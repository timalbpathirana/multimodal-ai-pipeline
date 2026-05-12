"use strict";

const VAGUE_PHRASES = [
  "market is",
  "sentiment is",
  "experts say",
  "it's worth noting",
  "according to",
  "things are",
];

const FORBIDDEN_CTA_PHRASES = [
  "buy now",
  "buy today",
  "don't miss out",
  "act fast",
  "jump in",
];

function validateScript(script, opts = {}) {
  const reasons = [];
  const maxHookWords = 15;

  const hookWords = (script.hook || "").trim().split(/\s+/);
  if (hookWords.length > maxHookWords) {
    reasons.push(`hook is ${hookWords.length} words (max ${maxHookWords})`);
  }
  const isEmotionalHook =
    /\?$/.test((script.hook || "").trim()) ||
    /\b(impossible|afford|behind|deposit|rent|priced out|scary|overwhelming|confusing|first home|still possible|locked out)\b/i.test(
      script.hook || "",
    );
  if (!opts.breakingNews && !isEmotionalHook && !/\d/.test(script.hook || "")) {
    reasons.push(
      "hook contains no number (use an emotional/question hook, or include a figure)",
    );
  }
  const hookLower = (script.hook || "").toLowerCase();
  for (const phrase of VAGUE_PHRASES) {
    if (hookLower.includes(phrase)) {
      reasons.push(`hook contains vague phrase: "${phrase}"`);
      break;
    }
  }
  for (const phrase of FORBIDDEN_CTA_PHRASES) {
    if (hookLower.includes(phrase)) {
      reasons.push(
        `hook contains forbidden CTA phrase: "${phrase}" — rephrase to avoid compliance risk`,
      );
      break;
    }
  }

  const totalWords = [script.hook, script.bridge, script.insight, script.impact]
    .filter(Boolean)
    .join(" ")
    .trim()
    .split(/\s+/).length;
  if (totalWords < 100) {
    reasons.push(
      `total script is ${totalWords} words — too short for 60s video (target 130–150)`,
    );
  } else if (totalWords > 160) {
    reasons.push(
      `total script is ${totalWords} words — too long for 60s video (target 130–150)`,
    );
  }

  return { valid: reasons.length === 0, reasons };
}

// Builds a guaranteed-valid hook directly from a signal when both LLM attempts fail.
// Keeps the numeric value in the output.
function constrainHookFromSignal(signal) {
  const sentence = signal.rawSentence || "";
  const numMatch = sentence.match(
    /\d+\.?\d*\s*(%|per cent|basis points|\$[\d,]+[km]?)/i,
  );

  if (!numMatch) {
    // No number extractable — just truncate to 7 words and capitalise
    const words = sentence.split(/\s+/).slice(0, 7);
    return capitalise(words.join(" ").replace(/[.,;:]+$/, ""));
  }

  const numIndex = sentence.indexOf(numMatch[0]);
  const words = sentence.split(/\s+/);
  let numWordIndex = 0;
  let charCount = 0;
  for (let i = 0; i < words.length; i++) {
    charCount += words[i].length + 1;
    if (charCount > numIndex) {
      numWordIndex = i;
      break;
    }
  }

  // Build a 7-word window that includes the number
  const start = Math.max(0, Math.min(numWordIndex - 3, words.length - 7));
  const hook = words
    .slice(start, start + 7)
    .join(" ")
    .replace(/[.,;:]+$/, "");
  return capitalise(hook);
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { validateScript, constrainHookFromSignal };
