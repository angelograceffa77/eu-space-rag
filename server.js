"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { once } = require("events");
const mammoth = require("mammoth");
const PDFParser = require("pdf2json");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const ROOT_PATH = __dirname;

/*
 * On Render, set INDEX_FILE to a persistent-disk location,
 * for example:
 *
 * /var/data/rag-index.ndjson
 *
 * Without a persistent disk, the generated index may disappear
 * after a new deployment.
 */
const INDEX_FILE =
  process.env.INDEX_FILE ||
  path.join(ROOT_PATH, "rag-index.ndjson");

/*
 * Large PDFs can consume significant memory during extraction.
 * Change this value through the Render environment variable:
 *
 * MAX_FILE_SIZE_MB=40
 */
const MAX_FILE_SIZE_MB = Math.max(
  Number.parseInt(process.env.MAX_FILE_SIZE_MB || "40", 10),
  1
);

const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/*
 * Limit the number of search results that can be requested.
 */
const MAX_TOP_K = 20;

/*
 * These are the folders searched recursively for PDF and DOCX files.
 */
const SOURCE_FOLDERS = [
  "00_GPT_CONFIGURATION",
  "01_POLICY",
  "02_LAW",
  "03_PROCUREMENT",
  "04_FUNDING",
  "05_COMPANIES"
].map(folder => path.join(ROOT_PATH, folder));

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".vscode",
  "dist",
  "build"
]);
const IGNORE_FILES = new Set([
  "ESA-REG-001_rev5_EN.pdf"
]);
/*
 * The searchable index is kept in memory after being loaded.
 */
let chunks = [];
let rebuildInProgress = false;
let indexLoadedAt = null;

/*
 * Return a path without exposing the full Render filesystem path.
 */
function relativeFilePath(filePath) {
  return path.relative(ROOT_PATH, filePath).replace(/\\/g, "/");
}

/*
 * Find all PDF and DOCX files recursively.
 */
function listFiles(folder) {
  const results = [];

  if (!fs.existsSync(folder)) {
    return results;
  }

  let items;

  try {
    items = fs.readdirSync(folder, { withFileTypes: true });
  } catch (error) {
    console.error(`Could not read folder ${folder}: ${error.message}`);
    return results;
  }

  for (const item of items) {
    const fullPath = path.join(folder, item.name);

    if (item.isDirectory()) {
      if (!IGNORE_DIRS.has(item.name)) {
        results.push(...listFiles(fullPath));
      }

      continue;
    }

    if (!item.isFile()) {
      continue;
    }
if (IGNORE_FILES.has(item.name)) {
  console.warn(`Skipped configured file: ${fullPath}`);
  continue;
}
    const lowerPath = fullPath.toLowerCase();

    if (lowerPath.endsWith(".docx") || lowerPath.endsWith(".pdf")) {
      results.push(fullPath);
    }
  }

  return results;
}

/*
 * Extract plain text from a DOCX file.
 */
async function readDocx(filePath) {
  const result = await mammoth.extractRawText({
    path: filePath
  });

  return result.value || "";
}

/*
 * Extract text from a PDF file.
 *
 * The parser processes one PDF at a time. This reduces the risk of
 * several large files being held in memory simultaneously.
 */
function readPdf(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    const cleanup = () => {
      pdfParser.removeAllListeners();
    };

    pdfParser.on("pdfParser_dataError", error => {
      cleanup();

      const message =
        error?.parserError?.message ||
        error?.parserError ||
        error?.message ||
        "Unknown PDF parsing error";

      reject(new Error(String(message)));
    });

    pdfParser.on("pdfParser_dataReady", pdfData => {
      try {
        const pageTexts = [];

        for (const page of pdfData.Pages || []) {
          const currentPage = [];

          for (const item of page.Texts || []) {
            for (const run of item.R || []) {
              const rawText = String(run.T || "");

              try {
                currentPage.push(decodeURIComponent(rawText));
              } catch {
                currentPage.push(rawText);
              }
            }
          }

          pageTexts.push(currentPage.join(" "));
        }

        cleanup();
        resolve(pageTexts.join("\n"));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    try {
      pdfParser.loadPDF(filePath);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/*
 * Divide extracted text into overlapping searchable chunks.
 */
function splitText(text, size = 1400, overlap = 200) {
  const cleanText = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) {
    return [];
  }

  const safeSize = Math.max(size, 200);
  const safeOverlap = Math.min(Math.max(overlap, 0), safeSize - 1);
  const step = safeSize - safeOverlap;
  const parts = [];

  for (let start = 0; start < cleanText.length; start += step) {
    const part = cleanText.slice(start, start + safeSize).trim();

    if (part) {
      parts.push(part);
    }
  }

  return parts;
}

/*
 * Convert the search request into useful search terms.
 */
function getQueryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(term => term.trim())
    .filter(term => term.length > 2);
}

/*
 * Count the number of occurrences of a term without constructing
 * a regular expression.
 */
function countOccurrences(text, term) {
  let count = 0;
  let position = 0;

  while (true) {
    position = text.indexOf(term, position);

    if (position === -1) {
      break;
    }

    count += 1;
    position += term.length;
  }

  return count;
}

/*
 * Score one chunk against the user's search terms.
 */
function scoreChunk(queryTerms, content) {
  const text = String(content || "").toLowerCase();

  if (!text || queryTerms.length === 0) {
    return 0;
  }

  let score = 0;

  for (const term of queryTerms) {
    score += countOccurrences(text, term);
  }

  return score;
}

/*
 * Search the in-memory index.
 */
function searchIndex(query, topK) {
  const queryTerms = getQueryTerms(query);

  if (queryTerms.length === 0) {
    return [];
  }

  const scoredResults = [];

  for (const chunk of chunks) {
    const score = scoreChunk(queryTerms, chunk.content);

    if (score > 0) {
      scoredResults.push({
        file: chunk.file,
        folder: chunk.folder,
        content: chunk.content,
        score
      });
    }
  }

  scoredResults.sort((a, b) => b.score - a.score);

  return scoredResults.slice(0, topK);
}

/*
 * Ensure the folder containing the index exists.
 */
function ensureIndexDirectory() {
  const indexDirectory = path.dirname(INDEX_FILE);

  if (!fs.existsSync(indexDirectory)) {
    fs.mkdirSync(indexDirectory, {
      recursive: true
    });
  }
}

/*
 * Write one line to a file stream while respecting backpressure.
 */
async function writeLine(stream, value) {
  const canContinue = stream.write(`${value}\n`, "utf8");

  if (!canContinue) {
    await once(stream, "drain");
  }
}

/*
 * Close a writable stream safely.
 */
function closeWriteStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(resolve);
  });
}

/*
 * Load the saved NDJSON index one line at a time.
 *
 * NDJSON means that each line is a separate JSON object. This avoids
 * calling JSON.parse on one very large JSON array.
 */
async function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    console.log(`No saved index found at ${INDEX_FILE}`);
    chunks = [];
    indexLoadedAt = null;
    return false;
  }

  const loadedChunks = [];
  let invalidLines = 0;

  const input = fs.createReadStream(INDEX_FILE, {
    encoding: "utf8"
  });

  const lineReader = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  try {
    for await (const line of lineReader) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        continue;
      }

      try {
        const item = JSON.parse(trimmedLine);

        if (
          typeof item.file === "string" &&
          typeof item.folder === "string" &&
          typeof item.content === "string"
        ) {
          loadedChunks.push(item);
        } else {
          invalidLines += 1;
        }
      } catch {
        invalidLines += 1;
      }
    }
  } catch (error) {
    console.error(`Could not load index: ${error.message}`);
    chunks = [];
    indexLoadedAt = null;
    return false;
  }

  chunks = loadedChunks;
  indexLoadedAt = new Date().toISOString();

  console.log(`Loaded ${chunks.length} chunks from the saved index.`);

  if (invalidLines > 0) {
    console.warn(`Ignored ${invalidLines} invalid index lines.`);
  }

  return true;
}

/*
 * Rebuild the index.
 *
 * Important memory-saving behaviour:
 *
 * 1. Only one document is extracted at a time.
 * 2. Chunks are written directly to a temporary index file.
 * 3. The complete extracted text of every document is not retained.
 * 4. The temporary index replaces the old index only after success.
 */
async function buildIndex() {
  ensureIndexDirectory();

  const temporaryIndexFile = `${INDEX_FILE}.tmp`;
  const files = SOURCE_FOLDERS
    .flatMap(folder => listFiles(folder))
    .sort((a, b) => a.localeCompare(b));

  console.log("Building local RAG index...");
  console.log(`Found ${files.length} DOCX/PDF files.`);
  console.log(`Maximum file size: ${MAX_FILE_SIZE_MB} MB`);

  const output = fs.createWriteStream(temporaryIndexFile, {
    encoding: "utf8",
    flags: "w"
  });

  let indexedFiles = 0;
  let skippedFiles = 0;
  let failedFiles = 0;
  let totalChunks = 0;

  try {
    for (const filePath of files) {
      const displayPath = relativeFilePath(filePath);
      console.log(`Processing: ${displayPath}`);
      try {
        const fileStats = await fs.promises.stat(filePath);

        if (fileStats.size > MAX_FILE_SIZE_BYTES) {
          skippedFiles += 1;

          console.warn(
            `Skipped large file: ${displayPath} ` +
            `(${Math.ceil(fileStats.size / 1024 / 1024)} MB)`
          );

          continue;
        }

        let text = "";

        if (filePath.toLowerCase().endsWith(".docx")) {
          text = await readDocx(filePath);
        } else if (filePath.toLowerCase().endsWith(".pdf")) {
          text = await readPdf(filePath);
        }

        const parts = splitText(text);
        const folder = path.basename(path.dirname(filePath));

        for (const content of parts) {
          const chunk = {
            file: displayPath,
            folder,
            content
          };

          await writeLine(output, JSON.stringify(chunk));
          totalChunks += 1;
        }

        indexedFiles += 1;

        console.log(
          `Indexed: ${displayPath} (${parts.length} parts)`
        );

        /*
         * Remove references to the extracted document text before
         * processing the next file.
         */
        text = "";
      } catch (error) {
        failedFiles += 1;

        console.error(
          `Failed to index ${displayPath}: ${error.message}`
        );
      }
    }

    await closeWriteStream(output);

    /*
     * Replace the existing index only after the new index has been
     * created successfully.
     */
    await fs.promises.rm(INDEX_FILE, {
      force: true
    });

    await fs.promises.rename(
      temporaryIndexFile,
      INDEX_FILE
    );

    /*
     * Load the newly created index into memory.
     */
    await loadIndex();

    console.log("Index rebuild completed.");
    console.log(`Indexed files: ${indexedFiles}`);
    console.log(`Skipped files: ${skippedFiles}`);
    console.log(`Failed files: ${failedFiles}`);
    console.log(`Total chunks: ${totalChunks}`);

    return {
      indexedFiles,
      skippedFiles,
      failedFiles,
      indexedChunks: chunks.length
    };
  } catch (error) {
    output.destroy();

    try {
      await fs.promises.rm(temporaryIndexFile, {
        force: true
      });
    } catch {
      // Ignore temporary-file cleanup errors.
    }

    throw error;
  }
}

/*
 * Optional protection for the rebuild endpoint.
 *
 * In Render, create:
 *
 * RAG_ADMIN_TOKEN=your-long-random-secret
 *
 * Then send the same value in:
 *
 * x-rag-admin-token
 *
 * When RAG_ADMIN_TOKEN is not configured, rebuilding is refused.
 */
function requireAdminToken(req, res, next) {
  const expectedToken = process.env.RAG_ADMIN_TOKEN;
  const suppliedToken = req.get("x-rag-admin-token");

  if (!expectedToken) {
    return res.status(503).json({
      error: "RAG_ADMIN_TOKEN is not configured"
    });
  }

  if (!suppliedToken || suppliedToken !== expectedToken) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

/*
 * Basic status endpoint.
 */
app.get("/", (req, res) => {
  res.json({
    status: "EU Space local RAG API running",
    indexedChunks: chunks.length,
    indexLoaded: chunks.length > 0,
    indexLoadedAt,
    rebuildInProgress,
    indexFile: INDEX_FILE,
    maximumFileSizeMB: MAX_FILE_SIZE_MB,
    folders: SOURCE_FOLDERS.map(folder =>
      path.relative(ROOT_PATH, folder).replace(/\\/g, "/")
    )
  });
});

/*
 * Health endpoint for Render.
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    indexedChunks: chunks.length,
    rebuildInProgress
  });
});

/*
 * Existing POST search endpoint.
 *
 * This remains compatible with the OpenAPI schema you supplied.
 */
app.post("/rag/search", (req, res) => {
  const query =
    typeof req.body?.query === "string"
      ? req.body.query.trim()
      : "";

  const requestedTopK = Number.parseInt(
    req.body?.topK ?? "5",
    10
  );

  const topK = Number.isFinite(requestedTopK)
    ? Math.min(Math.max(requestedTopK, 1), MAX_TOP_K)
    : 5;

  if (!query) {
    return res.status(400).json({
      error: "Missing query"
    });
  }

  if (chunks.length === 0) {
    return res.status(503).json({
      error:
        "The search index is empty. An administrator must rebuild the index."
    });
  }

  const results = searchIndex(query, topK);

  res.json({
    query,
    results,
    indexedChunks: chunks.length
  });
});

/*
 * Protected rebuild endpoint.
 *
 * Only one rebuild can run at a time.
 */
app.post(
  "/rag/rebuild",
  requireAdminToken,
  (req, res) => {
    if (rebuildInProgress) {
      return res.status(409).json({
        error: "An index rebuild is already running"
      });
    }

    rebuildInProgress = true;

    res.status(202).json({
      status: "Index rebuild started"
    });

    buildIndex()
      .then(result => {
        console.log("Background rebuild completed:", result);
      })
      .catch(error => {
        console.error(
          `Background rebuild failed: ${error.message}`
        );
      })
      .finally(() => {
        rebuildInProgress = false;
      });
  }
);
  
/*
 * Central error handler.
 */
app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "Internal server error"
  });
});

/*
 * Start the API.
 *
 * The server loads an existing index but does not automatically rebuild
 * all documents. This prevents a full rebuild after every Render restart.
 */
app.listen(PORT, async () => {
  console.log(`RAG API running on port ${PORT}`);

  try {
    await loadIndex();
  } catch (error) {
    console.error(`Startup index loading failed: ${error.message}`);
  }
});
