# Plan: Multi-Tenant Content Agent Web App

## Context

The current pipeline (Phase 3) is a CLI-only Node.js tool hardwired to a single niche (Melbourne property). It runs in three modes: weekly ingest, breaking news, and normal multi-video. All config, feeds, and LLM prompts are read from `process.env` or hardcoded files.

The goal is to:

1. Decouple the pipeline from the niche via a **database-driven AgentContext object**
2. Build a minimal web UI (React + Tailwind) to manage, configure, and run multiple agents
3. Support 50+ agents generating content for different niches
4. Host on Railway.com

---

## Chosen Stack

| Layer     | Choice                                    | Reason                                       |
| --------- | ----------------------------------------- | -------------------------------------------- |
| Backend   | Express.js                                | Already Node/CommonJS; simple                |
| Database  | PostgreSQL (Railway native)               | Multi-tenant; no extra services              |
| Job queue | `pg-boss`                                 | Postgres-backed; no Redis needed             |
| Frontend  | React + Vite + Tailwind CSS               | Minimal design; works with CommonJS pipeline |
| Auth      | `express-session` + `bcryptjs`            | Single admin; no OAuth complexity            |
| Hosting   | Railway (Web Service + Postgres + Volume) | Simple deploy; FFmpeg via Nixpacks           |

> **No Next.js** — `"type": "commonjs"` in package.json and native modules (`canvas`, `fluent-ffmpeg`) conflict with Next.js edge runtime.
>
> **No Redis** — `pg-boss` uses the existing Postgres instance.
>
> **No separate worker process** — `pg-boss` runs inside the Express process. Two concurrent video jobs max to avoid FFmpeg OOM on Railway.

---

## Auth

Single admin account. No registration page. The admin email and password are set via environment variables at deploy time:

```
ADMIN_EMAIL=youremail@gmail.com
ADMIN_PASSWORD=<set at deploy>
```

A `web/server/scripts/seed.js` script creates the user row on first run. Login via `POST /api/auth/login` returns a session cookie.

---

## Database Schema

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,    -- e.g. "Melbourne Property"
  niche      TEXT NOT NULL,    -- e.g. "melbourne_property"
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- All API keys are optional per-agent overrides of global_config defaults.
-- Resolution order: agent_settings value → global_config value → process.env fallback
CREATE TABLE agent_settings (
  agent_id             UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  elevenlabs_voice_id  TEXT,
  airtable_base_id     TEXT,
  airtable_table       TEXT NOT NULL DEFAULT 'Stories',
  airtable_api_key     TEXT,
  serper_api_key       TEXT,
  anthropic_api_key    TEXT,    -- per-agent override
  elevenlabs_api_key   TEXT,    -- per-agent override
  pexels_api_key       TEXT,    -- per-agent override
  -- TikTok (per-agent — each agent maps to one TikTok account)
  tiktok_access_token  TEXT,
  tiktok_open_id       TEXT,
  auto_post_to_tiktok  BOOLEAN NOT NULL DEFAULT false,
  tiktok_privacy_level TEXT NOT NULL DEFAULT 'DRAFT_FOR_DIRECT_POST',
  -- Pipeline flags
  is_breaking_news     BOOLEAN NOT NULL DEFAULT false,
  human_in_the_loop    BOOLEAN NOT NULL DEFAULT false,
  number_of_videos     INT NOT NULL DEFAULT 1,
  ingest_lookback_days INT NOT NULL DEFAULT 7,
  stories_per_week     INT NOT NULL DEFAULT 28,
  pipeline_stop_after  TEXT,   -- null | 'ingest' | 'script' | 'voice'
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Global API key defaults (applies when agent has no override)
CREATE TABLE global_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Keys: anthropic_api_key, elevenlabs_api_key, pexels_api_key,
--       trigger_secret_key, serper_api_key, airtable_api_key

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

-- LLM prompts per agent (falls back to DEFAULT_PROMPTS if no row)
-- Keys: audience_context, signal_system, signal_system_bn, overview_system,
--       rank_system, story_finder_system, hashtags, disclaimer
CREATE TABLE agent_prompts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  prompt_key TEXT NOT NULL,
  content    TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, prompt_key)
);

-- Pipeline run log — supports both ingest and video generation runs
-- status: queued → running → awaiting_review → done | failed
CREATE TABLE pipeline_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_mode     TEXT NOT NULL,    -- 'ingest' | 'video'
  status       TEXT NOT NULL DEFAULT 'queued',
  logs         TEXT,
  scripts_data JSONB,            -- generated scripts waiting for HITL approval
  output_paths TEXT[],           -- array of MP4 file paths (one per video)
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scheduled runs per agent (cron expressions stored in UTC)
CREATE TABLE agent_schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_mode    TEXT NOT NULL DEFAULT 'video',   -- 'ingest' | 'video'
  cron_utc    TEXT NOT NULL,                   -- e.g. "0 20 * * *" = 6am AEST
  label       TEXT,                            -- e.g. "6am AEST run"
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Up to 4 video schedules + 1 ingest schedule per agent is typical.
-- pg-boss job name per schedule: "scheduled-run-{schedule.id}"

-- ⚠️ NO signal_dedup table — signal dedup is not needed in the web app.
-- The Airtable story queue (Pending → Used lifecycle) handles dedup for normal
-- mode. Breaking news is manually triggered from the UI so repetition is not
-- an issue.

CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_pipeline_runs_agent ON pipeline_runs(agent_id, created_at DESC);
```

---

## Core Architecture: AgentContext

Every pipeline module stops reading from `process.env` or hardcoded files. Instead, a context object is built from the DB at the start of each job.

**File:** `web/server/lib/agentContext.js`

**Key resolution:** `agentSettings[key] → globalConfig[key] → process.env[key]`

```javascript
async function buildAgentContext(agentId, runId, db) {
  const [agent, settings, rssFeeds, ytFeeds, searchQ, prompts, globalCfg] =
    await Promise.all([
      /* 7 parallel queries */
    ]);

  const resolve = (key) =>
    settings[key] || globalCfg[key] || process.env[key.toUpperCase()];

  return {
    agentId,
    runId,
    agentName,
    anthropicApiKey: resolve("anthropic_api_key"),
    elevenLabsApiKey: resolve("elevenlabs_api_key"),
    elevenLabsVoiceId:
      settings.elevenlabs_voice_id ||
      globalCfg.elevenlabs_voice_id ||
      "cjVigY5qzO86Huf0OWal",
    pexelsApiKey: resolve("pexels_api_key"),
    airtableApiKey: resolve("airtable_api_key"),
    airtableBaseId: settings.airtable_base_id,
    airtableTable: settings.airtable_table || "Stories",
    serperApiKey: resolve("serper_api_key"),
    isBreakingNews: settings.is_breaking_news,
    humanInTheLoop: settings.human_in_the_loop,
    numberOfVideos: settings.number_of_videos || 1,
    ingestLookbackDays: settings.ingest_lookback_days || 7,
    storiesPerWeek: settings.stories_per_week || 28,
    pipelineStopAfter: settings.pipeline_stop_after || null,
    rssFeeds: rssFeeds.map((r) => r.url),
    youtubeChannelIds: ytFeeds.map((r) => r.channel_id),
    searchQueries: searchQ.map((r) => r.query),
    prompts: {
      audienceContext: promptMap.audience_context || DEFAULTS.audienceContext,
      signalSystem: promptMap.signal_system || DEFAULTS.signalSystem,
      signalSystemBn: promptMap.signal_system_bn || DEFAULTS.signalSystemBn,
      overviewSystem: promptMap.overview_system || DEFAULTS.overviewSystem,
      rankSystem: promptMap.rank_system || DEFAULTS.rankSystem,
      storyFinderSystem:
        promptMap.story_finder_system || DEFAULTS.storyFinderSystem,
      hashtags: promptMap.hashtags || DEFAULTS.hashtags,
      disclaimer: promptMap.disclaimer || DEFAULTS.disclaimer,
    },
    outputDir: `/data/output/${agentId}/${runId}`,
    db,
    log: makeRunLogger(runId, db), // appends to pipeline_runs.logs
  };
}
```

The CLI continues to work via `buildCliAgentContext()` which reads from `process.env` and `config/feeds.js` — no breaking change during development.

---

## Pipeline Refactoring

Every module gains `agentCtx` as its first parameter. API clients are constructed inside functions, not at module load time.

| File                       | Change                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/llm/claude.js`        | Remove module-top `client`/`isBreakingNews`; all 6 exported functions gain `agentCtx`; use `agentCtx.prompts.*`    |
| `src/llm/signals.js`       | `rankSignals(agentCtx, ...)` and `generateStoriesFromContent(agentCtx, ...)`                                       |
| `src/llm/dedup.js`         | Replace local JSON with `agent_signal_dedup` table; `isDuplicate(agentCtx, signal)` / `markSeen(agentCtx, signal)` |
| `src/ingestion/rss.js`     | `fetchRssArticles(agentCtx, maxPerFeed, maxAgeDays)` uses `agentCtx.rssFeeds`                                      |
| `src/ingestion/youtube.js` | Callers iterate `agentCtx.youtubeChannelIds`                                                                       |
| `src/ingestion/ingest.js`  | `runIngest(agentCtx)` — remove all `process.env` reads and `ask()` call                                            |
| `src/ingestion/search.js`  | `searchWeb(agentCtx, queries, max)` uses `agentCtx.serperApiKey` and `agentCtx.searchQueries`                      |
| `src/airtable/client.js`   | All CRUD fns gain `agentCtx`; build headers from `agentCtx.airtableApiKey` + `agentCtx.airtableBaseId`             |
| `src/airtable/stories.js`  | All fns gain `agentCtx`; `agentCtx.airtableTable` replaces env var                                                 |
| `src/voice/elevenlabs.js`  | `generateVoice(agentCtx, scriptText, outputDir)`                                                                   |
| `src/media/pexels.js`      | `fetchVideos(agentCtx, ...)` uses `agentCtx.pexelsApiKey`                                                          |
| `src/caption/generator.js` | Uses `agentCtx.prompts.hashtags` and `agentCtx.prompts.disclaimer`                                                 |
| `pipeline.js`              | `runPipeline(agentCtx)` — all sub-calls gain `agentCtx`; `console.log` → `agentCtx.log()`                          |

---

## Signal Dedup — Removed

The `isDuplicate()` / `markSeen()` mechanism and local JSON store are **not ported** to the web app. The Airtable story `Status` field (`Pending → Used → Archived`) is the canonical dedup mechanism for normal mode. Breaking news mode is manually triggered via the UI, so the risk of accidental repetition is negligible. Delete `src/llm/dedup.js` after the refactor; remove all call sites in `pipeline.js` and `signals.js`.

---

## Scheduled Runs (pg-boss Cron)

`pg-boss` supports native cron scheduling via `boss.schedule(jobName, cronExpr, data)`. Schedules are stored in `agent_schedules` and registered with pg-boss at server startup.

### Scale

| Scenario                 | Jobs/day |
| ------------------------ | -------- |
| 5 agents × 4 video runs  | 20       |
| 50 agents × 4 video runs | 200      |
| + 1 weekly ingest each   | +50      |

All well within pg-boss and PostgreSQL limits.

### How It Works

**DB:** Each row in `agent_schedules` has `cron_utc` (UTC cron expression) and `run_mode`.

**Server startup (`web/server/lib/jobQueue.js`):**

```javascript
async function registerSchedules(db) {
  const { rows } = await db.query(
    "SELECT * FROM agent_schedules WHERE is_active = true",
  );
  for (const schedule of rows) {
    const jobName = `scheduled-run-${schedule.id}`;
    // Registers with pg-boss; pg-boss uses its own pgboss.schedule table for persistence
    await boss.schedule(jobName, schedule.cron_utc, {
      agentId: schedule.agent_id,
      mode: schedule.run_mode,
      scheduleId: schedule.id,
    });
  }
  // Register a single handler for all scheduled-run-* jobs
  boss.work("scheduled-run-*", handleScheduledRun);
}
```

**When a scheduled job fires:** `handleScheduledRun` creates a new row in `pipeline_runs`, builds `agentCtx`, and delegates to `runIngest(agentCtx)` or `runPipeline(agentCtx)`.

> `HUMAN_IN_THE_LOOP` is automatically set to `false` for scheduled runs — there is no one at the terminal to approve hooks. Scheduled video runs use the full end-to-end pipeline without the review pause.

### Schedule API Routes

```
GET    /api/agents/:id/schedules         → list schedules
POST   /api/agents/:id/schedules         { run_mode, cron_utc, label } → 201
PATCH  /api/agents/:id/schedules/:sid    { is_active, cron_utc } → 200
DELETE /api/agents/:id/schedules/:sid    → 204
```

When a schedule is created/updated/deleted, the server calls `boss.unschedule(jobName)` + `boss.schedule(...)` to keep pg-boss in sync.

### Schedule UI

A "Schedules" section in the Runs tab:

- Add schedule: time picker (AEST timezone, converted to UTC cron on save) + mode selector (Ingest / Video)
- Toggle active/inactive per schedule
- Show "next run" time
- Up to 5 schedules per agent recommended (4 video + 1 weekly ingest)

**Typical Melbourne Property setup:**

```
06:00 AEST → video   (0 20 * * *)
10:00 AEST → video   (0 0 * * *)
14:00 AEST → video   (0 4 * * *)
18:00 AEST → video   (0 8 * * *)
09:00 Mon  → ingest  (0 23 * * 0)
```

---

## HUMAN_IN_THE_LOOP Web Flow (Two-Job Pattern)

The terminal readline `ask()` is replaced with a web review step. The pipeline is split into two jobs:

**Job 1: `generate-scripts`**

1. Runs Phase 1 of the pipeline (pull N stories from Airtable, generate N scripts)
2. Stores scripts in `pipeline_runs.scripts_data` as JSONB
3. Sets `pipeline_runs.status = 'awaiting_review'`
4. Job finishes — the UI shows the scripts

**User reviews in the UI:**

- Sees each script's hook, bridge, insight, impact
- Can edit the hook text inline
- Clicks "Approve All & Generate Videos"

**`POST /api/runs/:runId/scripts/approve { scripts: [{hook, bridge, insight, impact}, ...] }`**

- Updates `pipeline_runs.scripts_data` with the approved/edited scripts
- Enqueues Job 2: `produce-videos`

**Job 2: `produce-videos`**

1. Reads approved scripts from `pipeline_runs.scripts_data`
2. Runs Phase 3 of the pipeline (voice → video → caption for each script)
3. Updates `pipeline_runs.output_paths` and `status = 'done'`

> When `human_in_the_loop = false`, the video trigger enqueues a single `run-video` job that does both phases end-to-end with no pause.

---

## TikTok Integration

Each agent maps to a single TikTok account. After video production, the pipeline optionally uploads the MP4 as a draft (or scheduled post) using the **TikTok Content Posting API v2**.

### New File: `src/social/tiktok.js`

```javascript
// TikTok Content Posting API v2
// Docs: https://developers.tiktok.com/doc/content-posting-api-get-started-overview

async function uploadToTikTok(agentCtx, videoPath, captionText) {
  const { tikTokAccessToken, tikTokOpenId, tikTokPrivacyLevel } = agentCtx;

  // Step 1: Initialize upload
  const initRes = await axios.post(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      post_info: {
        title: captionText.slice(0, 2200), // TikTok caption limit
        privacy_level: tikTokPrivacyLevel, // 'DRAFT_FOR_DIRECT_POST' | 'PUBLIC_TO_EVERYONE' | 'SELF_ONLY'
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fs.statSync(videoPath).size,
        chunk_size: 10_000_000, // 10 MB chunks
        total_chunk_count: Math.ceil(fs.statSync(videoPath).size / 10_000_000),
      },
    },
    {
      headers: {
        Authorization: `Bearer ${tikTokAccessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    },
  );

  const { publish_id, upload_url } = initRes.data.data;

  // Step 2: Upload video in chunks
  await uploadChunks(videoPath, upload_url);

  // Step 3: Poll for processing
  await pollPublishStatus(tikTokAccessToken, publish_id);

  agentCtx.log(`[tiktok] Published draft. publish_id=${publish_id}`);
  return { publishId: publish_id };
}
```

### Pipeline Integration

In `pipeline.js`, after each `produceVideo()` call:

```javascript
if (agentCtx.autoPostToTikTok && agentCtx.tikTokAccessToken) {
  const { captionText } = await generateCaption(agentCtx, script, outputDir);
  const tiktokResult = await uploadToTikTok(agentCtx, videoPath, captionText);
  agentCtx.log(`[pipeline] TikTok draft created: ${tiktokResult.publishId}`);
}
```

### DB Changes

Already included in `agent_settings`:

- `tiktok_access_token TEXT`
- `tiktok_open_id TEXT`
- `auto_post_to_tiktok BOOLEAN DEFAULT false`
- `tiktok_privacy_level TEXT DEFAULT 'DRAFT_FOR_DIRECT_POST'`

Store TikTok publish IDs in `pipeline_runs.output_paths` array (alongside MP4 paths) or add a `tiktok_publish_ids TEXT[]` column to `pipeline_runs`.

### TikTok Settings in UI

In the **Settings tab** for each agent:

- Toggle: "Auto-post to TikTok after video generation"
- Field: TikTok Access Token (masked)
- Field: TikTok Open ID
- Dropdown: Post visibility — Draft / Public / Private
- Status: "Last posted" timestamp (pulled from most recent run's tiktok_publish_ids)

### Access Token Management

TikTok access tokens expire after 24 hours (refresh tokens last 365 days). Future work: store the refresh token and add a background job to auto-refresh. For the initial build, the user pastes a fresh access token via the Settings UI when needed.

---

## Directory Structure

```
melb-property-agent/
├── config/feeds.js              ← KEEP (CLI fallback defaults)
├── src/
│   ├── ingestion/               ← refactored
│   ├── llm/                     ← refactored; dedup.js DELETED
│   ├── airtable/                ← refactored
│   ├── voice/, video/, media/, caption/, subtitles/, utils/
│   └── social/
│       └── tiktok.js            ← NEW: TikTok Content Posting API v2
├── pipeline.js                  ← Refactored to accept agentCtx
├── index.js                     ← CLI entry (builds ctx from env, calls pipeline)
├── web/
│   ├── server/
│   │   ├── index.js             ← Express app entry point
│   │   ├── db.js                ← pg pool setup
│   │   ├── migrations/
│   │   │   └── 001_initial.sql  ← Full DDL
│   │   ├── scripts/
│   │   │   └── seed.js          ← Create admin user from ADMIN_EMAIL/ADMIN_PASSWORD
│   │   ├── lib/
│   │   │   ├── agentContext.js  ← buildAgentContext(), buildCliAgentContext()
│   │   │   ├── defaultPrompts.js ← DEFAULT_PROMPTS (extracted from claude.js/signals.js)
│   │   │   └── jobQueue.js      ← pg-boss setup; generate-scripts, produce-videos, run-ingest handlers
│   │   ├── middleware/
│   │   │   └── auth.js          ← requireAuth session middleware
│   │   └── routes/
│   │       ├── auth.js          ← POST /api/auth/login|logout, GET /api/auth/me
│   │       ├── agents.js        ← CRUD /api/agents
│   │       ├── settings.js      ← GET/PUT /api/agents/:id/settings
│   │       ├── config.js        ← GET/PUT /api/config (global API keys, masked on GET)
│   │       ├── feeds.js         ← CRUD /api/agents/:id/feeds/rss|youtube|search
│   │       ├── prompts.js       ← GET/PUT/DELETE /api/agents/:id/prompts/:key
│   │       ├── schedules.js     ← CRUD /api/agents/:id/schedules
│   │       └── runs.js          ← POST trigger, GET list/status/logs, POST approve
│   └── client/
│       ├── package.json
│       ├── vite.config.js       ← proxy /api → :3000 in dev
│       ├── tailwind.config.js
│       └── src/
│           ├── App.jsx
│           ├── api.js            ← typed fetch wrapper
│           ├── pages/
│           │   ├── LoginPage.jsx
│           │   ├── AgentListPage.jsx
│           │   └── AgentDetailPage.jsx  ← 6 tabs
│           └── components/
│               ├── Layout.jsx
│               ├── FeedList.jsx
│               ├── PromptEditor.jsx     ← textarea + "Reset to Default" button
│               ├── ScheduleManager.jsx  ← time picker + cron builder + active toggle
│               ├── ScriptReviewer.jsx   ← approve/edit hooks before video production
│               └── LogViewer.jsx        ← polls /api/runs/:id/logs every 2s
├── nixpacks.toml                ← FFmpeg + Node 20 for Railway
└── railway.json
```

---

## Backend API Routes

```
POST   /api/auth/login              { email, password }
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/config                  → all global keys (values masked: last 4 chars)
PUT    /api/config                  { anthropic_api_key, elevenlabs_api_key, ... }

GET    /api/agents
POST   /api/agents                  { name, niche }
GET    /api/agents/:id
PUT    /api/agents/:id              { name, niche, is_active }
DELETE /api/agents/:id

GET    /api/agents/:id/settings
PUT    /api/agents/:id/settings     { elevenlabs_voice_id, is_breaking_news,
                                      human_in_the_loop, number_of_videos,
                                      ingest_lookback_days, stories_per_week,
                                      pipeline_stop_after,
                                      anthropic_api_key, elevenlabs_api_key,
                                      pexels_api_key, airtable_base_id,
                                      airtable_table, airtable_api_key,
                                      serper_api_key }

GET    /api/agents/:id/feeds/rss
POST   /api/agents/:id/feeds/rss    { url, label }
DELETE /api/agents/:id/feeds/rss/:feedId
GET    /api/agents/:id/feeds/youtube
POST   /api/agents/:id/feeds/youtube { channel_id, label }
DELETE /api/agents/:id/feeds/youtube/:feedId
GET    /api/agents/:id/feeds/search
POST   /api/agents/:id/feeds/search  { query }
DELETE /api/agents/:id/feeds/search/:queryId

GET    /api/agents/:id/prompts       → all 8 prompts (is_default: true if using default)
GET    /api/agents/:id/prompts/:key
PUT    /api/agents/:id/prompts/:key  { content }
DELETE /api/agents/:id/prompts/:key  → resets to default

POST   /api/agents/:id/runs         { mode: 'ingest'|'video' }  → 202 { runId }
GET    /api/agents/:id/runs         → last 20 runs
GET    /api/runs/:runId             → run detail (status, scripts_data, output_paths)
GET    /api/runs/:runId/logs        → { logs } (polled by frontend)
POST   /api/runs/:runId/approve     { scripts: [{hook,bridge,insight,impact},...] }
                                     → enqueues produce-videos job; 202

GET    /api/agents/:id/schedules    → list schedules
POST   /api/agents/:id/schedules    { run_mode, cron_utc, label }
PATCH  /api/agents/:id/schedules/:sid { is_active, cron_utc, label }
DELETE /api/agents/:id/schedules/:sid

GET    /api/health                  → 200 { db: 'ok' }
```

---

## Frontend: 5-Tab Agent Detail

**Agent List** — cards with name, niche, last run status, "New Agent" button

**Agent Detail — 6 tabs:**

| Tab          | Contents                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings** | ELEVENLABS_VOICE_ID, IS_BREAKING_NEWS, HUMAN_IN_THE_LOOP, NUMBER_OF_VIDEOS, INGEST_LOOKBACK_DAYS, STORIES_PER_WEEK, PIPELINE_STOP_AFTER                                                                                             |
| **Config**   | AIRTABLE_BASE_ID, AIRTABLE_TABLE, AIRTABLE_API_KEY, SERPER_API_KEY, ANTHROPIC_API_KEY override, ELEVENLABS_API_KEY override, PEXELS_API_KEY override, TIKTOK_ACCESS_TOKEN, TIKTOK_OPEN_ID, auto-post toggle, privacy level dropdown |
| **Feeds**    | Three sections: RSS / YouTube / Search Queries — inline add/delete                                                                                                                                                                  |
| **Prompts**  | 8 textarea editors; each shows "(using default)" badge and has "Reset to Default" button                                                                                                                                            |
| **Schedule** | ScheduleManager: time picker (AEST) + mode selector + active toggle per schedule; shows next run time                                                                                                                               |
| **Runs**     | "Run Ingest" + "Generate Videos" buttons; run history table; LogViewer; ScriptReviewer (when status is `awaiting_review`)                                                                                                           |

**Global Config page** — ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, PEXELS_API_KEY, TRIGGER_SECRET_KEY (masked, editable)

**State management:** `@tanstack/react-query` — `useQuery` for reads, `useMutation` for writes, `refetchInterval: 2000` on runs while status is `running` or `awaiting_review`.

---

## Railway Deployment

**Services:**

1. **Web Service** — Express + React static files
2. **PostgreSQL** — Railway managed Postgres
3. **Volume** — `/data` mount for MP4 output files (1 GB initial)

**`nixpacks.toml`** (FFmpeg on Railway):

```toml
[phases.setup]
nixPkgs = ["ffmpeg", "nodejs_20"]
```

**`railway.json`:**

```json
{
  "build": { "buildCommand": "npm run build:client" },
  "deploy": {
    "startCommand": "node web/server/scripts/seed.js && node web/server/index.js",
    "healthcheckPath": "/api/health"
  }
}
```

**Railway env vars:**

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<32-char random>
OUTPUT_BASE_DIR=/data/output
PORT=3000
NODE_ENV=production
ADMIN_EMAIL=youremail@gmail.com
ADMIN_PASSWORD=<set at deploy>
```

---

## Phased Rollout

### Phase A — DB + Context Refactor (2 days)

1. Add `pg`; create `web/server/db.js`; run `001_initial.sql`
2. Create `web/server/lib/defaultPrompts.js` (copy prompts from [src/llm/claude.js](src/llm/claude.js#L20-L128) and [src/llm/signals.js](src/llm/signals.js#L273-L448))
3. Create `web/server/lib/agentContext.js` with `buildAgentContext()` + `buildCliAgentContext()`
4. **Delete `src/llm/dedup.js`** and remove all call sites in `pipeline.js` and `signals.js`
5. Refactor `src/airtable/client.js` + `stories.js`
6. Refactor `src/ingestion/*.js`
7. Refactor `src/llm/claude.js` + `signals.js`
8. Refactor `src/voice/elevenlabs.js`, `src/media/pexels.js`, `src/caption/generator.js`
9. Refactor `pipeline.js` to accept `agentCtx`
10. Update `index.js` to use `buildCliAgentContext()`
11. **Smoke test**: seed Melbourne Property agent in DB; `node index.js` works unchanged

### Phase B — Web Server + Job Queue (2-3 days)

1. Add Express, express-session, bcryptjs, pg-boss, connect-pg-simple, axios (TikTok)
2. Build Express app + all API routes (including schedules)
3. Implement `pg-boss` with four handlers: `run-ingest`, `generate-scripts`, `produce-videos`, `scheduled-run-*`
4. Implement `registerSchedules()` called at server startup
5. Create `src/social/tiktok.js`
6. Write `nixpacks.toml` and `railway.json`; deploy to Railway; test via `curl`

### Phase C — React Frontend (3-4 days)

1. Initialize `web/client/` with Vite + React + Tailwind + React Query
2. Build Login, AgentList, AgentDetail (6 tabs), Global Config pages
3. Build `ScheduleManager` component with AEST time picker
4. Build `ScriptReviewer` for HITL approval flow
5. Build `LogViewer` with 2s polling
6. `npm run build:client`; confirm Express serves static files

### Phase D — Hardening (1 day)

1. Mask API keys (last 4 chars) in GET responses
2. Zod validation on all POST/PUT routes
3. Rate limit: 1 active run per agent at a time
4. `SIGTERM` handler to drain pg-boss
5. Create second test agent via UI to confirm multi-tenancy end-to-end

---

## Verification Checklist

- [ ] `node index.js` still works throughout all phases (CLI regression test)
- [ ] `POST /api/agents/:id/runs { mode: 'ingest' }` → ingest job queues, runs, logs appear in LogViewer
- [ ] `POST /api/agents/:id/runs { mode: 'video' }` with HITL=false → video produced at `/data/output/{agentId}/{runId}/`
- [ ] `POST /api/agents/:id/runs { mode: 'video' }` with HITL=true → status becomes `awaiting_review`; ScriptReviewer shows scripts; approve → production runs
- [ ] Scheduled run fires at configured AEST time; creates pipeline_run row; completes unattended
- [ ] TikTok: with `auto_post_to_tiktok=true` and valid token, draft appears in TikTok Creator Studio after video run
- [ ] Second agent with different RSS feeds, different Airtable base, different TikTok account → fully independent pipeline run

---

## Future Extensions (Phase 4)

- Auto-upload to TikTok via TikTok Content Posting API (natural next step — each agent maps to a TikTok account)
- TikTok refresh token auto-renewal (store refresh token; background job to refresh before expiry)
- Auto-upload to YouTube Shorts via Google APIs
- Instagram Reels via Meta Graph API
- Webhook on completion → Slack/Discord notification with script text + video
- Story quality scoring in Airtable (de-prioritise stories with no `keyMetrics`)
- Batch Airtable archiving (replace one-at-a-time `updateRecord` with PATCH batch endpoint)
