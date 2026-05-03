'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PEXELS_BASE = 'https://api.pexels.com/v1';
const IMAGE_COUNT = 4;

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

async function downloadImage(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: { 'User-Agent': 'MelbPropertyAgent/1.0' },
  });
  fs.writeFileSync(destPath, Buffer.from(response.data));
}

async function fetchImages(script, outputDir) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn('[pexels] No PEXELS_API_KEY set — skipping image fetch');
    return [];
  }

  const query = buildSearchQuery(script);
  console.log(`[pexels] Searching: "${query}"`);

  let photos;
  try {
    const response = await axios.get(`${PEXELS_BASE}/search`, {
      headers: { Authorization: apiKey },
      params: { query, per_page: IMAGE_COUNT, orientation: 'portrait' },
      timeout: 10000,
    });
    photos = response.data.photos;
  } catch (err) {
    console.warn('[pexels] API request failed:', err.message);
    return [];
  }

  if (!photos || photos.length === 0) {
    console.warn('[pexels] No images found for query:', query);
    return [];
  }

  const imagesDir = path.join(outputDir, 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const imagePaths = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const imgUrl = photo.src.large2x || photo.src.large;
    const imgPath = path.join(imagesDir, `img_${i}.jpg`);
    try {
      await downloadImage(imgUrl, imgPath);
      console.log(`[pexels] Image ${i + 1}/${photos.length}: "${photo.alt || 'untitled'}" by ${photo.photographer}`);
      imagePaths.push(imgPath);
    } catch (err) {
      console.warn(`[pexels] Failed to download image ${i + 1}:`, err.message);
    }
  }

  return imagePaths;
}

module.exports = { fetchImages };
