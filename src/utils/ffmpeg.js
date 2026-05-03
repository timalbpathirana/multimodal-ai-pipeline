'use strict';

const fs     = require('fs');
const { execSync } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

// Search order: standard PATH locations → Homebrew Cellar (when brew link wasn't run)
const SEARCH_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
];

function findBinary(name) {
  // 1. Check standard locations
  for (const dir of SEARCH_DIRS) {
    const p = `${dir}/${name}`;
    if (fs.existsSync(p)) return p;
  }

  // 2. Search Homebrew Cellar (handles `brew install` without `brew link`)
  const cellars = ['/usr/local/Cellar/ffmpeg', '/opt/homebrew/Cellar/ffmpeg'];
  for (const cellar of cellars) {
    if (!fs.existsSync(cellar)) continue;
    try {
      const result = execSync(
        `find "${cellar}" -maxdepth 4 -name "${name}" -type f 2>/dev/null | head -1`
      ).toString().trim();
      if (result) return result;
    } catch (_) {}
  }

  return null;
}

const ffmpegPath  = findBinary('ffmpeg');
const ffprobePath = findBinary('ffprobe');

if (!ffmpegPath)  throw new Error('[ffmpeg] Cannot find ffmpeg binary. Run: brew install ffmpeg');
if (!ffprobePath) throw new Error('[ffmpeg] Cannot find ffprobe binary. Run: brew install ffmpeg');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

console.log(`[ffmpeg] Using ${ffmpegPath}`);

module.exports = ffmpeg;
