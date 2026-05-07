"use strict";

const fs   = require("fs");
const path = require("path");

const DOMAIN_TO_PUBLICATION = {
  "realestate.com.au":              "realestate.com.au",
  "propertyupdate.com.au":          "Property Update",
  "smartpropertyinvestment.com.au": "Smart Property Investment",
  "yourinvestmentpropertymag.com.au": "Your Investment Property",
  "positiverealestate.com.au":      "Positive Real Estate",
  "ironfish.com.au":                "Ironfish",
  "opencorp.com.au":                "OpenCorp",
  "petewargent.blogspot.com":       "Pete Wargent Blog",
};

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function domainToPublication(domain) {
  for (const [key, name] of Object.entries(DOMAIN_TO_PUBLICATION)) {
    if (domain === key || domain.endsWith("." + key)) return name;
  }
  return null;
}

function resolvePublications(contentItems) {
  const seen  = new Set();
  const names = [];
  for (const item of contentItems) {
    const name = domainToPublication(extractDomain(item.url || ""));
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function generateCaption(agentCtx, script, signal, contentItems, outputDir) {
  let publications = resolvePublications(contentItems);

  if (signal && signal.sourceUrl) {
    const signalPub = domainToPublication(extractDomain(signal.sourceUrl));
    if (signalPub) {
      publications = [signalPub, ...publications.filter((p) => p !== signalPub)];
    }
  }

  const top2 = publications.slice(0, 2);
  const sourceLine =
    top2.length > 0
      ? `Sources: ${top2.join(", ")}, etc...`
      : "Sources: Public Melbourne property news";

  const caption = [
    (script.insight || "").trim(),
    "",
    sourceLine,
    "",
    agentCtx.prompts.disclaimer,
    "",
    agentCtx.prompts.hashtags,
  ].join("\n");

  const captionDir  = path.join(outputDir, "caption");
  const captionPath = path.join(captionDir, "caption.txt");
  fs.mkdirSync(captionDir, { recursive: true });
  fs.writeFileSync(captionPath, caption, "utf8");

  console.log(`[caption] Written to ${captionPath}`);
  return caption;
}

module.exports = { generateCaption };
