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

const GITHUB_CHECKPOINT_DIR =
  `${GITHUB_INDEX_DIR}/checkpoint`;

const SHARD_SIZE_MB = Math.max(
  Number.parseInt(process.env.SHARD_SIZE_MB || "20", 10),
  5
);

const SHARD_SIZE_BYTES =
  SHARD_SIZE_MB * 1024 * 1024;

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
let rebuildInProgress = false;
let indexLoadedAt = null;
let lastRebuildAt = null;
let lastPublishedAt = null;
let lastCheckpointAt = null;
let lastError = null;
let lastReport = null;

function getStatus() {
  return {
    indexedChunks: manifest?.totalChunks || 0,
    indexLoaded: Boolean(
      manifest &&
      manifest.totalChunks > 0
    ),
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

  if (!fs.existsSync(folder)) {
    return results;
  }

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

    if (!item.isFile()) {
      continue;
    }

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

    if (position === -1) {
      return count;
    }

    count += 1;
    position += term.length;
  }
}

function addSearchResult(results, result, topK) {
  results.push(result);
  results.sort((a, b) => b.score - a.score);

  if (results.length > topK) {
    results.length = topK;
  }
}

async function searchIndex(query, topK) {
  const terms = getQueryTerms(query);

  if (
    terms.length === 0 ||
    !manifest
  ) {
    return [];
  }

  const bestResults = [];

  for (const shard of manifest.shards || []) {
    const shardPath = path.join(
      LOCAL_INDEX_ROOT,
      shard.file
    );

    if (!fs.existsSync(shardPath)) {
      console.warn(
        `Missing local shard: ${shard.file}`
      );
      continue;
    }

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

        if (!trimmed) {
          continue;
        }

        let item;

        try {
          item = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (
          typeof item.content !== "string" ||
          typeof item.file !== "string"
        ) {
          continue;
        }

        const text = item.content.toLowerCase();
        let score = 0;

        for (const term of terms) {
          score += countOccurrences(text, term);
        }

        if (score <= 0) {
          continue;
        }

        addSearchResult(
          bestResults,
          {
            file: item.file,
            folder: item.folder,
            content: item.content,
            score
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

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);

    input.on("error", reject);
    input.on("data", data => hash.update(data));
    input.on(
      "end",
      () => resolve(hash.digest("hex"))
    );
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
      console.error(
        `Could not inspect ${displayPath}: ${error.message}`
      );
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
    headers: {
      "User-Agent": "eu-space-rag-render"
    },
    redirect: "follow"
  });

  if (response.status === 404) {
    return false;
  }

  if (
    !response.ok ||
    !response.body
  ) {
    throw new Error(
      `Download failed: HTTP ${response.status}`
    );
  }

  await fs.promises.mkdir(
    path.dirname(destination),
    {
      recursive: true
    }
  );

  const output = fs.createWriteStream(destination, {
    flags: "w"
  });

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
    rawGitHubUrl(
      `${githubDirectory}/manifest.json`
    ),
    localManifestPath
  );

  if (!found) {
    return null;
  }

  const downloadedManifest = JSON.parse(
    await fs.promises.readFile(
      localManifestPath,
      "utf8"
    )
  );

  if (!Array.isArray(downloadedManifest.shards)) {
    throw new Error(
      `Invalid manifest in ${githubDirectory}`
    );
  }

  for (const shard of downloadedManifest.shards) {
    if (typeof shard.file !== "string") {
      throw new Error(
        `Invalid shard entry in ${githubDirectory}`
      );
    }

    const localShardPath = path.join(
      localDirectory,
      shard.file
    );

    const shardFound = await downloadFile(
      rawGitHubUrl(
        `${githubDirectory}/${shard.file}`
      ),
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
  const downloadedManifest =
    await downloadManifestAndShards(
      GITHUB_INDEX_DIR,
      LOCAL_INDEX_ROOT
    );

  if (!downloadedManifest) {
    manifest = null;
    indexLoadedAt = null;
    return false;
  }

  manifest = downloadedManifest;
  indexLoadedAt = new Date().toISOString();

  console.log(
    `Loaded index manifest with ` +
    `${manifest.totalChunks || 0} chunks in ` +
    `${manifest.shards.length} shard files.`
  );

  return manifest.totalChunks > 0;
}

async function loadCheckpointFromGitHub() {
  const checkpointManifest =
    await downloadManifestAndShards(
      GITHUB_CHECKPOINT_DIR,
      LOCAL_CHECKPOINT_ROOT
    );

  if (!checkpointManifest) {
    return null;
  }

  if (
    checkpointManifest.buildCommit &&
    BUILD_COMMIT &&
    checkpointManifest.buildCommit !== BUILD_COMMIT
  ) {
    console.log(
      "A checkpoint exists, but it belongs to a different source commit. Ignoring it."
    );

    await fs.promises.rm(
      LOCAL_CHECKPOINT_ROOT,
      {
        recursive: true,
        force: true
      }
    );

    return null;
  }

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
      "rag-index-" +
      String(this.shardNumber).padStart(4, "0") +
      ".ndjson";

    this.output = fs.createWriteStream(
      path.join(
        this.outputDirectory,
        this.fileName
      ),
      {
        encoding: "utf8",
        flags: "w"
      }
    );

    this.bytes = 0;
    this.chunkCount = 0;
  }

  async closeShard() {
    if (!this.output) {
      return;
    }

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
    const lineBytes = Buffer.byteLength(
      line,
      "utf8"
    );

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

  if (wantedFiles.size === 0) {
    return copiedChunks;
  }

  for (const shardPath of sourceShardPaths) {
    if (!fs.existsSync(shardPath)) {
      continue;
    }

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

        if (!trimmed) {
          continue;
        }

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
  if (
    !child ||
    !child.pid
  ) {
    return false;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Fall back to the direct child.
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
    const workerPath = path.join(
      ROOT_PATH,
      "index-worker.js"
    );

    const child = fork(
      workerPath,
      [
        filePath,
        outputPath,
        displayPath
      ],
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
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
    };

    const finish = result => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();

      try {
        if (child.connected) {
          child.disconnect();
        }
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
        `Worker timeout reached for ${displayPath}. ` +
        `Sending SIGTERM.`
      );

      killWorkerProcess(
        child,
        "SIGTERM"
      );

      forceKillTimer = setTimeout(() => {
        console.warn(
          `Force-killing worker for ${displayPath}.`
        );

        killWorkerProcess(
          child,
          "SIGKILL"
        );

        finish({
          ok: false,
          reason:
            `Worker exceeded ${WORKER_TIMEOUT_MS} ms`
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

    const finishFromExit = (
      code,
      signal,
      eventName
    ) => {
      if (settled) {
        return;
      }

      if (timedOut) {
        finish({
          ok: false,
          reason:
            `Worker exceeded ${WORKER_TIMEOUT_MS} ms`
        });
        return;
      }

      if (
        code === 0 &&
        workerMessage?.ok
      ) {
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
      (code, signal) =>
        finishFromExit(
          code,
          signal,
          "stopped"
        )
    );

    child.on(
      "close",
      (code, signal) =>
        finishFromExit(
          code,
          signal,
          "closed"
        )
    );
  });
}

async function appendWorkerFile(
  workerFile,
  writer
) {
  let addedChunks = 0;

  const input = fs.createReadStream(
    workerFile,
    {
      encoding: "utf8"
    }
  );

  const reader = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  try {
    for await (const line of reader) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

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
    throw new Error(
      "GITHUB_TOKEN is not configured"
    );
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
      maxBuffer:
        20 * 1024 * 1024
    }
  );

  return result.stdout.trim();
}

async function cloneRepository() {
  const cloneDirectory =
    await fs.promises.mkdtemp(
      path.join(
        os.tmpdir(),
        "rag-publish-"
      )
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
    [
      "config",
      "user.name",
      "EU Space RAG Bot"
    ],
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

async function commitAndPush(
  cloneDirectory,
  commitMessage
) {
  const gitStatus = await runGit(
    [
      "status",
      "--porcelain"
    ],
    cloneDirectory
  );

  if (!gitStatus) {
    return false;
  }

  await runGit(
    [
      "commit",
      "-m",
      commitMessage
    ],
    cloneDirectory
  );

  await runGit(
    [
      "push",
      "origin",
      `HEAD:${GITHUB_BRANCH}`
    ],
    cloneDirectory
  );

  return true;
}

async function publishCheckpointToGitHub(
  outputDirectory
) {
  const cloneDirectory =
    await cloneRepository();

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
      {
        recursive: true
      }
    );

    await runGit(
      [
        "add",
        GITHUB_CHECKPOINT_DIR
      ],
      cloneDirectory
    );

    const pushed = await commitAndPush(
      cloneDirectory,
      "Save RAG rebuild checkpoint [skip render]"
    );

    if (pushed) {
      lastCheckpointAt =
        new Date().toISOString();
    }

    return pushed;
  } finally {
    await fs.promises.rm(
      cloneDirectory,
      {
        recursive: true,
        force: true
      }
    );
  }
}

async function publishFinalIndexToGitHub(
  outputDirectory
) {
  const cloneDirectory =
    await cloneRepository();

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
      {
        recursive: true
      }
    );

    await runGit(
      [
        "add",
        GITHUB_INDEX_DIR
      ],
      cloneDirectory
    );

    const pushed = await commitAndPush(
      cloneDirectory,
      "Update RAG index [skip render]"
    );

    if (pushed) {
      lastPublishedAt =
        new Date().toISOString();
    }

    return pushed;
  } finally {
    await fs.promises.rm(
      cloneDirectory,
      {
        recursive: true,
        force: true
      }
    );
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
    version: 4,
    type: complete
      ? "final"
      : "checkpoint",
    complete,
    buildCommit: BUILD_COMMIT,
    createdAt:
      new Date().toISOString(),
    repository:
      `${GITHUB_OWNER}/${GITHUB_REPO}`,
    branch: GITHUB_BRANCH,
    shardSizeMB: SHARD_SIZE_MB,
    totalChunks,
    shards,
    sources: sourceReport,
    report: {
      discoveredFiles:
        files.length,
      unchangedFiles:
        unchangedFiles.size,
      changedFiles:
        changedFiles.length,
      processedChangedFiles,
      remainingChangedFiles:
        Math.max(
          changedFiles.length -
          processedChangedFiles,
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
  const writerState =
    await writer.checkpoint();

  const checkpointManifest =
    buildProgressManifest({
      sourceReport,
      failures,
      shards:
        writerState.shards,
      totalChunks:
        writerState.totalChunks,
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
    path.join(
      outputDirectory,
      "manifest.json"
    ),
    JSON.stringify(
      checkpointManifest,
      null,
      2
    ),
    "utf8"
  );

  await publishCheckpointToGitHub(
    outputDirectory
  );

  console.log(
    `Checkpoint saved after ` +
    `${processedChangedFiles} changed files.`
  );
}

async function rebuildIndex({
  publish = true
} = {}) {
  if (rebuildInProgress) {
    throw new Error(
      "An index rebuild is already running"
    );
  }

  rebuildInProgress = true;
  lastError = null;

  const buildRoot =
    await fs.promises.mkdtemp(
      path.join(
        os.tmpdir(),
        "rag-build-"
      )
    );

  try {
    const files = SOURCE_FOLDERS
      .flatMap(folder => listFiles(folder))
      .sort((a, b) =>
        a.localeCompare(b)
      );

    console.log(
      `Found ${files.length} PDF/DOCX files.`
    );

    const currentSources =
      await createSourceMap(files);

    /*
     * First try to resume an interrupted rebuild.
     * A checkpoint is used only when it belongs to
     * the same Render source commit.
     */
    const checkpointManifest =
      await loadCheckpointFromGitHub();

    let baseManifest = null;
    let baseRoot = null;
    let resumedFromCheckpoint = false;

    if (checkpointManifest) {
      baseManifest =
        checkpointManifest;
      baseRoot =
        LOCAL_CHECKPOINT_ROOT;
      resumedFromCheckpoint = true;

      console.log(
        `Resuming checkpoint with ` +
        `${checkpointManifest.totalChunks || 0} chunks.`
      );
    } else if (manifest) {
      baseManifest = manifest;
      baseRoot = LOCAL_INDEX_ROOT;
    }

    const baseSources =
      baseManifest?.sources || {};

    const sourceReport =
      resumedFromCheckpoint
        ? { ...baseSources }
        : {};

    const failures =
      resumedFromCheckpoint
        ? [
            ...(
              baseManifest?.report?.failures ||
              []
            )
          ]
        : [];

    const completedFiles =
      new Set();

    for (
      const [
        displayPath,
        sourceState
      ]
      of Object.entries(
        baseSources
      )
    ) {
      const current =
        currentSources[displayPath];

      if (
        current &&
        sourceState.sha256 ===
          current.sha256 &&
        (
          sourceState.status ===
            "indexed" ||
          sourceState.status ===
            "skipped"
        )
      ) {
        completedFiles.add(
          displayPath
        );
      }
    }

    const changedFiles = [];

    for (
      const displayPath
      of Object.keys(
        currentSources
      )
    ) {
      if (
        !completedFiles.has(
          displayPath
        )
      ) {
        changedFiles.push(
          displayPath
        );
      }
    }

    changedFiles.sort(
      (a, b) =>
        a.localeCompare(b)
    );

    const unchangedFiles =
      new Set(
        [...completedFiles].filter(
          fileName =>
            sourceReport[
              fileName
            ]?.status ===
            "indexed"
        )
      );

    const deletedFiles =
      Object.keys(
        baseSources
      ).filter(
        fileName =>
          !currentSources[
            fileName
          ]
      );

    const outputDirectory =
      path.join(
        buildRoot,
        "index-output"
      );

    await fs.promises.mkdir(
      outputDirectory,
      {
        recursive: true
      }
    );

    let writer;
    let copiedChunks = 0;

    if (resumedFromCheckpoint) {
      /*
       * Copy checkpoint shards into the new temporary
       * build folder, then continue with new shard files.
       */
      for (
        const shard
        of checkpointManifest.shards || []
      ) {
        await fs.promises.copyFile(
          path.join(
            LOCAL_CHECKPOINT_ROOT,
            shard.file
          ),
          path.join(
            outputDirectory,
            shard.file
          )
        );
      }

      writer = new ShardWriter(
        outputDirectory,
        checkpointManifest.shards || [],
        checkpointManifest.totalChunks || 0
      );

      copiedChunks =
        checkpointManifest?.report?.copiedChunks ||
        0;
    } else {
      writer = new ShardWriter(
        outputDirectory
      );

      if (
        baseManifest &&
        baseRoot
      ) {
        const baseShardPaths =
          (
            baseManifest.shards ||
            []
          ).map(
            shard =>
              path.join(
                baseRoot,
                shard.file
              )
          );

        copiedChunks =
          await copyChunksForFiles(
            baseShardPaths,
            unchangedFiles,
            writer
          );

        for (
          const fileName
          of completedFiles
        ) {
          sourceReport[
            fileName
          ] = {
            ...baseSources[
              fileName
            ],
            sha256:
              currentSources[
                fileName
              ].sha256,
            size:
              currentSources[
                fileName
              ].size
          };
        }
      }
    }

    let indexedFiles =
      resumedFromCheckpoint
        ? (
            checkpointManifest
              ?.report
              ?.indexedFiles || 0
          )
        : 0;

    let skippedFiles =
      resumedFromCheckpoint
        ? (
            checkpointManifest
              ?.report
              ?.skippedFiles || 0
          )
        : 0;

    let newChunks =
      resumedFromCheckpoint
        ? (
            checkpointManifest
              ?.report
              ?.newChunks || 0
          )
        : 0;

    let processedChangedFiles =
      resumedFromCheckpoint
        ? (
            checkpointManifest
              ?.report
              ?.processedChangedFiles ||
            completedFiles.size
          )
        : 0;

    let filesSinceCheckpoint = 0;

    for (
      const displayPath
      of changedFiles
    ) {
      const source =
        currentSources[
          displayPath
        ];

      const workerFile =
        path.join(
          buildRoot,
          crypto
            .createHash("sha1")
            .update(displayPath)
            .digest("hex") +
            ".ndjson"
        );

      console.log(
        `Processing: ${displayPath}`
      );

      const result =
        await processFileInWorker(
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

        sourceReport[
          displayPath
        ] = {
          sha256: source.sha256,
          size: source.size,
          status: "skipped",
          reason: result.reason,
          chunks: 0
        };

        console.warn(
          `Skipped ${displayPath}: ${result.reason}`
        );
      } else {
        const addedChunks =
          await appendWorkerFile(
            workerFile,
            writer
          );

        indexedFiles += 1;
        newChunks += addedChunks;

        sourceReport[
          displayPath
        ] = {
          sha256: source.sha256,
          size: source.size,
          status: "indexed",
          chunks: addedChunks
        };

        console.log(
          `Indexed: ${displayPath} ` +
          `(${addedChunks} chunks)`
        );
      }

      await fs.promises.rm(
        workerFile,
        {
          force: true
        }
      );

      processedChangedFiles += 1;
      filesSinceCheckpoint += 1;

      if (
        filesSinceCheckpoint >=
          CHECKPOINT_EVERY_FILES
      ) {
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

    const writerState =
      await writer.finish();

    if (
      writerState.totalChunks === 0
    ) {
      throw new Error(
        "The completed index contains no chunks."
      );
    }

    const finalManifest =
      buildProgressManifest({
        sourceReport,
        failures,
        shards:
          writerState.shards,
        totalChunks:
          writerState.totalChunks,
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
      path.join(
        outputDirectory,
        "manifest.json"
      ),
      JSON.stringify(
        finalManifest,
        null,
        2
      ),
      "utf8"
    );

    let published = false;

    if (publish) {
      published =
        await publishFinalIndexToGitHub(
          outputDirectory
        );
    }

    await fs.promises.rm(
      LOCAL_INDEX_ROOT,
      {
        recursive: true,
        force: true
      }
    );

    await fs.promises.cp(
      outputDirectory,
      LOCAL_INDEX_ROOT,
      {
        recursive: true
      }
    );

    await fs.promises.rm(
      LOCAL_CHECKPOINT_ROOT,
      {
        recursive: true,
        force: true
      }
    );

    manifest = finalManifest;
    indexLoadedAt =
      new Date().toISOString();
    lastRebuildAt =
      new Date().toISOString();

    lastReport = {
      discoveredFiles:
        files.length,
      resumedFromCheckpoint,
      unchangedFiles:
        unchangedFiles.size,
      changedFiles:
        changedFiles.length,
      deletedFiles,
      indexedFiles,
      skippedFiles,
      copiedChunks,
      newChunks,
      indexedChunks:
        manifest.totalChunks,
      shards:
        writerState.shards.length,
      published,
      failures
    };

    console.log(
      "Index rebuild completed."
    );

    console.log(
      `Total chunks: ${manifest.totalChunks}`
    );

    console.log(
      `Shard files: ${writerState.shards.length}`
    );

    console.log(
      `Skipped files: ${skippedFiles}`
    );

    return lastReport;
  } catch (error) {
    lastError = error.message;
    throw error;
  } finally {
    rebuildInProgress = false;

    await fs.promises.rm(
      buildRoot,
      {
        recursive: true,
        force: true
      }
    );
  }
}

module.exports = {
  getStatus,
  loadIndexFromGitHub,
  rebuildIndex,
  searchIndex
};
