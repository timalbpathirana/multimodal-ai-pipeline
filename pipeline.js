'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { fetchRssArticles }  = require('./src/ingestion/rss');
const { fetchYoutubeContent } = require('./src/ingestion/youtube');
const { generateScript }    = require('./src/llm/claude');
const { generateVoice }     = require('./src/voice/elevenlabs');
const { fetchVideo, fetchImages } = require('./src/media/pexels');
const { renderSubtitles }   = require('./src/subtitles/renderer');
const { composeVideo }      = require('./src/video/compose');

async function runPipeline() {
  console.log('[pipeline] Starting Melbourne property pipeline...');
  const startTime = Date.now();

  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // ── Step 1: Ingest (RSS + YouTube in parallel) ──────────────────────────────
  const [rssResult, ytResult] = await Promise.allSettled([
    fetchRssArticles(2),
    fetchYoutubeContent(process.env.YOUTUBE_CHANNEL_ID),
  ]);

  const contentItems = [];
  if (rssResult.status === 'fulfilled') {
    contentItems.push(...rssResult.value);
  } else {
    console.error('[pipeline] RSS ingestion failed:', rssResult.reason.message);
  }
  if (ytResult.status === 'fulfilled') {
    contentItems.push(ytResult.value);
  } else {
    console.warn('[pipeline] YouTube ingestion failed (continuing):', ytResult.reason.message);
  }
  if (contentItems.length === 0) throw new Error('[pipeline] No content ingested — aborting');
  console.log(`[pipeline] Ingested ${contentItems.length} content items`);

  // ── Step 2: Generate script ──────────────────────────────────────────────────
  const script = await generateScript(contentItems);
  console.log('[pipeline] Script:', JSON.stringify(script, null, 2));
  const spokenText = `${script.hook} ${script.insight} ${script.impact}`;

  // ── Step 3: Voice (with alignment) + background video — parallel ─────────────
  const [voiceResult, bgVideoPath] = await Promise.all([
    generateVoice(spokenText, outputDir),
    fetchVideo(script, outputDir),
  ]);

  const { voicePath, alignment } = voiceResult;

  // ── Step 4: Render subtitle PNGs from alignment data ─────────────────────────
  const subtitles = renderSubtitles(alignment, outputDir);

  // ── Step 5: Fallback to images if no video was found ─────────────────────────
  let imagePaths = [];
  if (!bgVideoPath) {
    console.log('[pipeline] No background video — fetching images as fallback');
    imagePaths = await fetchImages(script, outputDir);
  }

  // ── Step 6: Compose final video ───────────────────────────────────────────────
  const videoPath = await composeVideo(voicePath, outputDir, {
    bgVideoPath,
    imagePaths,
    subtitles,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[pipeline] Done in ${elapsed}s. Output: ${videoPath}`);

  return { script, scriptText: spokenText, voicePath, videoPath };
}

module.exports = { runPipeline };
