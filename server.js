const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const PDFParser = require("pdf2json");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const DESKTOP_PATH = __dirname;

const SOURCE_FOLDERS = [
  "00_GPT_CONFIGURATION",
  "01_POLICY",
  "02_LAW",
  "03_PROCUREMENT",
  "04_FUNDING",
  "05_COMPANIES"
].map(folder => path.join(DESKTOP_PATH, folder));

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".vscode",
  "dist",
  "build"
]);

let chunks = [];

function listFiles(folder) {
  let results = [];
  if (!fs.existsSync(folder)) return results;

  for (const item of fs.readdirSync(folder)) {
    const fullPath = path.join(folder, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.has(item)) {
        results = results.concat(listFiles(fullPath));
      }
    } else if (
      fullPath.toLowerCase().endsWith(".docx") ||
      fullPath.toLowerCase().endsWith(".pdf")
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

async function readDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || "";
}

function readPdf(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", err => reject(err.parserError));
    pdfParser.on("pdfParser_dataReady", pdfData => {
      let text = "";

      for (const page of pdfData.Pages || []) {
        for (const item of page.Texts || []) {
          for (const run of item.R || []) {
            try {
  text += decodeURIComponent(run.T) + " ";
} catch {
  text += run.T + " ";
};
          }
        }
        text += "\n";
      }

      resolve(text);
    });

    pdfParser.loadPDF(filePath);
  });
}

function splitText(text, size = 1400, overlap = 200) {
  const clean = text.replace(/\s+/g, " ").trim();
  const parts = [];

  for (let i = 0; i < clean.length; i += size - overlap) {
    const part = clean.slice(i, i + size);
    if (part.length > 0) parts.push(part);
  }

  return parts;
}

function scoreChunk(query, content) {
  const queryTerms = query
    .toLowerCase()
    .split(/\W+/)
    .filter(term => term.length > 2);

  const text = content.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    const matches = (text.match(new RegExp(term, "g")) || []).length;
console.log("Searching:", term, "Matches:", matches);
    score += matches;
  }

  return score;
}

async function buildIndex() {
  console.log("Building local RAG index...");
  chunks = [];

  const files = SOURCE_FOLDERS.flatMap(folder => listFiles(folder));
  console.log(`Found ${files.length} DOCX/PDF files.`);

  for (const file of files) {
    try {
      let text = "";

      if (file.toLowerCase().endsWith(".docx")) {
        text = await readDocx(file);
        console.log(text.substring(0, 1000));
      } else if (file.toLowerCase().endsWith(".pdf")) {
        text = await readPdf(file);
      }

      const parts = splitText(text);
console.log("Parts:", parts.length);
if (file.includes("AG.docx")) {
  console.log("FULL TEXT HAS TOKEN:", text.includes("987654321"));
  console.log("FIRST PART HAS TOKEN:", parts[0]?.includes("987654321"));
}

      for (const content of parts) {
    chunks.push({
  file,
  folder: path.basename(path.dirname(file)),
  content
});

if (file.includes("AG.docx")) {
    console.log("Chunk contains token:", content.includes("987654321"));
}

if (file.includes("AG.docx")) {
    console.log(content);
}
      }

      console.log(`Indexed: ${file}`);
    } catch (err) {
      console.error(`Failed to index ${file}: ${err.message}`);
    }
  }

  console.log(`Index ready. Total chunks: ${chunks.length}`);
}

app.get("/", (req, res) => {
  res.json({
    status: "EU Space local RAG API running",
    indexedChunks: chunks.length,
    folders: SOURCE_FOLDERS
  });
});

app.post("/rag/search", (req, res) => {
  const { query, topK = 5 } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Missing query" });
  }

  const results = chunks
    .map(chunk => ({
      file: chunk.file,
      folder: chunk.folder,
      content: chunk.content,
      score: scoreChunk(query, chunk.content)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  res.json({ query, results });
});

app.post("/rag/rebuild", async (req, res) => {
  await buildIndex();
  res.json({
    status: "Index rebuilt",
    indexedChunks: chunks.length
  });
});

app.listen(PORT, async () => {
  console.log(`RAG API running on http://localhost:${PORT}`);
  await buildIndex();
});
