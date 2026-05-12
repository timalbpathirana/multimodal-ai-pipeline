"use strict";

const { fetchRssArticles } = require("./rss");
const { fetchYoutubeContent } = require("./youtube");
const { searchWeb } = require("./search");
const { generateStoriesFromContent } = require("../llm/signals");
const {
  archivePendingStories,
  deleteOldStories,
  saveStories,
} = require("../airtable/stories");

async function runIngest(agentCtx) {
  const lookbackDays = agentCtx.ingestLookbackDays;
  const storiesCount = agentCtx.storiesPerWeek;

  const divider = "─".repeat(60);
  agentCtx.log(`\n${divider}`);
  agentCtx.log("  INGEST MODE");
  agentCtx.log(divider);
  agentCtx.log(`  Fetching ${lookbackDays} days of RSS, YouTube, and web data`);
  agentCtx.log(`  Generating ${storiesCount} stories using Claude`);
  agentCtx.log(divider);

  agentCtx.log("[ingest] Starting ingest...");
  const startTime = Date.now();

  // Fetch all data sources in parallel
  const ytTasks = agentCtx.youtubeChannelIds.map((id) =>
    fetchYoutubeContent(id, lookbackDays),
  );
  const [rssResult, webResult, ...ytResults] = await Promise.allSettled([
    fetchRssArticles(agentCtx, 3, lookbackDays),
    searchWeb(agentCtx),
    ...ytTasks,
  ]);

  const contentItems = [];
  let rssCount = 0;
  let ytCount = 0;
  let webCount = 0;

  if (rssResult.status === "fulfilled") {
    rssCount = rssResult.value.length;
    contentItems.push(...rssResult.value);
  } else {
    console.error("[ingest] RSS ingestion failed:", rssResult.reason.message);
  }

  if (webResult.status === "fulfilled") {
    webCount = webResult.value.length;
    contentItems.push(...webResult.value);
  } else {
    console.error("[ingest] Web search failed:", webResult.reason.message);
  }

  for (const [i, ytResult] of ytResults.entries()) {
    if (ytResult.status === "fulfilled") {
      ytCount += ytResult.value.length;
      contentItems.push(...ytResult.value);
    } else {
      console.warn(
        `[ingest] YouTube ingestion failed for channel ${agentCtx.youtubeChannelIds[i]}: ${ytResult.reason.message}`,
      );
    }
  }

  agentCtx.log(
    `[ingest] Collected ${contentItems.length} items total (RSS: ${rssCount}, YouTube: ${ytCount}, Web: ${webCount})`,
  );

  if (contentItems.length === 0) {
    throw new Error("[ingest] No content collected — aborting");
  }

  agentCtx.log(
    `[ingest] Sending content to Claude to generate ${storiesCount} stories...`,
  );
  const stories = await generateStoriesFromContent(
    agentCtx,
    contentItems,
    storiesCount,
  );

  const archived = await archivePendingStories(agentCtx);
  const deleted = await deleteOldStories(agentCtx, 4);
  await saveStories(agentCtx, stories);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  agentCtx.log(`\n${divider}`);
  agentCtx.log("  INGEST COMPLETE");
  agentCtx.log(divider);
  agentCtx.log(`  Stories generated : ${stories.length}`);
  agentCtx.log(`  Stories archived  : ${archived}`);
  agentCtx.log(`  Stories deleted   : ${deleted}`);
  agentCtx.log(`  Elapsed           : ${elapsed}s`);
  agentCtx.log(divider);

  return { stories: stories.length, archived, deleted };
}

module.exports = { runIngest };
