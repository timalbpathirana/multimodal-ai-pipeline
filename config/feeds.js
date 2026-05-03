"use strict";

// Melbourne property RSS feeds.
// Add, remove, or reorder entries here — no other files need changing.
const RSS_FEEDS = [
  "https://www.realestate.com.au/news/feed/",
  "https://propertyupdate.com.au/feed/",
  "https://www.smartpropertyinvestment.com.au/news?format=feed&type=rss",
  "https://www.yourinvestmentpropertymag.com.au/feed",
  "https://positiverealestate.com.au/feed/",
  "https://ironfish.com.au/feed/",
  "https://opencorp.com.au/feed/",
  "https://petewargent.blogspot.com/feeds/posts/default?alt=rss",
];

// YouTube channel IDs to ingest (UC... format — NOT the @handle).
// Find in YouTube Studio > Settings > Channel > Advanced Settings.
const VIDEO_FEEDS = [""];

module.exports = { RSS_FEEDS, VIDEO_FEEDS };
