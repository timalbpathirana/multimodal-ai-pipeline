"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getPool } = require("../db");

const router = express.Router();
router.use(requireAuth);

const GLOBAL_KEYS = [
  "anthropic_api_key",
  "elevenlabs_api_key",
  "pexels_api_key",
  "airtable_api_key",
  "serper_api_key",
  "trigger_secret_key",
];

function maskKey(val) {
  if (!val || val.length <= 4) return val;
  return "•".repeat(Math.min(val.length - 4, 20)) + val.slice(-4);
}

router.get("/", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query("SELECT key, value FROM global_config WHERE key = ANY($1)", [GLOBAL_KEYS]);
  const result = {};
  for (const key of GLOBAL_KEYS) {
    const row = rows.find((r) => r.key === key);
    result[key] = row ? maskKey(row.value) : null;
  }
  res.json(result);
});

router.put("/", async (req, res) => {
  const pool = getPool();
  const updates = {};
  for (const key of GLOBAL_KEYS) {
    if (req.body[key] !== undefined && req.body[key] !== null && !req.body[key].includes("•")) {
      updates[key] = req.body[key];
    }
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid keys to update" });

  for (const [key, value] of Object.entries(updates)) {
    await pool.query(
      `INSERT INTO global_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, value],
    );
  }
  res.json({ ok: true, updated: Object.keys(updates) });
});

module.exports = router;
