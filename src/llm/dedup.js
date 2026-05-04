'use strict';

const fs   = require('fs');
const path = require('path');

const DEDUP_TTL_DAYS    = 3;
const PRUNE_AFTER_DAYS  = 7;
const MS_PER_DAY        = 86_400_000;

const storePath = path.resolve(
  process.env.SIGNAL_STORE_PATH ||
  path.join(process.env.OUTPUT_DIR || './output', 'processed_signals.json')
);

function readStore() {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    // File missing (first run or ephemeral filesystem) — dedup disabled
    console.log('[dedup] Store not found — dedup disabled for this run (ephemeral filesystem)');
    return {};
  }
}

function writeStore(store) {
  try {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[dedup] Could not write store: ${err.message}`);
  }
}

function pruneStore(store) {
  const cutoff = Date.now() - PRUNE_AFTER_DAYS * MS_PER_DAY;
  let pruned = 0;
  for (const key of Object.keys(store)) {
    if (new Date(store[key]).getTime() < cutoff) {
      delete store[key];
      pruned++;
    }
  }
  if (pruned > 0) console.log(`[dedup] Pruned ${pruned} expired entries (older than ${PRUNE_AFTER_DAYS} days)`);
  return store;
}

function makeKey(signal) {
  return `${signal.metricType}:${signal.value.replace(/\s+/g, '').toLowerCase()}`;
}

function isDuplicate(signal) {
  const store = readStore();
  const key = makeKey(signal);
  const seenAt = store[key];
  if (!seenAt) {
    console.log(`[dedup] Checked "${key}" — fresh (not seen before)`);
    return false;
  }
  const ageHours = (Date.now() - new Date(seenAt).getTime()) / 3_600_000;
  if (ageHours > DEDUP_TTL_DAYS * 24) {
    console.log(`[dedup] Checked "${key}" — expired (seen ${ageHours.toFixed(0)}h ago, TTL=${DEDUP_TTL_DAYS * 24}h) — treating as fresh`);
    return false;
  }
  console.warn(`[dedup] Checked "${key}" — duplicate (seen ${ageHours.toFixed(0)}h ago)`);
  return true;
}

function markSeen(signal) {
  let store = readStore();
  store = pruneStore(store);
  const key = makeKey(signal);
  store[key] = new Date().toISOString();
  writeStore(store);
  console.log(`[dedup] Marked as seen: "${key}"`);
}

function clearStore() {
  try {
    fs.writeFileSync(storePath, '{}', 'utf8');
    console.log(`[dedup] Cache cleared: ${storePath}`);
  } catch (err) {
    console.warn(`[dedup] Could not clear store: ${err.message}`);
  }
}

module.exports = { isDuplicate, markSeen, clearStore };
