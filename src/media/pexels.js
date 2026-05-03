'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const PEXELS_BASE = 'https://api.pexels.com';

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','has','have','had','this','that',
  'these','those','will','would','could','should','may','might','must',
  'can','its','it','our','their','your','my','we','they','you','now',
  'just','more','into','from','over','about','after','before','when',
]);

function buildSearchQuery(script) {
  const words = script.hook
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 3);
  return `Melbourne property ${words.join(' ')}`.trim();
}

async function download(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: { 'User-Agent': 'MelbPropertyAgent/1.0' },
  });
  fs.writeFileSync(destPath, Buffer.from(response.data));
}

// ─── Videos ──────────────────────────────────────────────────────────────────

function pickBestVideoFile(videoFiles) {
  // Prefer portrait HD (1080x1920 or similar), fall back to any portrait file
  const portrait = videoFiles.filter(f => f.height > f.width);
  const hd = portrait.find(f => f.width >= 720);
  return hd || portrait[0] || videoFiles[0];
}

async function fetchVideo(script, outputDir) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn('[pexels] No PEXELS_API_KEY — skipping video fetch');
    return null;
  }

  const query = buildSearchQuery(script);
  console.log(`[pexels] Searching videos: "${query}"`);

  let videos;
  try {
    const res = await axios.get(`${PEXELS_BASE}/videos/search`, {
      headers: { Authorization: apiKey },
      params: { query, per_page: 5, orientation: 'portrait' },
      timeout: 10000,
    });
    videos = res.data.videos;
  } catch (err) {
    console.warn('[pexels] Video API request failed:', err.message);
    return null;
  }

  if (!videos || videos.length === 0) {
    console.warn('[pexels] No videos found, falling back to images');
    return null;
  }

  // Pick first video that has a usable file
  for (const video of videos) {
    const file = pickBestVideoFile(video.video_files || []);
    if (!file) continue;

    const mediaDir = path.join(outputDir, 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

    const videoPath = path.join(mediaDir, 'background.mp4');
    try {
      console.log(`[pexels] Downloading video (${file.width}x${file.height}, ${video.duration}s)...`);
      await download(file.link, videoPath);
      console.log(`[pexels] Video saved to ${videoPath}`);
      return videoPath;
    } catch (err) {
      console.warn(`[pexels] Video download failed:`, err.message);
    }
  }

  console.warn('[pexels] All video downloads failed');
  return null;
}

// ─── Images (fallback) ────────────────────────────────────────────────────────

async function fetchImages(script, outputDir) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn('[pexels] No PEXELS_API_KEY — skipping image fetch');
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

module.exports = { fetchVideo, fetchImages };
