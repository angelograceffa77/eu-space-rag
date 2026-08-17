"use strict";

const express = require("express");
const cors = require("cors");

require("dotenv").config();

const {
  getStatus,
  loadIndexFromGitHub,
  rebuildIndex,
  searchIndex,
  readDocument
} = require("./index-manager");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number.parseInt(
  process.env.PORT || "3000",
  10
);

const HOST = "0.0.0.0";

/*
 * Home/status endpoint.
 *
 * Important:
 * - indexReady means there is a searchable final index OR checkpoint.
 * - rebuildInProgress does NOT prevent searches.
 */
app.get("/", (req, res) => {
  const status = getStatus();

  res.status(200).json({
    service: "EU Space RAG",
    status: "ok",
    indexReady: status.indexedChunks > 0,
    indexMode: status.indexMode,
    indexedChunks: status.indexedChunks,
    finalIndexedChunks: status.finalIndexedChunks,
    rebuildInProgress: status.rebuildInProgress,
    ...status
  });
});

/*
 * Render health check.
 *
 * Always return HTTP 200 while the web server itself is alive.
 * A rebuild or an unavailable index must not make Render consider
 * the web service unhealthy.
 */
app.get("/health", (req, res) => {
  const status = getStatus();

  res.status(200).json({
    status: "ok",
    indexReady: status.indexedChunks > 0,
    indexMode: status.indexMode,
    indexedChunks: status.indexedChunks,
    rebuildInProgress: status.rebuildInProgress,
    lastError: status.lastError
  });
});

/*
 * Search endpoint.
 *
 * Searches remain available while a rebuild is running.
 *
 * index-manager decides what should be searched:
 * - final index, when one exists;
 * - otherwise the latest searchable checkpoint.
 */
app.post("/rag/search", async (req, res) => {
  try {
    const query =
      typeof req.body?.query === "string"
        ? req.body.query.trim()
        : "";

    const requestedTopK =
      Number.parseInt(req.body?.topK, 10);

    const topK =
      Number.isFinite(requestedTopK)
        ? Math.min(
            Math.max(requestedTopK, 1),
            50
          )
        : 8;

    if (!query) {
      return res.status(400).json({
        error: "A non-empty query is required."
      });
    }

    const statusBeforeSearch = getStatus();

    /*
     * Do NOT block merely because rebuildInProgress is true.
     * If indexedChunks > 0, index-manager has a searchable
     * final index or checkpoint available.
     */
    if (statusBeforeSearch.indexedChunks <= 0) {
      return res.status(503).json({
        error: "No searchable index is available yet.",
        indexReady: false,
        indexMode: statusBeforeSearch.indexMode,
        rebuildInProgress:
          statusBeforeSearch.rebuildInProgress
      });
    }

    const alternateQueries = Array.isArray(req.body?.alternateQueries)
      ? req.body.alternateQueries
          .filter(value => typeof value === "string")
          .map(value => value.trim())
          .filter(Boolean)
          .slice(0, 7)
      : [];

    const searchQueries = [query, ...alternateQueries];

    const results =
      await searchIndex(searchQueries, topK);

    const statusAfterSearch = getStatus();

    return res.status(200).json({
      query,
      alternateQueries,
      topK,
      resultCount: results.length,
      indexMode: statusAfterSearch.indexMode,
      indexedChunks: statusAfterSearch.indexedChunks,
      rebuildInProgress:
        statusAfterSearch.rebuildInProgress,
      results
    });
  } catch (error) {
    console.error(
      "Search failed:",
      error
    );

    return res.status(500).json({
      error: "Search failed.",
      detail: error.message
    });
  }
});


/*
 * Full-document reading endpoint.
 *
 * This reads the complete extracted text already stored in the RAG
 * index. It does NOT re-parse the original PDF/DOCX. Large documents
 * are returned in successive character ranges using offset/limit.
 */
app.post("/rag/document", async (req, res) => {
  try {
    const file =
      typeof req.body?.file === "string"
        ? req.body.file.trim()
        : "";

    if (!file) {
      return res.status(400).json({
        error: "A non-empty file path is required."
      });
    }

    const requestedOffset = Number.parseInt(req.body?.offset, 10);
    const requestedLimit = Number.parseInt(req.body?.limit, 10);

    const offset = Number.isFinite(requestedOffset)
      ? Math.max(requestedOffset, 0)
      : 0;

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1000), 80000)
      : 40000;

    const statusBeforeRead = getStatus();

    if (statusBeforeRead.indexedChunks <= 0) {
      return res.status(503).json({
        error: "No searchable index is available yet."
      });
    }

    const document = await readDocument(file, offset, limit);

    if (!document) {
      return res.status(404).json({
        error: "Document not found in the active RAG index.",
        file
      });
    }

    const statusAfterRead = getStatus();

    return res.status(200).json({
      ...document,
      indexMode: statusAfterRead.indexMode,
      indexedChunks: statusAfterRead.indexedChunks,
      rebuildInProgress: statusAfterRead.rebuildInProgress
    });
  } catch (error) {
    console.error("Document read failed:", error);

    return res.status(500).json({
      error: "Document read failed.",
      detail: error.message
    });
  }
});

/*
 * Protected manual rebuild endpoint.
 *
 * Example:
 * POST /rag/rebuild
 * Authorization: Bearer <RAG_ADMIN_TOKEN>
 *
 * The existing searchable index remains available while the
 * rebuild runs in the background.
 */
app.post("/rag/rebuild", (req, res) => {
  const configuredToken =
    process.env.RAG_ADMIN_TOKEN;

  if (!configuredToken) {
    return res.status(503).json({
      error:
        "RAG_ADMIN_TOKEN is not configured."
    });
  }

  const authorization =
    req.get("authorization") || "";

  const expected =
    `Bearer ${configuredToken}`;

  if (authorization !== expected) {
    return res.status(401).json({
      error: "Unauthorized."
    });
  }

  const currentStatus = getStatus();

  if (currentStatus.rebuildInProgress) {
    return res.status(409).json({
      error:
        "An index rebuild is already running.",
      status: currentStatus
    });
  }

  /*
   * Respond immediately. The rebuild continues in the
   * background, while /rag/search keeps using the best
   * searchable index exposed by index-manager.
   */
  res.status(202).json({
    accepted: true,
    message:
      "Index check/rebuild started in the background.",
    searchableIndexAvailable:
      currentStatus.indexedChunks > 0,
    indexMode: currentStatus.indexMode,
    indexedChunks: currentStatus.indexedChunks
  });

  rebuildIndex({ publish: true })
    .then(report => {
      console.log(
        "Manual index rebuild completed:",
        report
      );
    })
    .catch(error => {
      console.error(
        "Manual index rebuild failed:",
        error
      );
    });
});

/*
 * Load the permanent GitHub index first.
 * Then perform the source comparison/rebuild check.
 *
 * Because the server has already started listening, the API can
 * answer health/status requests immediately.
 */
async function startIndexInBackground() {
  try {
    const loaded =
      await loadIndexFromGitHub();

    if (loaded) {
      console.log(
        "Existing GitHub index downloaded successfully."
      );
    } else {
      console.log(
        "No completed GitHub index is currently available."
      );
    }
  } catch (error) {
    console.error(
      "Could not load completed GitHub index:",
      error
    );
  }

  try {
    const report =
      await rebuildIndex({
        publish: true
      });

    console.log(
      "Automatic index check completed:",
      report
    );
  } catch (error) {
    console.error(
      "Automatic index startup failed:",
      error
    );
  }
}

const server = app.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `RAG API running on port ${PORT}`
    );

    /*
     * Do not await this.
     * The HTTP service stays available while indexing/checking
     * happens in the background.
     */
    startIndexInBackground();
  }
);

function shutdown(signal) {
  console.log(
    `${signal} received. Closing HTTP server.`
  );

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 10000).unref();
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "unhandledRejection",
  reason => {
    console.error(
      "Unhandled promise rejection:",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);
