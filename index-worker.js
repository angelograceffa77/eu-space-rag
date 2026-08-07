"use strict";

const fs = require("fs");
const path = require("path");
const { once } = require("events");
const mammoth = require("mammoth");
const PDFParser = require("pdf2json");

/*
 * Arguments received from index-manager.js:
 *
 * 1. Full source-file path
 * 2. Temporary worker-output path
 * 3. Repository-relative display path
 */
const filePath = process.argv[2];
const outputPath = process.argv[3];
const displayPath = process.argv[4];

if (
  !filePath ||
  !outputPath ||
  !displayPath
) {
  console.error(
    "Missing worker arguments."
  );

  process.exit(2);
}

/*
 * Chunk settings.
 */
const CHUNK_SIZE = Math.max(
  Number.parseInt(
    process.env.CHUNK_SIZE || "1400",
    10
  ),
  200
);

const requestedOverlap =
  Number.parseInt(
    process.env.CHUNK_OVERLAP || "200",
    10
  );

const CHUNK_OVERLAP =
  Math.min(
    Math.max(
      Number.isFinite(requestedOverlap)
        ? requestedOverlap
        : 200,
      0
    ),
    CHUNK_SIZE - 1
  );

const CHUNK_STEP =
  CHUNK_SIZE -
  CHUNK_OVERLAP;

/*
 * Extract text from a DOCX file.
 */
async function readDocx(
  inputPath
) {
  const result =
    await mammoth.extractRawText({
      path: inputPath
    });

  return result.value || "";
}

/*
 * Extract text from a PDF.
 *
 * pdf2json still needs to parse the PDF, but this
 * version avoids keeping separate page and word
 * arrays after extraction.
 */
function readPdf(
  inputPath
) {
  return new Promise(
    (resolve, reject) => {
      const parser =
        new PDFParser();

      let completed = false;

      const cleanup = () => {
        parser.removeAllListeners();
      };

      const fail = error => {
        if (completed) {
          return;
        }

        completed = true;
        cleanup();

        reject(error);
      };

      parser.on(
        "pdfParser_dataError",
        error => {
          const message =
            error?.parserError?.message ||
            error?.parserError ||
            error?.message ||
            "Unknown PDF parsing error";

          fail(
            new Error(
              String(message)
            )
          );
        }
      );

      parser.on(
        "pdfParser_dataReady",
        pdfData => {
          if (completed) {
            return;
          }

          try {
            /*
             * Build one text string.
             *
             * We avoid creating a second array containing
             * every complete page.
             */
            let text = "";

            for (
              const page
              of pdfData.Pages || []
            ) {
              for (
                const item
                of page.Texts || []
              ) {
                for (
                  const run
                  of item.R || []
                ) {
                  const rawText =
                    String(
                      run.T || ""
                    );

                  try {
                    text +=
                      decodeURIComponent(
                        rawText
                      );
                  } catch {
                    text +=
                      rawText;
                  }

                  text += " ";
                }
              }

              text += "\n";
            }

            completed = true;
            cleanup();

            resolve(text);
          } catch (error) {
            fail(error);
          }
        }
      );

      try {
        parser.loadPDF(
          inputPath
        );
      } catch (error) {
        fail(error);
      }
    }
  );
}

/*
 * Normalise extracted text.
 */
function cleanText(
  text
) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Write one line while respecting stream
 * backpressure.
 */
async function writeLine(
  stream,
  value
) {
  const line =
    `${JSON.stringify(value)}\n`;

  const canContinue =
    stream.write(
      line,
      "utf8"
    );

  if (!canContinue) {
    await once(
      stream,
      "drain"
    );
  }
}

/*
 * Close a writable stream safely.
 */
function closeWriteStream(
  stream
) {
  return new Promise(
    (resolve, reject) => {
      stream.once(
        "error",
        reject
      );

      stream.end(resolve);
    }
  );
}

/*
 * Divide the text into chunks and write each
 * chunk immediately.
 *
 * The complete chunks are not stored in an array.
 */
async function writeChunks(
  text,
  output,
  folder
) {
  const cleaned =
    cleanText(text);

  if (!cleaned) {
    return 0;
  }

  let chunkCount = 0;

  for (
    let start = 0;
    start < cleaned.length;
    start += CHUNK_STEP
  ) {
    const content =
      cleaned
        .slice(
          start,
          start + CHUNK_SIZE
        )
        .trim();

    if (!content) {
      continue;
    }

    await writeLine(
      output,
      {
        file:
          displayPath,

        folder,

        content
      }
    );

    chunkCount += 1;
  }

  return chunkCount;
}

/*
 * Main worker process.
 */
async function main() {
  const lowerPath =
    filePath.toLowerCase();

  let extractedText = "";

  if (
    lowerPath.endsWith(".docx")
  ) {
    extractedText =
      await readDocx(
        filePath
      );
  } else if (
    lowerPath.endsWith(".pdf")
  ) {
    extractedText =
      await readPdf(
        filePath
      );
  } else {
    throw new Error(
      "Unsupported file type"
    );
  }

  const folder =
    path.basename(
      path.dirname(
        displayPath
      )
    );

  const output =
    fs.createWriteStream(
      outputPath,
      {
        encoding: "utf8",
        flags: "w"
      }
    );

  let chunkCount = 0;

  try {
    chunkCount =
      await writeChunks(
        extractedText,
        output,
        folder
      );

    /*
     * Release the extracted text reference before
     * closing the worker.
     */
    extractedText = "";

    await closeWriteStream(
      output
    );
  } catch (error) {
    output.destroy();

    try {
      await fs.promises.rm(
        outputPath,
        {
          force: true
        }
      );
    } catch {
      /*
       * Ignore cleanup errors.
       */
    }

    throw error;
  }

  if (process.send) {
    process.send({
      ok: true,
      chunks: chunkCount
    });
  }
}

/*
 * Run the worker.
 */
main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      error.stack ||
      error.message
    );

    if (process.send) {
      process.send({
        ok: false,
        error:
          error.message
      });
    }

    process.exit(1);
  });
