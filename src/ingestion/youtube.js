'use strict';

const Parser = require('rss-parser');
const { YoutubeTranscript } = require('youtube-transcript');

// rss-parser with custom field mapping for YouTube's yt:videoId namespace element
const parser = new Parser({
  customFields: { item: [['yt:videoId', 'videoId']] },
  timeout: 10000,
});

async function getLatestVideoId(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const feed = await parser.parseURL(feedUrl);

  if (!feed.items || feed.items.length === 0) {
    throw new Error(`No videos found for channel ${channelId}`);
  }

  return feed.items[0].videoId;
}

async function fetchYoutubeContent(channelId) {
  if (!channelId) {
    throw new Error('YOUTUBE_CHANNEL_ID is not set');
  }

  const videoId = await getLatestVideoId(channelId);
  console.log(`[youtube] Fetching transcript for video: ${videoId}`);

  const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
  const fullText = transcriptItems.map(t => t.text).join(' ');

  return {
    title: `YouTube: latest video from channel ${channelId}`,
    content: fullText.slice(0, 3000),
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

module.exports = { fetchYoutubeContent };
