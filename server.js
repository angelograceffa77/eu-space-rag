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

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const MAX_TOP_K = 20;

function requireAdminToken(req, res, next) {
  const expected = process.env.RAG_ADMIN_TOKEN;
  const supplied = req.get("x-rag-admin-token");

  if (!expected) {
    return res.status(503).json({
      error: "RAG_ADMIN_TOKEN is not configured"
    });
  }

  if (!supplied || supplied !== expected) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    status: "EU Space RAG API running",
    ...getStatus()
  });
});

app.get("/health", (req, res) => {
  const status = getStatus();

  res.status(status.indexedChunks > 0 ? 200 : 503).json({
    status: status.indexedChunks > 0 ? "ok" : "index-not-ready",
    indexedChunks: status.indexedChunks,
    rebuildInProgress: status.rebuildInProgress,
    lastError: status.lastError
  });
});

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

  const status = getStatus();

  if (status.indexedChunks === 0) {
    return res.status(503).json({
      error: status.rebuildInProgress
        ? "The search index is being rebuilt."
        : "The search index is empty."
    });
  }

  return res.json({
    query,
    results: searchIndex(query, topK),
    indexedChunks: status.indexedChunks
  });
});

app.post("/rag/rebuild", requireAdminToken, (req, res) => {
  const status = getStatus();

  if (status.rebuildInProgress) {
    return res.status(409).json({
      error: "An index rebuild is already running"
    });
  }

  res.status(202).json({
    status: "Index rebuild started"
  });

  rebuildIndex({ publish: true }).catch(error => {
    console.error(`Manual rebuild failed: ${error.message}`);
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "Internal server error"
  });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`RAG API running on port ${PORT}`);
  void startIndexInBackground();
});

async function startIndexInBackground() {
  try {
    await loadIndexFromGitHub();

    const result = await rebuildIndex({
      publish: true
    });

    console.log("Automatic index check completed:", result);
  } catch (error) {
    console.error(
      `Automatic index startup failed: ${error.message}`
    );
  }
}

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
