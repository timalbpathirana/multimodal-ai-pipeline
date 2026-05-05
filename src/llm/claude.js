"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { validateScript, constrainHookFromSignal } = require("./validate");

// Anthropic SDK client — uses ANTHROPIC_API_KEY from .env
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const isBreakingNews = process.env.IS_BREAKING_NEWS;

// ─── Model routing ────────────────────────────────────────────────────────────
// Change model assignments here only — nowhere else in this file or signals.js.
const MODEL_CONFIG = {
  ranking: "claude-sonnet-4-6", // Needs best reasoning
  signalScript: "claude-sonnet-4-6", // Quality matters most here
  overview: "claude-haiku-4-5-20251001", // Fine for overview
};

// ─── Legacy system prompts (V1–V4) ───────────────────────────────────────────
// These were used by generateScript(), which predates the signal-extraction pipeline.
// V4 is the last iteration. All four are kept for reference but not called by pipeline.js.

const SYSTEM_PROMPT = `You are a sharp, energetic, empathetic Melbourne property market analyst creating scroll-stopping 15-20 second videos optimised for ElevenLabs voiceover.

Your style: Direct, confident, slightly optimistic opinionated, and spoken like a trusted expert talking to investors. You use simple words to convey the message so elegantly that even a beginner to real estate niche can understand.

Core Rules:
- Total script: Maximum 58 words
- Hook: Maximum 9 words, dramatic and high-energy, attention catching
- Use period marks, exclamation marks and dashes to create punch and natural pauses
- Conversational spoken language only. No corporate jargon at all
- Focus exclusively on Melbourne buyers and investors, first home buyers and government schemes such as 5% scheme

ElevenLabs Optimisation:
- Hook must feel urgent and attention-grabbing
- Add energy with ! and strategic — pauses
- Make it flow naturally when spoken

Respond with valid JSON only:
{
  "hook": "High-energy opening line with ! or strong phrasing.",
  "insight": "Clear delivery of the key data or trend",
  "impact": "Strong closer — what this means for Melbourne buyers/investors right now"
}`;

const SYSTEM_PROMPT_BN = `You are a sharp, energetic, empathetic Melbourne property market analyst creating scroll-stopping 30-35 second videos optimised for ElevenLabs voiceover.

Your style: Direct, confident, slightly optimistic opinionated, and spoken like a trusted expert talking to investors. You use simple words to convey the message so elegantly that even a beginner to real estate niche can understand.

Core Rules:
- Total script: Minimum 75 words, Maximum 85 words
- Hook: Maximum 10–12 words, dramatic and high-energy, attention catching
- Use period marks, exclamation marks and dashes to create punch and natural pauses
- Conversational spoken language only. No corporate jargon at all
- Focus exclusively on Melbourne buyers and investors, first home buyers and government schemes such as 5% scheme

ElevenLabs Optimisation:
- Hook must feel urgent and attention-grabbing
- Add energy with ! and strategic — pauses
- Make it flow naturally when spoken

Respond with valid JSON only:
{
  "hook": "High-energy opening line with ! or strong phrasing.",
  "escalation": "What creates tension before delivering facts",
  "insight": "Clear delivery of the key data or trend in a meaningful way",
  "impact": "Strong closer — what this means for Melbourne buyers/investors right now, explaining in a clear way"
}`;

// ─── Active system prompts ────────────────────────────────────────────────────

// Used by generateScriptFromSignal() — takes a pre-extracted signal object and
// writes a script from it. Strict hook rules: max 8 words, must include the key figure.
const SIGNAL_SYSTEM_PROMPT = `You are a sharp, trusted Melbourne property market expert creating high-impact 15–20 second YouTube Shorts.

Style: Direct, confident, slightly optimistic, conversational, and authoritative. Speak like an experienced buyers agent talking to investors and first-home buyers. Use simple language.

Output **valid JSON only** (no markdown, no extra text):
{
  "hook": "...",
  "insight": "...",
  "impact": "..."
}

STRICT RULES:
- hook: Maximum 9 words. Must include the key figure naturally. Make it dramatic, urgent, and scroll-stopping.
- insight: 1–2 sentences, max 40 words. Deliver full context (what changed, by how much, timeframe, location).
- impact: 1 powerful sentence, max 22 words. Clear actionable takeaway for Melbourne buyers or investors.

CTA & COMPLIANCE RULES (Very Important):
- NEVER use direct investment commands like "Buy now", "Buy today", "Don't miss out", "Act fast", or "Jump in".
- Use soft, safe CTAs only: "worth watching", "worth paying attention to", "creates strong conditions", "many investors are watching", "a market worth understanding", etc.
- Never sound like you are giving personalised financial advice.

SOURCE INTELLIGENCE RULES:
- YouTube sources: Often from buyers agents or market analysts → can be more opinionated and conversational if high quality.
- RSS sources: Usually strong for official statistics (clearance rates, median prices, auction volumes).
- Prioritize the strongest and most recent information regardless of source.
- Trust YouTube transcripts from credible channels more when they provide deeper insight or context.

Additional Guidelines:
- Focus exclusively on Melbourne.
- Use spoken language with natural flow. Use ! and — for energy and pauses.
- No corporate jargon, no filler phrases ("experts say", "market is shifting", "it's worth noting").
- Present tense where possible.
- Make it beginner-friendly but valuable for serious investors.`;

// BREAKING NEWS
const SIGNAL_SYSTEM_PROMPT_BN = `You are a sharp, trusted Melbourne property market expert creating high-impact 30-35 second YouTube Shorts.

Style: Direct, confident, slightly optimistic, conversational, and authoritative. Speak like an experienced buyers agent talking to investors and first-home buyers. Use simple language.

Output **valid JSON only** (no markdown, no extra text):
{
  "hook": "...",
  "escalation":"...",
  "insight": "...",
  "impact": "..."
}

STRICT RULES:
- hook: Maximum 10–12 words. Must feel urgent, dramatic, and signal a major shift. Include key figure only if natural.
- escalation: 1 sentence, 12–18 words. Build tension and explain why this moment matters right now before giving details.
- insight: 2–3 sentences, max 45–60 words total. Clearly explain what changed, by how much, and immediate impact on Melbourne market.
- impact: 1–2 sentences, max 18–28 words. Give a clear, actionable takeaway for Melbourne buyers or investors.

CTA & COMPLIANCE RULES (Very Important):
- NEVER use direct investment commands like "Buy now", "Buy today", "Don't miss out", "Act fast", or "Jump in".
- Use soft, safe CTAs only: "worth watching", "worth paying attention to", "creates strong conditions", "many investors are watching", "a market worth understanding", etc.
- Never sound like you are giving personalised financial advice.

SOURCE INTELLIGENCE RULES:
- YouTube sources: Often from buyers agents or market analysts → can be more opinionated and conversational if high quality.
- RSS sources: Usually strong for official statistics (clearance rates, median prices, auction volumes).
- Prioritize the strongest and most recent information regardless of source.
- Trust YouTube transcripts from credible channels more when they provide deeper insight or context.

Additional Guidelines:
- Focus exclusively on Melbourne.
- Use spoken language with natural flow. Use ! and — for energy and pauses.
- No corporate jargon, no filler phrases ("experts say", "market is shifting", "it's worth noting").
- Present tense where possible.
- Make it beginner-friendly but valuable for serious investors.`;

// Used by generateOverviewScript() — fallback when no strong signal is found.
// Warmer tone, no fabricated stats, summarises the general Melbourne mood.
const OVERVIEW_SYSTEM_PROMPT = `You are an encouraging Melbourne property market commentator.
Today's news has no single standout data point. Write a warm, positive 10–20 second overview covering the general state of the Melbourne market based on the last few days of news.
Your style: Direct, confident, slightly optimistic opinionated, and spoken like a trusted expert talking to investors. You use simple words to convey the message so elegantly that even a beginner to real estate niche can understand.
Output valid JSON only — no markdown fences:
{ "hook": "...", "insight": "...", "impact": "..." }
Rules:
- hook: Maximum 9 words, upbeat and forward-looking (e.g. "Melbourne's market stays resilient this week")
- insight: 1–2 sentences summarising the general mood or theme across sources
- impact: 1 positive, actionable sentence for buyers or investors
- Do NOT fabricate statistics — only reference what is clearly stated in the sources
- Total: 30–60 words`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Logs token usage after each API call (input, output, cache read, cache creation)
function logUsage(label, usage) {
  console.log(
    `[claude] ${label} tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}, ` +
      `cache_read: ${usage.cache_read_input_tokens ?? 0}, cache_creation: ${usage.cache_creation_input_tokens ?? 0}`,
  );
}

// Parses the model's JSON response, stripping any markdown fences the model adds despite instructions
function parseJsonResponse(rawText, label) {
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`${label} returned non-JSON: ${rawText.slice(0, 200)}`);
  }
  const requiredFields = isBreakingNews
    ? ["hook", "escalation", "insight", "impact"]
    : ["hook", "insight", "impact"];
  const missing = requiredFields.filter((f) => !parsed[f]);
  if (missing.length) {
    throw new Error(
      `${label} missing required fields (${missing.join(", ")}): ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

// ─── Legacy: direct content-to-script (not called by pipeline.js) ─────────────
// Kept in case we want a one-shot script without signal extraction.
// Uses claude-sonnet with SYSTEM_PROMPT_V4 and the full raw content items.
async function generateScript(contentItems) {
  // Format each item with its source type tag so the model knows origin (rss vs youtube)
  const userContent = contentItems
    .map(
      (item, i) =>
        `[${i + 1}] [${(item.source || "unknown").toUpperCase()}] ${item.title}\n${item.content}\nSource: ${item.url}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: MODEL_CONFIG.signalScript,
    max_tokens: 512,
    temperature: 0.7,
    system: [
      {
        type: "text",
        text: isBreakingNews ? SYSTEM_PROMPT_BN : SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here are today's Melbourne property news items:\n\n${userContent}\n\nGenerate the script JSON now.`,
      },
    ],

    // Optional but recommended for caching
    extra_headers: {
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
  });

  const rawText = response.content[0].text.trim();

  // Strip markdown code fences if the model adds them despite instructions
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `Claude returned non-JSON response: ${rawText.slice(0, 200)}`,
    );
  }

  if (!parsed.hook || !parsed.insight || !parsed.impact) {
    throw new Error(
      `Claude response missing required fields: ${JSON.stringify(parsed)}`,
    );
  }

  const usage = response.usage;
  console.log(
    `[claude] tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}, ` +
      `cache_read: ${usage.cache_read_input_tokens ?? 0}, cache_creation: ${usage.cache_creation_input_tokens ?? 0}`,
  );

  return parsed;
}

// ─── Phase 2: signal-driven generation ───────────────────────────────────────

// Generates a script from a single pre-ranked signal object.
// opts.stricterHook = true appends a word-count reminder to the prompt on retry attempts.
async function generateScriptFromSignal(signal, opts = {}) {
  // Build the user prompt from structured signal fields so the model has full context
  const userPrompt =
    `Signal to script:\n` +
    `- Metric type: ${signal.metricType}\n` +
    `- Value: ${signal.value}\n` +
    `- Direction: ${signal.direction ?? "unknown"}\n` +
    `- Timeframe: ${signal.timeframe ?? "recent"}\n` +
    `- Geography: ${signal.geography ?? "Melbourne"}\n` +
    `- Source sentence: "${signal.rawSentence}"\n` +
    `- Source article: "${signal.sourceTitle}"\n` +
    `- Source type: ${signal.source || "unknown"}\n\n` +
    `Generate the script JSON now.` +
    (opts.stricterHook
      ? (() => {
          const isDollar = signal.value.startsWith("$");
          const valueHint = isDollar
            ? `a reference to the value ${signal.value} (you may round or abbreviate, e.g. "over ${signal.value}")`
            : `the exact figure ${signal.value}`;
          return `\n\nCONSTRAINT REMINDER: Your hook MUST be ${isBreakingNews ? "12 words or fewer" : "8 words or fewer"} and MUST include ${valueHint}. Do not exceed the word limit. Count words before responding.`;
        })()
      : "");

  const response = await client.messages.create({
    model: MODEL_CONFIG.signalScript,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: isBreakingNews ? SIGNAL_SYSTEM_PROMPT_BN : SIGNAL_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage(
    isBreakingNews ? "signal-gen (breaking news)" : "signal-gen",
    response.usage,
  );
  return parseJsonResponse(
    response.content[0].text.trim(),
    "generateScriptFromSignal",
  );
}

// Calls generateScriptFromSignal up to 2 times, escalating prompt strictness on failure.
// On a second failure, falls back to a deterministically constructed hook from the signal fields.
async function generateScriptWithRetry(signal) {
  const validationOpts = { breakingNews: !!isBreakingNews };

  // Attempt 1 — standard prompt
  const attempt1 = await generateScriptFromSignal(signal);
  const check1 = validateScript(attempt1, validationOpts);
  if (check1.valid) {
    const wordCount = attempt1.hook.trim().split(/\s+/).length;
    console.log(
      `[claude] Hook validation passed (attempt 1): "${attempt1.hook}" (${wordCount} words)`,
    );
    return attempt1;
  }

  console.warn(
    `[claude] Hook validation failed (attempt 1): ${check1.reasons.join("; ")} — retrying with stricter prompt`,
  );

  // Attempt 2 — stricter hook reminder
  const attempt2 = await generateScriptFromSignal(signal, {
    stricterHook: true,
  });
  const check2 = validateScript(attempt2, validationOpts);
  if (check2.valid) {
    const wordCount = attempt2.hook.trim().split(/\s+/).length;
    console.log(
      `[claude] Hook validation passed (attempt 2): "${attempt2.hook}" (${wordCount} words)`,
    );
    return attempt2;
  }

  console.warn(
    `[claude] Hook validation failed (attempt 2): ${check2.reasons.join("; ")} — applying deterministic fallback`,
  );
  const fallbackHook = constrainHookFromSignal(signal);
  console.log(`[claude] Deterministic hook fallback: "${fallbackHook}"`);

  // Fallback: use attempt-2 body but replace hook with a guaranteed-valid one
  return { ...attempt2, hook: fallbackHook };
}

// Fallback script when no strong signal was found — summarises general market mood.
// Receives the full contentItems array (rss + youtube) and uses OVERVIEW_SYSTEM_PROMPT.
async function generateOverviewScript(contentItems) {
  // Format each item with its source type tag so the model knows origin (rss vs youtube)
  const userContent = contentItems
    .map(
      (item, i) =>
        `[${i + 1}] [${(item.source || "unknown").toUpperCase()}] ${item.title}\n${item.content}\nSource: ${item.url}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: MODEL_CONFIG.overview,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: OVERVIEW_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here are today's Melbourne property news items:\n\n${userContent}\n\nGenerate a positive overview script JSON now.`,
      },
    ],
  });

  logUsage("overview", response.usage);
  return parseJsonResponse(
    response.content[0].text.trim(),
    "generateOverviewScript",
  );
}

// Generates 3 alternative hooks for the human-in-the-loop approval flow.
// Called when the user rejects the initial hook.
async function generateAlternativeHooks(signal, currentScript) {
  const maxWords = isBreakingNews ? "10–12" : "8";
  const userPrompt =
    `Signal:\n` +
    `- Metric type: ${signal.metricType}\n` +
    `- Value: ${signal.value}\n` +
    `- Direction: ${signal.direction ?? "unknown"}\n` +
    `- Source sentence: "${signal.rawSentence}"\n\n` +
    `Rejected hook: "${currentScript.hook}"\n\n` +
    `Generate exactly 3 alternative hooks. Each must:\n` +
    `- Be ${maxWords} words or fewer\n` +
    `- Include the key figure naturally\n` +
    `- Take a distinctly different angle or tone from each other\n` +
    `- Be scroll-stopping and urgent\n\n` +
    `Respond with valid JSON only:\n{"hooks": ["hook1", "hook2", "hook3"]}`;

  const response = await client.messages.create({
    model: MODEL_CONFIG.signalScript,
    max_tokens: 256,
    system: [
      {
        type: "text",
        text: isBreakingNews ? SIGNAL_SYSTEM_PROMPT_BN : SIGNAL_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage("alt-hooks", response.usage);
  const raw = response.content[0].text.trim();
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed.hooks) || parsed.hooks.length < 3) {
    throw new Error("generateAlternativeHooks: expected 3 hooks in response");
  }
  return parsed.hooks.slice(0, 3);
}

module.exports = {
  MODEL_CONFIG,
  generateScript,
  generateScriptFromSignal,
  generateScriptWithRetry,
  generateOverviewScript,
  generateAlternativeHooks,
};
