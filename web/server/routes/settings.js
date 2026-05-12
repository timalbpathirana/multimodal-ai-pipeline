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
  "tiktok_refresh_token",
  "telegram_bot_token",
  "telegram_chat_id",
  "auto_send_to_telegram",
  "ingest_lookback_days",
  "stories_per_week",
  "pipeline_stop_after",
  "pexels_override_url",
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
  for (const k of ["anthropic_api_key", "elevenlabs_api_key", "pexels_api_key", "airtable_api_key", "serper_api_key", "tiktok_access_token", "tiktok_refresh_token", "telegram_bot_token"]) {
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

  // When a fresh access token is saved, record its 24h expiry so the auto-refresh knows when to kick in
  if (updates.tiktok_access_token && !String(updates.tiktok_access_token).includes("•")) {
    updates.tiktok_token_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");

  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO agent_settings (agent_id, ${keys.join(", ")})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})
       ON CONFLICT (agent_id) DO UPDATE SET ${setClauses}, updated_at = now()
       RETURNING *`,
      [req.params.id, ...values],
    ));
  } catch (err) {
    console.error("[settings] PUT error:", err.message);
    return res.status(500).json({ error: `Database error: ${err.message}` });
  }
  res.json(rows[0]);
});

// POST /api/agents/:id/settings/verify-pexels — validate a Pexels video URL and return a previewable file URL
router.post("/verify-pexels", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const match = url.match(/[-\/](\d+)\/?(?:[#?].*)?$/);
  if (!match) return res.status(400).json({ error: "Could not extract a video ID from that URL" });
  const videoId = match[1];

  // Resolve the Pexels API key for this agent (agent override → global config → env)
  const [settingsRes, globalRes] = await Promise.all([
    pool.query("SELECT pexels_api_key FROM agent_settings WHERE agent_id = $1", [req.params.id]),
    pool.query("SELECT value FROM global_config WHERE key = 'pexels_api_key'"),
  ]);
  const apiKey =
    settingsRes.rows[0]?.pexels_api_key ||
    globalRes.rows[0]?.value ||
    process.env.PEXELS_API_KEY;

  if (!apiKey) return res.status(400).json({ error: "No Pexels API key configured for this agent" });

  let pexelsRes;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    pexelsRes = await fetch(`https://api.pexels.com/videos/videos/${videoId}`, {
      headers: { Authorization: apiKey },
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    return res.status(502).json({ error: `Could not reach Pexels API: ${err.message}` });
  }

  if (pexelsRes.status === 404) return res.status(404).json({ error: "Video not found on Pexels" });
  if (pexelsRes.status === 401 || pexelsRes.status === 403) return res.status(401).json({ error: "Invalid Pexels API key" });
  if (!pexelsRes.ok) return res.status(502).json({ error: `Pexels API returned ${pexelsRes.status}` });

  const video = await pexelsRes.json();
  const portrait = (video.video_files || []).filter((f) => f.height > f.width);
  const hd = portrait.find((f) => f.width >= 720);
  const best = hd || portrait[0] || video.video_files?.[0];

  if (!best) return res.status(400).json({ error: "No usable video file found" });

  res.json({
    videoFileUrl: best.link,
    width: best.width,
    height: best.height,
    duration: video.duration,
  });
});

module.exports = router;
