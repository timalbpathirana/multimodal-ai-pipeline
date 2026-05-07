"use strict";

const path = require("path");
const { DEFAULT_PROMPTS } = require("./defaultPrompts");

// ── Run logger ────────────────────────────────────────────────────────────────

function makeRunLogger(runId, db) {
  return (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(msg);
    // Fire-and-forget to avoid blocking the pipeline
    db.query(
      `UPDATE pipeline_runs SET logs = COALESCE(logs, '') || $1 WHERE id = $2`,
      [line, runId],
    ).catch(() => {});
  };
}

// ── DB-backed context ─────────────────────────────────────────────────────────

async function buildAgentContext(agentId, runId, db) {
  const [agentRes, settingsRes, rssRes, ytRes, searchRes, promptsRes, globalRes] =
    await Promise.all([
      db.query("SELECT * FROM agents WHERE id = $1", [agentId]),
      db.query("SELECT * FROM agent_settings WHERE agent_id = $1", [agentId]),
      db.query(
        "SELECT url FROM agent_rss_feeds WHERE agent_id = $1 AND is_active = true ORDER BY sort_order",
        [agentId],
      ),
      db.query(
        "SELECT channel_id FROM agent_youtube_feeds WHERE agent_id = $1 AND is_active = true ORDER BY sort_order",
        [agentId],
      ),
      db.query(
        "SELECT query FROM agent_search_queries WHERE agent_id = $1 AND is_active = true ORDER BY sort_order",
        [agentId],
      ),
      db.query(
        "SELECT prompt_key, content FROM agent_prompts WHERE agent_id = $1",
        [agentId],
      ),
      db.query("SELECT key, value FROM global_config"),
    ]);

  const agent = agentRes.rows[0];
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const s = settingsRes.rows[0] || {};
  const global = Object.fromEntries(globalRes.rows.map((r) => [r.key, r.value]));
  const promptMap = Object.fromEntries(promptsRes.rows.map((r) => [r.prompt_key, r.content]));

  // Key resolution: agent_settings → global_config → process.env
  const resolve = (key) =>
    s[key] ||
    global[key] ||
    process.env[key.toUpperCase()] ||
    null;

  const outputDir = path.join(
    process.env.OUTPUT_BASE_DIR || "./output",
    agentId,
    runId,
  );

  return {
    agentId,
    runId,
    agentName: agent.name,
    niche: agent.niche,

    // API keys
    anthropicApiKey: resolve("anthropic_api_key"),
    elevenLabsApiKey: resolve("elevenlabs_api_key"),
    elevenLabsVoiceId:
      s.elevenlabs_voice_id ||
      global.elevenlabs_voice_id ||
      process.env.ELEVENLABS_VOICE_ID ||
      "cjVigY5qzO86Huf0OWal",
    pexelsApiKey: resolve("pexels_api_key"),
    airtableApiKey: resolve("airtable_api_key"),
    airtableBaseId: s.airtable_base_id || global.airtable_base_id || process.env.AIRTABLE_BASE_ID || null,
    airtableTable: s.airtable_table || "Stories",
    serperApiKey: resolve("serper_api_key"),

    // TikTok
    tikTokAccessToken: s.tiktok_access_token || null,
    tikTokOpenId: s.tiktok_open_id || null,
    autoPostToTikTok: s.auto_post_to_tiktok || false,
    tikTokPrivacyLevel: s.tiktok_privacy_level || "DRAFT_FOR_DIRECT_POST",

    // Pipeline flags
    isBreakingNews: s.is_breaking_news || false,
    humanInTheLoop: s.human_in_the_loop || false,
    numberOfVideos: s.number_of_videos || 1,
    ingestLookbackDays: s.ingest_lookback_days || 7,
    storiesPerWeek: s.stories_per_week || 28,
    pipelineStopAfter: s.pipeline_stop_after || null,

    // Feeds
    rssFeeds: rssRes.rows.map((r) => r.url),
    youtubeChannelIds: ytRes.rows.map((r) => r.channel_id),
    searchQueries: searchRes.rows.map((r) => r.query),

    // Prompts — DB value falls back to DEFAULT_PROMPTS
    prompts: {
      audienceContext:   promptMap.audience_context    || DEFAULT_PROMPTS.audience_context,
      signalSystem:      promptMap.signal_system        || DEFAULT_PROMPTS.signal_system,
      signalSystemBn:    promptMap.signal_system_bn     || DEFAULT_PROMPTS.signal_system_bn,
      overviewSystem:    promptMap.overview_system      || DEFAULT_PROMPTS.overview_system,
      rankSystem:        promptMap.rank_system          || DEFAULT_PROMPTS.rank_system,
      storyFinderSystem: promptMap.story_finder_system  || DEFAULT_PROMPTS.story_finder_system,
      hashtags:          promptMap.hashtags             || DEFAULT_PROMPTS.hashtags,
      disclaimer:        promptMap.disclaimer           || DEFAULT_PROMPTS.disclaimer,
    },

    outputDir,
    db,
    log: makeRunLogger(runId, db),
  };
}

// ── CLI context (no DB — reads from process.env + hardcoded defaults) ─────────

async function buildCliAgentContext() {
  const { RSS_FEEDS, VIDEO_FEEDS } = require("../../../config/feeds");
  const { SEARCH_QUERIES } = require("../../../src/ingestion/search");

  const outputDir = process.env.OUTPUT_DIR || "./output";
  const cliLog = (msg) => console.log(msg);

  return {
    agentId: "cli",
    runId: `cli-${Date.now()}`,
    agentName: "CLI Agent",
    niche: "melbourne_property",

    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal",
    pexelsApiKey: process.env.PEXELS_API_KEY,
    airtableApiKey: process.env.AIRTABLE_API_KEY,
    airtableBaseId: process.env.AIRTABLE_BASE_ID,
    airtableTable: process.env.AIRTABLE_STORIES_TABLE || "Stories",
    serperApiKey: process.env.SERPER_API_KEY,

    tikTokAccessToken: process.env.TIKTOK_ACCESS_TOKEN || null,
    tikTokOpenId: process.env.TIKTOK_OPEN_ID || null,
    autoPostToTikTok: process.env.AUTO_POST_TO_TIKTOK === "true",
    tikTokPrivacyLevel: process.env.TIKTOK_PRIVACY_LEVEL || "DRAFT_FOR_DIRECT_POST",

    isBreakingNews: process.env.IS_BREAKING_NEWS === "true",
    humanInTheLoop: process.env.HUMAN_IN_THE_LOOP === "true",
    numberOfVideos: parseInt(process.env.NUMBER_OF_VIDEOS || "1", 10),
    ingestLookbackDays: parseInt(process.env.INGEST_LOOKBACK_DAYS || "7", 10),
    storiesPerWeek: parseInt(process.env.STORIES_PER_WEEK || "28", 10),
    pipelineStopAfter: process.env.PIPELINE_STOP_AFTER || null,

    rssFeeds: RSS_FEEDS,
    youtubeChannelIds: VIDEO_FEEDS,
    searchQueries: SEARCH_QUERIES,

    prompts: {
      audienceContext:   DEFAULT_PROMPTS.audience_context,
      signalSystem:      DEFAULT_PROMPTS.signal_system,
      signalSystemBn:    DEFAULT_PROMPTS.signal_system_bn,
      overviewSystem:    DEFAULT_PROMPTS.overview_system,
      rankSystem:        DEFAULT_PROMPTS.rank_system,
      storyFinderSystem: DEFAULT_PROMPTS.story_finder_system,
      hashtags:          DEFAULT_PROMPTS.hashtags,
      disclaimer:        DEFAULT_PROMPTS.disclaimer,
    },

    outputDir,
    db: null,
    log: cliLog,
  };
}

module.exports = { buildAgentContext, buildCliAgentContext };
