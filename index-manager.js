"use strict";

/* Multilingual search ranking v3: path targeting + substantive chunk relevance. */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const readline = require("readline");
const { once } = require("events");
const { fork, execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const ROOT_PATH = __dirname;

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
  "build",
  "index"
]);

const GITHUB_OWNER =
  process.env.GITHUB_OWNER || "angelograceffa77";
const GITHUB_REPO =
  process.env.GITHUB_REPO || "eu-space-rag";
const GITHUB_BRANCH =
  process.env.GITHUB_BRANCH || "main";
const GITHUB_INDEX_DIR =
  process.env.GITHUB_INDEX_DIR || "index";
const GITHUB_CHECKPOINT_DIR =
  `${GITHUB_INDEX_DIR}/checkpoint`;

const SHARD_SIZE_MB = Math.max(
  Number.parseInt(process.env.SHARD_SIZE_MB || "20", 10),
  5
);
const SHARD_SIZE_BYTES = SHARD_SIZE_MB * 1024 * 1024;

const WORKER_MEMORY_MB = Math.max(
  Number.parseInt(process.env.WORKER_MEMORY_MB || "180", 10),
  128
);
const WORKER_TIMEOUT_MS = Math.max(
  Number.parseInt(process.env.WORKER_TIMEOUT_MS || "300000", 10),
  30000
);
const WORKER_KILL_GRACE_MS = Math.max(
  Number.parseInt(process.env.WORKER_KILL_GRACE_MS || "5000", 10),
  1000
);
const CHECKPOINT_EVERY_FILES = Math.max(
  Number.parseInt(process.env.CHECKPOINT_EVERY_FILES || "10", 10),
  1
);

const BUILD_COMMIT =
  process.env.RENDER_GIT_COMMIT ||
  process.env.GITHUB_SHA ||
  null;

const LOCAL_INDEX_ROOT = path.join(
  os.tmpdir(),
  "eu-space-rag-index"
);
const LOCAL_CHECKPOINT_ROOT = path.join(
  os.tmpdir(),
  "eu-space-rag-checkpoint"
);

let manifest = null;
let searchManifest = null;
let searchRoot = null;
let searchMode = "none";

let rebuildInProgress = false;
let indexLoadedAt = null;
let lastRebuildAt = null;
let lastPublishedAt = null;
let lastCheckpointAt = null;
let lastError = null;
let lastReport = null;

function getStatus() {
  return {
    indexedChunks: searchManifest?.totalChunks || 0,
    indexLoaded: Boolean(
      searchManifest && searchManifest.totalChunks > 0
    ),
    indexMode: searchMode,
    finalIndexedChunks: manifest?.totalChunks || 0,
    indexLoadedAt,
    rebuildInProgress,
    lastRebuildAt,
    lastPublishedAt,
    lastCheckpointAt,
    lastError,
    lastReport,
    githubIndexDirectory:
      `${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_INDEX_DIR}`,
    githubCheckpointDirectory:
      `${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_CHECKPOINT_DIR}`,
    shardSizeMB: SHARD_SIZE_MB,
    workerMemoryMB: WORKER_MEMORY_MB,
    workerTimeoutMS: WORKER_TIMEOUT_MS,
    workerKillGraceMS: WORKER_KILL_GRACE_MS,
    checkpointEveryFiles: CHECKPOINT_EVERY_FILES,
    buildCommit: BUILD_COMMIT
  };
}

function relativeFilePath(filePath) {
  return path
    .relative(ROOT_PATH, filePath)
    .replace(/\\/g, "/");
}

function listFiles(folder) {
  const results = [];
  if (!fs.existsSync(folder)) return results;

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

    if (!item.isFile()) continue;

    const lowerName = item.name.toLowerCase();
    if (
      lowerName.endsWith(".pdf") ||
      lowerName.endsWith(".docx")
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

function normaliseSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getQueryTerms(query) {
  return normaliseSearchText(query)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(term => term.trim())
    .filter(term => term.length > 2);
}

/*
 * Very common space-policy/legal words are useful, but they should not
 * dominate the ranking.  More distinctive words (for example Italy / Italia,
 * France, CNES, ASI, etc.) receive a stronger weight automatically.
 *
 * This is deliberately a compact list rather than a dictionary.  The GPT
 * still supplies translated alternateQueries; this code only improves how
 * those queries are ranked.
 */
const GENERIC_QUERY_TERMS = new Set([
  "space", "spatial", "spatiale", "spaziale", "raumfahrt", "kosmiczny",
  "law", "laws", "legal", "legislation", "legislative", "regulation",
  "regulations", "legge", "leggi", "diritto", "loi", "lois", "droit",
  "gesetz", "recht", "prawo", "zakon", "zakona", "zakonem",
  "policy", "policies", "politica", "politique", "politik", "polityka",
  "strategy", "strategies", "strategia", "strategie", "strategii",
  "national", "nationale", "nazionale", "nationaler", "narodowa", "narodni",
  "operator", "operators", "operatore", "operatori", "operateur", "operateurs",
  "licensing", "licence", "license", "authorisation", "authorization",
  "autorizzazione", "autorizzazioni", "autorisation", "genehmigung",
  "act", "acts", "programme", "program", "programmes", "programma",
  "agency", "agencies", "agenzia", "agence", "agentur",
  "government", "ministry", "commission", "council", "parliament",
  "european", "europe", "union", "member", "state", "states"
].map(normaliseSearchText));

function countOccurrences(text, term) {
  let count = 0;
  let position = 0;

  while (true) {
    position = text.indexOf(term, position);
    if (position === -1) return count;
    count += 1;
    position += term.length;
  }
}

function addSearchResult(results, result, topK) {
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > topK) results.length = topK;
}

function uniqueSearchQueries(queryOrQueries) {
  const raw = Array.isArray(queryOrQueries)
    ? queryOrQueries
    : [queryOrQueries];

  const seen = new Set();
  const queries = [];

  for (const value of raw) {
    if (typeof value !== "string") continue;
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = normaliseSearchText(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(cleaned);
  }

  return queries.slice(0, 8);
}

function scoreItemAgainstQuery(item, query) {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return null;

  const contentText = normaliseSearchText(item.content);
  const pathText = normaliseSearchText(`${item.file || ""} ${item.folder || ""}`);
  const phrase = normaliseSearchText(query).replace(/\s+/g, " ").trim();

  let score = 0;
  let contentMatchedTerms = 0;
  let distinctiveContentMatched = 0;
  let distinctivePathMatched = 0;
  const matched = [];

  for (const term of terms) {
    const contentHits = countOccurrences(contentText, term);
    const pathHits = countOccurrences(pathText, term);
    const distinctive = !GENERIC_QUERY_TERMS.has(term);

    /*
     * PATH RULE (v3):
     * The path is useful for country/institution targeting, but it must not
     * make an unrelated chunk relevant.  Therefore:
     * - generic words such as "law", "national" and "space" get NO path bonus;
     * - only distinctive words such as "Italy", "Italia", "CNES" or "ASI"
     *   can contribute a document-level path bonus.
     */
    if (distinctive && pathHits > 0) {
      distinctivePathMatched += 1;
    }

    if (contentHits <= 0) continue;

    contentMatchedTerms += 1;
    matched.push(term);

    if (distinctive) distinctiveContentMatched += 1;

    /*
     * CONTENT RULE:
     * Reward different concepts much more than repetition of one word.
     * Occurrence contribution is capped so a long chunk repeating "space"
     * cannot beat a chunk that actually covers several query concepts.
     */
    const cappedHits = Math.min(contentHits, 4);
    const weight = distinctive ? 8 : 3;
    score += cappedHits * weight;
  }

  /*
   * SUBSTANTIVE-MATCH GATE (v3):
   * A country/path match alone is never sufficient.  The actual chunk text
   * must match at least two query concepts.  This filters out unrelated pages
   * (for example medicine notices inside a large Italian gazette PDF) while
   * still allowing the Italy/Italia path to steer genuinely relevant chunks.
   */
  if (contentMatchedTerms < 2) return null;

  // Strongly reward coverage of several different concepts in the content.
  score += contentMatchedTerms * contentMatchedTerms * 6;

  // A distinctive term found in the text itself is particularly valuable.
  score += distinctiveContentMatched * 20;

  // Document-level country/institution bonus, applied only AFTER the chunk
  // has passed the substantive content gate above.
  score += distinctivePathMatched * 22;

  // Reward an exact multi-word phrase when present in the actual content.
  // The path is deliberately not phrase-scored in v3.
  if (phrase.length > 6 && contentText.includes(phrase)) {
    score += 35;
  }

  return {
    score,
    matchedTerms: matched,
    contentMatchedTerms,
    distinctivePathMatched
  };
}

async function searchIndex(queryOrQueries, topK) {
  const queries = uniqueSearchQueries(queryOrQueries);
  const activeManifest = searchManifest;
  const activeRoot = searchRoot;

  if (
    queries.length === 0 ||
    !activeManifest ||
    !activeRoot
  ) {
    return [];
  }

  const bestResults = [];

  for (const shard of activeManifest.shards || []) {
    const shardPath = path.join(activeRoot, shard.file);

    if (!fs.existsSync(shardPath)) {
      console.warn(`Missing searchable shard: ${shard.file}`);
      continue;
    }

    const input = fs.createReadStream(shardPath, { encoding: "utf8" });
    const reader = readline.createInterface({ input, crlfDelay: Infinity });

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let item;
        try {
          item = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (
          typeof item.file !== "string" ||
          typeof item.content !== "string"
        ) {
          continue;
        }

        // Configuration/instruction material should not compete with policy,
        // law, procurement, funding or company documents in ordinary search.
        if (item.file.startsWith("00_GPT_CONFIGURATION/")) {
          continue;
        }

        let bestQueryScore = 0;
        let matchedQueryCount = 0;
        const matchedQueries = [];
        const matchedTermsSet = new Set();

        for (const query of queries) {
          const scored = scoreItemAgainstQuery(item, query);
          if (!scored) continue;

          matchedQueryCount += 1;
          matchedQueries.push(query);
          for (const term of scored.matchedTerms) matchedTermsSet.add(term);
          bestQueryScore = Math.max(bestQueryScore, scored.score);
        }

        if (bestQueryScore <= 0) continue;

        // Small bonus when the same chunk is relevant in more than one
        // language/query.  This helps genuine multilingual matches without
        // allowing many weak translations to overwhelm the ranking.
        const score = bestQueryScore + Math.max(0, matchedQueryCount - 1) * 8;

        addSearchResult(
          bestResults,
          {
            file: item.file,
            folder: item.folder,
            content: item.content,
            score,
            matchedQueries,
            matchedTerms: [...matchedTermsSet]
          },
          topK
        );
      }
    } finally {
      reader.close();
      input.destroy();
    }
  }

  return bestResults;
}

/*
 * Reconstruct the complete extracted text of one indexed document.
 * Chunks are stored in document order.  Adjacent chunks overlap, so remove
 * the largest exact suffix/prefix overlap before joining them.
 */
function appendChunkWithoutDuplicateOverlap(currentText, nextChunk) {
  if (!currentText) return nextChunk;
  if (!nextChunk) return currentText;

  const maxOverlap = Math.min(1000, currentText.length, nextChunk.length);

  for (let size = maxOverlap; size >= 20; size -= 1) {
    if (currentText.slice(-size) === nextChunk.slice(0, size)) {
      return currentText + nextChunk.slice(size);
    }
  }

  return `${currentText} ${nextChunk}`;
}

async function readDocument(file, offset = 0, limit = 40000) {
  const requestedFile = String(file || "").trim().replace(/\\/g, "/");
  const activeManifest = searchManifest;
  const activeRoot = searchRoot;

  if (!requestedFile) {
    throw new Error("A document file path is required.");
  }

  if (!activeManifest || !activeRoot) {
    throw new Error("No searchable index is available.");
  }

  const chunks = [];

  for (const shard of activeManifest.shards || []) {
    const shardPath = path.join(activeRoot, shard.file);
    if (!fs.existsSync(shardPath)) continue;

    const input = fs.createReadStream(shardPath, { encoding: "utf8" });
    const reader = readline.createInterface({ input, crlfDelay: Infinity });

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let item;
        try {
          item = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (
          item.file === requestedFile &&
          typeof item.content === "string"
        ) {
          chunks.push(item.content);
        }
      }
    } finally {
      reader.close();
      input.destroy();
    }
  }

  if (chunks.length === 0) return null;

  let completeText = "";
  for (const chunk of chunks) {
    completeText = appendChunkWithoutDuplicateOverlap(completeText, chunk);
  }

  const safeOffset = Math.min(
    Math.max(Number.parseInt(offset, 10) || 0, 0),
    completeText.length
  );
  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 40000, 1000),
    60000
  );
  const end = Math.min(safeOffset + safeLimit, completeText.length);
  const text = completeText.slice(safeOffset, end);
  const hasMore = end < completeText.length;

  return {
    file: requestedFile,
    offset: safeOffset,
    returnedCharacters: text.length,
    totalCharacters: completeText.length,
    chunkCount: chunks.length,
    hasMore,
    nextOffset: hasMore ? end : null,
    text
  };
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);

    input.on("error", reject);
    input.on("data", data => hash.update(data));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function createSourceMap(files) {
  const sources = {};

  for (const filePath of files) {
    const displayPath = relativeFilePath(filePath);

    try {
      const stats = await fs.promises.stat(filePath);
      sources[displayPath] = {
        absolutePath: filePath,
        sha256: await hashFile(filePath),
        size: stats.size
      };
    } catch (error) {
      console.error(`Could not inspect ${displayPath}: ${error.message}`);
    }
  }

  return sources;
}

function rawGitHubUrl(repositoryPath) {
  const encodedPath = repositoryPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return (
    "https://raw.githubusercontent.com/" +
    `${encodeURIComponent(GITHUB_OWNER)}/` +
    `${encodeURIComponent(GITHUB_REPO)}/` +
    `${encodeURIComponent(GITHUB_BRANCH)}/` +
    encodedPath
  );
}

function closeWriteStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(resolve);
  });
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: { "User-Agent": "eu-space-rag-render" },
    redirect: "follow"
  });

  if (response.status === 404) return false;

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  await fs.promises.mkdir(path.dirname(destination), {
    recursive: true
  });

  const output = fs.createWriteStream(destination, { flags: "w" });

  try {
    for await (const data of response.body) {
      if (!output.write(data)) {
        await once(output, "drain");
      }
    }

    await closeWriteStream(output);
    return true;
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function downloadManifestAndShards(
  githubDirectory,
  localDirectory
) {
  await fs.promises.rm(localDirectory, {
    recursive: true,
    force: true
  });
  await fs.promises.mkdir(localDirectory, {
    recursive: true
  });

  const localManifestPath = path.join(
    localDirectory,
    "manifest.json"
  );

  const found = await downloadFile(
    rawGitHubUrl(`${githubDirectory}/manifest.json`),
    localManifestPath
  );

  if (!found) return null;

  const downloadedManifest = JSON.parse(
    await fs.promises.readFile(localManifestPath, "utf8")
  );

  if (!Array.isArray(downloadedManifest.shards)) {
    throw new Error(`Invalid manifest in ${githubDirectory}`);
  }

  for (const shard of downloadedManifest.shards) {
    if (typeof shard.file !== "string") {
      throw new Error(`Invalid shard entry in ${githubDirectory}`);
    }

    const localShardPath = path.join(localDirectory, shard.file);
    const shardFound = await downloadFile(
      rawGitHubUrl(`${githubDirectory}/${shard.file}`),
      localShardPath
    );

    if (!shardFound) {
      throw new Error(
        `Missing GitHub shard: ${githubDirectory}/${shard.file}`
      );
    }
  }

  return downloadedManifest;
}

async function loadIndexFromGitHub() {
  const downloadedManifest = await downloadManifestAndShards(
    GITHUB_INDEX_DIR,
    LOCAL_INDEX_ROOT
  );

  if (!downloadedManifest) {
    manifest = null;
    if (searchMode === "final") {
      searchManifest = null;
      searchRoot = null;
      searchMode = "none";
      indexLoadedAt = null;
    }
    return false;
  }

  manifest = downloadedManifest;
  searchManifest = downloadedManifest;
  searchRoot = LOCAL_INDEX_ROOT;
  searchMode = "final";
  indexLoadedAt = new Date().toISOString();

  console.log(
    `Loaded final index with ${manifest.totalChunks || 0} chunks ` +
    `in ${manifest.shards.length} shard files.`
  );

  return manifest.totalChunks > 0;
}

async function loadCheckpointFromGitHub() {
  const checkpointManifest = await downloadManifestAndShards(
    GITHUB_CHECKPOINT_DIR,
    LOCAL_CHECKPOINT_ROOT
  );

  if (!checkpointManifest) return null;

  if (
    checkpointManifest.buildCommit &&
    BUILD_COMMIT &&
    checkpointManifest.buildCommit !== BUILD_COMMIT
  ) {
    console.log(
      "A checkpoint exists, but it belongs to a different source commit. Ignoring it."
    );

    await fs.promises.rm(LOCAL_CHECKPOINT_ROOT, {
      recursive: true,
      force: true
    });

    return null;
  }

  searchManifest = checkpointManifest;
  searchRoot = LOCAL_CHECKPOINT_ROOT;
  searchMode = "checkpoint";
  indexLoadedAt = new Date().toISOString();

  return checkpointManifest;
}

class ShardWriter {
  constructor(
    outputDirectory,
    existingShards = [],
    existingTotalChunks = 0
  ) {
    this.outputDirectory = outputDirectory;
    this.shards = [...existingShards];
    this.shardNumber = existingShards.length;
    this.output = null;
    this.fileName = "";
    this.bytes = 0;
    this.chunkCount = 0;
    this.totalChunks = existingTotalChunks;
  }

  async openShard() {
    this.shardNumber += 1;
    this.fileName =
      `rag-index-${String(this.shardNumber).padStart(4, "0")}.ndjson`;

    this.output = fs.createWriteStream(
      path.join(this.outputDirectory, this.fileName),
      {
        encoding: "utf8",
        flags: "w"
      }
    );

    this.bytes = 0;
    this.chunkCount = 0;
  }

  async closeShard() {
    if (!this.output) return;

    await closeWriteStream(this.output);

    this.shards.push({
      file: this.fileName,
      chunks: this.chunkCount,
      bytes: this.bytes
    });

    this.output = null;
  }

  async writeItem(item) {
    const line = `${JSON.stringify(item)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");

    if (!this.output) {
      await this.openShard();
    }

    if (
      this.chunkCount > 0 &&
      this.bytes + lineBytes > SHARD_SIZE_BYTES
    ) {
      await this.closeShard();
      await this.openShard();
    }

    if (!this.output.write(line, "utf8")) {
      await once(this.output, "drain");
    }

    this.bytes += lineBytes;
    this.chunkCount += 1;
    this.totalChunks += 1;
  }

  async checkpoint() {
    await this.closeShard();
    return {
      shards: [...this.shards],
      totalChunks: this.totalChunks
    };
  }

  async finish() {
    return this.checkpoint();
  }
}

async function copyChunksForFiles(
  sourceShardPaths,
  wantedFiles,
  writer
) {
  let copiedChunks = 0;
  if (wantedFiles.size === 0) return copiedChunks;

  for (const shardPath of sourceShardPaths) {
    if (!fs.existsSync(shardPath)) continue;

    const input = fs.createReadStream(shardPath, {
      encoding: "utf8"
    });
    const reader = readline.createInterface({
      input,
      crlfDelay: Infinity
    });

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let item;
        try {
          item = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (wantedFiles.has(item.file)) {
          await writer.writeItem(item);
          copiedChunks += 1;
        }
      }
    } finally {
      reader.close();
      input.destroy();
    }
  }

  return copiedChunks;
}

function killWorkerProcess(child, signal) {
  if (!child || !child.pid) return false;

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Fall back to direct child.
    }
  }

  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function processFileInWorker(
  filePath,
  displayPath,
  outputPath
) {
  return new Promise(resolve => {
    const workerPath = path.join(ROOT_PATH, "index-worker.js");
    const child = fork(
      workerPath,
      [filePath, outputPath, displayPath],
      {
        detached: true,
        execArgv: [
          `--max-old-space-size=${WORKER_MEMORY_MB}`
        ],
        stdio: [
          "ignore",
          "inherit",
          "inherit",
          "ipc"
        ]
      }
    );

    let settled = false;
    let timedOut = false;
    let workerMessage = null;
    let timeoutTimer = null;
    let forceKillTimer = null;

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimers();

      try {
        if (child.connected) child.disconnect();
      } catch {
        // Ignore disconnect errors.
      }

      resolve(result);
    };

    console.log(
      `Worker started for ${displayPath}. ` +
      `Timeout: ${WORKER_TIMEOUT_MS} ms.`
    );

    timeoutTimer = setTimeout(() => {
      timedOut = true;

      console.warn(
        `Worker timeout reached for ${displayPath}. Sending SIGTERM.`
      );

      killWorkerProcess(child, "SIGTERM");

      forceKillTimer = setTimeout(() => {
        console.warn(`Force-killing worker for ${displayPath}.`);
        killWorkerProcess(child, "SIGKILL");

        finish({
          ok: false,
          reason: `Worker exceeded ${WORKER_TIMEOUT_MS} ms`
        });
      }, WORKER_KILL_GRACE_MS);
    }, WORKER_TIMEOUT_MS);

    child.on("message", message => {
      workerMessage = message;
    });

    child.on("error", error => {
      finish({
        ok: false,
        reason: error.message
      });
    });

    const finishFromExit = (code, signal, eventName) => {
      if (settled) return;

      if (timedOut) {
        finish({
          ok: false,
          reason: `Worker exceeded ${WORKER_TIMEOUT_MS} ms`
        });
        return;
      }

      if (code === 0 && workerMessage?.ok) {
        finish({
          ok: true,
          chunks: workerMessage.chunks
        });
        return;
      }

      finish({
        ok: false,
        reason:
          workerMessage?.error ||
          `Worker ${eventName} with code ${code}, signal ${signal}`
      });
    };

    child.on(
      "exit",
      (code, signal) => finishFromExit(code, signal, "stopped")
    );

    child.on(
      "close",
      (code, signal) => finishFromExit(code, signal, "closed")
    );
  });
}

async function appendWorkerFile(workerFile, writer) {
  let addedChunks = 0;

  const input = fs.createReadStream(workerFile, {
    encoding: "utf8"
  });
  const reader = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let item;
      try {
        item = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (
        typeof item.file !== "string" ||
        typeof item.content !== "string"
      ) {
        continue;
      }

      await writer.writeItem(item);
      addedChunks += 1;
    }
  } finally {
    reader.close();
    input.destroy();
  }

  return addedChunks;
}

function gitEnvironment() {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const basic = Buffer.from(
    `x-access-token:${token}`,
    "utf8"
  ).toString("base64");

  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0:
      `AUTHORIZATION: basic ${basic}`,
    GIT_TERMINAL_PROMPT: "0"
  };
}

async function runGit(args, workingDirectory) {
  const result = await execFileAsync(
    "git",
    args,
    {
      cwd: workingDirectory,
      env: gitEnvironment(),
      maxBuffer: 20 * 1024 * 1024
    }
  );

  return result.stdout.trim();
}

async function cloneRepository() {
  const cloneDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "rag-publish-")
  );

  await runGit(
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      GITHUB_BRANCH,
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`,
      cloneDirectory
    ],
    os.tmpdir()
  );

  await runGit(
    ["config", "user.name", "EU Space RAG Bot"],
    cloneDirectory
  );

  await runGit(
    [
      "config",
      "user.email",
      "eu-space-rag-bot@users.noreply.github.com"
    ],
    cloneDirectory
  );

  return cloneDirectory;
}

async function commitAndPush(cloneDirectory, commitMessage) {
  const gitStatus = await runGit(
    ["status", "--porcelain"],
    cloneDirectory
  );

  if (!gitStatus) return false;

  await runGit(
    ["commit", "-m", commitMessage],
    cloneDirectory
  );

  await runGit(
    ["push", "origin", `HEAD:${GITHUB_BRANCH}`],
    cloneDirectory
  );

  return true;
}

async function publishCheckpointToGitHub(outputDirectory) {
  const cloneDirectory = await cloneRepository();

  try {
    const destination = path.join(
      cloneDirectory,
      GITHUB_CHECKPOINT_DIR
    );

    await fs.promises.rm(destination, {
      recursive: true,
      force: true
    });

    await fs.promises.cp(
      outputDirectory,
      destination,
      { recursive: true }
    );

    await runGit(
      ["add", GITHUB_CHECKPOINT_DIR],
      cloneDirectory
    );

    const pushed = await commitAndPush(
      cloneDirectory,
      "Save RAG rebuild checkpoint [skip render]"
    );

    if (pushed) {
      lastCheckpointAt = new Date().toISOString();
    }

    return pushed;
  } finally {
    await fs.promises.rm(cloneDirectory, {
      recursive: true,
      force: true
    });
  }
}

async function publishFinalIndexToGitHub(outputDirectory) {
  const cloneDirectory = await cloneRepository();

  try {
    const destination = path.join(
      cloneDirectory,
      GITHUB_INDEX_DIR
    );

    await fs.promises.rm(destination, {
      recursive: true,
      force: true
    });

    await fs.promises.cp(
      outputDirectory,
      destination,
      { recursive: true }
    );

    await runGit(
      ["add", GITHUB_INDEX_DIR],
      cloneDirectory
    );

    const pushed = await commitAndPush(
      cloneDirectory,
      "Update RAG index [skip render]"
    );

    if (pushed) {
      lastPublishedAt = new Date().toISOString();
    }

    return pushed;
  } finally {
    await fs.promises.rm(cloneDirectory, {
      recursive: true,
      force: true
    });
  }
}

function buildProgressManifest({
  sourceReport,
  failures,
  shards,
  totalChunks,
  files,
  unchangedFiles,
  changedFiles,
  deletedFiles,
  indexedFiles,
  skippedFiles,
  copiedChunks,
  newChunks,
  processedChangedFiles,
  complete
}) {
  return {
    version: 5,
    type: complete ? "final" : "checkpoint",
    complete,
    buildCommit: BUILD_COMMIT,
    createdAt: new Date().toISOString(),
    repository: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    branch: GITHUB_BRANCH,
    shardSizeMB: SHARD_SIZE_MB,
    totalChunks,
    shards,
    sources: sourceReport,
    report: {
      discoveredFiles: files.length,
      unchangedFiles: unchangedFiles.size,
      changedFiles: changedFiles.length,
      processedChangedFiles,
      remainingChangedFiles: Math.max(
        changedFiles.length - processedChangedFiles,
        0
      ),
      deletedFiles,
      indexedFiles,
      skippedFiles,
      copiedChunks,
      newChunks,
      totalChunks,
      failures
    }
  };
}

async function saveCheckpoint({
  outputDirectory,
  writer,
  sourceReport,
  failures,
  files,
  unchangedFiles,
  changedFiles,
  deletedFiles,
  indexedFiles,
  skippedFiles,
  copiedChunks,
  newChunks,
  processedChangedFiles
}) {
  const writerState = await writer.checkpoint();

  const checkpointManifest = buildProgressManifest({
    sourceReport,
    failures,
    shards: writerState.shards,
    totalChunks: writerState.totalChunks,
    files,
    unchangedFiles,
    changedFiles,
    deletedFiles,
    indexedFiles,
    skippedFiles,
    copiedChunks,
    newChunks,
    processedChangedFiles,
    complete: false
  });

  await fs.promises.writeFile(
    path.join(outputDirectory, "manifest.json"),
    JSON.stringify(checkpointManifest, null, 2),
    "utf8"
  );

  await publishCheckpointToGitHub(outputDirectory);

  await fs.promises.rm(LOCAL_CHECKPOINT_ROOT, {
    recursive: true,
    force: true
  });

  await fs.promises.cp(
    outputDirectory,
    LOCAL_CHECKPOINT_ROOT,
    { recursive: true }
  );

  searchManifest = checkpointManifest;
  searchRoot = LOCAL_CHECKPOINT_ROOT;
  searchMode = "checkpoint";
  indexLoadedAt = new Date().toISOString();

  console.log(
    `Checkpoint saved after ${processedChangedFiles} changed files. ` +
    `Checkpoint is now searchable (${writerState.totalChunks} chunks).`
  );
}

async function rebuildIndex({ publish = true } = {}) {
  if (rebuildInProgress) {
    throw new Error("An index rebuild is already running");
  }

  rebuildInProgress = true;
  lastError = null;

  const buildRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "rag-build-")
  );

  try {
    const files = SOURCE_FOLDERS
      .flatMap(folder => listFiles(folder))
      .sort((a, b) => a.localeCompare(b));

    console.log(`Found ${files.length} PDF/DOCX files.`);

    const currentSources = await createSourceMap(files);

    /*
     * POINT 1:
     * If the complete GitHub index already matches every current
     * source file, keep it exactly as it is and do not rebuild.
     */
    if (
      manifest &&
      sourcesMatchManifest(currentSources, manifest)
    ) {
      searchManifest = manifest;
      searchRoot = LOCAL_INDEX_ROOT;
      searchMode = "final";
      indexLoadedAt = indexLoadedAt || new Date().toISOString();
      lastRebuildAt = new Date().toISOString();

      lastReport = {
        discoveredFiles: files.length,
        noChanges: true,
        resumedFromCheckpoint: false,
        unchangedFiles: files.length,
        changedFiles: 0,
        deletedFiles: [],
        indexedFiles: 0,
        skippedFiles: 0,
        copiedChunks: 0,
        newChunks: 0,
        indexedChunks: manifest.totalChunks || 0,
        shards: manifest.shards?.length || 0,
        published: false,
        failures: []
      };

      console.log(
        "No source changes detected. Existing final index remains active."
      );

      return lastReport;
    }

    const checkpointManifest = await loadCheckpointFromGitHub();

    let baseManifest = null;
    let baseRoot = null;
    let resumedFromCheckpoint = false;

    if (checkpointManifest) {
      baseManifest = checkpointManifest;
      baseRoot = LOCAL_CHECKPOINT_ROOT;
      resumedFromCheckpoint = true;

      console.log(
        `Resuming checkpoint with ` +
        `${checkpointManifest.totalChunks || 0} chunks.`
      );
    } else if (manifest) {
      baseManifest = manifest;
      baseRoot = LOCAL_INDEX_ROOT;
    }

    const baseSources = baseManifest?.sources || {};
    const sourceReport = baseManifest
      ? { ...baseSources }
      : {};

    const failures = resumedFromCheckpoint
      ? [...(baseManifest?.report?.failures || [])]
      : [];

    const completedFiles = new Set();

    for (const [displayPath, sourceState] of Object.entries(baseSources)) {
      const current = currentSources[displayPath];

      if (
        current &&
        sourceState.sha256 === current.sha256 &&
        (
          sourceState.status === "indexed" ||
          sourceState.status === "skipped"
        )
      ) {
        completedFiles.add(displayPath);
      }
    }

    const changedFiles = Object.keys(currentSources)
      .filter(displayPath => !completedFiles.has(displayPath))
      .sort((a, b) => a.localeCompare(b));

    const unchangedFiles = new Set(
      [...completedFiles].filter(
        fileName => sourceReport[fileName]?.status === "indexed"
      )
    );

    const deletedFiles = Object.keys(baseSources).filter(
      fileName => !currentSources[fileName]
    );

    for (const fileName of deletedFiles) {
      delete sourceReport[fileName];
    }

    const outputDirectory = path.join(
      buildRoot,
      "index-output"
    );

    await fs.promises.mkdir(outputDirectory, {
      recursive: true
    });

    let writer;
    let copiedChunks = 0;

    if (resumedFromCheckpoint) {
      for (const shard of checkpointManifest.shards || []) {
        await fs.promises.copyFile(
          path.join(LOCAL_CHECKPOINT_ROOT, shard.file),
          path.join(outputDirectory, shard.file)
        );
      }

      writer = new ShardWriter(
        outputDirectory,
        checkpointManifest.shards || [],
        checkpointManifest.totalChunks || 0
      );

      copiedChunks =
        checkpointManifest?.report?.copiedChunks || 0;
    } else {
      writer = new ShardWriter(outputDirectory);

      if (baseManifest && baseRoot) {
        const baseShardPaths = (baseManifest.shards || []).map(
          shard => path.join(baseRoot, shard.file)
        );

        copiedChunks = await copyChunksForFiles(
          baseShardPaths,
          unchangedFiles,
          writer
        );

        for (const fileName of completedFiles) {
          sourceReport[fileName] = {
            ...baseSources[fileName],
            sha256: currentSources[fileName].sha256,
            size: currentSources[fileName].size
          };
        }
      }
    }

    let indexedFiles = resumedFromCheckpoint
      ? checkpointManifest?.report?.indexedFiles || 0
      : 0;

    let skippedFiles = resumedFromCheckpoint
      ? checkpointManifest?.report?.skippedFiles || 0
      : 0;

    let newChunks = resumedFromCheckpoint
      ? checkpointManifest?.report?.newChunks || 0
      : 0;

    let processedChangedFiles = resumedFromCheckpoint
      ? checkpointManifest?.report?.processedChangedFiles ||
        completedFiles.size
      : 0;

    let filesSinceCheckpoint = 0;

    for (const displayPath of changedFiles) {
      const source = currentSources[displayPath];
      const workerFile = path.join(
        buildRoot,
        crypto
          .createHash("sha1")
          .update(displayPath)
          .digest("hex") + ".ndjson"
      );

      console.log(`Processing: ${displayPath}`);

      const result = await processFileInWorker(
        source.absolutePath,
        displayPath,
        workerFile
      );

      if (!result.ok) {
        skippedFiles += 1;
        failures.push({
          file: displayPath,
          reason: result.reason
        });

        sourceReport[displayPath] = {
          sha256: source.sha256,
          size: source.size,
          status: "skipped",
          reason: result.reason,
          chunks: 0
        };

        console.warn(`Skipped ${displayPath}: ${result.reason}`);
      } else {
        const addedChunks = await appendWorkerFile(
          workerFile,
          writer
        );

        indexedFiles += 1;
        newChunks += addedChunks;

        sourceReport[displayPath] = {
          sha256: source.sha256,
          size: source.size,
          status: "indexed",
          chunks: addedChunks
        };

        console.log(
          `Indexed: ${displayPath} (${addedChunks} chunks)`
        );
      }

      await fs.promises.rm(workerFile, { force: true });

      processedChangedFiles += 1;
      filesSinceCheckpoint += 1;

      if (filesSinceCheckpoint >= CHECKPOINT_EVERY_FILES) {
        await saveCheckpoint({
          outputDirectory,
          writer,
          sourceReport,
          failures,
          files,
          unchangedFiles,
          changedFiles,
          deletedFiles,
          indexedFiles,
          skippedFiles,
          copiedChunks,
          newChunks,
          processedChangedFiles
        });

        filesSinceCheckpoint = 0;
      }
    }

    const writerState = await writer.finish();

    if (writerState.totalChunks === 0) {
      throw new Error("The completed index contains no chunks.");
    }

    const finalManifest = buildProgressManifest({
      sourceReport,
      failures,
      shards: writerState.shards,
      totalChunks: writerState.totalChunks,
      files,
      unchangedFiles,
      changedFiles,
      deletedFiles,
      indexedFiles,
      skippedFiles,
      copiedChunks,
      newChunks,
      processedChangedFiles,
      complete: true
    });

    await fs.promises.writeFile(
      path.join(outputDirectory, "manifest.json"),
      JSON.stringify(finalManifest, null, 2),
      "utf8"
    );

    let published = false;

    if (publish) {
      published = await publishFinalIndexToGitHub(
        outputDirectory
      );
    }

    await fs.promises.rm(LOCAL_INDEX_ROOT, {
      recursive: true,
      force: true
    });

    await fs.promises.cp(
      outputDirectory,
      LOCAL_INDEX_ROOT,
      { recursive: true }
    );

    await fs.promises.rm(LOCAL_CHECKPOINT_ROOT, {
      recursive: true,
      force: true
    });

    manifest = finalManifest;
    searchManifest = finalManifest;
    searchRoot = LOCAL_INDEX_ROOT;
    searchMode = "final";
    indexLoadedAt = new Date().toISOString();
    lastRebuildAt = new Date().toISOString();

    lastReport = {
      discoveredFiles: files.length,
      noChanges: false,
      resumedFromCheckpoint,
      unchangedFiles: unchangedFiles.size,
      changedFiles: changedFiles.length,
      deletedFiles,
      indexedFiles,
      skippedFiles,
      copiedChunks,
      newChunks,
      indexedChunks: manifest.totalChunks,
      shards: writerState.shards.length,
      published,
      failures
    };

    console.log("Index rebuild completed.");
    console.log(`Total chunks: ${manifest.totalChunks}`);
    console.log(`Shard files: ${writerState.shards.length}`);
    console.log(`Skipped files: ${skippedFiles}`);

    return lastReport;
  } catch (error) {
    lastError = error.message;
    throw error;
  } finally {
    rebuildInProgress = false;

    await fs.promises.rm(buildRoot, {
      recursive: true,
      force: true
    });
  }
}

module.exports = {
  getStatus,
  loadIndexFromGitHub,
  rebuildIndex,
  searchIndex,
  readDocument
};
