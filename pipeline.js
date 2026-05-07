"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { fetchRssArticles } = require("./src/ingestion/rss");
const { fetchYoutubeContent } = require("./src/ingestion/youtube");
const { runIngest } = require("./src/ingestion/ingest");
const {
  generateScriptWithRetry,
  generateOverviewScript,
  generateAlternativeHooks,
  generateScriptFromStoryWithRetry,
} = require("./src/llm/claude");
const { extractSignals, NoHighSignalError } = require("./src/llm/signals");
const { getNextPendingStory, markStoryUsed } = require("./src/airtable/stories");
const { generateVoice } = require("./src/voice/elevenlabs");
const { fetchVideos, fetchImages } = require("./src/media/pexels");
const { renderSubtitles } = require("./src/subtitles/renderer");
const { composeVideo } = require("./src/video/compose");
const { generateCaption } = require("./src/caption/generator");
const { uploadToTikTok } = require("./src/social/tiktok");
const { ask } = require("./src/utils/prompt");

// ── Display helpers ───────────────────────────────────────────────────────────

function printScriptSummary(script, label, signal) {
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log(`  SCRIPT PREVIEW${label ? ` — ${label}` : ""}`);
  console.log(divider);
  if (signal) {
    console.log(
      `  Signal  : [${signal.metricType}] "${signal.value}" (finalScore=${signal.score ?? signal.preScore})`,
    );
    console.log(divider);
  }
  console.log(`  HOOK       : ${script.hook}`);
  if (script.bridge) console.log(`  BRIDGE     : ${script.bridge}`);
  console.log(`  INSIGHT    : ${script.insight}`);
  console.log(`  IMPACT     : ${script.impact}`);
  const totalWords = [script.hook, script.bridge, script.insight, script.impact]
    .filter(Boolean)
    .join(" ")
    .trim()
    .split(/\s+/).length;
  console.log(divider);
  const estimatedSecs = Math.round(totalWords / 2.5);
  const wordCountNote = totalWords < 120 ? " ⚠ too short" : totalWords > 160 ? " ⚠ too long" : "";
  console.log(`  Total words: ${totalWords}  (~${estimatedSecs}s spoken)${wordCountNote}`);
  console.log(`${divider}\n`);
}

// ── Human-in-the-loop: review and optionally replace the hook (CLI only) ──────

async function reviewHook(agentCtx, script, label, signal) {
  printScriptSummary(script, label, signal);

  const approval = await ask("  Approve this hook? (y/n): ");
  if (approval.toLowerCase() === "y") {
    agentCtx.log(`[pipeline] Hook approved for ${label}.`);
    return script;
  }

  if (!signal) {
    console.warn("[pipeline] No signal available for alternative hooks — keeping current hook.\n");
    return script;
  }

  console.log("[pipeline] Generating 3 alternative hooks...");
  const altHooks = await generateAlternativeHooks(agentCtx, signal, script);

  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log("  ALTERNATIVE HOOKS");
  console.log(divider);
  altHooks.forEach((hook, i) => console.log(`  [${i + 1}] ${hook}`));
  console.log(`${divider}\n`);

  const pick = await ask("  Pick a hook (1/2/3): ");
  const idx = parseInt(pick, 10) - 1;
  if (idx >= 0 && idx <= 2) {
    script = { ...script, hook: altHooks[idx] };
    agentCtx.log(`[pipeline] Hook updated: "${script.hook}"`);
  } else {
    console.warn("[pipeline] Invalid selection — keeping original hook.\n");
  }
  return script;
}

// ── Breaking news flow (always 1 video) ──────────────────────────────────────

async function runBreakingNewsPipeline(agentCtx) {
  const ytTasks = agentCtx.youtubeChannelIds.map((id) => fetchYoutubeContent(id));
  const [rssResult, ...ytResults] = await Promise.allSettled([
    fetchRssArticles(agentCtx, 2),
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
      ytCount += ytResult.value.length;
      contentItems.push(...ytResult.value);
    } else {
      console.warn(
        `[pipeline] YouTube ingestion failed for channel ${agentCtx.youtubeChannelIds[i]} (continuing):`,
        ytResult.reason.message,
      );
    }
  }
  if (contentItems.length === 0) throw new Error("[pipeline] No content ingested — aborting");
  agentCtx.log(`[pipeline] Ingested ${contentItems.length} items (${rssCount} RSS, ${ytCount} YouTube)`);

  if (agentCtx.pipelineStopAfter === "ingest") {
    agentCtx.log("\n[pipeline] ── STOP_AFTER=ingest — printing ingested articles ──");
    contentItems.forEach((item, i) => {
      console.log(`\n[${i + 1}] ${item.title}`);
      console.log(`    ${(item.content || "").slice(0, 120).replace(/\n/g, " ")}…`);
      console.log(`    ${item.url}  pubDate=${item.pubDate ?? "unknown"}`);
    });
    agentCtx.log("[pipeline] Done (ingest only).");
    return { contentItems };
  }

  let script;
  let usedSignal = null;
  try {
    const { best: topSignal, score } = await extractSignals(agentCtx, contentItems);
    agentCtx.log(`[pipeline] Top signal: type=${topSignal.metricType} value="${topSignal.value}" finalScore=${score}`);
    script = await generateScriptWithRetry(agentCtx, topSignal);
    usedSignal = topSignal;
  } catch (err) {
    if (err instanceof NoHighSignalError) {
      console.warn(`[pipeline] No high-signal content (${err.message}) — generating overview`);
      script = await generateOverviewScript(agentCtx, contentItems);
    } else {
      throw err;
    }
  }

  return { script, usedSignal, contentItems };
}

// ── Pull one story from Airtable and generate a valid script ──────────────────

async function pullOneStory(agentCtx, excludeIds = []) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = await getNextPendingStory(agentCtx, excludeIds);
    if (!candidate) {
      throw new Error(
        "[pipeline] No pending stories in Airtable. Run ingest first: RUN_INGEST=true node index.js",
      );
    }
    const title = (candidate.fields || {}).Title || candidate.id;
    agentCtx.log(`[pipeline] Pulled story: "${title}"`);
    try {
      const script = await generateScriptFromStoryWithRetry(agentCtx, candidate);
      return { script, storyRecord: candidate };
    } catch (err) {
      console.warn(`[pipeline] Script failed for "${title}" — skipping: ${err.message}`);
      await markStoryUsed(agentCtx, candidate.id);
    }
  }
  throw new Error(`[pipeline] Could not generate a valid script after ${MAX_ATTEMPTS} attempts`);
}

// ── Produce a single video given an approved script ───────────────────────────

async function produceVideo(agentCtx, script, usedSignal, contentItems, videoOutputDir) {
  const spokenText = `${script.hook} ${script.bridge} ${script.insight} ${script.impact} - Follow us for tomorrow morning update.`;

  if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });

  if (agentCtx.pipelineStopAfter === "script") {
    agentCtx.log("[pipeline] Done (script only — audio and video skipped).");
    return { scriptText: spokenText };
  }

  const [voiceResult, bgVideoPaths] = await Promise.all([
    generateVoice(agentCtx, spokenText, videoOutputDir),
    fetchVideos(agentCtx, script, videoOutputDir),
  ]);
  const { voicePath, alignment } = voiceResult;

  if (agentCtx.pipelineStopAfter === "voice") {
    agentCtx.log(`[pipeline] Done (voice only). Voice: ${voicePath}`);
    return { scriptText: spokenText, voicePath };
  }

  const subtitles = renderSubtitles(alignment, videoOutputDir);

  let imagePaths = [];
  if (!bgVideoPaths || bgVideoPaths.length === 0) {
    agentCtx.log("[pipeline] No background video — fetching images as fallback");
    imagePaths = await fetchImages(agentCtx, script, videoOutputDir);
  }

  const videoPath = await composeVideo(voicePath, videoOutputDir, {
    bgVideoPaths,
    imagePaths,
    subtitles,
  });

  const captionText = generateCaption(agentCtx, script, usedSignal, contentItems, videoOutputDir);

  if (agentCtx.autoPostToTikTok && agentCtx.tikTokAccessToken && videoPath) {
    try {
      const tiktokResult = await uploadToTikTok(agentCtx, videoPath, captionText || "");
      agentCtx.log(`[pipeline] TikTok draft created: publish_id=${tiktokResult.publishId}`);
    } catch (err) {
      console.error("[pipeline] TikTok upload failed (non-fatal):", err.message);
    }
  }

  return { scriptText: spokenText, voicePath, videoPath };
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

async function runPipeline(agentCtx) {
  if (!agentCtx) throw new Error("runPipeline requires an agentCtx — use buildCliAgentContext() for CLI runs");

  if (agentCtx.pipelineStopAfter === "ingest" ||
      (agentCtx.pipelineStopAfter && agentCtx.pipelineStopAfter !== "")) {
    agentCtx.log(`[pipeline] PIPELINE_STOP_AFTER=${agentCtx.pipelineStopAfter} — will exit early after this stage`);
  }

  const baseOutputDir = path.resolve(agentCtx.outputDir);
  if (!fs.existsSync(baseOutputDir)) fs.mkdirSync(baseOutputDir, { recursive: true });

  // ── Breaking news: always single video ────────────────────────────────────
  if (agentCtx.isBreakingNews) {
    agentCtx.log("[pipeline] Breaking news mode — fetching fresh data");
    const result = await runBreakingNewsPipeline(agentCtx);
    if (result.contentItems && !result.script) return result; // STOP_AFTER=ingest

    let { script, usedSignal, contentItems } = result;
    agentCtx.log(`[pipeline] Script: hook="${script.hook}"`);

    if (agentCtx.humanInTheLoop) {
      script = await reviewHook(agentCtx, script, "Breaking News", usedSignal);
    } else {
      printScriptSummary(script, "Breaking News", usedSignal);
    }

    const startTime = Date.now();
    const output = await produceVideo(agentCtx, script, usedSignal, contentItems, baseOutputDir);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    agentCtx.log(`[pipeline] Done in ${elapsed}s. Output: ${output.videoPath}`);
    return { script, ...output };
  }

  // ── Normal mode: pull NUMBER_OF_VIDEOS stories, optionally review hooks, produce videos ──
  const count = Math.max(1, agentCtx.numberOfVideos);
  agentCtx.log(`[pipeline] Normal mode — generating ${count} video(s) from Airtable stories`);
  const startTime = Date.now();

  // Phase 1: pull N stories and generate N scripts
  agentCtx.log(`\n[pipeline] ── Phase 1: pulling ${count} stor${count === 1 ? "y" : "ies"} and generating scripts ──`);
  const jobs = [];
  const pulledIds = [];
  for (let i = 0; i < count; i++) {
    agentCtx.log(`[pipeline] Story ${i + 1}/${count}...`);
    const { script, storyRecord } = await pullOneStory(agentCtx, pulledIds);
    pulledIds.push(storyRecord.id);
    jobs.push({ script, storyRecord });
    agentCtx.log(`[pipeline] Script ${i + 1} ready: hook="${script.hook}"`);
  }

  // Phase 2: human reviews all hooks (CLI only; web uses two-job HITL pattern)
  if (agentCtx.humanInTheLoop) {
    agentCtx.log(`\n[pipeline] ── Phase 2: hook review (${count} script${count === 1 ? "" : "s"}) ──`);
    for (let i = 0; i < jobs.length; i++) {
      jobs[i].script = await reviewHook(agentCtx, jobs[i].script, `Video ${i + 1} of ${count}`, null);
    }
  } else {
    for (let i = 0; i < jobs.length; i++) {
      printScriptSummary(jobs[i].script, `Video ${i + 1} of ${count}`, null);
    }
  }

  if (agentCtx.pipelineStopAfter === "script") {
    agentCtx.log("[pipeline] Done (script only — audio and video skipped).");
    return { jobs };
  }

  // Phase 3: produce all videos and mark stories used
  agentCtx.log(`\n[pipeline] ── Phase 3: producing ${count} video${count === 1 ? "" : "s"} ──`);
  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    const { script, storyRecord } = jobs[i];
    const videoOutputDir = count === 1 ? baseOutputDir : path.join(baseOutputDir, `video_${i + 1}`);
    agentCtx.log(`\n[pipeline] Producing video ${i + 1}/${count}...`);

    const output = await produceVideo(agentCtx, script, null, [], videoOutputDir);
    await markStoryUsed(agentCtx, storyRecord.id);
    agentCtx.log(
      `[pipeline] Video ${i + 1} done. Story "${(storyRecord.fields || {}).Title}" marked as Used.`,
    );
    results.push({ script, storyRecord, ...output });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const videoPaths = results.map((r) => r.videoPath).filter(Boolean);
  agentCtx.log(`\n[pipeline] All ${count} video(s) done in ${elapsed}s.`);
  videoPaths.forEach((p, i) => agentCtx.log(`  Video ${i + 1}: ${p}`));

  return results;
}

module.exports = { runPipeline, produceVideo };
