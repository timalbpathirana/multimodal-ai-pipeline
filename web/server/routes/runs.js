"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getPool } = require("../db");
const { enqueueRun, enqueueProduceVideos } = require("../lib/jobQueue");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

async function ownsAgent(pool, agentId, userId) {
  const { rows } = await pool.query("SELECT id FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return rows.length > 0;
}

// POST /api/agents/:id/runs — trigger a run
router.post("/", async (req, res) => {
  const { mode } = req.body; // 'ingest' | 'video'
  if (!["ingest", "video"].includes(mode)) return res.status(400).json({ error: "mode must be 'ingest' or 'video'" });

  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });

  // Prevent duplicate concurrent runs
  const { rows: active } = await pool.query(
    "SELECT id FROM pipeline_runs WHERE agent_id = $1 AND status IN ('queued', 'running', 'awaiting_review')",
    [req.params.id],
  );
  if (active.length > 0) return res.status(409).json({ error: "A run is already in progress for this agent" });

  // Create run record with initial log
  const ts = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO pipeline_runs (agent_id, run_mode, logs) VALUES ($1, $2, $3) RETURNING *`,
    [req.params.id, mode, `[${ts}] Run created (mode=${mode}). Waiting for worker...\n`],
  );
  const run = rows[0];

  // Enqueue the job
  await enqueueRun(req.params.id, run.id, mode);

  res.status(202).json({ runId: run.id, status: run.status });
});

// GET /api/agents/:id/runs — list last 20 runs
router.get("/", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    `SELECT id, run_mode, status, output_paths, started_at, finished_at, created_at
     FROM pipeline_runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.params.id],
  );
  res.json(rows);
});

// GET /api/runs/:runId — run detail (used by non-agent-scoped requests too)
router.get("/:runId", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]);
  if (!rows[0]) return res.status(404).json({ error: "Run not found" });
  res.json(rows[0]);
});

// GET /api/runs/:runId/logs
router.get("/:runId/logs", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query("SELECT logs FROM pipeline_runs WHERE id = $1", [req.params.runId]);
  if (!rows[0]) return res.status(404).json({ error: "Run not found" });
  res.json({ logs: rows[0].logs || "" });
});

// POST /api/runs/:runId/cancel — cancel a stuck or in-progress run
router.post("/:runId/cancel", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]);
  const run = rows[0];
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (!["queued", "running", "awaiting_review"].includes(run.status)) {
    return res.status(409).json({ error: "Run is not active" });
  }
  if (!(await ownsAgent(pool, run.agent_id, req.session.userId))) return res.status(403).json({ error: "Forbidden" });

  const ts = new Date().toISOString();
  await pool.query(
    `UPDATE pipeline_runs SET status = 'failed', finished_at = now(),
     logs = COALESCE(logs, '') || $1 WHERE id = $2`,
    [`[${ts}] Run cancelled by user.\n`, run.id],
  );
  res.json({ ok: true });
});

// POST /api/runs/:runId/approve — approve scripts and enqueue produce-videos job
router.post("/:runId/approve", async (req, res) => {
  const { scripts } = req.body;
  if (!Array.isArray(scripts) || scripts.length === 0) return res.status(400).json({ error: "scripts array required" });

  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]);
  const run = rows[0];
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (run.status !== "awaiting_review") return res.status(409).json({ error: "Run is not awaiting review" });

  // Verify the agent belongs to this user
  if (!(await ownsAgent(pool, run.agent_id, req.session.userId))) return res.status(403).json({ error: "Forbidden" });

  // Store the approved scripts and re-enqueue for video production
  await pool.query(
    "UPDATE pipeline_runs SET scripts_data = $1, status = 'queued' WHERE id = $2",
    [JSON.stringify({ approved: scripts }), req.params.runId],
  );

  await enqueueProduceVideos(run.agent_id, req.params.runId);

  res.status(202).json({ ok: true });
});

module.exports = router;
