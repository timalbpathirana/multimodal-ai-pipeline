'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Static system prompt — cache_control marks it for prompt caching on repeated runs
const SYSTEM_PROMPT = `You are a sharp, data-driven Melbourne property market analyst creating daily short-form video content.

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

async function generateScript(contentItems) {
  const userContent = contentItems
    .map((item, i) => `[${i + 1}] ${item.title}\n${item.content}\nSource: ${item.url}`)
    .join('\n\n---\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Here are today's Melbourne property news items:\n\n${userContent}\n\nGenerate the script JSON now.`,
      },
    ],
  });

  const rawText = response.content[0].text.trim();

  // Strip markdown code fences if the model adds them despite instructions
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Claude returned non-JSON response: ${rawText.slice(0, 200)}`);
  }

  if (!parsed.hook || !parsed.insight || !parsed.impact) {
    throw new Error(`Claude response missing required fields: ${JSON.stringify(parsed)}`);
  }

  const usage = response.usage;
  console.log(
    `[claude] tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}, ` +
    `cache_read: ${usage.cache_read_input_tokens ?? 0}, cache_creation: ${usage.cache_creation_input_tokens ?? 0}`
  );

  return parsed;
}

module.exports = { generateScript };
