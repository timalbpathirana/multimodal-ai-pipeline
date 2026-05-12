"use strict";

const express = require("express");
const Parser = require("rss-parser");
const { YoutubeTranscript } = require("youtube-transcript");
const { requireAuth } = require("../middleware/auth");
const { getPool } = require("../db");

const feedParser = new Parser({
  customFields: { item: [["yt:videoId", "videoId"]] },
  timeout: 10000,
});

async function checkCaptionsForChannel(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const feed = await feedParser.parseURL(feedUrl);
  if (!feed.items || feed.items.length === 0) {
    throw new Error(`No videos found for channel ${channelId}`);
  }
  const videoId = feed.items[0].videoId;
  if (!videoId) throw new Error(`Could not extract video ID for channel ${channelId}`);
  try {
    await YoutubeTranscript.fetchTranscript(videoId);
    return true;
  } catch {
    return false;
  }
}

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

async function ownsAgent(pool, agentId, userId) {
  const { rows } = await pool.query("SELECT id FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return rows.length > 0;
}

// ── RSS ───────────────────────────────────────────────────────────────────────

router.get("/rss", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "SELECT * FROM agent_rss_feeds WHERE agent_id = $1 ORDER BY sort_order, id",
    [req.params.id],
  );
  res.json(rows);
});

router.post("/rss", async (req, res) => {
  const { url, label } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "INSERT INTO agent_rss_feeds (agent_id, url, label) VALUES ($1, $2, $3) ON CONFLICT (agent_id, url) DO NOTHING RETURNING *",
    [req.params.id, url, label || null],
  );
  res.status(201).json(rows[0] || { error: "Feed already exists" });
});

router.delete("/rss/:feedId", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  await pool.query("DELETE FROM agent_rss_feeds WHERE id = $1 AND agent_id = $2", [req.params.feedId, req.params.id]);
  res.status(204).end();
});

// ── YouTube ───────────────────────────────────────────────────────────────────

router.get("/youtube", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "SELECT * FROM agent_youtube_feeds WHERE agent_id = $1 ORDER BY sort_order, id",
    [req.params.id],
  );
  res.json(rows);
});

router.post("/youtube", async (req, res) => {
  const { channel_id, label } = req.body;
  if (!channel_id) return res.status(400).json({ error: "channel_id required" });
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });

  let captionsAvailable;
  try {
    captionsAvailable = await checkCaptionsForChannel(channel_id);
  } catch (err) {
    return res.status(400).json({ error: `Could not verify channel: ${err.message}` });
  }

  if (!captionsAvailable) {
    return res.status(400).json({
      error: "This channel has auto-generated captions disabled. Only channels with captions enabled can be used for ingest.",
    });
  }

  const { rows } = await pool.query(
    `INSERT INTO agent_youtube_feeds (agent_id, channel_id, label, captions_available)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, channel_id) DO UPDATE SET captions_available = EXCLUDED.captions_available
     RETURNING *`,
    [req.params.id, channel_id, label || null, true],
  );
  res.status(201).json(rows[0]);
});

router.delete("/youtube/:feedId", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  await pool.query("DELETE FROM agent_youtube_feeds WHERE id = $1 AND agent_id = $2", [req.params.feedId, req.params.id]);
  res.status(204).end();
});

// ── Search queries ────────────────────────────────────────────────────────────

router.get("/search", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "SELECT * FROM agent_search_queries WHERE agent_id = $1 ORDER BY sort_order, id",
    [req.params.id],
  );
  res.json(rows);
});

router.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "INSERT INTO agent_search_queries (agent_id, query) VALUES ($1, $2) RETURNING *",
    [req.params.id, query],
  );
  res.status(201).json(rows[0]);
});

router.delete("/search/:queryId", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  await pool.query("DELETE FROM agent_search_queries WHERE id = $1 AND agent_id = $2", [req.params.queryId, req.params.id]);
  res.status(204).end();
});

module.exports = router;
