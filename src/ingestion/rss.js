'use strict';

const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MelbPropertyAgent/1.0)' },
});

const RSS_FEEDS = [
  'https://www.abc.net.au/news/feed/51892/rss.xml',
  'https://www.realestate.com.au/news/feed/',
  'https://www.propertyupdate.com.au/feed/',
];

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
        title: item.title || '',
        content: item.contentSnippet || item.content || item.summary || '',
        url: item.link || '',
      });
    });
  });

  return articles;
}

module.exports = { fetchRssArticles };
