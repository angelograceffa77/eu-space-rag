"use strict";

const fs = require("fs");
const path = require("path");
const { once } = require("events");
const mammoth = require("mammoth");
const PDFParser = require("pdf2json");

const filePath = process.argv[2];
const outputPath = process.argv[3];
const displayPath = process.argv[4];

if (!filePath || !outputPath || !displayPath) {
  process.exit(2);
}

async function readDocx(inputPath) {
  const result = await mammoth.extractRawText({
    path: inputPath
  });

  return result.value || "";
}

function readPdf(inputPath) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    const cleanup = () => parser.removeAllListeners();

    parser.on("pdfParser_dataError", error => {
      cleanup();

      reject(new Error(String(
        error?.parserError?.message ||
        error?.parserError ||
        error?.message ||
        "Unknown PDF parsing error"
      )));
    });

    parser.on("pdfParser_dataReady", pdfData => {
      try {
        const pages = [];

        for (const page of pdfData.Pages || []) {
          const words = [];

          for (const item of page.Texts || []) {
            for (const run of item.R || []) {
              const raw = String(run.T || "");

              try {
                words.push(decodeURIComponent(raw));
              } catch {
                words.push(raw);
              }
            }
          }

          pages.push(words.join(" "));
        }

        cleanup();
        resolve(pages.join("\n"));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    try {
      parser.loadPDF(inputPath);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function splitText(text, size = 1400, overlap = 200) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return [];

  const safeSize = Math.max(size, 200);
  const safeOverlap = Math.min(
    Math.max(overlap, 0),
    safeSize - 1
  );
  const step = safeSize - safeOverlap;
  const parts = [];

  for (let start = 0; start < clean.length; start += step) {
    const part = clean
      .slice(start, start + safeSize)
      .trim();

    if (part) parts.push(part);
  }

  return parts;
}

async function writeLine(stream, value) {
  if (!stream.write(`${value}\n`, "utf8")) {
    await once(stream, "drain");
  }
}

async function closeStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(resolve);
  });
}

async function main() {
  const lower = filePath.toLowerCase();

  let text = "";

  if (lower.endsWith(".docx")) {
    text = await readDocx(filePath);
  } else if (lower.endsWith(".pdf")) {
    text = await readPdf(filePath);
  } else {
    throw new Error("Unsupported file type");
  }

  const parts = splitText(text);
  const folder = path.basename(path.dirname(displayPath));

  const output = fs.createWriteStream(outputPath, {
    encoding: "utf8",
    flags: "w"
  });

  try {
    for (const content of parts) {
      await writeLine(
        output,
        JSON.stringify({
          file: displayPath,
          folder,
          content
        })
      );
    }

    await closeStream(output);
  } catch (error) {
    output.destroy();
    throw error;
  }

  if (process.send) {
    process.send({
      ok: true,
      chunks: parts.length
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error.stack || error.message);

    if (process.send) {
      process.send({
        ok: false,
        error: error.message
      });
    }

    process.exit(1);
  });
