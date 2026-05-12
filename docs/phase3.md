# Phase 3: Melbourne Property Agent — Weekly Story Backlog & Multi-Video Pipeline

## Overview

Phase 3 decouples **data ingestion** from **video generation**. The Phase 2 pipeline re-fetched the same RSS feeds and YouTube channels on every run (up to 4× per day), producing limited story diversity. Phase 3 introduces a weekly ingest step that collects 7 days of data, uses Claude to identify cross-source patterns and generate 28 story ideas, saves them to Airtable, and then lets the daily video pipeline pull from that backlog — one story per video, no repeated fetching.

### Core problems solved

1. **Repetitive content** — hitting the same feeds every run meant the same articles drove every script. 28 pre-generated stories sourced from a full week of data provide genuine variety.
2. **No story persistence** — there was no way to track which story angles had already been used. Airtable now tracks `Pending → Used → Archived` lifecycle for every story.
3. **Limited data sources** — only RSS and YouTube were used. Phase 3 adds Google News via the Serper API as a third data source for the weekly ingest.
4. **Single-video-only pipeline** — the pipeline could only produce one video per run. Phase 3 adds `NUMBER_OF_VIDEOS` support, reviewing all hooks upfront then producing all videos unattended.

---

## Pipeline Modes

| Mode | Trigger | Behaviour |
|------|---------|-----------|
| **Weekly ingest** | `RUN_INGEST=true` | Fetch 7 days of RSS + YouTube + web → Claude generates N stories → archive last week's Pending stories → delete stories older than 4 weeks → save new stories to Airtable. Requires typing `yes` to confirm before running. |
| **Normal video gen** | *(no special flags)* | Pull next `Pending` story from Airtable → generate script → human hook review (if enabled) → voice → video → caption → mark story `Used`. Supports `NUMBER_OF_VIDEOS` for multi-video runs. |
| **Breaking news** | `IS_BREAKING_NEWS=true` | Fresh ingest (RSS + YouTube only, no Airtable) → `extractSignals()` → `generateScriptWithRetry()` → voice → video → caption. Always produces 1 video. |

---

## New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NUMBER_OF_VIDEOS` | `1` | Videos to produce per pipeline run. Each video uses a distinct Airtable story. |
| `RUN_INGEST` | `false` | Set `true` to run the weekly ingest instead of generating videos. |
| `INGEST_LOOKBACK_DAYS` | `7` | Days of history to fetch during ingest. |
| `STORIES_PER_WEEK` | `28` | Number of story ideas Claude should generate per ingest run (4 videos/day × 7 days). |
| `SERPER_API_KEY` | *(required for web search)* | Serper.dev API key. Web search is skipped gracefully if not set. |
| `AIRTABLE_API_KEY` | *(required)* | Airtable personal access token. |
| `AIRTABLE_BASE_ID` | *(required)* | Airtable base ID (starts with `app`). |
| `AIRTABLE_STORIES_TABLE` | `Stories` | Stories table name in Airtable. |

---

## Airtable Stories Table Schema

Created manually in Airtable. Field names are case-sensitive — the code reads them directly via `record.fields.FieldName`.

| Field | Airtable type | Purpose |
|-------|--------------|---------|
| `Title` | Single line text | Short story headline (primary field) |
| `Angle` | Long text | Narrative angle and cross-source pattern identified by Claude |
| `KeyMetrics` | Long text | Key data points and figures (e.g. `"68% clearance, up from 62% last week"`) |
| `SourceFeeds` | Single line text | Comma-separated feed names used to build this story |
| `SourceData` | Long text | Verbatim source excerpts that support the story (used in script generation prompt) |
| `Status` | Single select | `Pending` → `Used` → `Archived`. Only `Pending` stories are pulled for video generation. |
| `WeekOf` | Date | ISO date of the Monday for the ingest week. Controls ordering and archiving. |
| `CreatedAt` | Date (with time) | When the record was created. |
| `UsedAt` | Date (with time) | When the story was used in a video. Null until used. |

---

## New Files

### `src/utils/prompt.js`

Shared `ask(question)` readline helper. Extracted from `pipeline.js` so both the pipeline and the ingest module can prompt the user from the terminal without duplicating the readline setup.

```js
async function ask(question) → string
```

---

### `src/ingestion/search.js`

Serper Google News API integration. Returns results in the same `{ title, content, url, pubDate, source: "web" }` shape as RSS and YouTube, so they flow transparently into the same content pipeline.

```js
async function searchWeb(queries = SEARCH_QUERIES, maxResultsPerQuery = 5) → contentItem[]
```

**Built-in search queries** (Melbourne property focused):
- `"Melbourne property market clearance rate"`
- `"Melbourne house prices auction results"`
- `"Melbourne real estate listings supply demand"`
- `"Melbourne property investment interest rates RBA"`
- `"Melbourne housing market stamp duty first home buyer"`

**Date parsing:** Serper returns dates in inconsistent formats (`"2 hours ago"`, `"May 5, 2026"`, `"1 day ago"`). A `parseDateSafe()` helper handles all formats gracefully — relative strings are converted to absolute ISO datetimes; unrecognisable formats return `null` rather than throwing.

If `SERPER_API_KEY` is not set, `searchWeb` logs a warning and returns `[]` — the ingest continues with RSS and YouTube only.

---

### `src/airtable/client.js`

Thin Airtable REST API wrapper using `axios`. No Airtable SDK dependency. All operations respect the Airtable limit of 10 records per create/delete request by chunking automatically.

```js
listRecords(table, filterFormula, sort)   → records[]
createRecords(table, fieldsList)          → created[]   // batches at 10
updateRecord(table, recordId, fields)     → updated
deleteRecord(table, recordId)             → void
deleteRecords(table, recordIds)           → void        // batches at 10
```

Base URL: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`
Auth: `Authorization: Bearer ${AIRTABLE_API_KEY}`

---

### `src/airtable/stories.js`

Story-specific Airtable operations built on top of `client.js`.

```js
getNextPendingStory(excludeIds = [])  → record | null
markStoryUsed(recordId)               → void
archivePendingStories()               → count archived
deleteOldStories(weeksToKeep = 4)     → count deleted
saveStories(stories[], weekOf?)       → created[]
```

**`getNextPendingStory(excludeIds)`** — queries for `{Status} = "Pending"`, sorted by `WeekOf ASC` then `CreatedAt ASC` (oldest story first). The `excludeIds` parameter appends `RECORD_ID() != "recXXX"` exclusions to the Airtable formula, ensuring each video in a multi-video run gets a distinct story (see bug fix below).

**`deleteOldStories`** — uses Airtable formula `IS_BEFORE({WeekOf}, "${cutoffISO}")` to find records whose week is older than 4 weeks, then permanently deletes them in batches of 10.

---

### `src/ingestion/ingest.js`

Weekly ingest orchestrator. Entry point: `runIngest()`.

**Flow:**
1. Prints a warning banner describing exactly what will happen
2. Prompts `"Type 'yes' to proceed with ingest: "` — aborts immediately on any other input
3. Fetches in parallel: `fetchRssArticles(3, 7)`, all YouTube channels with 7-day lookback, `searchWeb()`
4. Calls `generateStoriesFromContent(contentItems, STORIES_COUNT)` — sends all collected content to Claude
5. Archives all current `Pending` stories in Airtable (sets `Status = Archived`)
6. Permanently deletes stories older than 4 weeks
7. Saves the new stories with `Status = Pending` and the current Monday as `WeekOf`
8. Logs a summary table: stories generated, archived, deleted, elapsed time

---

## Modified Files

### `src/ingestion/rss.js`

`MAX_AGE_DAYS` changed from a hardcoded module constant (`4`) to a function parameter with a default:

```js
// Before
async function fetchRssArticles(maxPerFeed = 2)  // always 4-day cutoff

// After
async function fetchRssArticles(maxPerFeed = 2, maxAgeDays = 4)
```

The weekly ingest calls `fetchRssArticles(3, 7)` — 3 articles per feed, 7-day lookback. The daily video pipeline and breaking news mode call it with defaults, unchanged behaviour.

---

### `src/ingestion/youtube.js`

Same change as `rss.js`:

```js
// Before
async function fetchYoutubeContent(channelId)  // always 3-day cutoff

// After
async function fetchYoutubeContent(channelId, maxAgeDays = 3)
```

The weekly ingest calls `fetchYoutubeContent(id, 7)`. All existing callers unchanged.

---

### `src/llm/signals.js`

All existing functions (`extractSignals`, `extractCandidates`, `rankSignals`, `NoHighSignalError`) are untouched — they remain active for breaking news mode.

**New export added:**

```js
async function generateStoriesFromContent(contentItems, count = 28) → story[]
```

Groups content by source type, formats it into source-labelled sections, and sends to Claude Sonnet 4.6 with `STORY_FINDER_SYSTEM_PROMPT`. The prompt instructs Claude to:
- Find cross-source patterns where multiple feeds corroborate the same trend
- Generate `count` distinct, non-overlapping story ideas
- Ground every story in actual excerpts from the provided content
- Return a JSON array (no markdown fences)

Each story in the returned array:
```json
{
  "title": "Clearance rates hit 7-month high as stock tightens",
  "angle": "Narrative angle and why this story matters...",
  "keyMetrics": "68% clearance (REA), supply down 12% YoY",
  "sourceFeeds": ["realestate.com.au", "Luke Wiles YT"],
  "sourceData": "Verbatim excerpts from sources..."
}
```

Uses `max_tokens: 8000` to fit 28 full story objects. Throws if the response is non-JSON or returns fewer than `count / 2` stories.

---

### `src/llm/claude.js`

All existing functions unchanged. Two new exports added for story-based script generation:

```js
async function generateScriptFromStory(story, opts = {})
async function generateScriptFromStoryWithRetry(story)
```

**`generateScriptFromStory`** — uses the same `SIGNAL_SYSTEM_PROMPT` (same constraints: max 9-word hook, must include a number, no vague phrases) with a story-shaped user prompt:

```
Story to script:
- Title: ${fields.Title}
- Angle: ${fields.Angle}
- Key metrics: ${fields.KeyMetrics}
- Sources: ${fields.SourceFeeds}
- Source excerpts: "${fields.SourceData.slice(0, 600)}"
```

Returns `{ hook, insight, impact }` — the same shape as signal-driven scripts. Validated by the existing `validateScript()` with no changes to that function.

**`generateScriptFromStoryWithRetry`** — mirrors `generateScriptWithRetry` from the signal pipeline:
- Attempt 1: standard prompt
- Attempt 2: appends a word-count constraint reminder (`stricterHook: true`)
- If both fail validation: throws with the failure reasons so the pipeline can skip to the next story

**`IS_BREAKING_NEWS` bug fix:** The module-level constant was changed from:
```js
const isBreakingNews = process.env.IS_BREAKING_NEWS;       // "false" is truthy ✗
```
to:
```js
const isBreakingNews = process.env.IS_BREAKING_NEWS === "true";  // correct ✓
```
Without this fix, `IS_BREAKING_NEWS=false` in `.env` was treated as truthy (non-empty string), causing `parseJsonResponse` to always require an `escalation` field and `generateOverviewScript` to always fail with a missing-field error.

---

### `src/llm/validate.js`

**No changes.** `validateScript(script, opts)` and `constrainHookFromSignal(signal)` work identically for story-generated scripts:
- Story scripts output the same `{ hook, insight, impact }` shape as signal scripts
- `constrainHookFromSignal` is only called in the breaking news signal path — untouched
- The `breakingNews` option (relaxed word limit, no number requirement) continues to work

---

### `pipeline.js`

Restructured around three distinct execution branches. The breaking news flow is line-for-line identical to Phase 2.

#### Branch 1 — Weekly ingest (`RUN_INGEST=true`)
Delegates immediately to `runIngest()` and returns. No video is produced.

#### Branch 2 — Breaking news (`IS_BREAKING_NEWS=true`)
Identical to Phase 2: fresh RSS + YouTube ingest → `extractSignals` → `generateScriptWithRetry` → single video. `NUMBER_OF_VIDEOS` is ignored in this mode.

#### Branch 3 — Normal multi-video (`default`)

Three sequential phases:

**Phase 1 — Pull N stories and generate N scripts**
```
pulledIds = []
for i in 0..N:
  story = getNextPendingStory(excludeIds=pulledIds)
  script = generateScriptFromStoryWithRetry(story)
  pulledIds.push(story.id)
  jobs.push({ script, storyRecord: story })
```
The `pulledIds` exclusion list ensures each iteration fetches a *different* Airtable record, even though stories are not marked `Used` until Phase 3.

**Phase 2 — Human hook review (if `HUMAN_IN_THE_LOOP=true`)**
```
for i in 0..N:
  show SCRIPT PREVIEW for video i+1 of N
  "Approve this hook? (y/n)"
  if n: generate 3 alternatives → let user pick
```
All hooks are reviewed upfront before any voice or video generation starts — so you can approve everything and walk away.

**Phase 3 — Produce all videos**
```
for i in 0..N:
  outputDir = (N == 1) ? baseOutputDir : baseOutputDir/video_{i+1}
  voice + background videos (parallel)
  render subtitles
  compose video
  generate caption
  markStoryUsed(story.id)  ← only marked used after video succeeds
```

Output directories:
- `NUMBER_OF_VIDEOS=1` → `output/` (backward compatible, no subfolder)
- `NUMBER_OF_VIDEOS=2` → `output/video_1/`, `output/video_2/`
- `NUMBER_OF_VIDEOS=N` → `output/video_1/` … `output/video_N/`

`PIPELINE_STOP_AFTER=script` and `HUMAN_IN_THE_LOOP` both work in multi-video mode.

---

## Bug Fixes

### Bug 1 — `IS_BREAKING_NEWS=false` treated as truthy

**Root cause:** `process.env.IS_BREAKING_NEWS` returns the string `"false"` when set in `.env`. Any non-empty string is truthy in JavaScript.

**Impact:** Pipeline always entered breaking news mode regardless of the env value. `parseJsonResponse` required an `escalation` field. `generateOverviewScript` doesn't produce one → crash: `"missing required fields (escalation)"`.

**Fix:** Changed `=` to `=== "true"` in both `pipeline.js` and `src/llm/claude.js`:
```js
// Before (both files)
const isBreakingNews = process.env.IS_BREAKING_NEWS;

// After
const isBreakingNews = process.env.IS_BREAKING_NEWS === "true";
```

`RUN_INGEST` and `HUMAN_IN_THE_LOOP` were already using `=== "true"` — now all boolean env vars are consistent.

---

### Bug 2 — All N videos use the same story

**Root cause:** In Phase 1, `pullOneStory()` calls `getNextPendingStory()` which always returns the oldest `Pending` record. Stories are only marked `Used` in Phase 3 — so every iteration of the Phase 1 loop returned the same record.

**Fix:** `getNextPendingStory` now accepts `excludeIds = []`. When IDs are present, the Airtable filter formula becomes:
```
AND({Status} = "Pending", RECORD_ID() != "recA", RECORD_ID() != "recB")
```

The Phase 1 loop maintains a `pulledIds` array and passes it to each `pullOneStory` call:
```js
const pulledIds = [];
for (let i = 0; i < count; i++) {
  const { script, storyRecord } = await pullOneStory(pulledIds);
  pulledIds.push(storyRecord.id);   // ← excluded from all subsequent pulls
  jobs.push({ script, storyRecord });
}
```

---

## Story Lifecycle in Airtable

```
Weekly ingest runs
       │
       ▼
  Status: Pending   ◄── Stories available for video generation
       │
       │  Daily video pipeline pulls story
       ▼
  Status: Used      ◄── Video produced, UsedAt timestamp set
       │
       │  Next ingest run archives remaining Pending stories
       ▼
  Status: Archived  ◄── No longer available for video generation
       │
       │  If WeekOf > 4 weeks ago
       ▼
  Permanently deleted from Airtable
```

---

## Multi-Video Run — Full Log Example (`NUMBER_OF_VIDEOS=2`)

```
[pipeline] Normal mode — generating 2 video(s) from Airtable stories

── Phase 1: pulling 2 stories and generating scripts ──
[pipeline] Story 1/2...
[pipeline] Pulled story: "Clearance rates hit 7-month high as stock tightens"
[claude] Story hook validation passed (attempt 1): "Melbourne clearance hits 68% this week"
[pipeline] Script 1 ready: hook="Melbourne clearance hits 68% this week"
[pipeline] Story 2/2...
[pipeline] Pulled story: "RBA cut drives refinancing surge across Melbourne"
[claude] Story hook validation passed (attempt 1): "Rate cuts spark Melbourne refinancing boom"
[pipeline] Script 2 ready: hook="Rate cuts spark Melbourne refinancing boom"

── Phase 2: hook review (2 scripts) ──

────────────────────────────────────────────────────────────
  SCRIPT PREVIEW — Video 1 of 2
────────────────────────────────────────────────────────────
  HOOK    : Melbourne clearance hits 68% this week
  INSIGHT : ...
  IMPACT  : ...
────────────────────────────────────────────────────────────
  Approve this hook? (y/n): y
[pipeline] Hook approved for Video 1 of 2.

  Approve this hook? (y/n): n
[pipeline] Generating 3 alternative hooks...
  [1] RBA cut fuels Melbourne refinancing surge
  [2] Rate relief hits Melbourne borrowers hard
  [3] Melbourne refinancing jumps after RBA move
  Pick a hook (1/2/3): 1
[pipeline] Hook updated: "RBA cut fuels Melbourne refinancing surge"

── Phase 3: producing 2 videos ──

[pipeline] Producing video 1/2...
[pipeline] Video 1 done. Story "Clearance rates hit 7-month high..." marked as Used.

[pipeline] Producing video 2/2...
[pipeline] Video 2 done. Story "RBA cut drives refinancing surge..." marked as Used.

[pipeline] All 2 video(s) done in 84.3s.
  Video 1: ./output/video_1/output.mp4
  Video 2: ./output/video_2/output.mp4
```

---

## Weekly Ingest — Full Log Example

```
────────────────────────────────────────────────────────────
  WEEKLY INGEST MODE
────────────────────────────────────────────────────────────
  This will:
    1. Fetch 7 days of RSS, YouTube, and web data
    2. Generate 28 stories using Claude
    3. Archive all current Pending stories in Airtable
    4. Save new stories to Airtable
    5. Permanently delete stories older than 4 weeks

  Type 'yes' to proceed with ingest: yes

[ingest] Starting weekly ingest...
[rss] Fetched 24 articles across 8 feeds (11 discarded as older than 7 days)
[search] Fetched 23 web results across 5 queries
[youtube] Channel UCo_nWik261ZKSnjgoaIjz0w: 3/3 recent videos with transcripts
...
[ingest] Collected 71 items total (RSS: 24, YouTube: 22, Web: 23)
[ingest] Sending content to Claude to generate 28 stories...
[signals] generateStoriesFromContent tokens — input: 42300, output: 7800
[signals] Generated 28 stories from 71 content items
[stories] Archived 6 pending stories
[stories] No stories older than 4 weeks to delete
[stories] Saved 28 stories to Airtable (WeekOf: 2026-05-05)

────────────────────────────────────────────────────────────
  INGEST COMPLETE
────────────────────────────────────────────────────────────
  Stories generated : 28
  Stories archived  : 6
  Stories deleted   : 0
  Elapsed           : 47.2s
────────────────────────────────────────────────────────────
```

---

## LLM Cost Analysis (Phase 3 additions)

| Call | Model | ~Input tokens | ~Output tokens | ~Cost |
|------|-------|--------------|----------------|-------|
| Weekly: story generation | Sonnet 4.6 | ~40,000 | ~8,000 | ~$0.18 |
| Daily: script from story | Sonnet 4.6 | ~600 | ~120 | ~$0.003 |
| Daily: script from story ×2 | Sonnet 4.6 | ~1,200 | ~240 | ~$0.006 |

The weekly ingest is the only expensive call (~$0.18 once per week). Daily video generation from Airtable stories costs ~$0.003 per video — cheaper than Phase 2 signal-based generation because the story data is already structured and the ranking step is eliminated.

---

## Known Limitations (Phase 3)

- **Airtable rate limits:** The free tier allows 5 requests/second. `saveStories(28)` makes 3 batch create calls — well within limits. `archivePendingStories` updates records one at a time; with large backlogs this could be slow. A future optimisation is batch updating via Airtable's PATCH endpoint.
- **Story quality depends on source richness:** If the 7-day window has thin content (e.g. public holidays), Claude may generate fewer than 28 meaningful stories or produce weaker angles. The `count / 2` minimum threshold causes a hard failure in this case — consider lowering or removing it if ingest runs during low-news periods.
- **No alternative hooks for story-based scripts:** The `generateAlternativeHooks` function in `claude.js` requires a `SignalObject` (from breaking news mode). In normal Airtable mode, rejecting a hook in the human-in-the-loop step keeps the original hook rather than offering alternatives. This could be improved by adding `generateAlternativeHooksFromStory(story, script)`.
- **Serper date parsing is approximate:** Relative dates like `"2 hours ago"` are converted to absolute timestamps at ingest time — which is correct. But Serper occasionally returns undocumented date formats that fall through to `null`. This doesn't break anything but the item gets no `pubDate` and therefore no freshness boost in the story finder prompt.

---

## Phase 4 Ideas

- **Auto-upload to YouTube Shorts** — `googleapis` OAuth2 → `youtube.videos.insert` with `#shorts` in description
- **Instagram Reels / TikTok posting** — Graph API for Instagram; TikTok Content Posting API
- **Alternative hooks for story mode** — `generateAlternativeHooksFromStory(story, script)` in `claude.js` so the human-in-the-loop step can offer 3 alternatives when a story-based hook is rejected
- **Batch Airtable archiving** — replace one-at-a-time `updateRecord` calls in `archivePendingStories` with Airtable's PATCH batch endpoint (10 records per call) to speed up ingest
- **Trigger.dev scheduled ingest** — add a weekly cron task (`0 9 * * 1` = 9am UTC every Monday) alongside the existing daily video task
- **Story quality scoring** — after saving stories to Airtable, run a quick scoring pass and tag weak stories (those with no `keyMetrics`) so they are deprioritised in the pull order
- **Webhook on completion** — POST to Slack or Discord with the script text and video path when each video is ready
