"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const readline = require("readline");
const { once } = require("events");
const {
  fork,
  execFile
} = require("child_process");
const { promisify } = require("util");

const execFileAsync =
  promisify(execFile);

const ROOT_PATH = __dirname;

/*
 * Folders containing PDF and DOCX files.
 */
const SOURCE_FOLDERS = [
  "00_GPT_CONFIGURATION",
  "01_POLICY",
  "02_LAW",
  "03_PROCUREMENT",
  "04_FUNDING",
  "05_COMPANIES"
].map(folder =>
  path.join(ROOT_PATH, folder)
);

/*
 * Folders that must not be scanned.
 *
 * This is only a folder-ignore list.
 * There is no individual file-ignore list.
 */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".vscode",
  "dist",
  "build",
  "index"
]);

/*
 * GitHub configuration.
 */
const GITHUB_OWNER =
  process.env.GITHUB_OWNER ||
  "angelograceffa77";

const GITHUB_REPO =
  process.env.GITHUB_REPO ||
  "eu-space-rag";

const GITHUB_BRANCH =
  process.env.GITHUB_BRANCH ||
  "main";

const GITHUB_INDEX_DIR =
  process.env.GITHUB_INDEX_DIR ||
  "index";

/*
 * Maximum approximate size of each NDJSON shard.
 */
const SHARD_SIZE_MB = Math.max(
  Number.parseInt(
    process.env.SHARD_SIZE_MB ||
      "20",
    10
  ),
  5
);

const SHARD_SIZE_BYTES =
  SHARD_SIZE_MB *
  1024 *
  1024;

/*
 * Each document is processed in a separate worker.
 *
 * If the worker reaches this memory limit,
 * only that document fails.
 */
const WORKER_MEMORY_MB = Math.max(
  Number.parseInt(
    process.env.WORKER_MEMORY_MB ||
      "180",
    10
  ),
  128
);

/*
 * Maximum processing time for one document.
 *
 * Default: 15 minutes.
 */
const WORKER_TIMEOUT_MS = Math.max(
  Number.parseInt(
    process.env.WORKER_TIMEOUT_MS ||
      "900000",
    10
  ),
  30000
);

/*
 * Temporary local index folder on Render.
 *
 * GitHub remains the permanent storage.
 */
const LOCAL_INDEX_ROOT =
  path.join(
    os.tmpdir(),
    "eu-space-rag-index"
  );

/*
 * Only the small manifest is kept in memory.
 *
 * The full NDJSON index remains on disk.
 */
let manifest = null;

let rebuildInProgress = false;
let indexLoadedAt = null;
let lastRebuildAt = null;
let lastPublishedAt = null;
let lastError = null;
let lastReport = null;

/*
 * Return current server and index status.
 */
function getStatus() {
  return {
    indexedChunks:
      manifest?.totalChunks || 0,

    indexLoaded:
      Boolean(
        manifest &&
        manifest.totalChunks > 0
      ),

    indexLoadedAt,
    rebuildInProgress,
    lastRebuildAt,
    lastPublishedAt,
    lastError,
    lastReport,

    githubIndexDirectory:
      `${GITHUB_OWNER}/` +
      `${GITHUB_REPO}/` +
      `${GITHUB_INDEX_DIR}`,

    shardSizeMB:
      SHARD_SIZE_MB,

    workerMemoryMB:
      WORKER_MEMORY_MB,

    workerTimeoutMS:
      WORKER_TIMEOUT_MS
  };
}

/*
 * Return a safe repository-relative file path.
 */
function relativeFilePath(filePath) {
  return path
    .relative(
      ROOT_PATH,
      filePath
    )
    .replace(/\\/g, "/");
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
    items =
      fs.readdirSync(
        folder,
        {
          withFileTypes: true
        }
      );
  } catch (error) {
    console.error(
      `Could not read folder ` +
      `${folder}: ` +
      `${error.message}`
    );

    return results;
  }

  for (const item of items) {
    const fullPath =
      path.join(
        folder,
        item.name
      );

    if (item.isDirectory()) {
      if (
        !IGNORE_DIRS.has(
          item.name
        )
      ) {
        results.push(
          ...listFiles(fullPath)
        );
      }

      continue;
    }

    if (!item.isFile()) {
      continue;
    }

    const lowerName =
      item.name.toLowerCase();

    if (
      lowerName.endsWith(".pdf") ||
      lowerName.endsWith(".docx")
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

/*
 * Convert a search query into terms.
 */
function getQueryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(
      /[^\p{L}\p{N}_-]+/u
    )
    .map(term =>
      term.trim()
    )
    .filter(term =>
      term.length > 2
    );
}

/*
 * Count occurrences without using a regular expression.
 */
function countOccurrences(
  text,
  term
) {
  let count = 0;
  let position = 0;

  while (true) {
    position =
      text.indexOf(
        term,
        position
      );

    if (position === -1) {
      return count;
    }

    count += 1;
    position += term.length;
  }
}

/*
 * Add one search result while keeping only
 * the best topK results in memory.
 */
function addSearchResult(
  results,
  result,
  topK
) {
  results.push(result);

  results.sort(
    (a, b) =>
      b.score - a.score
  );

  if (
    results.length >
    topK
  ) {
    results.length = topK;
  }
}

/*
 * Search the NDJSON shard files line by line.
 *
 * The full index is never loaded into memory.
 */
async function searchIndex(
  query,
  topK
) {
  const terms =
    getQueryTerms(query);

  if (
    terms.length === 0 ||
    !manifest
  ) {
    return [];
  }

  const bestResults = [];

  for (
    const shard
    of manifest.shards || []
  ) {
    const shardPath =
      path.join(
        LOCAL_INDEX_ROOT,
        shard.file
      );

    if (
      !fs.existsSync(shardPath)
    ) {
      console.warn(
        `Missing local shard: ` +
        `${shard.file}`
      );

      continue;
    }

    const input =
      fs.createReadStream(
        shardPath,
        {
          encoding: "utf8"
        }
      );

    const reader =
      readline.createInterface({
        input,
        crlfDelay: Infinity
      });

    try {
      for await (
        const line
        of reader
      ) {
        const trimmed =
          line.trim();

        if (!trimmed) {
          continue;
        }

        let item;

        try {
          item =
            JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (
          typeof item.content !==
            "string" ||
          typeof item.file !==
            "string"
        ) {
          continue;
        }

        const text =
          item.content
            .toLowerCase();

        let score = 0;

        for (
          const term
          of terms
        ) {
          score +=
            countOccurrences(
              text,
              term
            );
        }

        if (score <= 0) {
          continue;
        }

        addSearchResult(
          bestResults,
          {
            file:
              item.file,

            folder:
              item.folder,

            content:
              item.content,

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

/*
 * Calculate a SHA-256 hash without loading
 * the full file into memory.
 */
async function hashFile(
  filePath
) {
  return new Promise(
    (resolve, reject) => {
      const hash =
        crypto.createHash(
          "sha256"
        );

      const input =
        fs.createReadStream(
          filePath
        );

      input.on(
        "error",
        reject
      );

      input.on(
        "data",
        data =>
          hash.update(data)
      );

      input.on(
        "end",
        () =>
          resolve(
            hash.digest("hex")
          )
      );
    }
  );
}

/*
 * Build a map of current source documents.
 */
async function createSourceMap(
  files
) {
  const sources = {};

  for (
    const filePath
    of files
  ) {
    const displayPath =
      relativeFilePath(
        filePath
      );

    try {
      const stats =
        await fs.promises.stat(
          filePath
        );

      sources[displayPath] = {
        absolutePath:
          filePath,

        sha256:
          await hashFile(
            filePath
          ),

        size:
          stats.size
      };
    } catch (error) {
      console.error(
        `Could not inspect ` +
        `${displayPath}: ` +
        `${error.message}`
      );
    }
  }

  return sources;
}

/*
 * Create a raw GitHub URL.
 */
function rawGitHubUrl(
  repositoryPath
) {
  const encodedPath =
    repositoryPath
      .split("/")
      .map(
        encodeURIComponent
      )
      .join("/");

  return (
    "https://raw.githubusercontent.com/" +
    `${encodeURIComponent(
      GITHUB_OWNER
    )}/` +
    `${encodeURIComponent(
      GITHUB_REPO
    )}/` +
    `${encodeURIComponent(
      GITHUB_BRANCH
    )}/` +
    encodedPath
  );
}

/*
 * Download one file using streaming.
 */
async function downloadFile(
  url,
  destination
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "eu-space-rag-render"
        },

        redirect:
          "follow"
      }
    );

  if (
    response.status === 404
  ) {
    return false;
  }

  if (
    !response.ok ||
    !response.body
  ) {
    throw new Error(
      `Download failed: ` +
      `HTTP ${response.status}`
    );
  }

  await fs.promises.mkdir(
    path.dirname(
      destination
    ),
    {
      recursive: true
    }
  );

  const output =
    fs.createWriteStream(
      destination,
      {
        flags: "w"
      }
    );

  try {
    for await (
      const data
      of response.body
    ) {
      if (
        !output.write(data)
      ) {
        await once(
          output,
          "drain"
        );
      }
    }

    await closeWriteStream(
      output
    );

    return true;
  } catch (error) {
    output.destroy();
    throw error;
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
 * Download the manifest and all index shards
 * from GitHub.
 *
 * Only the manifest is kept in memory.
 */
async function loadIndexFromGitHub() {
  await fs.promises.rm(
    LOCAL_INDEX_ROOT,
    {
      recursive: true,
      force: true
    }
  );

  await fs.promises.mkdir(
    LOCAL_INDEX_ROOT,
    {
      recursive: true
    }
  );

  const manifestPath =
    path.join(
      LOCAL_INDEX_ROOT,
      "manifest.json"
    );

  const manifestFound =
    await downloadFile(
      rawGitHubUrl(
        `${GITHUB_INDEX_DIR}/` +
        `manifest.json`
      ),
      manifestPath
    );

  if (!manifestFound) {
    manifest = null;
    indexLoadedAt = null;

    return false;
  }

  const downloadedManifest =
    JSON.parse(
      await fs.promises.readFile(
        manifestPath,
        "utf8"
      )
    );

  if (
    !Array.isArray(
      downloadedManifest.shards
    )
  ) {
    throw new Error(
      "The GitHub manifest has no valid shards list."
    );
  }

  for (
    const shard
    of downloadedManifest.shards
  ) {
    if (
      typeof shard.file !==
      "string"
    ) {
      throw new Error(
        "The GitHub manifest contains an invalid shard."
      );
    }

    const localShard =
      path.join(
        LOCAL_INDEX_ROOT,
        shard.file
      );

    const shardFound =
      await downloadFile(
        rawGitHubUrl(
          `${GITHUB_INDEX_DIR}/` +
          `${shard.file}`
        ),
        localShard
      );

    if (!shardFound) {
      throw new Error(
        `Missing GitHub shard: ` +
        `${shard.file}`
      );
    }
  }

  manifest =
    downloadedManifest;

  indexLoadedAt =
    new Date()
      .toISOString();

  console.log(
    `Loaded index manifest with ` +
    `${manifest.totalChunks || 0} ` +
    `chunks in ` +
    `${manifest.shards.length} ` +
    `shard files.`
  );

  return (
    manifest.totalChunks > 0
  );
}

/*
 * Write one NDJSON line while respecting
 * stream backpressure.
 */
async function writeLine(
  stream,
  value
) {
  const line =
    typeof value === "string"
      ? `${value}\n`
      : `${JSON.stringify(
          value
        )}\n`;

  if (
    !stream.write(
      line,
      "utf8"
    )
  ) {
    await once(
      stream,
      "drain"
    );
  }
}

/*
 * Writer that automatically creates new
 * shard files when the current shard reaches
 * the configured size.
 */
class ShardWriter {
  constructor(outputDirectory) {
    this.outputDirectory =
      outputDirectory;

    this.shards = [];
    this.shardNumber = 0;
    this.output = null;
    this.fileName = "";
    this.bytes = 0;
    this.chunkCount = 0;
    this.totalChunks = 0;
  }

  async openShard() {
    this.shardNumber += 1;

    this.fileName =
      "rag-index-" +
      String(
        this.shardNumber
      ).padStart(
        4,
        "0"
      ) +
      ".ndjson";

    this.output =
      fs.createWriteStream(
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

    await closeWriteStream(
      this.output
    );

    this.shards.push({
      file:
        this.fileName,

      chunks:
        this.chunkCount,

      bytes:
        this.bytes
    });

    this.output = null;
  }

  async writeItem(item) {
    const line =
      `${JSON.stringify(
        item
      )}\n`;

    const lineBytes =
      Buffer.byteLength(
        line,
        "utf8"
      );

    if (!this.output) {
      await this.openShard();
    }

    if (
      this.chunkCount > 0 &&
      this.bytes +
        lineBytes >
        SHARD_SIZE_BYTES
    ) {
      await this.closeShard();
      await this.openShard();
    }

    if (
      !this.output.write(
        line,
        "utf8"
      )
    ) {
      await once(
        this.output,
        "drain"
      );
    }

    this.bytes +=
      lineBytes;

    this.chunkCount += 1;
    this.totalChunks += 1;
  }

  async finish() {
    await this.closeShard();

    return this.shards;
  }
}

/*
 * Copy unchanged chunks from the old shards
 * directly into the new shard writer.
 *
 * No large array is created.
 */
async function copyUnchangedChunks(
  oldShardPaths,
  unchangedFiles,
  writer
) {
  let copiedChunks = 0;

  if (
    unchangedFiles.size === 0
  ) {
    return copiedChunks;
  }

  for (
    const shardPath
    of oldShardPaths
  ) {
    if (
      !fs.existsSync(
        shardPath
      )
    ) {
      continue;
    }

    const input =
      fs.createReadStream(
        shardPath,
        {
          encoding: "utf8"
        }
      );

    const reader =
      readline.createInterface({
        input,
        crlfDelay: Infinity
      });

    try {
      for await (
        const line
        of reader
      ) {
        const trimmed =
          line.trim();

        if (!trimmed) {
          continue;
        }

        let item;

        try {
          item =
            JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (
          unchangedFiles.has(
            item.file
          )
        ) {
          await writer.writeItem(
            item
          );

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

/*
 * Process one source file in a separate
 * Node worker process.
 */
function processFileInWorker(
  filePath,
  displayPath,
  outputPath
) {
  return new Promise(
    resolve => {
      const workerPath =
        path.join(
          ROOT_PATH,
          "index-worker.js"
        );

      const child =
        fork(
          workerPath,
          [
            filePath,
            outputPath,
            displayPath
          ],
          {
            execArgv: [
              `--max-old-space-size=` +
              `${WORKER_MEMORY_MB}`
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
      let workerMessage = null;

      const finish =
        result => {
          if (finished) {
            return;
          }

          finished = true;
          clearTimeout(timer);
          resolve(result);
        };

      const timer =
        setTimeout(
          () => {
            child.kill(
              "SIGKILL"
            );

            finish({
              ok: false,

              reason:
                `Worker exceeded ` +
                `${WORKER_TIMEOUT_MS} ms`
            });
          },
          WORKER_TIMEOUT_MS
        );

      child.on(
        "message",
        message => {
          workerMessage =
            message;
        }
      );

      child.on(
        "error",
        error => {
          finish({
            ok: false,
            reason:
              error.message
          });
        }
      );

      child.on(
        "exit",
        (
          code,
          signal
        ) => {
          if (
            code === 0 &&
            workerMessage?.ok
          ) {
            finish({
              ok: true,

              chunks:
                workerMessage.chunks
            });

            return;
          }

          finish({
            ok: false,

            reason:
              workerMessage?.error ||
              `Worker stopped with ` +
              `code ${code}, ` +
              `signal ${signal}`
          });
        }
      );
    }
  );
}

/*
 * Copy one worker NDJSON file into the
 * shard writer line by line.
 */
async function appendWorkerFile(
  workerFile,
  writer
) {
  let addedChunks = 0;

  const input =
    fs.createReadStream(
      workerFile,
      {
        encoding: "utf8"
      }
    );

  const reader =
    readline.createInterface({
      input,
      crlfDelay: Infinity
    });

  try {
    for await (
      const line
      of reader
    ) {
      const trimmed =
        line.trim();

      if (!trimmed) {
        continue;
      }

      let item;

      try {
        item =
          JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (
        typeof item.file !==
          "string" ||
        typeof item.content !==
          "string"
      ) {
        continue;
      }

      await writer.writeItem(
        item
      );

      addedChunks += 1;
    }
  } finally {
    reader.close();
    input.destroy();
  }

  return addedChunks;
}

/*
 * Create Git authentication environment.
 *
 * The token is not written into the repository URL.
 */
function gitEnvironment() {
  const token =
    process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not configured"
    );
  }

  const basic =
    Buffer.from(
      `x-access-token:${token}`,
      "utf8"
    ).toString(
      "base64"
    );

  return {
    ...process.env,

    GIT_CONFIG_COUNT:
      "1",

    GIT_CONFIG_KEY_0:
      "http.extraHeader",

    GIT_CONFIG_VALUE_0:
      `AUTHORIZATION: basic ${basic}`,

    GIT_TERMINAL_PROMPT:
      "0"
  };
}

/*
 * Run one Git command.
 */
async function runGit(
  args,
  workingDirectory
) {
  const result =
    await execFileAsync(
      "git",
      args,
      {
        cwd:
          workingDirectory,

        env:
          gitEnvironment(),

        maxBuffer:
          20 *
          1024 *
          1024
      }
    );

  return result.stdout.trim();
}

/*
 * Publish the completed index directory to GitHub.
 *
 * The current Render source directory is not modified.
 */
async function publishIndexToGitHub(
  outputDirectory
) {
  const cloneDirectory =
    await fs.promises.mkdtemp(
      path.join(
        os.tmpdir(),
        "rag-publish-"
      )
    );

  try {
    const repositoryUrl =
      `https://github.com/` +
      `${GITHUB_OWNER}/` +
      `${GITHUB_REPO}.git`;

    await runGit(
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        GITHUB_BRANCH,
        repositoryUrl,
        cloneDirectory
      ],
      os.tmpdir()
    );

    const destination =
      path.join(
        cloneDirectory,
        GITHUB_INDEX_DIR
      );

    /*
     * Remove the old index folder inside
     * the temporary clone.
     */
    await fs.promises.rm(
      destination,
      {
        recursive: true,
        force: true
      }
    );

    /*
     * Copy the completed index folder.
     */
    await fs.promises.cp(
      outputDirectory,
      destination,
      {
        recursive: true
      }
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

    await runGit(
      [
        "add",
        GITHUB_INDEX_DIR
      ],
      cloneDirectory
    );

    const gitStatus =
      await runGit(
        [
          "status",
          "--porcelain"
        ],
        cloneDirectory
      );

    if (!gitStatus) {
      console.log(
        "GitHub index is already up to date."
      );

      return false;
    }

    await runGit(
      [
        "commit",
        "-m",
        "Update RAG index [skip render]"
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

    lastPublishedAt =
      new Date()
        .toISOString();

    return true;
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

/*
 * Rebuild the complete index.
 *
 * Low-memory process:
 *
 * 1. Hash source files one by one.
 * 2. Copy unchanged chunks line by line.
 * 3. Process changed documents one at a time.
 * 4. Write chunks directly into shard files.
 * 5. Never keep the complete index in memory.
 * 6. Upload only after the new index is complete.
 */
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
    /*
     * Use the manifest and shards already
     * downloaded from GitHub.
     */
    const oldManifest =
      manifest;

    const oldSources =
      oldManifest?.sources ||
      {};

    const oldShardPaths =
      (
        oldManifest?.shards ||
        []
      ).map(
        shard =>
          path.join(
            LOCAL_INDEX_ROOT,
            shard.file
          )
      );

    /*
     * Find all current source documents.
     */
    const files =
      SOURCE_FOLDERS
        .flatMap(
          folder =>
            listFiles(folder)
        )
        .sort(
          (a, b) =>
            a.localeCompare(b)
        );

    console.log(
      `Found ${files.length} ` +
      `PDF/DOCX files.`
    );

    /*
     * Calculate source hashes.
     */
    const currentSources =
      await createSourceMap(
        files
      );

    const unchangedFiles =
      new Set();

    const changedFiles = [];

    for (
      const [
        displayPath,
        source
      ]
      of Object.entries(
        currentSources
      )
    ) {
      if (
        oldSources[
          displayPath
        ]?.sha256 ===
          source.sha256 &&
        oldSources[
          displayPath
        ]?.status ===
          "indexed"
      ) {
        unchangedFiles.add(
          displayPath
        );
      } else {
        changedFiles.push(
          displayPath
        );
      }
    }

    /*
     * Files present in the old manifest
     * but not in the repository are deleted.
     */
    const deletedFiles =
      Object.keys(
        oldSources
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

    const writer =
      new ShardWriter(
        outputDirectory
      );

    const sourceReport = {};
    const failures = [];

    /*
     * Copy unchanged chunks directly from
     * old shards into new shards.
     */
    const copiedChunks =
      await copyUnchangedChunks(
        oldShardPaths,
        unchangedFiles,
        writer
      );

    for (
      const fileName
      of unchangedFiles
    ) {
      sourceReport[
        fileName
      ] = {
        ...oldSources[
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

    let indexedFiles = 0;
    let skippedFiles = 0;
    let newChunks = 0;

    /*
     * Process new or changed files.
     */
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
            .createHash(
              "sha1"
            )
            .update(
              displayPath
            )
            .digest(
              "hex"
            ) +
            ".ndjson"
        );

      console.log(
        `Processing: ` +
        `${displayPath}`
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
          file:
            displayPath,

          reason:
            result.reason
        });

        sourceReport[
          displayPath
        ] = {
          sha256:
            source.sha256,

          size:
            source.size,

          status:
            "skipped",

          reason:
            result.reason,

          chunks:
            0
        };

        console.warn(
          `Skipped ` +
          `${displayPath}: ` +
          `${result.reason}`
        );

        await fs.promises.rm(
          workerFile,
          {
            force: true
          }
        );

        continue;
      }

      const addedChunks =
        await appendWorkerFile(
          workerFile,
          writer
        );

      indexedFiles += 1;
      newChunks +=
        addedChunks;

      sourceReport[
        displayPath
      ] = {
        sha256:
          source.sha256,

        size:
          source.size,

        status:
          "indexed",

        chunks:
          addedChunks
      };

      console.log(
        `Indexed: ` +
        `${displayPath} ` +
        `(${addedChunks} chunks)`
      );

      await fs.promises.rm(
        workerFile,
        {
          force: true
        }
      );
    }

    /*
     * Close the final shard.
     */
    const shards =
      await writer.finish();

    if (
      writer.totalChunks === 0
    ) {
      throw new Error(
        "The completed index contains no chunks."
      );
    }

    /*
     * Create the new manifest.
     */
    const newManifest = {
      version: 2,

      createdAt:
        new Date()
          .toISOString(),

      repository:
        `${GITHUB_OWNER}/` +
        `${GITHUB_REPO}`,

      branch:
        GITHUB_BRANCH,

      shardSizeMB:
        SHARD_SIZE_MB,

      totalChunks:
        writer.totalChunks,

      shards,

      sources:
        sourceReport,

      report: {
        discoveredFiles:
          files.length,

        unchangedFiles:
          unchangedFiles.size,

        changedFiles:
          changedFiles.length,

        deletedFiles,

        indexedFiles,

        skippedFiles,

        copiedChunks,

        newChunks,

        totalChunks:
          writer.totalChunks,

        failures
      }
    };

    await fs.promises.writeFile(
      path.join(
        outputDirectory,
        "manifest.json"
      ),
      JSON.stringify(
        newManifest,
        null,
        2
      ),
      "utf8"
    );

    /*
     * Publish only after the full new index
     * has been completed successfully.
     */
    let published = false;

    if (publish) {
      published =
        await publishIndexToGitHub(
          outputDirectory
        );
    }

    /*
     * Replace the local index only after the
     * new index has been completed.
     */
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

    manifest =
      newManifest;

    indexLoadedAt =
      new Date()
        .toISOString();

    lastRebuildAt =
      new Date()
        .toISOString();

    lastReport = {
      discoveredFiles:
        files.length,

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
        shards.length,

      published,

      failures
    };

    console.log(
      "Index rebuild completed."
    );

    console.log(
      `Total chunks: ` +
      `${manifest.totalChunks}`
    );

    console.log(
      `Shard files: ` +
      `${shards.length}`
    );

    console.log(
      `Skipped files: ` +
      `${skippedFiles}`
    );

    return lastReport;
  } catch (error) {
    lastError =
      error.message;

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
