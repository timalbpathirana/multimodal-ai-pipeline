'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const PEXELS_BASE = 'https://api.pexels.com';

const CALM_REAL_ESTATE_QUERIES = [
  'Melbourne aerial suburb view',
  'Australian real estate house exterior',
  'Melbourne skyline aerial drone',
  'Australian neighborhood peaceful street',
  'Melbourne waterfront suburb',
  'Australian property garden',
  'Melbourne suburb rooftop view',
  'Australia coastal suburb aerial',
];

const MIN_CLIP_DURATION = 5;

function buildSearchQuery(script) {
  const idx = script.hook.length % CALM_REAL_ESTATE_QUERIES.length;
  return CALM_REAL_ESTATE_QUERIES[idx];
}

async function download(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: { 'User-Agent': 'MelbPropertyAgent/1.0' },
  });
  fs.writeFileSync(destPath, Buffer.from(response.data));
}

function pickBestVideoFile(videoFiles) {
  const portrait = videoFiles.filter(f => f.height > f.width);
  const hd = portrait.find(f => f.width >= 720);
  return hd || portrait[0] || videoFiles[0];
}

async function fetchVideos(agentCtx, script, outputDir, count = 4) {
  const apiKey = agentCtx.pexelsApiKey;
  if (!apiKey) {
    console.warn('[pexels] No pexelsApiKey — skipping video fetch');
    return [];
  }

  const query = buildSearchQuery(script);
  console.log(`[pexels] Searching videos: "${query}"`);

  let videos;
  try {
    const res = await axios.get(`${PEXELS_BASE}/videos/search`, {
      headers: { Authorization: apiKey },
      params: { query, per_page: 15, orientation: 'portrait' },
      timeout: 10000,
    });
    videos = res.data.videos;
  } catch (err) {
    console.warn('[pexels] Video API request failed:', err.message);
    return [];
  }

  if (!videos || videos.length === 0) {
    console.warn('[pexels] No videos found, falling back to images');
    return [];
  }

  const mediaDir = path.join(outputDir, 'media');
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

  const clipPaths = [];
  for (const video of videos) {
    if (clipPaths.length >= count) break;
    if ((video.duration || 0) < MIN_CLIP_DURATION) {
      console.log(`[pexels] Skipping clip (too short: ${video.duration}s)`);
      continue;
    }
    const file = pickBestVideoFile(video.video_files || []);
    if (!file) continue;

    const clipIndex = clipPaths.length;
    const clipPath = path.join(mediaDir, `clip_${clipIndex}.mp4`);
    try {
      console.log(`[pexels] Downloading clip ${clipIndex + 1}/${count} (${file.width}x${file.height}, ${video.duration}s)...`);
      await download(file.link, clipPath);
      clipPaths.push(clipPath);
    } catch (err) {
      console.warn(`[pexels] Clip ${clipIndex + 1} download failed:`, err.message);
    }
  }

  if (clipPaths.length === 0) console.warn('[pexels] All video downloads failed');
  else console.log(`[pexels] Downloaded ${clipPaths.length} clip(s)`);

  return clipPaths;
}

async function fetchImages(agentCtx, script, outputDir) {
  const apiKey = agentCtx.pexelsApiKey;
  if (!apiKey) {
    console.warn('[pexels] No pexelsApiKey — skipping image fetch');
    return [];
  }

  const query = buildSearchQuery(script);
  console.log(`[pexels] Searching images: "${query}"`);

  let photos;
  try {
    const res = await axios.get(`${PEXELS_BASE}/v1/search`, {
      headers: { Authorization: apiKey },
      params: { query, per_page: 4, orientation: 'portrait' },
      timeout: 10000,
    });
    photos = res.data.photos;
  } catch (err) {
    console.warn('[pexels] Image API request failed:', err.message);
    return [];
  }

  if (!photos || photos.length === 0) return [];

  const mediaDir = path.join(outputDir, 'media');
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

  const imagePaths = [];
  for (let i = 0; i < photos.length; i++) {
    const imgPath = path.join(mediaDir, `img_${i}.jpg`);
    try {
      await download(photos[i].src.large2x || photos[i].src.large, imgPath);
      imagePaths.push(imgPath);
    } catch (err) {
      console.warn(`[pexels] Image ${i + 1} download failed:`, err.message);
    }
  }
  return imagePaths;
}

module.exports = { fetchVideos, fetchImages };
