"use strict";

const Parser = require("rss-parser");

const parser = new Parser({
  timeout: 10000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; MelbPropertyAgent/1.0)" },
});

async function fetchRssArticles(agentCtx, maxPerFeed = 2, maxAgeDays = 4) {
  const feeds = agentCtx.rssFeeds;
  const results = await Promise.allSettled(feeds.map((url) => parser.parseURL(url)));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  cutoff.setHours(0, 0, 0, 0);

  const articles = [];
  let discarded = 0;
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn(`[rss] Feed ${feeds[i]} failed:`, result.reason.message);
      return;
    }
    result.value.items.slice(0, maxPerFeed).forEach((item) => {
      const pubDate = item.isoDate || null;
      if (!pubDate || new Date(pubDate) < cutoff) {
        discarded++;
        return;
      }
      articles.push({
        title: item.title || "",
        content: item.contentSnippet || item.content || item.summary || "",
        url: item.link || "",
        pubDate,
        source: "rss",
      });
    });
  });

  console.log(
    `[rss] Fetched ${articles.length} articles across ${feeds.length} feeds (${discarded} discarded as older than ${maxAgeDays} days)`,
  );
  return articles;
}

module.exports = { fetchRssArticles };
