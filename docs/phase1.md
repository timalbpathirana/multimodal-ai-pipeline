# Phase 1: Melbourne Property Agent — Pipeline Documentation

## Overview

Fully automated daily pipeline that ingests Melbourne property news, generates a 10–20 second AI script, synthesises a voiceover with character-level timestamps, overlays word-by-word subtitles, and composes a portrait MP4 ready for short-form social media (Reels/Shorts/TikTok).

**Output:** `output/output.mp4` — 1080×1920, H.264, AAC, ~10–20 seconds

---

## Tech Stack

| Layer | Package | Version |
|---|---|---|
| Runtime | Node.js (CommonJS) | — |
| LLM | `@anthropic-ai/sdk` | ^0.92.0 |
| TTS | ElevenLabs REST API (axios) | — |
| TTS fallback | macOS `say` + ffmpeg AIFF→MP3 | — |
| RSS parsing | `rss-parser` | ^3.13.0 |
| YouTube transcripts | `youtube-transcript` | ^1.3.1 |
| Media (video/images) | Pexels REST API (axios) | — |
| Subtitle rendering | `canvas` | ^3.2.3 |
| Video composition | `fluent-ffmpeg` | ^2.1.3 |
| HTTP client | `axios` | ^1.15.2 |
| Scheduling | `@trigger.dev/sdk` | ^4.4.5 |
| Env management | `dotenv` | ^17.4.2 |

### FFmpeg binary resolution

`src/utils/ffmpeg.js` resolves the binary at startup rather than relying on shell PATH. Search order:

1. `/usr/local/bin`, `/opt/homebrew/bin`, `/usr/bin`
2. Homebrew Cellar (`/usr/local/Cellar/ffmpeg`, `/opt/homebrew/Cellar/ffmpeg`) via `find -maxdepth 4`

This handles the common case where `brew install ffmpeg` populates the Cellar but `brew link` was never run. Both `ffmpegPath` and `ffprobePath` are set via `fluent-ffmpeg.setFfmpegPath()` / `setFfprobePath()` so all downstream modules use the same resolved instance.

---

## APIs

### Anthropic (Claude)

- **Model:** `claude-haiku-4-5-20251001` (cheapest/fastest in Claude 4 family)
- **Endpoint:** `POST /v1/messages`
- **Usage:** Script generation — given ingested news content, returns `{ hook, insight, impact }` JSON
- **Prompt caching:** System prompt has `cache_control: { type: 'ephemeral' }`. On the second daily run the system prompt tokens are read from cache (logged as `cache_read_input_tokens`) rather than charged at full price
- **Max tokens:** 512 (output only — script is short)
- **Token logging:** Input, output, `cache_read_input_tokens`, `cache_creation_input_tokens` logged every run

### ElevenLabs

- **Endpoint:** `POST /v1/text-to-speech/{voiceId}/with-timestamps`
- **Model:** `eleven_multilingual_v2`
- **Default voice:** Rachel (`21m00Tcm4TlvDq8ikWAM`) — overridable via `ELEVENLABS_VOICE_ID`
- **Voice settings:** `stability: 0.5`, `similarity_boost: 0.75`
- **Response format:** JSON `{ audio_base64, alignment }` where `alignment` contains character-level timing arrays
- **Alignment schema:**
  ```
  {
    characters: string[],
    character_start_times_seconds: number[],
    character_end_times_seconds: number[]
  }
  ```
- **Credit saving:** `DEV_SKIP_TTS=true` skips the API call entirely and reuses `output/voice_dev.mp3`

### Pexels

- **Videos:** `GET https://api.pexels.com/videos/search?query=...&orientation=portrait&per_page=5`
- **Images (fallback):** `GET https://api.pexels.com/v1/search?query=...&orientation=portrait&per_page=4`
- **Auth:** `Authorization: <PEXELS_API_KEY>` header
- **Query building:** Takes the `hook` field from the script, strips stop words, keeps top 3 keywords, prefixes with `"Melbourne property "`
- **Video file selection:** Prefers portrait HD files (`height > width` AND `width >= 720`), falls back to any portrait file, then any file

---

## Pipeline Modules

### `src/ingestion/rss.js`

Fetches articles from 3 RSS feeds in parallel using `Promise.allSettled` — tolerates individual feed failures.

**Feeds:**
- `https://www.abc.net.au/news/feed/51892/rss.xml` (ABC property/finance)
- `https://www.realestate.com.au/news/feed/`
- `https://www.propertyupdate.com.au/feed/`

**Output:** Array of `{ title, content, url }` — up to `maxPerFeed` (default 2) items per feed. Content uses `contentSnippet || content || summary` fallback chain.

**Config:** 10s timeout, custom User-Agent header to avoid 403s.

---

### `src/ingestion/youtube.js`

Fetches the transcript of the most recent video from a YouTube channel without requiring the YouTube Data API.

**Step 1 — Video ID:** Fetches `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` via `rss-parser` with `customFields: { item: [['yt:videoId', 'videoId']] }` to parse the `yt:videoId` XML namespace. Takes `feed.items[0].videoId`.

**Step 2 — Transcript:** `YoutubeTranscript.fetchTranscript(videoId)` → joins all `.text` fields, caps at 3000 characters.

**Output:** Single `{ title, content, url }` object. Throws on failure (pipeline uses `Promise.allSettled` so YouTube failure is non-fatal).

**Limitation:** Only works on channels with auto-generated or manual captions enabled. Private channels not supported.

---

### `src/llm/claude.js`

Generates the 10–20 second spoken script from ingested content.

**Input:** Array of `{ title, content, url }` formatted as numbered blocks:
```
[1] Title
Content snippet
Source: url

---

[2] ...
```

**Output:** `{ hook, insight, impact }` — three sentences that are concatenated as `${hook} ${insight} ${impact}` for TTS.

**JSON fence stripping:** Claude occasionally wraps JSON in ` ```json ``` ` fences despite instructions. A regex strip runs before `JSON.parse` as a safety net.

---

### `src/voice/elevenlabs.js`

Three execution paths depending on environment:

1. **DEV mode** (`DEV_SKIP_TTS=true`): Looks for `output/voice_dev.mp3`. If found, estimates word alignment by distributing characters proportionally across the audio duration using `ffmpeg.ffprobe()`. Returns `{ voicePath, alignment }`.

2. **ElevenLabs** (API key present): POSTs to `/with-timestamps` endpoint. Decodes `audio_base64` → writes `output/voice.mp3`. Returns real character-level alignment.

3. **macOS fallback** (no API key, or ElevenLabs error): Calls `say -v Samantha` to generate AIFF, converts to MP3 via ffmpeg shell command. Returns `{ voicePath, alignment: null }` — no alignment means subtitles are skipped.

---

### `src/media/pexels.js`

**`fetchVideo(script, outputDir)`:** Searches Pexels Videos API, picks the best portrait file, downloads to `output/media/background.mp4`. Returns the local path or `null` on any failure.

**`fetchImages(script, outputDir)`:** Fallback when no video is found. Downloads up to 4 portrait photos to `output/media/img_0.jpg` etc. Returns array of local paths (empty array on failure).

Both functions degrade gracefully — `null` / `[]` return causes the pipeline to fall through to the solid background fallback.

---

### `src/subtitles/renderer.js`

Converts ElevenLabs character-level alignment into word-by-word subtitle PNGs for FFmpeg overlay.

**Word extraction:** Scans `characters[]` array, accumulates chars into words, splits on space/newline. Word `startTime` = first char's start, `endTime` = last char's start (exclusive of the space).

**PNG rendering (per word):**
- Canvas: 1080×220px transparent
- Font: Impact 900 96px, all-caps
- Text style: `#FFD700` (gold) fill, 10px black stroke with `lineJoin: round`, 12px drop shadow
- Background: `rgba(0,0,0,0.55)` rounded pill (radius 18) sized to text with 40px/20px padding
- Top highlight: `rgba(255,255,255,0.25)` fill offset 2px up for depth
- Saved as PNG with transparency to `output/subtitles/word_N.png`

**Output:** Array of `{ imagePath, startTime, endTime }` — one entry per word, punctuation-only tokens filtered out.

**Position:** `SUBTITLE_Y = 1920 - 220 - 120 = 1580` (lower third, ~120px from bottom).

---

### `src/video/compose.js`

Composes the final video with three modes selected automatically:

**Mode 1 — Pexels video background** (`bgVideoPath` provided):
- Input 0: background video with `-stream_loop -1` (loops for duration of voiceover)
- Scale+crop to 1080×1920: `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1`
- Chains subtitle overlays on top

**Mode 2 — Image slideshow** (`imagePaths` array provided):
- Each image looped as static video for `segDuration` seconds: `segDuration = (total + (n-1) * 0.5) / n`
- Images crossfaded with `xfade=transition=fade:duration=0.5`
- Subtitle overlays chained on top of final slideshow output

**Mode 3 — Solid colour fallback** (no media):
- Generates a 1080×1920 dark blue (`#1a1a2e`) PPM image in Node.js (no external tools)
- Looped as static background with `-loop 1`

**Subtitle overlay chain (all modes):** Each word PNG added as a separate input. FFmpeg `overlay` filter with `enable='between(t,start,end)'` applied in a chain: `[prev][N:v]overlay=x=(W-w)/2:y=1580:enable='between(t,start,end)'[outN]`

**Output encoding** (all modes):
- Video: libx264, `fast` preset, CRF 23, 30fps, yuv420p
- Audio: AAC 128k
- Flags: `-movflags +faststart` (streaming-friendly), `-pix_fmt yuv420p` (Instagram/Reels compatibility)

---

### `pipeline.js`

Main orchestrator. Six steps with parallel operations where possible.

```
1. Ingest: Promise.allSettled([fetchRssArticles(2), fetchYoutubeContent(channelId)])
           → RSS required, YouTube optional (pipeline continues if it fails)
           → throws if zero items ingested

2. Script: generateScript(contentItems)
           → spokenText = `${hook} ${insight} ${impact}`

3. Parallel: Promise.all([generateVoice(spokenText, outputDir), fetchVideo(script, outputDir)])
             → saves ~2-5s vs sequential

4. Subtitles: renderSubtitles(alignment, outputDir)
              → skipped (returns []) if alignment is null (macOS TTS fallback)

5. Image fallback: fetchImages(script, outputDir) — only if no bgVideoPath

6. Compose: composeVideo(voicePath, outputDir, { bgVideoPath, imagePaths, subtitles })
```

---

### `trigger/daily.js`

Trigger.dev v4 scheduled task — runs the pipeline at 6am UTC (4pm AEST / 5pm AEDT).

```js
schedules.task({
  id: 'daily-melb-property-video',
  cron: '0 6 * * *',
  run: async () => runPipeline()
})
```

Retry config in `trigger.config.js`: 3 attempts, exponential backoff (1s → 10s, factor 2).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `ELEVENLABS_API_KEY` | No | ElevenLabs key — falls back to macOS `say` if absent |
| `ELEVENLABS_VOICE_ID` | No | Voice ID (default: Rachel `21m00Tcm4TlvDq8ikWAM`) |
| `PEXELS_API_KEY` | No | Pexels key — falls back to solid background if absent |
| `YOUTUBE_CHANNEL_ID` | No | UC... channel ID (not @handle) — YouTube skipped if absent |
| `TRIGGER_SECRET_KEY` | Yes (cloud) | Trigger.dev personal access token |
| `OUTPUT_DIR` | No | Output directory (default: `./output`) |
| `DEV_SKIP_TTS` | No | `true` to skip ElevenLabs and reuse `output/voice_dev.mp3` |

---

## Current Capabilities

- Ingests up to 6 RSS articles (2 per feed × 3 feeds) + 1 YouTube transcript per run
- Generates a 10–20 second spoken script focused on a single Melbourne property insight
- Produces voice with real character-level timestamps (ElevenLabs path) or estimated timestamps (dev/fallback paths)
- Word-by-word subtitle overlay: each word flashes in sync with speech, lower-third position
- Background options: Pexels portrait video (primary) → Pexels image slideshow → solid dark blue
- Full graceful degradation: every external API failure has a fallback path, pipeline never hard-crashes on optional services
- Dev mode (`DEV_SKIP_TTS=true`) for iteration without burning ElevenLabs credits
- Daily scheduling via Trigger.dev cloud with automatic retries

---

## Known Limitations

- **YouTube transcript availability:** Works only on channels with captions enabled. Fails silently (pipeline continues without YouTube content).
- **Pexels query relevance:** Search query is built from keywords in the `hook` field. Results may not be specifically Melbourne property imagery — stock footage is generic.
- **Subtitle estimation in dev/fallback mode:** When using `DEV_SKIP_TTS=true` or macOS TTS, word timings are linearly interpolated — not aligned to actual speech. Subtitles will be off in dev mode.
- **FFmpeg binary coupling:** The Cellar search is macOS/Homebrew specific. Deploying to Linux (e.g. Trigger.dev cloud) requires `ffmpeg` on PATH or a Docker image with it pre-installed.
- **No output delivery:** The pipeline writes `output/output.mp4` locally. There is no upload step — manual upload to YouTube/Instagram/TikTok required.
- **No deduplication:** The same news story may be used across consecutive runs if it stays at the top of the RSS feeds.
- **Single insight per video:** By design — but if news is thin, the hook may not be compelling.
- **No content moderation:** Script is generated directly from RSS/transcript content with no filtering.

---

## Phase 2 Ideas

- **Auto-upload to YouTube Shorts** — use `googleapis` with OAuth2 to call `youtube.videos.insert` with `#shorts` in the description
- **Instagram Reels posting** — Graph API `POST /me/media` + `POST /me/media_publish`
- **Smarter background video** — use a curated set of Melbourne-specific b-roll clips stored locally, cycling through them rather than relying on Pexels relevance
- **Multiple voices / A/B testing** — randomise voice ID each run and log which gets more engagement
- **Deduplication** — store processed article URLs in a lightweight JSON file or SQLite to avoid repeating stories
- **Webhook on completion** — POST to Slack/Discord with the script text and a thumbnail when the video is ready
- **Upgrade model** — swap Haiku for Sonnet on the script generation step once quality is the priority over cost
- **Subtitle grouping** — show 3–4 words at a time (phrase-level) instead of one word, to match standard caption convention and reduce the number of FFmpeg overlay inputs
- **Audio background music** — mix a low-volume ambient track under the voiceover using FFmpeg `amix`
- **Analytics tracking** — log daily runs, script content, and delivery success to a simple append-only JSONL file for review
