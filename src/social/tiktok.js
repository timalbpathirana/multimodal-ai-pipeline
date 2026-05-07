"use strict";

const fs = require("fs");
const axios = require("axios");

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const CHUNK_SIZE = 10_000_000; // 10 MB

async function uploadChunks(videoPath, uploadUrl, fileSize) {
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const fileHandle = fs.openSync(videoPath, "r");

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize) - 1;
      const chunkSize = end - start + 1;
      const buffer = Buffer.alloc(chunkSize);
      fs.readSync(fileHandle, buffer, 0, chunkSize, start);

      await axios.put(uploadUrl, buffer, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": chunkSize,
        },
      });
    }
  } finally {
    fs.closeSync(fileHandle);
  }
}

async function pollPublishStatus(accessToken, publishId, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
      { publish_id: publishId },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      },
    );
    const { status } = res.data?.data || {};
    if (status === "PUBLISH_COMPLETE" || status === "FAILED") {
      if (status === "FAILED") throw new Error(`TikTok publish failed: ${JSON.stringify(res.data)}`);
      return;
    }
  }
  throw new Error(`TikTok publish status timed out after ${maxAttempts} attempts`);
}

async function uploadToTikTok(agentCtx, videoPath, captionText) {
  const { tikTokAccessToken, tikTokPrivacyLevel } = agentCtx;
  if (!tikTokAccessToken) throw new Error("[tiktok] tikTokAccessToken is required");
  if (!fs.existsSync(videoPath)) throw new Error(`[tiktok] Video file not found: ${videoPath}`);

  const fileSize = fs.statSync(videoPath).size;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  agentCtx.log(`[tiktok] Initializing upload (${(fileSize / 1_000_000).toFixed(1)} MB, ${totalChunks} chunk(s))`);

  // Step 1: Initialize upload
  const initRes = await axios.post(
    `${TIKTOK_API_BASE}/post/publish/video/init/`,
    {
      post_info: {
        title: captionText.slice(0, 2200),
        privacy_level: tikTokPrivacyLevel || "DRAFT_FOR_DIRECT_POST",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fileSize,
        chunk_size: CHUNK_SIZE,
        total_chunk_count: totalChunks,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${tikTokAccessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    },
  );

  const { publish_id, upload_url } = initRes.data?.data || {};
  if (!publish_id || !upload_url) {
    throw new Error(`[tiktok] Init failed: ${JSON.stringify(initRes.data)}`);
  }

  // Step 2: Upload video in chunks
  agentCtx.log(`[tiktok] Uploading chunks... publish_id=${publish_id}`);
  await uploadChunks(videoPath, upload_url, fileSize);

  // Step 3: Poll for processing completion
  agentCtx.log(`[tiktok] Polling publish status...`);
  await pollPublishStatus(tikTokAccessToken, publish_id);

  agentCtx.log(`[tiktok] Upload complete. publish_id=${publish_id}`);
  return { publishId: publish_id };
}

module.exports = { uploadToTikTok };
