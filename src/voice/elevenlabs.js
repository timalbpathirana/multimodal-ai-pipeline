'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios  = require('axios');
const ffmpeg = require('../utils/ffmpeg');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

async function generateVoiceElevenLabs(agentCtx, scriptText, outputDir) {
  const voiceId   = agentCtx.elevenLabsVoiceId;
  const voicePath = path.join(outputDir, 'voice.mp3');

  const response = await axios.post(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/with-timestamps`,
    {
      text: scriptText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: {
        'xi-api-key': agentCtx.elevenLabsApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const { audio_base64, alignment } = response.data;
  fs.writeFileSync(voicePath, Buffer.from(audio_base64, 'base64'));
  console.log(`[elevenlabs] Voice written to ${voicePath}`);

  return { voicePath, alignment };
}

function generateVoiceMac(scriptText, outputDir) {
  const aiffPath  = path.join(outputDir, 'voice.aiff');
  const voicePath = path.join(outputDir, 'voice.mp3');

  execSync(`say -v Samantha -o "${aiffPath}" "${scriptText.replace(/"/g, '\\"')}"`);
  execSync(`ffmpeg -y -i "${aiffPath}" -ar 44100 -ab 128k "${voicePath}" 2>/dev/null`);
  fs.unlinkSync(aiffPath);

  console.log(`[tts-mac] Voice written to ${voicePath}`);
  return { voicePath, alignment: null };
}

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(parseFloat(metadata.format.duration));
    });
  });
}

async function estimateAlignment(scriptText, audioPath) {
  const duration = await getAudioDuration(audioPath);
  const chars    = scriptText.split('');
  const total    = chars.length;
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => (i / total) * duration),
    character_end_times_seconds:   chars.map((_, i) => ((i + 1) / total) * duration),
  };
}

async function useDevVoice(scriptText, outputDir) {
  const devPath = path.join(outputDir, 'voice_dev.mp3');
  if (!fs.existsSync(devPath)) {
    console.warn('[voice] DEV_SKIP_TTS=true but voice_dev.mp3 not found — generating normally');
    return null;
  }
  console.log('[voice] DEV_SKIP_TTS=true — using voice_dev.mp3 (ElevenLabs skipped)');
  const alignment = await estimateAlignment(scriptText, devPath);
  return { voicePath: devPath, alignment };
}

async function generateVoice(agentCtx, scriptText, outputDir) {
  if (process.env.DEV_SKIP_TTS === 'true') {
    const devResult = await useDevVoice(scriptText, outputDir);
    if (devResult) return devResult;
  }

  if (!agentCtx.elevenLabsApiKey) {
    console.warn('[voice] No elevenLabsApiKey — using macOS TTS fallback');
    return generateVoiceMac(scriptText, outputDir);
  }

  try {
    return await generateVoiceElevenLabs(agentCtx, scriptText, outputDir);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 200)
      : err.message;
    console.warn(`[elevenlabs] Failed (${status}): ${detail}`);
    console.warn('[voice] Falling back to macOS TTS');
    return generateVoiceMac(scriptText, outputDir);
  }
}

module.exports = { generateVoice };
