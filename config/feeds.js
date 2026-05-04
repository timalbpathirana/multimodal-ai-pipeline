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
const VIDEO_FEEDS = [
  "UCo_nWik261ZKSnjgoaIjz0w", //PersonalFinancewithRaviSharma
  "UCB0znyWXxqj2d7Q_yQ6rz_Q", //Luke Wiles (@lukewiles1) – ~103K subscribers
  "UC8MKnM1crMT4g1E4orv2gfg", //Pumped on Property – ~21K subscribers
  "UCndQlfMU5dlCmBQfNabGKxw", //Your Australian Property Buyers Agents
  "UCJvgKvj1XGjO9PylVT_pUsw", //Industry Insider Property (Andrew Date)
  "UCg_RmJmYBRPuTpS2DjITuxg", //Investors Prime Real Estate (Konrad Bobilak)
];

module.exports = { RSS_FEEDS, VIDEO_FEEDS };
