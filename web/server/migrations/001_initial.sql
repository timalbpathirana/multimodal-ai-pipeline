-- Melbourne Property Agent — initial schema
-- Run once against a fresh Postgres database.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  niche      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- All API keys are optional per-agent overrides.
-- Resolution: agent_settings → global_config → process.env
CREATE TABLE agent_settings (
  agent_id             UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  elevenlabs_voice_id  TEXT,
  airtable_base_id     TEXT,
  airtable_table       TEXT NOT NULL DEFAULT 'Stories',
  airtable_api_key     TEXT,
  serper_api_key       TEXT,
  anthropic_api_key    TEXT,
  elevenlabs_api_key   TEXT,
  pexels_api_key       TEXT,
  tiktok_access_token  TEXT,
  tiktok_open_id       TEXT,
  auto_post_to_tiktok  BOOLEAN NOT NULL DEFAULT false,
  tiktok_privacy_level TEXT NOT NULL DEFAULT 'DRAFT_FOR_DIRECT_POST',
  is_breaking_news     BOOLEAN NOT NULL DEFAULT false,
  human_in_the_loop    BOOLEAN NOT NULL DEFAULT false,
  number_of_videos     INT NOT NULL DEFAULT 1,
  ingest_lookback_days INT NOT NULL DEFAULT 7,
  stories_per_week     INT NOT NULL DEFAULT 28,
  pipeline_stop_after  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE global_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_rss_feeds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  label      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(agent_id, url)
);

CREATE TABLE agent_youtube_feeds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL,
  label       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE(agent_id, channel_id)
);

CREATE TABLE agent_search_queries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE agent_prompts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  prompt_key TEXT NOT NULL,
  content    TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, prompt_key)
);

-- status: queued → running → awaiting_review → done | failed
CREATE TABLE pipeline_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_mode      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  logs          TEXT,
  scripts_data  JSONB,
  output_paths  TEXT[],
  tiktok_ids    TEXT[],
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_mode    TEXT NOT NULL DEFAULT 'video',
  cron_utc    TEXT NOT NULL,
  label       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_pipeline_runs_agent ON pipeline_runs(agent_id, created_at DESC);
CREATE INDEX idx_schedules_agent ON agent_schedules(agent_id);
