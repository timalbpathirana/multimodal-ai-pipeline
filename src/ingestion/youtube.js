'use strict';

const Parser = require('rss-parser');
const { YoutubeTranscript } = require('youtube-transcript');

const parser = new Parser({
  customFields: { item: [['yt:videoId', 'videoId']] },
  timeout: 10000,
});

const MAX_VIDEOS_PER_CHANNEL = 3;
const MAX_TRANSCRIPT_CHARS = 3000;

async function fetchYoutubeContent(channelId, maxAgeDays = 3) {
  if (!channelId) throw new Error('channelId is required');

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const feed = await parser.parseURL(feedUrl);

  if (!feed.items || feed.items.length === 0) {
    throw new Error(`No videos found for channel ${channelId}`);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  cutoff.setHours(0, 0, 0, 0);

  const recentVideos = feed.items
    .filter(item => {
      const pubDate = item.isoDate || null;
      if (!pubDate || new Date(pubDate) < cutoff) return false;
      return true;
    })
    .slice(0, MAX_VIDEOS_PER_CHANNEL);

  if (recentVideos.length === 0) {
    console.warn(`[youtube] No videos within last ${maxAgeDays} days for channel ${channelId}`);
    return [];
  }

  const results = await Promise.allSettled(
    recentVideos.map(item => fetchTranscriptItem(item))
  );

  const articles = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      articles.push(result.value);
    }
  }

  console.log(`[youtube] Channel ${channelId}: ${articles.length}/${recentVideos.length} recent videos with transcripts`);
  return articles;
}

async function fetchTranscriptItem(item) {
  const videoId = item.videoId;
  const title = item.title || `YouTube video ${videoId}`;
  const pubDate = item.isoDate || null;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    const fullText = transcriptItems.map(t => t.text).join(' ');
    return {
      title,
      content: fullText.slice(0, MAX_TRANSCRIPT_CHARS),
      url,
      pubDate,
      source: 'youtube',
    };
  } catch (err) {
    console.warn(`[youtube] No transcript for "${title}" (${videoId}): ${err.message}`);
    return null;
  }
}

module.exports = { fetchYoutubeContent };
