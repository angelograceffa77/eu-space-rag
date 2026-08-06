"use strict";

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

const SHARD_SIZE_MB = Math.max(
  Number.parseInt(process.env.SHARD_SIZE_MB || "20", 10),
  5
);

const SHARD_SIZE_BYTES = SHARD_SIZE_MB * 1024 * 1024;

const WORKER_MEMORY_MB = Math.max(
  Number.parseInt(process.env.WORKER_MEMORY_MB || "300", 10),
  128
);

const WORKER_TIMEOUT_MS = Math.max(
  Number.parseInt(
    process.env.WORKER_TIMEOUT_MS || "900000",
    10
  ),
  30000
);

const LOCAL_INDEX_ROOT = path.join(
  os.tmpdir(),
  "eu-space-rag-index"
);

let chunks = [];
let rebuildInProgress = false;
let indexLoadedAt = null;
let lastRebuildAt = null;
let lastPublishedAt = null;
let lastError = null;
let lastReport = null;

function getStatus() {
  return {
    indexedChunks: chunks.length,
    indexLoaded: chunks.length > 0,
    indexLoadedAt,
    rebuildInProgress,
    lastRebuildAt,
    lastPublishedAt,
    lastError,
    lastReport,
    githubIndexDirectory:
      `${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_INDEX_DIR}`,
    shardSizeMB: SHARD_SIZE_MB
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
    items = fs.readdirSync(folder, {
      withFileTypes: true
    });
  } catch (error) {
    console.error(
      `Could not read folder ${folder}: ${error.message}`
    );
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

    const lower = item.name.toLowerCase();

    if (
      lower.endsWith(".pdf") ||
      lower.endsWith(".docx")
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

function getQueryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(term => term.trim())
    .filter(term => term.length > 2);
}

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

function searchIndex(query, topK) {
  const terms = getQueryTerms(query);

  if (terms.length === 0) return [];

  const results = [];

  for (const chunk of chunks) {
    const text = chunk.content.toLowerCase();
    let score = 0;

    for (const term of terms) {
      score += countOccurrences(text, term);
    }

    if (score > 0) {
      results.push({
        file: chunk.file,
        folder: chunk.folder,
        content: chunk.content,
        score
      });
    }
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, topK);
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
  const result = {};

  for (const filePath of files) {
    const displayPath = relativeFilePath(filePath);

    try {
      const stats = await fs.promises.stat(filePath);

      result[displayPath] = {
        absolutePath: filePath,
        sha256: await hashFile(filePath),
        size: stats.size
      };
    } catch (error) {
      console.error(
        `Could not inspect ${displayPath}: ${error.message}`
      );
    }
  }

  return result;
}

function rawGitHubUrl(repositoryPath) {
  const encodedPath = repositoryPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return (
    `https://raw.githubusercontent.com/` +
    `${encodeURIComponent(GITHUB_OWNER)}/` +
    `${encodeURIComponent(GITHUB_REPO)}/` +
    `${encodeURIComponent(GITHUB_BRANCH)}/` +
    encodedPath
  );
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "eu-space-rag-render"
    }
  });

  if (response.status === 404) return false;

  if (!response.ok || !response.body) {
    throw new Error(
      `Download failed: HTTP ${response.status}`
    );
  }

  await fs.promises.mkdir(path.dirname(destination), {
    recursive: true
  });

  const output = fs.createWriteStream(destination, {
    flags: "w"
  });

  try {
    for await (const data of response.body) {
      if (!output.write(data)) {
        await once(output, "drain");
      }
    }

    await new Promise((resolve, reject) => {
      output.once("error", reject);
      output.end(resolve);
    });

    return true;
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function loadIndexFromGitHub() {
  await fs.promises.rm(LOCAL_INDEX_ROOT, {
    recursive: true,
    force: true
  });

  await fs.promises.mkdir(LOCAL_INDEX_ROOT, {
    recursive: true
  });

  const manifestPath = path.join(
    LOCAL_INDEX_ROOT,
    "manifest.json"
  );

  const found = await downloadFile(
    rawGitHubUrl(`${GITHUB_INDEX_DIR}/manifest.json`),
    manifestPath
  );

  if (!found) {
    chunks = [];
    indexLoadedAt = null;
    return false;
  }

  const manifest = JSON.parse(
    await fs.promises.readFile(manifestPath, "utf8")
  );

  const loaded = [];

  for (const shard of manifest.shards || []) {
    const localShard = path.join(
      LOCAL_INDEX_ROOT,
      shard.file
    );

    await downloadFile(
      rawGitHubUrl(
        `${GITHUB_INDEX_DIR}/${shard.file}`
      ),
      localShard
    );

    const input = fs.createReadStream(localShard, {
      encoding: "utf8"
    });

    const reader = readline.createInterface({
      input,
      crlfDelay: Infinity
    });

    for await (const line of reader) {
      const trimmed = line.trim();

      if (!trimmed) continue;

      try {
        const item = JSON.parse(trimmed);

        if (
          typeof item.file === "string" &&
          typeof item.folder === "string" &&
          typeof item.content === "string"
        ) {
          loaded.push(item);
        }
      } catch {
        // Ignore one damaged line and continue.
      }
    }
  }

  chunks = loaded;
  indexLoadedAt = new Date().toISOString();

  return chunks.length > 0;
}

async function readOldManifest() {
  const manifestPath = path.join(
    LOCAL_INDEX_ROOT,
    "manifest.json"
  );

  if (!fs.existsSync(manifestPath)) return null;

  try {
    return JSON.parse(
      await fs.promises.readFile(manifestPath, "utf8")
    );
  } catch {
    return null;
  }
}

async function writeLine(stream, value) {
  if (!stream.write(`${value}\n`, "utf8")) {
    await once(stream, "drain");
  }
}

function processFileInWorker(
  filePath,
  displayPath,
  outputPath
) {
  return new Promise(resolve => {
    const child = fork(
      path.join(ROOT_PATH, "index-worker.js"),
      [filePath, outputPath, displayPath],
      {
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

    let finished = false;
    let message = null;

    const finish = result => {
      if (finished) return;

      finished = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");

      finish({
        ok: false,
        reason: `Worker exceeded ${WORKER_TIMEOUT_MS} ms`
      });
    }, WORKER_TIMEOUT_MS);

    child.on("message", value => {
      message = value;
    });

    child.on("error", error => {
      finish({
        ok: false,
        reason: error.message
      });
    });

    child.on("exit", (code, signal) => {
      if (code === 0 && message?.ok) {
        finish({
          ok: true,
          chunks: message.chunks
        });
      } else {
        finish({
          ok: false,
          reason:
            message?.error ||
            `Worker stopped with code ${code}, signal ${signal}`
        });
      }
    });
  });
}

async function readAllExistingChunks() {
  const all = [];

  if (!fs.existsSync(LOCAL_INDEX_ROOT)) return all;

  const files = await fs.promises.readdir(
    LOCAL_INDEX_ROOT
  );

  const shards = files
    .filter(name => /^rag-index-\d+\.ndjson$/.test(name))
    .sort();

  for (const file of shards) {
    const input = fs.createReadStream(
      path.join(LOCAL_INDEX_ROOT, file),
      { encoding: "utf8" }
    );

    const reader = readline.createInterface({
      input,
      crlfDelay: Infinity
    });

    for await (const line of reader) {
      const trimmed = line.trim();

      if (!trimmed) continue;

      try {
        all.push(JSON.parse(trimmed));
      } catch {
        // Ignore damaged lines.
      }
    }
  }

  return all;
}

async function writeShards(
  buildDir,
  chunkItems
) {
  const shards = [];
  let shardNumber = 1;
  let shardBytes = 0;
  let shardChunks = 0;
  let output = null;
  let fileName = "";

  async function openShard() {
    fileName =
      `rag-index-${String(shardNumber).padStart(4, "0")}.ndjson`;

    output = fs.createWriteStream(
      path.join(buildDir, fileName),
      {
        encoding: "utf8",
        flags: "w"
      }
    );

    shardBytes = 0;
    shardChunks = 0;
  }

  async function closeShard() {
    if (!output) return;

    await new Promise((resolve, reject) => {
      output.once("error", reject);
      output.end(resolve);
    });

    shards.push({
      file: fileName,
      chunks: shardChunks,
      bytes: shardBytes
    });

    output = null;
    shardNumber += 1;
  }

  await openShard();

  for (const item of chunkItems) {
    const line = `${JSON.stringify(item)}\n`;
    const bytes = Buffer.byteLength(line, "utf8");

    if (
      shardChunks > 0 &&
      shardBytes + bytes > SHARD_SIZE_BYTES
    ) {
      await closeShard();
      await openShard();
    }

    if (!output.write(line, "utf8")) {
      await once(output, "drain");
    }

    shardBytes += bytes;
    shardChunks += 1;
  }

  await closeShard();

  return shards;
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

async function runGit(args, cwd) {
  const result = await execFileAsync(
    "git",
    args,
    {
      cwd,
      env: gitEnvironment(),
      maxBuffer: 20 * 1024 * 1024
    }
  );

  return result.stdout.trim();
}

async function publishIndexToGitHub(buildDir) {
  const cloneDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "rag-publish-")
  );

  try {
    await runGit(
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        GITHUB_BRANCH,
        `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`,
        cloneDir
      ],
      os.tmpdir()
    );

    const destination = path.join(
      cloneDir,
      GITHUB_INDEX_DIR
    );

    await fs.promises.rm(destination, {
      recursive: true,
      force: true
    });

    await fs.promises.mkdir(destination, {
      recursive: true
    });

    for (const name of await fs.promises.readdir(buildDir)) {
      await fs.promises.copyFile(
        path.join(buildDir, name),
        path.join(destination, name)
      );
    }

    await runGit(
      ["config", "user.name", "EU Space RAG Bot"],
      cloneDir
    );

    await runGit(
      [
        "config",
        "user.email",
        "eu-space-rag-bot@users.noreply.github.com"
      ],
      cloneDir
    );

    await runGit(["add", GITHUB_INDEX_DIR], cloneDir);

    const status = await runGit(
      ["status", "--porcelain"],
      cloneDir
    );

    if (!status) return false;

    await runGit(
      [
        "commit",
        "-m",
        "Update RAG index [skip render]"
      ],
      cloneDir
    );

    await runGit(
      [
        "push",
        "origin",
        `HEAD:${GITHUB_BRANCH}`
      ],
      cloneDir
    );

    lastPublishedAt = new Date().toISOString();
    return true;
  } finally {
    await fs.promises.rm(cloneDir, {
      recursive: true,
      force: true
    });
  }
}

async function rebuildIndex({ publish = true } = {}) {
  if (rebuildInProgress) {
    throw new Error(
      "An index rebuild is already running"
    );
  }

  rebuildInProgress = true;
  lastError = null;

  const buildRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "rag-build-")
  );

  try {
    const oldManifest = await readOldManifest();
    const oldSources = oldManifest?.sources || {};
    const oldChunks = await readAllExistingChunks();

    const files = SOURCE_FOLDERS
      .flatMap(folder => listFiles(folder))
      .sort((a, b) => a.localeCompare(b));

    const currentSources = await createSourceMap(files);
    const unchanged = new Set();
    const changed = [];

    for (const [name, source] of Object.entries(currentSources)) {
      if (
        oldSources[name]?.sha256 === source.sha256 &&
        oldSources[name]?.status === "indexed"
      ) {
        unchanged.add(name);
      } else {
        changed.push(name);
      }
    }

    const newChunkItems = oldChunks.filter(
      item => unchanged.has(item.file)
    );

    const sourceReport = {};
    const failures = [];

    for (const name of unchanged) {
      sourceReport[name] = {
        ...oldSources[name],
        sha256: currentSources[name].sha256,
        size: currentSources[name].size
      };
    }

    for (const displayPath of changed) {
      const source = currentSources[displayPath];
      const workerFile = path.join(
        buildRoot,
        `${crypto
          .createHash("sha1")
          .update(displayPath)
          .digest("hex")}.ndjson`
      );

      console.log(`Processing: ${displayPath}`);

      const result = await processFileInWorker(
        source.absolutePath,
        displayPath,
        workerFile
      );

      if (!result.ok) {
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

        continue;
      }

      const input = fs.createReadStream(workerFile, {
        encoding: "utf8"
      });

      const reader = readline.createInterface({
        input,
        crlfDelay: Infinity
      });

      for await (const line of reader) {
        if (!line.trim()) continue;
        newChunkItems.push(JSON.parse(line));
      }

      sourceReport[displayPath] = {
        sha256: source.sha256,
        size: source.size,
        status: "indexed",
        chunks: result.chunks
      };
    }

    if (newChunkItems.length === 0) {
      throw new Error(
        "The completed index contains no chunks."
      );
    }

    const outputDir = path.join(
      buildRoot,
      "index-output"
    );

    await fs.promises.mkdir(outputDir, {
      recursive: true
    });

    const shards = await writeShards(
      outputDir,
      newChunkItems
    );

    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      repository:
        `${GITHUB_OWNER}/${GITHUB_REPO}`,
      branch: GITHUB_BRANCH,
      shardSizeMB: SHARD_SIZE_MB,
      totalChunks: newChunkItems.length,
      shards,
      sources: sourceReport,
      report: {
        discoveredFiles: files.length,
        unchangedFiles: unchanged.size,
        changedFiles: changed.length,
        skippedFiles: failures.length,
        failures
      }
    };

    await fs.promises.writeFile(
      path.join(outputDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    let published = false;

    if (publish) {
      published = await publishIndexToGitHub(
        outputDir
      );
    }

    await fs.promises.rm(LOCAL_INDEX_ROOT, {
      recursive: true,
      force: true
    });

    await fs.promises.cp(
      outputDir,
      LOCAL_INDEX_ROOT,
      {
        recursive: true
      }
    );

    chunks = newChunkItems;
    indexLoadedAt = new Date().toISOString();
    lastRebuildAt = new Date().toISOString();

    lastReport = {
      discoveredFiles: files.length,
      unchangedFiles: unchanged.size,
      changedFiles: changed.length,
      skippedFiles: failures.length,
      indexedChunks: chunks.length,
      shards: shards.length,
      published,
      failures
    };

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
  searchIndex
};
