"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { fetchRssArticles } = require("./src/ingestion/rss");
const { fetchYoutubeContent } = require("./src/ingestion/youtube");
const { VIDEO_FEEDS } = require("./config/feeds");
const {
  generateScript,
  generateScriptWithRetry,
  generateOverviewScript,
} = require("./src/llm/claude");
const { extractSignals, NoHighSignalError } = require("./src/llm/signals");
const { markSeen, clearStore } = require("./src/llm/dedup");
const { generateVoice } = require("./src/voice/elevenlabs");
const { fetchVideos, fetchImages } = require("./src/media/pexels");
const { renderSubtitles } = require("./src/subtitles/renderer");
const { composeVideo } = require("./src/video/compose");
const { generateCaption } = require("./src/caption/generator");

const STOP_AFTER = (process.env.PIPELINE_STOP_AFTER || "").toLowerCase().trim();

function printScriptSummary(script, signal) {
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log("  SCRIPT PREVIEW");
  console.log(divider);
  if (signal) {
    console.log(
      `  Signal  : [${signal.metricType}] "${signal.value}" (finalScore=${signal.score ?? signal.preScore})`,
    );
    console.log(divider);
  }
  console.log(`  HOOK    : ${script.hook}`);
  console.log(`  INSIGHT : ${script.insight}`);
  console.log(`  IMPACT  : ${script.impact}`);
  const totalWords = `${script.hook} ${script.insight} ${script.impact}`
    .trim()
    .split(/\s+/).length;
  console.log(divider);
  console.log(
    `  Total words: ${totalWords}  (~${Math.round(totalWords / 3)}s spoken)`,
  );
  console.log(`${divider}\n`);
}

async function runPipeline() {
  if (STOP_AFTER)
    console.log(
      `[pipeline] PIPELINE_STOP_AFTER=${STOP_AFTER} — will exit early after this stage`,
    );
  if (process.env.CLEAR_DEDUP_CACHE === "true") clearStore();
  console.log("[pipeline] Starting Melbourne property pipeline...");
  const startTime = Date.now();

  const outputDir = path.resolve(process.env.OUTPUT_DIR || "./output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // ── Step 1: Ingest (RSS + YouTube channels in parallel) ────────────────────
  const ytTasks = VIDEO_FEEDS.map((id) => fetchYoutubeContent(id));
  const [rssResult, ...ytResults] = await Promise.allSettled([
    fetchRssArticles(2),
    ...ytTasks,
  ]);

  const contentItems = [];
  let rssCount = 0;
  let ytCount = 0;
  if (rssResult.status === "fulfilled") {
    rssCount = rssResult.value.length;
    contentItems.push(...rssResult.value);
  } else {
    console.error("[pipeline] RSS ingestion failed:", rssResult.reason.message);
  }
  for (const [i, ytResult] of ytResults.entries()) {
    if (ytResult.status === "fulfilled") {
      const videos = ytResult.value;
      ytCount += videos.length;
      contentItems.push(...videos);
    } else {
      console.warn(
        `[pipeline] YouTube ingestion failed for channel ${VIDEO_FEEDS[i]} (continuing):`,
        ytResult.reason.message,
      );
    }
  }
  if (VIDEO_FEEDS.length === 0)
    console.log("[pipeline] YouTube skipped (VIDEO_FEEDS is empty)");
  if (contentItems.length === 0)
    throw new Error("[pipeline] No content ingested — aborting");
  console.log(
    `[pipeline] Ingested ${contentItems.length} content items (${rssCount} from RSS, ${ytCount} from YouTube)`,
  );

  if (STOP_AFTER === "ingest") {
    console.log(
      "\n[pipeline] ── STOP_AFTER=ingest — printing ingested articles ──",
    );
    contentItems.forEach((item, i) => {
      console.log(`\n[${i + 1}] ${item.title}`);
      console.log(
        `    ${(item.content || "").slice(0, 120).replace(/\n/g, " ")}…`,
      );
      console.log(`    ${item.url}  pubDate=${item.pubDate ?? "unknown"}`);
    });
    console.log("\n[pipeline] Done (ingest only).");
    return { contentItems };
  }

  // ── Step 2: Generate script (signal extraction → script; fallback to overview) ──────────
  let script;
  let usedSignal = null;
  try {
    const { best: topSignal, score } = await extractSignals(contentItems);
    console.log(
      `[pipeline] Top signal: type=${topSignal.metricType} value="${topSignal.value}" finalScore=${score}`,
    );
    script = await generateScriptWithRetry(topSignal);
    usedSignal = topSignal;
  } catch (err) {
    if (err instanceof NoHighSignalError) {
      console.warn(
        `[pipeline] No high-signal content today (${err.message}) — generating general overview`,
      );
      script = await generateOverviewScript(contentItems);
    } else {
      throw err;
    }
  }

  // Mark signal as seen only after successful script generation (protects against retry waste)
  if (usedSignal) {
    markSeen(usedSignal);
    console.log("[pipeline] Marked signal as seen for dedup");
  }

  const hookWordCount = script.hook.trim().split(/\s+/).length;
  console.log(
    `[pipeline] Script generated: hook="${script.hook}" (${hookWordCount} words)`,
  );
  const spokenText = `${script.hook}. Good morning Melbourne, here is what happened in the market since yesterday, ${script.insight} ${script.impact} - Follow us for tomorrow morning update.`;

  if (STOP_AFTER === "script") {
    printScriptSummary(script, usedSignal);
    console.log("[pipeline] Done (script only — audio and video skipped).");
    return { script, scriptText: spokenText };
  }

  // ── Step 3: Voice (with alignment) + background videos — parallel ────────────
  const [voiceResult, bgVideoPaths] = await Promise.all([
    generateVoice(spokenText, outputDir),
    fetchVideos(script, outputDir),
  ]);

  const { voicePath, alignment } = voiceResult;

  if (STOP_AFTER === "voice") {
    console.log(
      `[pipeline] Done (voice only — video skipped). Voice: ${voicePath}`,
    );
    return { script, scriptText: spokenText, voicePath };
  }

  // ── Step 4: Render subtitle PNGs from alignment data ─────────────────────────
  const subtitles = renderSubtitles(alignment, outputDir);

  // ── Step 5: Fallback to images if no video was found ─────────────────────────
  let imagePaths = [];
  if (!bgVideoPaths || bgVideoPaths.length === 0) {
    console.log("[pipeline] No background video — fetching images as fallback");
    imagePaths = await fetchImages(script, outputDir);
  }

  // ── Step 6: Compose final video ───────────────────────────────────────────────
  const videoPath = await composeVideo(voicePath, outputDir, {
    bgVideoPaths,
    imagePaths,
    subtitles,
  });

  // ── Step 7: Generate social caption ──────────────────────────────────────────
  generateCaption(script, usedSignal, contentItems, outputDir);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[pipeline] Done in ${elapsed}s. Output: ${videoPath}`);

  return { script, scriptText: spokenText, voicePath, videoPath };
}

module.exports = { runPipeline };
