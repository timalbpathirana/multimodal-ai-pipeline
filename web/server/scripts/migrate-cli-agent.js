"use strict";

require("dotenv").config();
const { getPool } = require("../db");
const { RSS_FEEDS, VIDEO_FEEDS } = require("../../../config/feeds");
const { SEARCH_QUERIES } = require("../../../src/ingestion/search");

const AGENT_NAME = "Melbourne Property";
const AGENT_NICHE = "melbourne_property";

// Global config keys to migrate from .env
const GLOBAL_KEYS = {
  anthropic_api_key:  process.env.ANTHROPIC_API_KEY,
  elevenlabs_api_key: process.env.ELEVENLABS_API_KEY,
  pexels_api_key:     process.env.PEXELS_API_KEY,
  airtable_api_key:   process.env.AIRTABLE_API_KEY,
  serper_api_key:     process.env.SERPER_API_KEY,
  trigger_secret_key: process.env.TRIGGER_SECRET_KEY,
};

async function migrate() {
  const pool = getPool();

  // ── 1. Find admin user ────────────────────────────────────────────────────
  const userRes = await pool.query("SELECT id FROM users LIMIT 1");
  if (userRes.rows.length === 0) {
    console.error("[migrate] No users found. Run seed.js first: node web/server/scripts/seed.js");
    process.exit(1);
  }
  const userId = userRes.rows[0].id;
  console.log(`[migrate] Using user id=${userId}`);

  // ── 2. Skip if agent already exists ──────────────────────────────────────
  const existing = await pool.query(
    "SELECT id FROM agents WHERE user_id = $1 AND niche = $2",
    [userId, AGENT_NICHE],
  );
  if (existing.rows.length > 0) {
    console.log(`[migrate] Agent "${AGENT_NAME}" already exists (id=${existing.rows[0].id}) — skipping.`);
    await pool.end();
    return;
  }

  // ── 3. Create agent ───────────────────────────────────────────────────────
  const agentRes = await pool.query(
    "INSERT INTO agents (user_id, name, niche) VALUES ($1, $2, $3) RETURNING id",
    [userId, AGENT_NAME, AGENT_NICHE],
  );
  const agentId = agentRes.rows[0].id;
  console.log(`[migrate] Created agent "${AGENT_NAME}" id=${agentId}`);

  // ── 4. Create agent_settings from .env ───────────────────────────────────
  await pool.query(
    `INSERT INTO agent_settings (
       agent_id,
       elevenlabs_voice_id,
       airtable_base_id,
       airtable_table,
       is_breaking_news,
       human_in_the_loop,
       number_of_videos,
       ingest_lookback_days,
       stories_per_week,
       pipeline_stop_after
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      agentId,
      process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal",
      process.env.AIRTABLE_BASE_ID || null,
      process.env.AIRTABLE_STORIES_TABLE || "stories",
      process.env.IS_BREAKING_NEWS === "true",
      process.env.HUMAN_IN_THE_LOOP === "true",
      parseInt(process.env.NUMBER_OF_VIDEOS || "1", 10),
      parseInt(process.env.INGEST_LOOKBACK_DAYS || "7", 10),
      parseInt(process.env.STORIES_PER_WEEK || "28", 10),
      process.env.PIPELINE_STOP_AFTER || null,
    ],
  );
  console.log("[migrate] Agent settings saved");

  // ── 5. RSS feeds ──────────────────────────────────────────────────────────
  for (let i = 0; i < RSS_FEEDS.length; i++) {
    await pool.query(
      "INSERT INTO agent_rss_feeds (agent_id, url, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [agentId, RSS_FEEDS[i], i],
    );
  }
  console.log(`[migrate] Added ${RSS_FEEDS.length} RSS feeds`);

  // ── 6. YouTube channels ───────────────────────────────────────────────────
  for (let i = 0; i < VIDEO_FEEDS.length; i++) {
    await pool.query(
      "INSERT INTO agent_youtube_feeds (agent_id, channel_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [agentId, VIDEO_FEEDS[i], i],
    );
  }
  console.log(`[migrate] Added ${VIDEO_FEEDS.length} YouTube channels`);

  // ── 7. Search queries ─────────────────────────────────────────────────────
  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    await pool.query(
      "INSERT INTO agent_search_queries (agent_id, query, sort_order) VALUES ($1, $2, $3)",
      [agentId, SEARCH_QUERIES[i], i],
    );
  }
  console.log(`[migrate] Added ${SEARCH_QUERIES.length} search queries`);

  // ── 8. Global config ──────────────────────────────────────────────────────
  let savedKeys = 0;
  for (const [key, value] of Object.entries(GLOBAL_KEYS)) {
    if (!value) continue;
    await pool.query(
      `INSERT INTO global_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, value],
    );
    savedKeys++;
  }
  console.log(`[migrate] Saved ${savedKeys} global config keys`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(`
[migrate] Done!
  Agent:    ${AGENT_NAME} (id=${agentId})
  RSS:      ${RSS_FEEDS.length} feeds
  YouTube:  ${VIDEO_FEEDS.length} channels
  Search:   ${SEARCH_QUERIES.length} queries
  Config:   ${savedKeys} keys

Restart the server and refresh the UI — your agent will appear.
`);

  await pool.end();
}

migrate().catch((err) => {
  console.error("[migrate] Error:", err.message);
  process.exit(1);
});
