'use strict';

const Parser = require('rss-parser');
const { RSS_FEEDS } = require('../../config/feeds');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MelbPropertyAgent/1.0)' },
});

async function fetchRssArticles(maxPerFeed = 2) {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(url => parser.parseURL(url))
  );

  const articles = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[rss] Feed ${RSS_FEEDS[i]} failed:`, result.reason.message);
      return;
    }
    result.value.items.slice(0, maxPerFeed).forEach(item => {
      articles.push({
        title:   item.title || '',
        content: item.contentSnippet || item.content || item.summary || '',
        url:     item.link || '',
        pubDate: item.isoDate || null,
      });
    });
  });

  console.log(`[rss] Fetched ${articles.length} articles across ${RSS_FEEDS.length} feeds`);
  return articles;
}

module.exports = { fetchRssArticles };
