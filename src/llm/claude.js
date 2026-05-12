"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { validateScript, constrainHookFromSignal } = require("./validate");

// Model routing — change assignments here only.
const MODEL_CONFIG = {
  ranking: "claude-sonnet-4-6",
  signalScript: "claude-sonnet-4-6",
  overview: "claude-haiku-4-5-20251001",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const requiredFields = ["hook", "bridge", "insight", "impact"];
  const missing = requiredFields.filter((f) => !parsed[f]);
  if (missing.length) {
    throw new Error(
      `${label} missing required fields (${missing.join(", ")}): ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

// ─── Signal-driven generation ─────────────────────────────────────────────────

async function generateScriptFromSignal(agentCtx, signal, opts = {}) {
  const client = new Anthropic({ apiKey: agentCtx.anthropicApiKey });
  const systemPrompt = agentCtx.isBreakingNews
    ? agentCtx.prompts.signalSystemBn
    : agentCtx.prompts.signalSystem;

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
      ? `\n\nCONSTRAINT REMINDER: Your hook MUST be 15 words or fewer. Count words before responding.`
      : opts.tooShort
      ? `\n\nCONSTRAINT REMINDER: Your script is too short. Expand your insight to at least 70 words and your impact to at least 30 words. Total (hook + bridge + insight + impact) MUST reach 130–150 words. Add more explanation, a real-life consequence, or a concrete example for a first home buyer in the insight field.`
      : "");

  const response = await client.messages.create({
    model: MODEL_CONFIG.signalScript,
    max_tokens: 600,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
    extra_headers: { "anthropic-beta": "prompt-caching-2024-07-31" },
  });

  logUsage(agentCtx.isBreakingNews ? "signal-gen (breaking news)" : "signal-gen", response.usage);
  return parseJsonResponse(response.content[0].text.trim(), "generateScriptFromSignal");
}

async function generateScriptWithRetry(agentCtx, signal) {
  const validationOpts = { breakingNews: !!agentCtx.isBreakingNews };

  const attempt1 = await generateScriptFromSignal(agentCtx, signal);
  const check1 = validateScript(attempt1, validationOpts);
  if (check1.valid) {
    const wordCount = attempt1.hook.trim().split(/\s+/).length;
    console.log(`[claude] Hook validation passed (attempt 1): "${attempt1.hook}" (${wordCount} words)`);
    return attempt1;
  }

  console.warn(`[claude] Hook validation failed (attempt 1): ${check1.reasons.join("; ")} — retrying`);

  const hookFailed = check1.reasons.some((r) => r.includes("hook"));
  const tooShort = check1.reasons.some((r) => r.includes("too short"));
  const attempt2 = await generateScriptFromSignal(agentCtx, signal, {
    stricterHook: hookFailed,
    tooShort: tooShort && !hookFailed,
  });
  const check2 = validateScript(attempt2, validationOpts);
  if (check2.valid) {
    const wordCount = attempt2.hook.trim().split(/\s+/).length;
    console.log(`[claude] Hook validation passed (attempt 2): "${attempt2.hook}" (${wordCount} words)`);
    return attempt2;
  }

  console.warn(`[claude] Hook validation failed (attempt 2): ${check2.reasons.join("; ")} — applying fallback`);

  const hookStillFailed = check2.reasons.some((r) => r.includes("hook"));
  if (hookStillFailed) {
    const fallbackHook = constrainHookFromSignal(signal);
    console.log(`[claude] Deterministic hook fallback: "${fallbackHook}"`);
    return { ...attempt2, hook: fallbackHook };
  }
  return attempt2;
}

async function generateOverviewScript(agentCtx, contentItems) {
  const client = new Anthropic({ apiKey: agentCtx.anthropicApiKey });
  const userContent = contentItems
    .map(
      (item, i) =>
        `[${i + 1}] [${(item.source || "unknown").toUpperCase()}] ${item.title}\n${item.content}\nSource: ${item.url}`,
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: MODEL_CONFIG.overview,
    max_tokens: 512,
    system: [{ type: "text", text: agentCtx.prompts.overviewSystem, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Here are today's Melbourne property news items:\n\n${userContent}\n\nGenerate a positive overview script JSON now.`,
    }],
  });

  logUsage("overview", response.usage);
  return parseJsonResponse(response.content[0].text.trim(), "generateOverviewScript");
}

async function generateAlternativeHooks(agentCtx, signal, currentScript) {
  const client = new Anthropic({ apiKey: agentCtx.anthropicApiKey });
  const systemPrompt = agentCtx.isBreakingNews
    ? agentCtx.prompts.signalSystemBn
    : agentCtx.prompts.signalSystem;

  const userPrompt =
    `Signal:\n` +
    `- Metric type: ${signal.metricType}\n` +
    `- Value: ${signal.value}\n` +
    `- Direction: ${signal.direction ?? "unknown"}\n` +
    `- Source sentence: "${signal.rawSentence}"\n\n` +
    `Rejected hook: "${currentScript.hook}"\n\n` +
    `Generate exactly 3 alternative hooks. Each must:\n` +
    `- Be 15 words or fewer\n` +
    `- Prefer emotional questions or statements that speak to a first home buyer's fear or hope. Include the key figure only if it makes the hook land harder — do not force it.\n` +
    `- Take a distinctly different angle or tone from each other\n` +
    `- Be scroll-stopping and urgent\n\n` +
    `Respond with valid JSON only:\n{"hooks": ["hook1", "hook2", "hook3"]}`;

  const response = await client.messages.create({
    model: MODEL_CONFIG.signalScript,
    max_tokens: 256,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage("alt-hooks", response.usage);
  const raw = response.content[0].text.trim();
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed.hooks) || parsed.hooks.length < 3) {
    throw new Error("generateAlternativeHooks: expected 3 hooks in response");
  }
  return parsed.hooks.slice(0, 3);
}

// ─── Story-driven generation (Airtable backlog mode) ─────────────────────────

async function generateScriptFromStory(agentCtx, story, opts = {}) {
  const client = new Anthropic({ apiKey: agentCtx.anthropicApiKey });
  const fields = story.fields || story;
  const userPrompt =
    `Story to script:\n` +
    `- Title: ${fields.Title || ""}\n` +
    `- Angle: ${fields.Angle || ""}\n` +
    `- Key metrics: ${fields.KeyMetrics || ""}\n` +
    `- Sources: ${fields.SourceFeeds || ""}\n` +
    `- Source excerpts: "${(fields.SourceData || "").slice(0, 600)}"\n\n` +
    `Generate the script JSON now.` +
    (opts.stricterHook
      ? `\n\nCONSTRAINT REMINDER: Your hook MUST be 15 words or fewer. The total script (hook + bridge + insight + impact combined) MUST be 130–150 words. Count words in each field before responding.`
      : "");

  const response = await client.messages.create({
    model: MODEL_CONFIG.signalScript,
    max_tokens: 512,
    system: [{ type: "text", text: agentCtx.prompts.signalSystem, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  logUsage("story-gen", response.usage);

  const rawText = response.content[0].text.trim();
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`generateScriptFromStory returned non-JSON: ${rawText.slice(0, 200)}`);
  }
  const missing = ["hook", "bridge", "insight", "impact"].filter((f) => !parsed[f]);
  if (missing.length) {
    throw new Error(`generateScriptFromStory missing fields (${missing.join(", ")}): ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function generateScriptFromStoryWithRetry(agentCtx, story) {
  const attempt1 = await generateScriptFromStory(agentCtx, story);
  const check1 = validateScript(attempt1, {});
  if (check1.valid) {
    console.log(`[claude] Story hook validation passed (attempt 1): "${attempt1.hook}"`);
    return attempt1;
  }

  console.warn(`[claude] Story hook validation failed (attempt 1): ${check1.reasons.join("; ")} — retrying`);

  const attempt2 = await generateScriptFromStory(agentCtx, story, { stricterHook: true });
  const check2 = validateScript(attempt2, {});
  if (check2.valid) {
    console.log(`[claude] Story hook validation passed (attempt 2): "${attempt2.hook}"`);
    return attempt2;
  }

  console.warn(`[claude] Story hook validation failed (attempt 2): ${check2.reasons.join("; ")} — giving up`);
  throw new Error(
    `Script generation failed for story "${(story.fields || story).Title}": ${check2.reasons.join("; ")}`,
  );
}

module.exports = {
  MODEL_CONFIG,
  generateScriptFromSignal,
  generateScriptWithRetry,
  generateOverviewScript,
  generateAlternativeHooks,
  generateScriptFromStory,
  generateScriptFromStoryWithRetry,
};
