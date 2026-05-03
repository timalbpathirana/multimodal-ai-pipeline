'use strict';

const fs   = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Canvas dimensions — full frame width, tall enough for two lines
const W = 1080;
const H = 220;

// Vertical position: lower third of the 1920px frame
const SUBTITLE_Y = 1920 - H - 120;

// ─── Word timing extraction ───────────────────────────────────────────────────

function extractWords(alignment) {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;

  const words = [];
  let currentWord  = '';
  let wordStart    = null;

  for (let i = 0; i < characters.length; i++) {
    const char      = characters[i];
    const charStart = character_start_times_seconds[i];
    const charEnd   = character_end_times_seconds[i];

    if (char === ' ' || char === '\n') {
      if (currentWord.length > 0) {
        words.push({ word: currentWord, startTime: wordStart, endTime: charStart });
        currentWord = '';
        wordStart   = null;
      }
    } else {
      if (wordStart === null) wordStart = charStart;
      currentWord += char;
    }
  }

  // Flush last word
  if (currentWord.length > 0) {
    const lastEnd = character_end_times_seconds[characters.length - 1];
    words.push({ word: currentWord, startTime: wordStart, endTime: lastEnd });
  }

  return words;
}

// ─── Canvas rendering ─────────────────────────────────────────────────────────

function drawRoundedRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function renderWordPNG(word, destPath) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Transparent base
  ctx.clearRect(0, 0, W, H);

  const text     = word.toUpperCase();
  const fontSize = 96;
  ctx.font       = `900 ${fontSize}px Impact, Arial Black, sans-serif`;

  const metrics   = ctx.measureText(text);
  const textW     = metrics.width;
  const textH     = fontSize;
  const padX      = 40;
  const padY      = 20;
  const boxW      = Math.min(textW + padX * 2, W - 40);
  const boxH      = textH + padY * 2;
  const boxX      = (W - boxW) / 2;
  const boxY      = (H - boxH) / 2;
  const textX     = W / 2;
  const textY     = H / 2 + textH * 0.35; // baseline offset

  // Semi-transparent dark pill background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 18);
  ctx.fill();

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  // Drop shadow
  ctx.shadowColor   = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur    = 12;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  // Thick black stroke
  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = 10;
  ctx.lineJoin    = 'round';
  ctx.strokeText(text, textX, textY);

  // Reset shadow for fill
  ctx.shadowColor   = 'transparent';
  ctx.shadowBlur    = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Yellow fill
  ctx.fillStyle = '#FFD700';
  ctx.fillText(text, textX, textY);

  // Bright white top highlight — makes text pop on any background
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText(text, textX, textY - 2);

  fs.writeFileSync(destPath, canvas.toBuffer('image/png'));
}

// ─── Public entry point ───────────────────────────────────────────────────────

function renderSubtitles(alignment, outputDir) {
  if (!alignment) {
    console.warn('[subtitles] No alignment data — skipping subtitles');
    return [];
  }

  const subsDir = path.join(outputDir, 'subtitles');
  if (!fs.existsSync(subsDir)) fs.mkdirSync(subsDir, { recursive: true });

  const words    = extractWords(alignment);
  const subtitles = [];

  words.forEach((entry, i) => {
    // Skip punctuation-only tokens
    if (!/[a-zA-Z0-9]/.test(entry.word)) return;

    const imgPath = path.join(subsDir, `word_${i}.png`);
    renderWordPNG(entry.word, imgPath);

    subtitles.push({
      imagePath: imgPath,
      startTime: entry.startTime,
      endTime:   entry.endTime,
    });
  });

  console.log(`[subtitles] Rendered ${subtitles.length} word overlays`);
  return subtitles;
}

module.exports = { renderSubtitles, SUBTITLE_Y };
