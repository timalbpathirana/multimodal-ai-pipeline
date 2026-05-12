"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getPool } = require("../db");
const { registerSchedule, unregisterSchedule } = require("../lib/jobQueue");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

async function ownsAgent(pool, agentId, userId) {
  const { rows } = await pool.query("SELECT id FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return rows.length > 0;
}

router.get("/", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "SELECT * FROM agent_schedules WHERE agent_id = $1 ORDER BY created_at",
    [req.params.id],
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { run_mode, cron_utc, label } = req.body;
  if (!run_mode || !cron_utc) return res.status(400).json({ error: "run_mode and cron_utc required" });
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "INSERT INTO agent_schedules (agent_id, run_mode, cron_utc, label) VALUES ($1, $2, $3, $4) RETURNING *",
    [req.params.id, run_mode, cron_utc, label || null],
  );
  const schedule = rows[0];
  await registerSchedule(schedule);
  res.status(201).json(schedule);
});

router.patch("/:sid", async (req, res) => {
  const { is_active, cron_utc, label } = req.body;
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    `UPDATE agent_schedules SET
       is_active = COALESCE($1, is_active),
       cron_utc  = COALESCE($2, cron_utc),
       label     = COALESCE($3, label)
     WHERE id = $4 AND agent_id = $5 RETURNING *`,
    [is_active, cron_utc, label, req.params.sid, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: "Schedule not found" });
  const schedule = rows[0];
  // Re-register with updated cron / active state
  await unregisterSchedule(schedule.id);
  if (schedule.is_active) await registerSchedule(schedule);
  res.json(schedule);
});

router.delete("/:sid", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "DELETE FROM agent_schedules WHERE id = $1 AND agent_id = $2 RETURNING id",
    [req.params.sid, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: "Schedule not found" });
  await unregisterSchedule(req.params.sid);
  res.status(204).end();
});

module.exports = router;
