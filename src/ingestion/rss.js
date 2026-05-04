'use strict';

const Parser = require('rss-parser');
const { RSS_FEEDS } = require('../../config/feeds');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MelbPropertyAgent/1.0)' },
});

const MAX_AGE_DAYS = 3;

async function fetchRssArticles(maxPerFeed = 2) {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(url => parser.parseURL(url))
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  cutoff.setHours(0, 0, 0, 0);

  const articles = [];
  let discarded = 0;
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[rss] Feed ${RSS_FEEDS[i]} failed:`, result.reason.message);
      return;
    }
    result.value.items.slice(0, maxPerFeed).forEach(item => {
      const pubDate = item.isoDate || null;
      if (!pubDate || new Date(pubDate) < cutoff) {
        console.warn(`[rss] Discarded stale article (pubDate=${pubDate ?? 'missing'}): "${item.title}"`);
        discarded++;
        return;
      }
      articles.push({
        title:   item.title || '',
        content: item.contentSnippet || item.content || item.summary || '',
        url:     item.link || '',
        pubDate,
        source:  'rss',
      });
    });
  });

  console.log(`[rss] Fetched ${articles.length} articles across ${RSS_FEEDS.length} feeds (${discarded} discarded as older than ${MAX_AGE_DAYS} days)`);
  return articles;
}

module.exports = { fetchRssArticles };
