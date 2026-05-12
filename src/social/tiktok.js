"use strict";

const fs = require("fs");
const axios = require("axios");

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const CHUNK_SIZE = 10_000_000; // 10 MB
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh when within 5 min of expiry

async function refreshTikTokToken(agentCtx) {
  const { tikTokRefreshToken, tikTokClientKey, tikTokClientSecret, db, agentId } = agentCtx;

  if (!tikTokRefreshToken)
    throw new Error("[tiktok] No refresh token — paste a Refresh Token in agent Config settings");
  if (!tikTokClientKey || !tikTokClientSecret)
    throw new Error("[tiktok] TikTok Client Key / Client Secret missing from Global Config");

  agentCtx.log("[tiktok] Access token expired or expiring soon — refreshing...");

  const params = new URLSearchParams({
    client_key: tikTokClientKey,
    client_secret: tikTokClientSecret,
    grant_type: "refresh_token",
    refresh_token: tikTokRefreshToken,
  });

  const res = await axios.post(`${TIKTOK_API_BASE}/oauth/token/`, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const { access_token, expires_in, refresh_token } = res.data;
  if (!access_token) throw new Error(`[tiktok] Token refresh failed: ${JSON.stringify(res.data)}`);

  const expiresAt = new Date(Date.now() + expires_in * 1000);

  await db.query(
    `UPDATE agent_settings
     SET tiktok_access_token = $1, tiktok_refresh_token = $2, tiktok_token_expires_at = $3
     WHERE agent_id = $4`,
    [access_token, refresh_token, expiresAt, agentId],
  );

  agentCtx.tikTokAccessToken = access_token;
  agentCtx.tikTokRefreshToken = refresh_token;
  agentCtx.tikTokTokenExpiresAt = expiresAt;

  agentCtx.log(`[tiktok] Token refreshed — expires ${expiresAt.toISOString()}`);
}

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
  // Auto-refresh if token is expired or expiring within 5 minutes
  if (agentCtx.tikTokRefreshToken) {
    const expiresAt = agentCtx.tikTokTokenExpiresAt ? new Date(agentCtx.tikTokTokenExpiresAt) : null;
    if (!expiresAt || expiresAt.getTime() < Date.now() + REFRESH_BUFFER_MS) {
      await refreshTikTokToken(agentCtx);
    }
  }

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
