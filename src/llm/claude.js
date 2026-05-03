"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { validateScript, constrainHookFromSignal } = require("./validate");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Static system prompt — cache_control marks it for prompt caching on repeated runs
const SYSTEM_PROMPT_V1 = `You are a sharp, data-driven Melbourne property market analyst creating daily short-form video content.

Your job is to scan multiple news sources and extract the single most important insight for property buyers and investors in Melbourne right now.

Rules:
- Choose ONE insight with a clear numeric or statistical hook if possible
- The combined script must be speakable in 10-20 seconds (approximately 30-60 words total across all three fields)
- Avoid filler phrases like "it's worth noting", "experts say", or "according to reports"
- Be direct, confident, and slightly opinionated
- Focus specifically on Melbourne — not national trends unless directly relevant
- Prefer insights about: price movements, auction clearance rates, supply/demand shifts, interest rate implications, or suburb-specific data

You MUST respond with valid JSON only — no markdown fences, no extra text, no explanation:
{
  "hook": "...",
  "insight": "...",
  "impact": "..."
}

Where:
- hook: 1 attention-grabbing opening sentence (what is happening right now)
- insight: 1-2 sentences with the core data point or trend
- impact: 1 sentence on what this means for Melbourne buyers or investors`;

const SYSTEM_PROMPT_V2 = `You are a sharp, data-driven Melbourne property market analyst creating high-engagement daily short-form video content for ElevenLabs voiceover.

Task: Turn the best signal into a compelling 10-20 second video script.

Rules:
- Choose ONE strong, timely insight focused on Melbourne
- Total script must be speakable in 10-20 seconds (maximum 55 words)
- Use direct, confident, and slightly opinionated tone
- No filler words: Avoid "it's worth noting", "according to reports", "experts say", etc.
- Make the hook curiosity-driven or emotionally charged
- Focus only on Melbourne (ignore pure national stories unless directly relevant)

ElevenLabs TTS Optimisation:
- Hook must be short, sharp, and dramatic (8-14 words)
- Use exclamation marks ! and dashes — for energy and natural pauses
- Add ... sparingly for dramatic effect
- Make the language conversational and speakable
- Prioritise punchy delivery on the hook

You MUST respond with valid JSON only:
{
  "hook": "One punchy, dramatic opening sentence with strong energy",
  "insight": "1-2 sentences delivering the core data or trend",
  "impact": "One sentence explaining what this means for Melbourne buyers or investors right now"
}`;

const SYSTEM_PROMPT_V3 = `You are a sharp Melbourne property market analyst creating high-impact 10-20 second videos optimised for ElevenLabs voiceover.

Task: Convert the best signal into a punchy, energetic short script.

Strict Rules:
- Total length: Maximum 52 words
- Hook must be dramatic, short (8-14 words) and use exclamation marks or strong phrasing
- Use dashes — and exclamation marks ! to create energy and natural pauses
- Conversational spoken language only
- No corporate filler. Be direct and slightly opinionated
- Focus exclusively on Melbourne

ElevenLabs Style:
- Hook = Attention-grabbing and energetic
- Insight = Deliver the key number or fact clearly
- Impact = Strong closer with implication for buyers/investors

You MUST respond with valid JSON only:
{
  "hook": "Dramatic opening sentence with ! or strong energy",
  "insight": "Core data or trend with natural flow",
  "impact": "What it means for Melbourne buyers or investors"
}`;

const SYSTEM_PROMPT_V4 = `You are a sharp, energetic Melbourne property market analyst creating scroll-stopping 10-20 second videos optimised for ElevenLabs voiceover.

Your style: Direct, confident, slightly opinionated, and spoken like a trusted expert talking to investors.

Core Rules:
- Total script: Maximum 52 words
- Hook: 8-14 words, dramatic and high-energy
- Use exclamation marks ! and dashes — to create punch and natural pauses
- Conversational spoken language only. No corporate jargon
- Focus exclusively on Melbourne buyers and investors

ElevenLabs Optimisation:
- Hook must feel urgent and attention-grabbing
- Add energy with ! and strategic — pauses
- Make it flow naturally when spoken

Respond with valid JSON only:
{
  "hook": "High-energy opening line with ! or strong phrasing",
  "insight": "Clear delivery of the key data or trend",
  "impact": "Strong closer — what this means for Melbourne buyers/investors right now"
}`;

async function generateScript(contentItems) {
  const userContent = contentItems
    .map(
      (item, i) =>
        `[${i + 1}] ${item.title}\n${item.content}\nSource: ${item.url}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    temperature: 0.7,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT_V4,
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

const SIGNAL_SYSTEM_PROMPT = `You are a sharp, data-driven Melbourne property market analyst creating daily short-form video content.
Given a specific market signal already extracted from today's news, write a 10–20 second spoken script.

Output valid JSON only — no markdown fences:
{ "hook": "...", "insight": "...", "impact": "..." }

Field rules (STRICTLY ENFORCED):
hook:
  - Maximum 8 words
  - MUST reference the key figure:
      For percentages and rates (e.g. 68%, 3.2%): include the exact number
      For dollar amounts (e.g. $850k, $1.2m): you may round or abbreviate, but a number MUST still appear (e.g. "over $850k", "near $1m")
  - Present tense, scroll-stopping
  - GOOD examples: "Auction rates just dropped to 68%", "Melbourne prices up 3.2% this month", "Medians cross $1m in inner suburbs"
  - BAD examples: "The Melbourne market is showing signs of change", "Experts are now suggesting a shift"
  - NO filler: "market is shifting", "sentiment is changing", "it's worth noting", "experts say"

insight: 1–2 sentences, max 40 words, Melbourne-specific, includes the full statistic with context (what changed, from where to where, over what timeframe)
impact: 1 sentence, max 20 words, direct takeaway for buyers OR investors — pick one
Total word count across all three fields: 30–60 words`;

const OVERVIEW_SYSTEM_PROMPT = `You are an encouraging Melbourne property market commentator.
Today's news has no single standout data point. Write a warm, positive 10–20 second overview covering the general state of the Melbourne market based on the last few days of news.

Output valid JSON only — no markdown fences:
{ "hook": "...", "insight": "...", "impact": "..." }

Rules:
- hook: max 10 words, upbeat and forward-looking (e.g. "Melbourne's market stays resilient this week")
- insight: 1–2 sentences summarising the general mood or theme across sources
- impact: 1 positive, actionable sentence for buyers or investors
- Do NOT fabricate statistics — only reference what is clearly stated in the sources
- Total: 30–60 words`;

function logUsage(label, usage) {
  console.log(
    `[claude] ${label} tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}, ` +
      `cache_read: ${usage.cache_read_input_tokens ?? 0}, cache_creation: ${usage.cache_creation_input_tokens ?? 0}`,
  );
}

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
  if (!parsed.hook || !parsed.insight || !parsed.impact) {
    throw new Error(
      `${label} missing required fields: ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

async function generateScriptFromSignal(signal, opts = {}) {
  const userPrompt =
    `Signal to script:\n` +
    `- Metric type: ${signal.metricType}\n` +
    `- Value: ${signal.value}\n` +
    `- Direction: ${signal.direction ?? "unknown"}\n` +
    `- Timeframe: ${signal.timeframe ?? "recent"}\n` +
    `- Geography: ${signal.geography ?? "Melbourne"}\n` +
    `- Source sentence: "${signal.rawSentence}"\n` +
    `- Source article: "${signal.sourceTitle}"\n\n` +
    `Generate the script JSON now.` +
    (opts.stricterHook
      ? (() => {
          const isDollar = signal.value.startsWith("$");
          const valueHint = isDollar
            ? `a reference to the value ${signal.value} (you may round or abbreviate, e.g. "over ${signal.value}")`
            : `the exact figure ${signal.value}`;
          return `\n\nCONSTRAINT REMINDER: Your hook MUST be 8 words or fewer and MUST contain ${valueHint}. Count the words before responding.`;
        })()
      : "");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: SIGNAL_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage("signal-gen", response.usage);
  return parseJsonResponse(
    response.content[0].text.trim(),
    "generateScriptFromSignal",
  );
}

async function generateScriptWithRetry(signal) {
  // Attempt 1 — standard prompt
  const attempt1 = await generateScriptFromSignal(signal);
  const check1 = validateScript(attempt1);
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
  const check2 = validateScript(attempt2);
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

async function generateOverviewScript(contentItems) {
  const userContent = contentItems
    .map(
      (item, i) =>
        `[${i + 1}] ${item.title}\n${item.content}\nSource: ${item.url}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
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

module.exports = {
  generateScript,
  generateScriptFromSignal,
  generateScriptWithRetry,
  generateOverviewScript,
};
