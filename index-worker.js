"use strict";

const fs = require("fs");
const path = require("path");
const { once } = require("events");
const mammoth = require("mammoth");
const PDFParser = require("pdf2json");
const XLSX = require("xlsx");

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
 * Write Excel content incrementally.
 *
 * The previous Excel implementation loaded the complete workbook and then
 * created a second in-memory rows array plus one large text string.  Large
 * workbooks could therefore exceed the worker heap.
 *
 * This version keeps the existing RAG text format but:
 * - reads workbook sheet names first;
 * - parses one worksheet at a time;
 * - walks cells directly instead of creating a full rows array;
 * - writes RAG chunks incrementally instead of building one huge text string.
 *
 * Supported: .xlsx, .xls, .xlsm and .xlsb.
 */
async function writeExcelChunks(
  inputPath,
  output,
  folder
) {
  const workbookInfo =
    XLSX.readFile(
      inputPath,
      {
        bookSheets: true,
        bookProps: false
      }
    );

  const sheetNames =
    Array.isArray(workbookInfo.SheetNames)
      ? [...workbookInfo.SheetNames]
      : [];

  let buffer = "";
  let chunkCount = 0;

  const flushReadyChunks = async () => {
    while (buffer.length >= CHUNK_SIZE) {
      const content =
        buffer
          .slice(0, CHUNK_SIZE)
          .trim();

      if (content) {
        await writeLine(
          output,
          {
            file: displayPath,
            folder,
            content
          }
        );

        chunkCount += 1;
      }

      buffer =
        buffer.slice(CHUNK_STEP);
    }
  };

  const appendText = async value => {
    const cleaned =
      cleanText(value);

    if (!cleaned) return;

    buffer +=
      buffer
        ? ` ${cleaned}`
        : cleaned;

    await flushReadyChunks();
  };

  for (const sheetName of sheetNames) {
    let workbook =
      XLSX.readFile(
        inputPath,
        {
          sheets: sheetName,
          cellDates: true,
          raw: false,
          cellFormula: false,
          cellHTML: false,
          cellNF: false,
          cellStyles: false,
          bookVBA: false,
          bookFiles: false
        }
      );

    const sheet =
      workbook.Sheets?.[sheetName];

    if (!sheet || !sheet["!ref"]) {
      workbook = null;
      continue;
    }

    const range =
      XLSX.utils.decode_range(
        sheet["!ref"]
      );

    for (
      let rowIndex = range.s.r;
      rowIndex <= range.e.r;
      rowIndex += 1
    ) {
      const cells = [];
      let hasValue = false;

      for (
        let columnIndex = range.s.c;
        columnIndex <= range.e.c;
        columnIndex += 1
      ) {
        const address =
          XLSX.utils.encode_cell({
            r: rowIndex,
            c: columnIndex
          });

        const cell =
          sheet[address];

        let value = "";

        if (cell) {
          if (typeof cell.w === "string") {
            value = cell.w;
          } else if (cell.v !== undefined && cell.v !== null) {
            try {
              value =
                XLSX.utils.format_cell(cell);
            } catch {
              value =
                String(cell.v);
            }
          }
        }

        value =
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();

        if (value) {
          hasValue = true;
        }

        cells.push(value);
      }

      if (!hasValue) {
        continue;
      }

      await appendText(
        `Worksheet: ${sheetName} | Row ${rowIndex + 1}: ` +
        cells.join(" | ")
      );
    }

    workbook = null;
  }

  const remaining =
    buffer.trim();

  if (remaining) {
    await writeLine(
      output,
      {
        file: displayPath,
        folder,
        content: remaining
      }
    );

    chunkCount += 1;
  }

  return chunkCount;
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
  } else if (
    lowerPath.endsWith(".xlsx") ||
    lowerPath.endsWith(".xls") ||
    lowerPath.endsWith(".xlsm") ||
    lowerPath.endsWith(".xlsb")
  ) {
    /*
     * Excel is written incrementally after the output stream is opened.
     */
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
    if (
      lowerPath.endsWith(".xlsx") ||
      lowerPath.endsWith(".xls") ||
      lowerPath.endsWith(".xlsm") ||
      lowerPath.endsWith(".xlsb")
    ) {
      chunkCount =
        await writeExcelChunks(
          filePath,
          output,
          folder
        );
    } else {
      chunkCount =
        await writeChunks(
          extractedText,
          output,
          folder
        );
    }

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
