'use strict';

const fs   = require('fs');
const path = require('path');
const ffmpeg = require('../utils/ffmpeg');
const { SUBTITLE_Y } = require('../subtitles/renderer');

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      if (!duration) return reject(new Error('Could not determine audio duration'));
      resolve(parseFloat(duration));
    });
  });
}

// Builds the FFmpeg overlay chain that burns subtitle PNGs onto a video stream.
// Each PNG is shown for exactly its [startTime, endTime] window.
// Returns { filterGraph, inputCount } where inputCount is the number of subtitle
// inputs added (caller must append them after the background inputs).
function buildSubtitleOverlays(subtitles, baseInputIndex, baseStreamLabel) {
  if (!subtitles || subtitles.length === 0) {
    return { filterGraph: '', finalLabel: baseStreamLabel };
  }

  const parts = [];
  let prevLabel = baseStreamLabel;

  subtitles.forEach((sub, i) => {
    const subLabel  = `sub${i}`;
    const outLabel  = i === subtitles.length - 1 ? 'vout' : `ov${i}`;
    const inputIdx  = baseInputIndex + i;
    const start     = sub.startTime.toFixed(3);
    const end       = sub.endTime.toFixed(3);

    parts.push(
      `[${prevLabel}][${inputIdx}:v]overlay=` +
      `x=(W-w)/2:y=${SUBTITLE_Y}:` +
      `enable='between(t,${start},${end})'[${outLabel}]`
    );
    prevLabel = outLabel;
  });

  return { filterGraph: parts.join('; '), finalLabel: 'vout' };
}

// ─── Mode 1: Multiple Pexels video clips concatenated ────────────────────────

const CLIP_MAX_SECONDS = 10;

async function composeWithVideos(bgVideoPaths, voicePath, subtitles, totalDuration, outputPath) {
  // Probe each clip's actual duration
  const clipDurations = await Promise.all(bgVideoPaths.map(getAudioDuration));

  // Build a clip sequence long enough to cover totalDuration (cycle if needed).
  // Each clip is capped at CLIP_MAX_SECONDS so multiple clips always appear.
  const sequence = [];
  let accumulated = 0;
  let i = 0;
  while (accumulated < totalDuration && i < 20) {
    const idx = i % bgVideoPaths.length;
    const effectiveDuration = Math.min(clipDurations[idx], CLIP_MAX_SECONDS);
    sequence.push({ path: bgVideoPaths[idx], effectiveDuration });
    accumulated += effectiveDuration;
    i++;
  }

  console.log(`[ffmpeg] Concatenating ${sequence.length} clip(s) (each ≤${CLIP_MAX_SECONDS}s, ~${accumulated.toFixed(1)}s total) → trimmed to ${totalDuration.toFixed(1)}s`);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    sequence.forEach(c => cmd.input(c.path));
    cmd.input(voicePath);
    (subtitles || []).forEach(sub => cmd.input(sub.imagePath));

    const n = sequence.length;
    const parts = [];

    // Trim each clip to its effective duration, then scale + normalize
    for (let j = 0; j < n; j++) {
      const ed = sequence[j].effectiveDuration.toFixed(3);
      parts.push(
        `[${j}:v]trim=0:${ed},setpts=PTS-STARTPTS,` +
        `scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1,fps=30[v${j}]`
      );
    }

    // Concat all clips into [vcat]
    const concatInputs = sequence.map((_, j) => `[v${j}]`).join('');
    parts.push(`${concatInputs}concat=n=${n}:v=1:a=0[vcat]`);

    const hasSubtitles = subtitles && subtitles.length > 0;
    let filterGraph;
    if (hasSubtitles) {
      const { filterGraph: overlayPart } = buildSubtitleOverlays(subtitles, n + 1, 'vcat');
      filterGraph = `${parts.join('; ')}; ${overlayPart}`;
    } else {
      // Rename [vcat] → [vout] so the map works uniformly
      parts.push(`[vcat]null[vout]`);
      filterGraph = parts.join('; ');
    }

    cmd
      .outputOptions([
        '-filter_complex', filterGraph,
        '-map', '[vout]',
        '-map', `${n}:a`,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-t', String(totalDuration),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-r', '30',
      ])
      .output(outputPath)
      .on('end', () => {
        console.log(`[ffmpeg] Video written to ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('[ffmpeg] Error:', err.message);
        reject(err);
      })
      .run();
  });
}

// ─── Mode 2: Image slideshow with crossfades ──────────────────────────────────

function buildSlideshowFilterGraph(imageCount, segDuration, fadeDuration) {
  const parts = [];

  for (let i = 0; i < imageCount; i++) {
    parts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1[v${i}]`
    );
  }

  if (imageCount === 1) {
    parts.push(`[v0]null[vout]`);
    return parts.join('; ');
  }

  for (let i = 1; i < imageCount; i++) {
    const inputA = i === 1 ? 'v0' : `x${i - 1}`;
    const output = i === imageCount - 1 ? 'vout' : `x${i}`;
    const offset = (i * (segDuration - fadeDuration)).toFixed(3);
    parts.push(
      `[${inputA}][v${i}]xfade=transition=fade:duration=${fadeDuration}:offset=${offset}[${output}]`
    );
  }

  return parts.join('; ');
}

function composeWithImages(imagePaths, voicePath, subtitles, totalDuration, outputPath) {
  const n           = imagePaths.length;
  const fadeDuration = 0.5;
  const segDuration  = (totalDuration + (n - 1) * fadeDuration) / n;

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    imagePaths.forEach(p => cmd.input(p).inputOptions(['-loop', '1', '-t', segDuration.toFixed(3)]));
    cmd.input(voicePath);
    (subtitles || []).forEach(sub => cmd.input(sub.imagePath));

    const hasSubtitles  = subtitles && subtitles.length > 0;
    const slideshowPart = buildSlideshowFilterGraph(n, segDuration, fadeDuration);

    let filterGraph;
    if (hasSubtitles) {
      // Replace final [vout] label in slideshow with [slout] so we can chain overlays
      const slideshowBase = slideshowPart.replace(/\[vout\]$/, '[slout]');
      const { filterGraph: overlayPart } = buildSubtitleOverlays(subtitles, n + 1, 'slout');
      filterGraph = `${slideshowBase}; ${overlayPart}`;
    } else {
      filterGraph = slideshowPart;
    }

    cmd
      .outputOptions([
        '-filter_complex', filterGraph,
        '-map', '[vout]',
        '-map', `${n}:a`,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-shortest',
        '-r', '30',
      ])
      .output(outputPath)
      .on('end', () => {
        console.log(`[ffmpeg] Slideshow written to ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('[ffmpeg] Slideshow error:', err.message);
        reject(err);
      })
      .run();
  });
}

// ─── Mode 3: Solid colour fallback ───────────────────────────────────────────

function createBackgroundPPM(outputDir) {
  const width = 1080, height = 1920;
  const [r, g, b] = [0x1a, 0x1a, 0x2e];
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
  }
  const ppmPath = path.join(outputDir, 'bg.ppm');
  fs.writeFileSync(ppmPath, Buffer.concat([header, pixels]));
  return ppmPath;
}

function composeWithSolidBackground(voicePath, subtitles, totalDuration, outputPath, outputDir) {
  const bgPath = createBackgroundPPM(outputDir);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    cmd.input(bgPath).inputOptions(['-loop', '1']);
    cmd.input(voicePath);
    (subtitles || []).forEach(sub => cmd.input(sub.imagePath));

    const hasSubtitles = subtitles && subtitles.length > 0;

    let filterGraph;
    if (hasSubtitles) {
      const scalePart = `[0:v]scale=1080:1920,setsar=1[scaled]`;
      const { filterGraph: overlayPart } = buildSubtitleOverlays(subtitles, 2, 'scaled');
      filterGraph = `${scalePart}; ${overlayPart}`;
    } else {
      filterGraph = `[0:v]scale=1080:1920,setsar=1[vout]`;
    }

    cmd
      .outputOptions([
        '-filter_complex', filterGraph,
        '-map', '[vout]',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-tune', 'stillimage',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-t', String(totalDuration),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', () => {
        if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
        console.log(`[ffmpeg] Video written to ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
        reject(err);
      })
      .run();
  });
}

// ─── Public entry point ───────────────────────────────────────────────────────

async function composeVideo(voicePath, outputDir, { bgVideoPaths, imagePaths, subtitles } = {}) {
  const duration   = await getAudioDuration(voicePath);
  const outputPath = path.join(outputDir, 'output.mp4');

  if (bgVideoPaths && bgVideoPaths.length > 0) {
    console.log(`[ffmpeg] ${bgVideoPaths.length} video clip(s) + ${(subtitles || []).length} subtitle overlays (${duration.toFixed(1)}s)...`);
    return composeWithVideos(bgVideoPaths, voicePath, subtitles, duration, outputPath);
  }

  if (imagePaths && imagePaths.length > 0) {
    console.log(`[ffmpeg] Image slideshow (${imagePaths.length} images, ${duration.toFixed(1)}s)...`);
    return composeWithImages(imagePaths, voicePath, subtitles, duration, outputPath);
  }

  console.log('[ffmpeg] No media — using solid background');
  return composeWithSolidBackground(voicePath, subtitles, duration, outputPath, outputDir);
}

module.exports = { composeVideo };
