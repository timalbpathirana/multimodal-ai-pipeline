"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { isDuplicate } = require("./dedup");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

class NoHighSignalError extends Error {
  constructor(message) {
    super(message);
    this.name = "NoHighSignalError";
  }
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// Catches: "68%", "$850k", "$1.2m", "50 basis points", "3.2 per cent"
const NUMERIC_PATTERN =
  /(\$\d[\d,.]*[km]?\b|\d+\.?\d*\s*(%|per cent|basis points))/i;

// Sentence must contain at least one of these words to be a valid market signal
const SIGNAL_KEYWORD_RE =
  /\b(clearance|prices?|rates?|growth|decline|increase|decrease|supply|listings?|demand|median|auction|yield)\b/i;

const METRIC_KEYWORDS = [
  {
    type: "clearance_rate",
    keywords: [
      "clearance rate",
      "auction clearance",
      "passed in",
      "cleared at auction",
    ],
  },
  {
    type: "price_change",
    keywords: [
      "median price",
      "price growth",
      "price drop",
      "price fell",
      "price rose",
      "fell by",
      "rose by",
      "increased by",
      "decreased by",
      "down by",
      "up by",
      "price change",
    ],
  },
  {
    type: "volume",
    keywords: [
      "listings",
      "new properties",
      "stock on market",
      "new listings",
      "supply rose",
      "supply fell",
      "properties listed",
    ],
  },
  {
    type: "days_on_market",
    keywords: ["days on market", "time to sell", "selling time"],
  },
  {
    type: "interest_rate",
    keywords: [
      "cash rate",
      "interest rate",
      "rba",
      "basis points",
      "rate cut",
      "rate rise",
      "rate hold",
    ],
  },
];

const UP_WORDS =
  /\b(rose|risen|increased|up|higher|surged|jumped|climbed|gained)\b/i;
const DOWN_WORDS =
  /\b(fell|fallen|decreased|down|lower|dropped|slumped|declined|eased)\b/i;

// ── Field extractors ──────────────────────────────────────────────────────────

function detectMetricType(sentence) {
  const lower = sentence.toLowerCase();
  for (const { type, keywords } of METRIC_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }
  return "generic";
}

function detectDirection(sentence) {
  if (UP_WORDS.test(sentence)) return "up";
  if (DOWN_WORDS.test(sentence)) return "down";
  return null;
}

function extractTimeframe(sentence) {
  const patterns = [
    /this week/i,
    /last week/i,
    /this month/i,
    /last month/i,
    /this quarter/i,
    /year.on.year/i,
    /annually/i,
    /in \w+ quarter/i,
  ];
  for (const p of patterns) {
    const m = sentence.match(p);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

function extractGeography(sentence) {
  if (/inner\s+suburb/i.test(sentence)) return "inner Melbourne";
  if (/melbourne/i.test(sentence)) return "Melbourne";
  return null;
}

function toSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Pre-scoring ───────────────────────────────────────────────────────────────

function computePreScore(candidate) {
  let score = 0;
  if (candidate.metricType === "clearance_rate") score += 30;
  if (candidate.metricType === "price_change") score += 25;
  if (candidate.metricType === "interest_rate") score += 20;
  if (candidate.metricType === "volume") score += 15;
  if (candidate.metricType === "days_on_market") score += 10;
  if (candidate.rawSentence.includes("%")) score += 10;
  if (candidate.rawSentence.length < 120) score += 5;
  if (candidate.direction !== null) score += 5;

  // Freshness boost from article publication date
  if (candidate.pubDate) {
    const ageHours =
      (Date.now() - new Date(candidate.pubDate).getTime()) / 3_600_000;
    if (ageHours < 24) score += 15;
    else if (ageHours < 48) score += 10;
    else if (ageHours < 72) score += 5;
  }
  // Secondary: text-based timeframe for YouTube / unknown pubDate
  if (candidate.timeframe && /today|this week/i.test(candidate.timeframe))
    score += 5;

  return score;
}

// ── Candidate extraction ──────────────────────────────────────────────────────

function extractCandidates(contentItems) {
  const candidates = [];

  for (const item of contentItems) {
    const sentences = toSentences(item.content || "");

    for (const sentence of sentences) {
      if (!NUMERIC_PATTERN.test(sentence)) continue;
      if (!SIGNAL_KEYWORD_RE.test(sentence)) continue;

      const match = sentence.match(NUMERIC_PATTERN);
      const candidate = {
        metricType: detectMetricType(sentence),
        value: match[0].trim(),
        direction: detectDirection(sentence),
        timeframe: extractTimeframe(sentence),
        geography: extractGeography(sentence),
        rawSentence: sentence.slice(0, 200),
        sourceTitle: item.title || "",
        sourceUrl: item.url || "",
        pubDate: item.pubDate || null,
        preScore: 0,
      };
      candidate.preScore = computePreScore(candidate);
      candidates.push(candidate);
    }

    // Title fallback: if no sentence-level match, check the title
    if (
      !sentences.some(
        (s) => NUMERIC_PATTERN.test(s) && SIGNAL_KEYWORD_RE.test(s),
      ) &&
      NUMERIC_PATTERN.test(item.title || "") &&
      SIGNAL_KEYWORD_RE.test(item.title || "")
    ) {
      const match = item.title.match(NUMERIC_PATTERN);
      const candidate = {
        metricType: detectMetricType(item.title),
        value: match[0].trim(),
        direction: detectDirection(item.title),
        timeframe: null,
        geography: extractGeography(item.title),
        rawSentence: item.title.slice(0, 200),
        sourceTitle: item.title || "",
        sourceUrl: item.url || "",
        pubDate: item.pubDate || null,
        preScore: 0,
      };
      candidate.preScore = computePreScore(candidate);
      candidates.push(candidate);
    }
  }

  return candidates;
}

// ── LLM ranking ───────────────────────────────────────────────────────────────

const RANK_SYSTEM_PROMPT_V1 = `You are a Melbourne property market signal ranker.
Given extracted numeric signals from today's news (each with a pre-computed heuristic preScore), return the single highest-value signal for a 15-second social video.

Prefer signals in this order:
1. Auction clearance rates (most recognisable metric for Melbourne)
2. Median price changes with a percentage
3. Volume/supply changes with a percentage
4. Days on market changes
5. Interest rate changes
6. Generic percentage figures

Use the preScore as a quality hint — higher preScore candidates are generally better, but apply your own judgment on content relevance and Melbourne specificity.

Return ONLY valid JSON — no markdown fences, no explanation:
{
  "selectedIndex": <0-based integer from the candidates list, or -1 if no signal scores above 40>,
  "score": <integer 0-100, your assessment of signal quality>,
  "reason": "<one sentence>"
}`;

const RANK_SYSTEM_PROMPT_V2 = `You are an expert Melbourne property market signal ranker.

You will be given a list of extracted numeric signals from yesterday's news, each with a pre-computed heuristic preScore.

Your task: Select the SINGLE highest-value signal for a high-impact 15-second Melbourne property video.

Strict preference order (most to least valuable):
1. Melbourne auction clearance rates or auction results
2. Median house/unit price changes (with percentage or dollar figure)
3. Supply/volume/listings changes (with percentage)
4. Days on market or auction passed-in rate changes
5. Interest rate or lending policy impacts on Melbourne
6. Other strong percentage-based metrics

Rules:
- Heavily prioritise Melbourne-specific signals
- Use preScore as a guide only — override if a lower preScore item is significantly more relevant or timely
- Reject weak, vague, or non-Melbourne signals
- Only select a signal if it is strong enough for public video content

Return ONLY valid JSON — no explanation, no markdown:
{
  "selectedIndex": <0-based integer or -1 if no signal scores above 45>,
  "score": <integer 0-100>,
  "reason": "<one short, sharp sentence explaining your choice>"
}`;

async function rankSignals(candidates) {
  const candidateText = candidates
    .map(
      (c, i) =>
        `[${i}] type=${c.metricType} preScore=${c.preScore} value="${c.value}" direction=${c.direction ?? "unknown"} ` +
        `sentence="${c.rawSentence.slice(0, 120)}"`,
    )
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
    system: RANK_SYSTEM_PROMPT_V2,
    messages: [
      {
        role: "user",
        content: `Today's candidates (${candidates.length} total):\n${candidateText}\n\nSelect the best signal for Melbourne property viewers.`,
      },
    ],
  });

  const rawText = response.content[0].text.trim();
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let ranked;
  try {
    ranked = JSON.parse(jsonText);
  } catch {
    throw new Error(
      `Signal ranker returned non-JSON: ${rawText.slice(0, 200)}`,
    );
  }

  const usage = response.usage;
  console.log(
    `[signals] rank tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}`,
  );

  return ranked;
}

// ── Main export ───────────────────────────────────────────────────────────────

async function extractSignals(contentItems) {
  const rawCandidates = extractCandidates(contentItems);
  console.log(
    `[signals] Candidates found: ${rawCandidates.length} (raw numeric + keyword matches)`,
  );

  if (rawCandidates.length === 0) {
    throw new NoHighSignalError("No numeric signals found in today's content");
  }

  // Sort by preScore descending for logging visibility
  const candidates = [...rawCandidates].sort((a, b) => b.preScore - a.preScore);
  const top3 = candidates
    .slice(0, 3)
    .map((c) => `${c.metricType}(${c.preScore})`)
    .join(", ");
  console.log(`[signals] Pre-scores — top candidates: ${top3}`);

  const ranked = await rankSignals(candidates);

  if (ranked.selectedIndex === -1 || ranked.score < 0) {
    throw new NoHighSignalError(
      `Signal ranker found no suitable signal (score=${ranked.score}, reason: ${ranked.reason})`,
    );
  }

  const best = candidates[ranked.selectedIndex];
  const finalScore = ranked.score + best.preScore;
  console.log(
    `[signals] LLM selected index=${ranked.selectedIndex} llmScore=${ranked.score} preScore=${best.preScore} finalScore=${finalScore} reason="${ranked.reason}"`,
  );

  // Combined threshold: llmScore + preScore >= 50
  if (finalScore < 50) {
    throw new NoHighSignalError(
      `Combined score too low: finalScore=${finalScore} (need ≥50)`,
    );
  }

  // Deduplication: try best, then next non-deduped candidates by preScore
  if (!isDuplicate(best)) {
    console.log(
      `[signals] Best signal — type=${best.metricType} value="${best.value}" finalScore=${finalScore}`,
    );
    return {
      best: { ...best, score: finalScore },
      all: candidates,
      score: finalScore,
    };
  }

  console.warn(
    `[signals] Dedup: top signal "${best.metricType}:${best.value}" already seen — trying next candidate`,
  );

  const NEXT_PRESCORE_MIN = 20;
  for (const candidate of candidates) {
    if (candidate === best) continue;
    if (candidate.preScore < NEXT_PRESCORE_MIN) break; // sorted desc, no point continuing
    if (!isDuplicate(candidate)) {
      console.log(
        `[signals] Dedup: next candidate — type=${candidate.metricType} value="${candidate.value}" preScore=${candidate.preScore}`,
      );
      return {
        best: { ...candidate, score: candidate.preScore },
        all: candidates,
        score: candidate.preScore,
      };
    }
  }

  console.warn(
    "[signals] Dedup: all strong candidates already seen — falling back to overview",
  );
  throw new NoHighSignalError("All strong signals already used recently");
}

module.exports = { extractSignals, NoHighSignalError };
