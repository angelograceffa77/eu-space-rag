"use strict";

const express = require("express");
const cors = require("cors");

require("dotenv").config();

const {
  getStatus,
  loadIndexFromGitHub,
  rebuildIndex,
  searchIndex
} = require("./index-manager");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number.parseInt(
  process.env.PORT || "3000",
  10
);

const MAX_TOP_K = 20;

/*
 * Protect the manual rebuild endpoint.
 */
function requireAdminToken(
  req,
  res,
  next
) {
  const expectedToken =
    process.env.RAG_ADMIN_TOKEN;

  const suppliedToken =
    req.get("x-rag-admin-token");

  if (!expectedToken) {
    return res.status(503).json({
      error:
        "RAG_ADMIN_TOKEN is not configured"
    });
  }

  if (
    !suppliedToken ||
    suppliedToken !== expectedToken
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

/*
 * Main status endpoint.
 */
app.get("/", (req, res) => {
  res.json({
    status:
      "EU Space RAG API running",
    ...getStatus()
  });
});

/*
 * Render health-check endpoint.
 *
 * This always returns HTTP 200 while the web server
 * is running. The index may still be rebuilding.
 */
app.get("/health", (req, res) => {
  const status = getStatus();

  res.status(200).json({
    status: "ok",
    indexReady:
      status.indexedChunks > 0,
    indexedChunks:
      status.indexedChunks,
    rebuildInProgress:
      status.rebuildInProgress,
    lastError:
      status.lastError
  });
});

/*
 * Search endpoint.
 *
 * searchIndex is asynchronous because it reads the
 * NDJSON shard files one line at a time.
 */
app.post(
  "/rag/search",
  async (req, res, next) => {
    try {
      const query =
        typeof req.body?.query === "string"
          ? req.body.query.trim()
          : "";

      const requestedTopK =
        Number.parseInt(
          req.body?.topK ?? "5",
          10
        );

      const topK =
        Number.isFinite(requestedTopK)
          ? Math.min(
              Math.max(
                requestedTopK,
                1
              ),
              MAX_TOP_K
            )
          : 5;

      if (!query) {
        return res.status(400).json({
          error: "Missing query"
        });
      }

      const status = getStatus();

      if (status.indexedChunks === 0) {
        return res.status(503).json({
          error:
            status.rebuildInProgress
              ? "The search index is being rebuilt."
              : "The search index is empty."
        });
      }

      const results =
        await searchIndex(
          query,
          topK
        );

      return res.json({
        query,
        results,
        indexedChunks:
          status.indexedChunks
      });
    } catch (error) {
      return next(error);
    }
  }
);

/*
 * Protected manual rebuild endpoint.
 */
app.post(
  "/rag/rebuild",
  requireAdminToken,
  (req, res) => {
    const status = getStatus();

    if (status.rebuildInProgress) {
      return res.status(409).json({
        error:
          "An index rebuild is already running"
      });
    }

    res.status(202).json({
      status:
        "Index rebuild started"
    });

    rebuildIndex({
      publish: true
    }).then(result => {
      console.log(
        "Manual rebuild completed:",
        result
      );
    }).catch(error => {
      console.error(
        `Manual rebuild failed: ` +
        `${error.message}`
      );
    });
  }
);

/*
 * Central Express error handler.
 */
app.use(
  (error, req, res, next) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      error:
        "Internal server error"
    });
  }
);

/*
 * Start the web server before loading or rebuilding
 * the index.
 *
 * This lets Render see that the service is alive
 * while the background work continues.
 */
const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `RAG API running on port ${PORT}`
    );

    void startIndexInBackground();
  }
);

/*
 * Startup process:
 *
 * 1. Try to download the current index from GitHub.
 * 2. Make it available for searches immediately.
 * 3. Check the source documents.
 * 4. Rebuild and publish the index when necessary.
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
        "No usable GitHub index was found."
      );
    }

    const result =
      await rebuildIndex({
        publish: true
      });

    console.log(
      "Automatic index check completed:",
      result
    );
  } catch (error) {
    console.error(
      `Automatic index startup failed: ` +
      `${error.message}`
    );
  }
}

/*
 * Close the server cleanly when Render stops
 * or replaces the service.
 */
process.on(
  "SIGTERM",
  () => {
    console.log(
      "SIGTERM received. Closing server."
    );

    server.close(() => {
      process.exit(0);
    });
  }
);

/*
 * Log unexpected promise failures instead of
 * allowing them to disappear silently.
 */
process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled promise rejection:",
      error
    );
  }
);

/*
 * Log unexpected synchronous errors.
 */
process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );

    process.exit(1);
  }
);
