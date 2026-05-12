"use strict";

const axios = require("axios");

const SERPER_API_URL = "https://google.serper.dev/news";

function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString();
  const hoursMatch = dateStr.match(/(\d+)\s+hour/i);
  if (hoursMatch) {
    const t = new Date();
    t.setHours(t.getHours() - parseInt(hoursMatch[1], 10));
    return t.toISOString();
  }
  const daysMatch = dateStr.match(/(\d+)\s+day/i);
  if (daysMatch) {
    const t = new Date();
    t.setDate(t.getDate() - parseInt(daysMatch[1], 10));
    return t.toISOString();
  }
  return null;
}

// Default Melbourne property search queries — used when an agent has no custom queries.
const SEARCH_QUERIES = [
  "Melbourne property market clearance rate",
  "Melbourne house prices auction results",
  "Melbourne real estate listings supply demand",
  "Melbourne property investment interest rates RBA",
  "Melbourne housing market stamp duty first home buyer",
];

async function searchWeb(agentCtx, queries, maxResultsPerQuery = 5) {
  const resolvedQueries = queries || agentCtx.searchQueries || SEARCH_QUERIES;
  const apiKey = agentCtx.serperApiKey;
  if (!apiKey) {
    console.warn("[search] serperApiKey not set — skipping web search");
    return [];
  }

  const results = await Promise.allSettled(
    resolvedQueries.map((q) =>
      axios.post(
        SERPER_API_URL,
        { q, num: maxResultsPerQuery },
        {
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          timeout: 10000,
        },
      ),
    ),
  );

  const articles = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      console.warn(`[search] Query "${resolvedQueries[i]}" failed: ${result.reason.message}`);
      continue;
    }
    const newsItems = result.value.data?.news || [];
    for (const item of newsItems) {
      articles.push({
        title: item.title || "",
        content: item.snippet || "",
        url: item.link || "",
        pubDate: item.date ? parseDateSafe(item.date) : null,
        source: "web",
      });
    }
  }

  console.log(`[search] Fetched ${articles.length} web results across ${resolvedQueries.length} queries`);
  return articles;
}

module.exports = { searchWeb, SEARCH_QUERIES };
