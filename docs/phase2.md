# Phase 2: Melbourne Property Agent — Signal Quality Upgrade

## Overview

Phase 2 replaces the Phase 1 single-pass LLM summarisation with a **multi-step signal extraction pipeline** designed to produce sharp, data-driven scripts with concrete numbers every day.

### Core problem solved

Phase 1 sent raw article text directly to Claude Haiku and asked it to summarise. The result was generic summaries like *"Market sentiment is shifting as buyer fatigue sets in"* — vague, numberless, low engagement.

Phase 2 changes the approach:

1. **Extract** — scan articles for sentences containing a numeric market metric
2. **Filter** — drop non-signal sentences with a keyword guard
3. **Pre-score** — assign heuristic quality scores before the LLM sees anything
4. **Rank** — a lightweight LLM call selects the single best signal
5. **Generate** — a second LLM call writes the script *from* the structured signal
6. **Validate** — post-generation hook constraints enforced with retry and deterministic fallback
7. **Deduplicate** — 3-day TTL prevents the same metric being reused on consecutive days

**Fallback guarantee:** If no numeric signal is found, or all signals are recently used, the pipeline generates a warm general overview — content is always produced, the pipeline never blocks.

---

## New Files

| File | Purpose |
|------|---------|
| `config/feeds.js` | Configurable RSS feed list — add feeds here without touching any other file |
| `src/llm/signals.js` | Signal extraction, pre-scoring, LLM ranking, dedup integration |
| `src/llm/validate.js` | Post-generation hook constraint validator and deterministic fallback hook builder |
| `src/llm/dedup.js` | File-based signal deduplication with TTL and automatic pruning |

## Modified Files

| File | Change summary |
|------|---------------|
| `src/ingestion/rss.js` | Imports feeds from `config/feeds.js`; adds `pubDate` to each article |
| `src/llm/claude.js` | Added `generateScriptFromSignal`, `generateScriptWithRetry`, `generateOverviewScript`; updated prompts to V2 |
| `pipeline.js` | Step 2 replaced with 3-path orchestration; `PIPELINE_STOP_AFTER` early-exit support; `markSeen` wired after script success |

---

## `config/feeds.js`

Single source of truth for RSS feed URLs. Adding a new feed requires one line here — no other file needs to change.

```js
const RSS_FEEDS = [
  'https://www.realestate.com.au/news/feed/',
  'https://propertyupdate.com.au/feed/',
  'https://www.smartpropertyinvestment.com.au/news?format=feed&type=rss',
  'https://www.yourinvestmentpropertymag.com.au/feed',
  'https://positiverealestate.com.au/feed/',
  'https://ironfish.com.au/feed/',
  'https://opencorp.com.au/feed/',
  'https://petewargent.blogspot.com/feeds/posts/default?alt=rss',
];
```

---

## `src/ingestion/rss.js` — Changes

Added `pubDate: item.isoDate || null` to each article object. `isoDate` is an ISO 8601 string provided by rss-parser (confirmed present on all tested feeds). Used downstream in `signals.js` for freshness scoring.

Added fetch-count log: `[rss] Fetched X articles across Y feeds`.

---

## `src/llm/signals.js`

The core of Phase 2. Two-stage pipeline: regex pre-pass → LLM ranking.

### Stage A — Regex pre-pass (free, synchronous)

**Numeric pattern** — catches percentages, basis points, and dollar shorthands:

```js
const NUMERIC_PATTERN = /(\$\d[\d,.]*[km]?\b|\d+\.?\d*\s*(%|per cent|basis points))/i;
```

The original Phase 1 pattern did not catch standalone dollar amounts like `$850k` (the `$` appeared in the alternation *after* the digits, which is the reverse of natural English). The new pattern handles both `$850k` and `68%`.

**Signal keyword filter** — eliminates junk sentences:

```js
const SIGNAL_KEYWORD_RE = /\b(clearance
|prices?
|rates?
|growth
|decline
|increase
|decrease
|supply
|listings?
|demand
|median
|auction
|yield
|gearing
|gains
|capital
|CGT
|budget)\b/i;
```

A sentence must match **both** patterns to become a candidate. This removes noise like:
- `"3-bedroom house in Brighton"` — no numeric pattern
- `"$1.2m luxury penthouse sold"` — no signal keyword
- `"The 5-year fixed rate offer"` — no signal keyword around the number

`\b` word boundaries prevent false positives: `"moderate"` does not match `\brate\b`, `"separate"` does not match `\brate\b`.

Title fallback: if no sentence in an article qualifies, the article title is checked under the same two-pattern rule.

### Candidate schema (`SignalObject`)

```js
{
  metricType:  'clearance_rate' | 'price_change' | 'interest_rate' | 'volume' | 'days_on_market' | 'generic',
  value:       string,          // matched numeric string — "68%", "$850k"
  direction:   'up' | 'down' | null,
  timeframe:   string | null,   // "this week", "last month", etc.
  geography:   string | null,   // "Melbourne", "inner Melbourne"
  rawSentence: string,          // source sentence, max 200 chars
  sourceTitle: string,
  sourceUrl:   string,
  pubDate:     string | null,   // ISO 8601 from rss-parser
  preScore:    number,          // heuristic quality score (see below)
}
```

### Pre-scoring (`computePreScore`)

Runs on every candidate before any LLM call. Produces a deterministic quality score based on signal type, freshness, and sentence characteristics.

| Condition | Score boost |
|-----------|------------|
| `metricType === 'clearance_rate'` | +30 |
| `metricType === 'price_change'` | +25 |
| `metricType === 'interest_rate'` | +20 |
| `metricType === 'volume'` | +15 |
| `metricType === 'days_on_market'` | +10 |
| Sentence contains `%` | +10 |
| Sentence length < 120 chars | +5 |
| Direction detected (`up` or `down`) | +5 |
| `pubDate` age < 24 hours | +15 |
| `pubDate` age < 48 hours | +10 |
| `pubDate` age < 72 hours | +5 |
| Timeframe contains "today" or "this week" | +5 (secondary — for YouTube / null pubDate) |

### Stage B — LLM ranking call

Candidates (with `preScore` included in the prompt text) are sent to Claude Haiku. Currently uses `RANK_SYSTEM_PROMPT_V2` — stricter than V1, with a higher implicit rejection threshold and sharper preference ordering.

The LLM returns `{ selectedIndex, score (0–100), reason }`.

**Combined threshold:** `finalScore = llmScore + candidate.preScore ≥ 50`.

This means a clearance-rate signal with `%` and direction detected has `preScore = 30 + 10 + 5 = 45`. Even if the LLM gives it a modest score of 10, `finalScore = 55` → passes. Weak generic signals with `preScore = 0` need a strong LLM score (≥ 50) to pass.

### Deduplication inside `extractSignals`

After the LLM selects the best candidate:

1. `isDuplicate(best)` is called (from `dedup.js`)
2. If **not duplicate** → return `{ best }`
3. If **duplicate** → sort remaining candidates by `preScore` descending, find first with `preScore ≥ 20` that is not a duplicate → return that instead
4. If **all strong candidates are duplicates** → throw `NoHighSignalError('All strong signals already used recently')` → caught in `pipeline.js` → `generateOverviewScript()`

**Logs:**
```
[signals] Candidates found: 6 (raw numeric + keyword matches)
[signals] Pre-scores — top candidates: clearance_rate(60), price_change(45), volume(30)
[signals] rank tokens — input: 312, output: 48
[signals] LLM selected index=0 llmScore=78 preScore=60 finalScore=138 reason="Clearance rate is the most actionable Melbourne metric"
[dedup] Checked "clearance_rate:68%" — fresh (not seen before)
[signals] Best signal — type=clearance_rate value="68%" finalScore=138
```

---

## `src/llm/dedup.js`

File-based deduplication with TTL, auto-pruning, and graceful degradation.

### Store format

`processed_signals.json` in `OUTPUT_DIR` (override with `SIGNAL_STORE_PATH`):

```json
{
  "clearance_rate:68%": "2026-05-03T06:00:00.000Z",
  "price_change:3.2%": "2026-05-02T06:00:00.000Z"
}
```

**Key:** `${metricType}:${value}` normalised (lowercase, no spaces).

### TTL and pruning

- **TTL: 3 days** — a signal seen Monday is unblocked by Thursday. Genuine weekly recurrences (e.g., every Saturday clearance rate) are not permanently blocked.
- **Prune: 7 days** — entries older than 7 days are removed on every read/write cycle. Prevents unbounded file growth.

### Graceful degradation (production note)

Trigger.dev cloud runs in an **ephemeral container** — the filesystem is reset between runs. If `processed_signals.json` cannot be read, `isDuplicate` returns `false` and the pipeline behaves exactly as Phase 1 (no dedup). Zero breakage. Deduplication requires a persistent volume mounted at `OUTPUT_DIR` to work across cloud runs.

### `markSeen` placement

`markSeen(signal)` is called in `pipeline.js` **after** `generateScriptWithRetry` succeeds — not inside `extractSignals`. This prevents a signal from being marked as used if script generation later throws, which would waste the signal on the next Trigger.dev retry attempt.

**Logs:**
```
[dedup] Checked "clearance_rate:68%" — fresh (not seen before)
[dedup] Checked "price_change:3.2%" — duplicate (seen 14h ago)
[dedup] Marked as seen: "clearance_rate:68%"
[dedup] Pruned 2 expired entries (older than 7 days)
[dedup] Store not found — dedup disabled for this run (ephemeral filesystem)
```

---

## `src/llm/validate.js`

Pure utility — no API calls, no side effects.

### `validateScript(script)`

Enforces the Phase 2 output contract on any generated script:

| Check | Rule |
|-------|------|
| Hook length | ≤ 8 words |
| Hook number | Must contain at least one digit |
| Hook tone | Must not contain vague phrases: `'market is'`, `'sentiment is'`, `'experts say'`, `"it's worth noting"`, `'according to'`, `'things are'` |

Returns `{ valid: boolean, reasons: string[] }`.

### `constrainHookFromSignal(signal)`

Deterministic hook builder — used as final fallback when both LLM attempts produce an invalid hook. No LLM call, zero cost.

Algorithm:
1. Find the numeric pattern in `rawSentence`
2. Locate the word containing the number
3. Build a 7-word window centred around that word
4. Capitalise first letter, strip trailing punctuation

Guarantees: the number is always in the output; output is always ≤ 7 words.

---

## `src/llm/claude.js` — Changes

### New exports

| Function | Purpose |
|----------|---------|
| `generateScriptFromSignal(signal, opts?)` | Generates script from a `SignalObject` — takes structured signal, not raw articles |
| `generateScriptWithRetry(signal)` | Wraps the above with 2-attempt validation + deterministic fallback |
| `generateOverviewScript(contentItems)` | Warm positive overview for low-signal or all-deduped days |

`generateScript(contentItems)` (original Phase 1 function) is kept as a retained legacy export. It is no longer called by the main pipeline path.

### Prompt versioning

Both `generateScript` (legacy) and the new functions now have versioned system prompts (`SYSTEM_PROMPT_V1` / `V2`, `RANK_SYSTEM_PROMPT_V1` / `V2`). The active version in use is `V2` in both cases. V1 prompts are retained for rollback comparison.

### `generateScriptFromSignal` prompt

System prompt (`SIGNAL_SYSTEM_PROMPT`, cached with `cache_control: ephemeral`) enforces:

```
hook:
  - Maximum 8 words
  - For percentages/rates: include the exact number
  - For dollar amounts: may round/abbreviate, but a number MUST still appear
  - Present tense, scroll-stopping
  - GOOD: "Auction rates just dropped to 68%", "Medians cross $1m in inner suburbs"
  - BAD: "The Melbourne market is showing signs of change"
  - NO filler phrases

insight: 1–2 sentences, max 40 words, Melbourne-specific, full statistic with context
impact: 1 sentence, max 20 words, direct takeaway for buyers OR investors
Total: 30–60 words
```

User prompt sends: metric type, value, direction, timeframe, geography, source sentence, source article title.

### `generateScriptWithRetry` flow

```
Attempt 1
  → generateScriptFromSignal(signal)
  → validateScript(attempt1)
  → valid: return
  → invalid: log "[claude] Hook validation failed (attempt 1): <reasons>"

Attempt 2 (stricter hook reminder appended to user prompt)
  → generateScriptFromSignal(signal, { stricterHook: true })
  → validateScript(attempt2)
  → valid: return
  → invalid: log "[claude] Hook validation failed (attempt 2): <reasons>"

Fallback (no LLM call)
  → hook = constrainHookFromSignal(signal)
  → return { ...attempt2, hook }
  → log "[claude] Applying deterministic hook fallback: <hook>"
```

For dollar-value signals, the retry reminder allows abbreviation: `"MUST contain a reference to the value $850k (you may round/abbreviate)"`. For percentage signals it requires the exact figure.

**Logs:**
```
[claude] Hook validation passed (attempt 1): "Auction rates just dropped to 68%" (6 words)
[claude] Hook validation failed (attempt 1): hook is 11 words (max 8)
[claude] Retrying with stricter hook prompt (attempt 2)
[claude] Applying deterministic hook fallback: "Clearance rates fell to 68%"
[claude] signal-gen tokens — input: 380, output: 95, cache_read: 340, cache_creation: 0
[claude] overview tokens — input: 890, output: 88, cache_read: 820, cache_creation: 0
```

---

## `pipeline.js` — Changes

### Three-path script generation (Step 2)

```
Path A — Signal found, not a duplicate:
  extractSignals(contentItems) → { best: SignalObject, score: finalScore }
  generateScriptWithRetry(best) → validated { hook, insight, impact }
  markSeen(best)

Path B — Signal found but duplicate / all candidates deduped:
  extractSignals() tries next candidate by preScore
  if all strong candidates deduped → NoHighSignalError thrown
  → caught → generateOverviewScript(contentItems)

Path C — No numeric signals at all:
  extractSignals() → NoHighSignalError thrown (zero candidates)
  → caught → generateOverviewScript(contentItems)
```

`generateScript` (Phase 1 legacy) is no longer called in normal operation. It remains imported but is not used unless someone explicitly calls it.

### `PIPELINE_STOP_AFTER` — early-exit for testing

Set in `.env` to stop the pipeline after a given stage and skip the rest. Useful for checking script quality without spending ElevenLabs or Pexels credits.

| Value | Stops after | Use case |
|-------|------------|---------|
| `ingest` | Step 1 — prints all ingested articles | Verify feeds are working, check article quality |
| `script` | Step 2 — prints full script preview | **Primary quality check** — evaluate hook, insight, impact before audio |
| `voice` | Step 3 — generates voice file only | Test TTS without video composition |
| *(empty)* | Runs all 6 steps | Normal daily run |

**Script preview output** (`PIPELINE_STOP_AFTER=script`):

```
────────────────────────────────────────────────────────────
  SCRIPT PREVIEW
────────────────────────────────────────────────────────────
  Signal  : [clearance_rate] "68%" (finalScore=138)
────────────────────────────────────────────────────────────
  HOOK    : Auction rates just dropped to 68%
  INSIGHT : Melbourne's weekend clearance rate fell to 68%, down from 72%
            as listings surged 12% over the same period.
  IMPACT  : Buyers now have more negotiating power as supply rises.
────────────────────────────────────────────────────────────
  Total words: 40  (~13s spoken)
────────────────────────────────────────────────────────────
```

### Ingestion log improvement

Step 1 log now includes source breakdown:

```
[pipeline] Ingested 16 content items (16 from RSS, 0 from YouTube)
```

---

## New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PIPELINE_STOP_AFTER` | *(empty)* | `ingest` / `script` / `voice` — stop early at this stage |
| `SIGNAL_STORE_PATH` | `OUTPUT_DIR/processed_signals.json` | Custom path for the dedup store |

---

## LLM Cost Analysis

| Call | Model | ~Input tokens | ~Output tokens | ~Cost (Haiku) |
|------|-------|--------------|----------------|--------------|
| Signal ranking | Haiku | ~300 | ~50 | $0.0001 |
| Script generation | Haiku | ~400 | ~120 | $0.0002 |
| **Total (signal day)** | | **~700** | **~170** | **~$0.0003** |
| Overview (fallback day) | Haiku | ~900 | ~100 | $0.0003 |

Phase 1 cost was ~$0.0004/run (1,200 input tokens from full article text). Phase 2 is cheaper because the ranking call uses compressed signal objects (~15 tokens each) rather than full article bodies.

---

## Full Log — Typical Run

```
[pipeline] PIPELINE_STOP_AFTER=script — will exit early after this stage
[pipeline] Starting Melbourne property pipeline...
[rss] Fetched 16 articles across 8 feeds
[pipeline] Ingested 16 content items (16 from RSS, 0 from YouTube)
[signals] Candidates found: 6 (raw numeric + keyword matches)
[signals] Pre-scores — top candidates: clearance_rate(60), price_change(45), volume(30)
[signals] rank tokens — input: 312, output: 48
[signals] LLM selected index=0 llmScore=78 preScore=60 finalScore=138 reason="Clearance rate is the most actionable Melbourne metric this week"
[dedup] Checked "clearance_rate:68%" — fresh (not seen before)
[signals] Best signal — type=clearance_rate value="68%" finalScore=138
[claude] Hook validation passed (attempt 1): "Auction rates just dropped to 68%" (6 words)
[claude] signal-gen tokens — input: 380, output: 92, cache_read: 340, cache_creation: 0
[pipeline] Marked signal as seen for dedup
[dedup] Marked as seen: "clearance_rate:68%"
[pipeline] Script generated: hook="Auction rates just dropped to 68%" (6 words)

────────────────────────────────────────────────────────────
  SCRIPT PREVIEW
────────────────────────────────────────────────────────────
  Signal  : [clearance_rate] "68%" (finalScore=138)
────────────────────────────────────────────────────────────
  HOOK    : Auction rates just dropped to 68%
  INSIGHT : Melbourne's weekend clearance rate fell to 68%, down from 72% as listings surged 12%.
  IMPACT  : Buyers now have more negotiating power as supply rises.
────────────────────────────────────────────────────────────
  Total words: 38  (~13s spoken)
────────────────────────────────────────────────────────────

[pipeline] Done (script only — audio and video skipped).
```

---

## Known Limitations (Phase 2)

- **Dedup is local-only:** Requires a persistent `OUTPUT_DIR`. Silently no-ops on ephemeral Trigger.dev cloud containers — needs a mounted volume to work across cloud runs.
- **Combined score threshold (50) is empirical:** Calibrated at build time. After a week of real runs, review logged `finalScore` values to confirm the threshold is appropriate.
- **Pre-score weights are fixed:** Clearance rates always score 30 points regardless of whether they are Melbourne-specific. A national clearance figure could out-score a Melbourne-specific volume figure. The LLM ranking step is the safeguard for this.
- **Dedup TTL (3 days) may block important ongoing stories:** An RBA rate cut announced on Monday is blocked again until Thursday. On those days the pipeline falls back to a general overview. Acceptable trade-off for reduced repetition.

---

## Phase 3 Ideas

- **Trigger.dev KV store for dedup** — replace file-based `processed_signals.json` with `store.set`/`store.get` so dedup works on ephemeral cloud containers without requiring a mounted volume
- **Auto-upload to YouTube Shorts** — `googleapis` OAuth2 → `youtube.videos.insert` with `#shorts` in description
- **Instagram Reels posting** — Graph API `POST /me/media` + `POST /me/media_publish`
- **Smarter background video** — curated Melbourne-specific b-roll clips stored locally, cycling rather than relying on Pexels
- **Subtitle grouping** — show 3–4 words at a time (phrase-level) instead of one word, reducing FFmpeg overlay complexity and matching standard caption convention
- **Pre-score weight tuning** — after 2–4 weeks of real runs, adjust metric-type boosts and threshold based on observed `finalScore` distributions in the logs
- **Analytics JSONL log** — append daily run data (signal type, score, path taken, hook) to a local file for trend review and threshold calibration
- **Webhook on completion** — POST to Slack/Discord with script text and thumbnail when video is ready
- **Audio background music** — mix a low-volume ambient track via FFmpeg `amix`
