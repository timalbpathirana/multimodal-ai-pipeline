"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getPool } = require("../db");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.niche, a.is_active, a.created_at,
            pr.status AS last_run_status, pr.created_at AS last_run_at,
            COALESCE(s.auto_post_to_tiktok,    false) AS has_tiktok,
            COALESCE(s.auto_send_to_telegram, false) AS has_telegram
     FROM agents a
     LEFT JOIN LATERAL (
       SELECT status, created_at FROM pipeline_runs
       WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 1
     ) pr ON true
     LEFT JOIN agent_settings s ON s.agent_id = a.id
     WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
    [req.session.userId],
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { name, niche } = req.body;
  if (!name || !niche) return res.status(400).json({ error: "name and niche required" });

  const pool = getPool();
  const { rows } = await pool.query(
    "INSERT INTO agents (user_id, name, niche) VALUES ($1, $2, $3) RETURNING *",
    [req.session.userId, name, niche],
  );
  const agent = rows[0];

  // Create default settings row
  await pool.query("INSERT INTO agent_settings (agent_id) VALUES ($1) ON CONFLICT DO NOTHING", [agent.id]);

  res.status(201).json(agent);
});

router.get("/:id", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM agents WHERE id = $1 AND user_id = $2",
    [req.params.id, req.session.userId],
  );
  if (!rows[0]) return res.status(404).json({ error: "Agent not found" });
  res.json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const { name, niche, is_active } = req.body;
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE agents SET
       name = COALESCE($1, name),
       niche = COALESCE($2, niche),
       is_active = COALESCE($3, is_active)
     WHERE id = $4 AND user_id = $5 RETURNING *`,
    [name, niche, is_active, req.params.id, req.session.userId],
  );
  if (!rows[0]) return res.status(404).json({ error: "Agent not found" });
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const pool = getPool();
  const { rowCount } = await pool.query(
    "DELETE FROM agents WHERE id = $1 AND user_id = $2",
    [req.params.id, req.session.userId],
  );
  if (!rowCount) return res.status(404).json({ error: "Agent not found" });
  res.status(204).end();
});

module.exports = router;
