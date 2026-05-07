"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getPool } = require("../db");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const UPDATABLE_FIELDS = [
  "elevenlabs_voice_id",
  "airtable_base_id",
  "airtable_table",
  "airtable_api_key",
  "serper_api_key",
  "anthropic_api_key",
  "elevenlabs_api_key",
  "pexels_api_key",
  "tiktok_access_token",
  "tiktok_open_id",
  "auto_post_to_tiktok",
  "tiktok_privacy_level",
  "is_breaking_news",
  "human_in_the_loop",
  "number_of_videos",
  "ingest_lookback_days",
  "stories_per_week",
  "pipeline_stop_after",
];

async function ownsAgent(pool, agentId, userId) {
  const { rows } = await pool.query("SELECT id FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return rows.length > 0;
}

function maskKey(val) {
  if (!val || val.length <= 4) return val;
  return "•".repeat(val.length - 4) + val.slice(-4);
}

router.get("/", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) {
    return res.status(404).json({ error: "Agent not found" });
  }
  const { rows } = await pool.query("SELECT * FROM agent_settings WHERE agent_id = $1", [req.params.id]);
  const s = rows[0] || {};
  // Mask sensitive keys on GET
  const masked = { ...s };
  for (const k of ["anthropic_api_key", "elevenlabs_api_key", "pexels_api_key", "airtable_api_key", "serper_api_key", "tiktok_access_token"]) {
    if (masked[k]) masked[k] = maskKey(masked[k]);
  }
  res.json(masked);
});

router.put("/", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });

  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");

  const { rows } = await pool.query(
    `INSERT INTO agent_settings (agent_id, ${keys.join(", ")})
     VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})
     ON CONFLICT (agent_id) DO UPDATE SET ${setClauses}, updated_at = now()
     RETURNING *`,
    [req.params.id, ...values],
  );
  res.json(rows[0]);
});

module.exports = router;
