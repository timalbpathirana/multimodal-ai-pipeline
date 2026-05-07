"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const cors = require("cors");
const path = require("path");

const { getPool } = require("./db");
const { startJobQueue, stopJobQueue } = require("./lib/jobQueue");

const authRouter = require("./routes/auth");
const agentsRouter = require("./routes/agents");
const settingsRouter = require("./routes/settings");
const feedsRouter = require("./routes/feeds");
const promptsRouter = require("./routes/prompts");
const configRouter = require("./routes/config");
const schedulesRouter = require("./routes/schedules");
const runsRouter = require("./routes/runs");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: isProd ? false : "http://localhost:5173", // Vite dev server
  credentials: true,
}));

const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    pool: getPool(),
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ── API routes ────────────────────────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/config", configRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/agents/:id/settings", settingsRouter);
app.use("/api/agents/:id/feeds", feedsRouter);
app.use("/api/agents/:id/prompts", promptsRouter);
app.use("/api/agents/:id/schedules", schedulesRouter);
app.use("/api/agents/:id/runs", runsRouter);
// Stand-alone run detail and logs (no agent scope needed after creation)
app.use("/api/runs", runsRouter);

app.get("/api/health", async (req, res) => {
  try {
    await getPool().query("SELECT 1");
    res.json({ status: "ok", db: "ok" });
  } catch {
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

// ── Static files (React build in production) ─────────────────────────────────

const clientBuildDir = path.resolve(__dirname, "../client/dist");
if (isProd) {
  app.use(express.static(clientBuildDir));
  app.get("*", (_req, res) => res.sendFile(path.join(clientBuildDir, "index.html")));
}

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error("[server] Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  await startJobQueue();

  app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT} (${isProd ? "production" : "development"})`);
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received — draining job queue...");
  await stopJobQueue();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await stopJobQueue();
  process.exit(0);
});

start().catch((err) => {
  console.error("[server] Fatal startup error:", err.message);
  process.exit(1);
});

module.exports = app; // for testing
