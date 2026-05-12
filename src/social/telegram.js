"use strict";

const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const TELEGRAM_API = "https://api.telegram.org";

async function sendVideoToTelegram(agentCtx, videoPath, captionText) {
  const { telegramBotToken, telegramChatId, agentName, runId, log } = agentCtx;

  if (!fs.existsSync(videoPath))
    throw new Error(`[telegram] Video not found: ${videoPath}`);

  log(`[telegram] Sending video to Telegram...`);

  // Telegram caption max is 1024 chars
  const rawCaption = captionText || `${agentName} — run ${runId.slice(0, 8)}\nReady to download and upload to TikTok`;
  const caption = rawCaption.length > 1024 ? rawCaption.slice(0, 1021) + "..." : rawCaption;

  log(`[telegram] Caption (${caption.length} chars): "${caption.slice(0, 100).replace(/\n/g, "\\n")}"`);

  const form = new FormData();
  form.append("chat_id", telegramChatId);
  form.append("video", fs.createReadStream(videoPath), { filename: "video.mp4" });
  form.append("caption", caption);
  form.append("supports_streaming", "true");

  const res = await axios.post(
    `${TELEGRAM_API}/bot${telegramBotToken}/sendVideo`,
    form,
    { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity },
  );

  if (!res.data.ok) throw new Error(`[telegram] API error: ${JSON.stringify(res.data)}`);

  log(`[telegram] Sent — message_id=${res.data.result.message_id}`);
  return res.data.result;
}

module.exports = { sendVideoToTelegram };
