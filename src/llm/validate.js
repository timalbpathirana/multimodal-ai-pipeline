"use strict";

const VAGUE_PHRASES = [
  "market is",
  "sentiment is",
  "experts say",
  "it's worth noting",
  "according to",
  "things are",
];

function validateScript(script, opts = {}) {
  const reasons = [];
  const maxHookWords = opts.breakingNews ? 12 : 9;

  const hookWords = (script.hook || "").trim().split(/\s+/);
  if (hookWords.length > maxHookWords) {
    reasons.push(`hook is ${hookWords.length} words (max ${maxHookWords})`);
  }
  if (!opts.breakingNews && !/\d/.test(script.hook || "")) {
    reasons.push("hook contains no number");
  }
  const hookLower = (script.hook || "").toLowerCase();
  for (const phrase of VAGUE_PHRASES) {
    if (hookLower.includes(phrase)) {
      reasons.push(`hook contains vague phrase: "${phrase}"`);
      break;
    }
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
