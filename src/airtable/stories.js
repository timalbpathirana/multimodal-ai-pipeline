"use strict";

const { listRecords, createRecords, updateRecord, deleteRecords } = require("./client");

function getMondayISO(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

async function getNextPendingStory(agentCtx, excludeIds = []) {
  const table = agentCtx.airtableTable;
  const exclusions = excludeIds.map((id) => `RECORD_ID() != "${id}"`);
  const filter =
    exclusions.length > 0
      ? `AND({Status} = "Pending", ${exclusions.join(", ")})`
      : `{Status} = "Pending"`;
  const records = await listRecords(agentCtx, table, filter, { field: "WeekOf", direction: "asc" });
  if (records.length === 0) return null;

  records.sort((a, b) => {
    const weekDiff = (a.fields.WeekOf || "").localeCompare(b.fields.WeekOf || "");
    if (weekDiff !== 0) return weekDiff;
    return (a.fields.CreatedAt || "").localeCompare(b.fields.CreatedAt || "");
  });

  return records[0];
}

async function markStoryUsed(agentCtx, recordId) {
  await updateRecord(agentCtx, agentCtx.airtableTable, recordId, {
    Status: "Used",
    UsedAt: new Date().toISOString(),
  });
}

async function archivePendingStories(agentCtx) {
  const table = agentCtx.airtableTable;
  const pending = await listRecords(agentCtx, table, `{Status} = "Pending"`);
  if (pending.length === 0) {
    console.log("[stories] No pending stories to archive");
    return 0;
  }
  for (const record of pending) {
    await updateRecord(agentCtx, table, record.id, { Status: "Archived" });
  }
  console.log(`[stories] Archived ${pending.length} pending stories`);
  return pending.length;
}

async function deleteOldStories(agentCtx, weeksToKeep = 4) {
  const table = agentCtx.airtableTable;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - weeksToKeep * 7);
  const cutoffISO = cutoffDate.toISOString().split("T")[0];

  const old = await listRecords(agentCtx, table, `IS_BEFORE({WeekOf}, "${cutoffISO}")`);
  if (old.length === 0) {
    console.log("[stories] No stories older than 4 weeks to delete");
    return 0;
  }

  const ids = old.map((r) => r.id);
  await deleteRecords(agentCtx, table, ids);
  console.log(`[stories] Permanently deleted ${ids.length} stories older than 4 weeks`);
  return ids.length;
}

async function saveStories(agentCtx, stories, weekOf) {
  const table = agentCtx.airtableTable;
  const week = weekOf || getMondayISO();
  const now = new Date().toISOString();

  const fieldsList = stories.map((s) => ({
    Title: s.title || "",
    Angle: s.angle || "",
    KeyMetrics: s.keyMetrics || "",
    SourceFeeds: Array.isArray(s.sourceFeeds) ? s.sourceFeeds.join(", ") : (s.sourceFeeds || ""),
    SourceData: s.sourceData || "",
    Status: "Pending",
    WeekOf: week,
    CreatedAt: now,
  }));

  const created = await createRecords(agentCtx, table, fieldsList);
  console.log(`[stories] Saved ${created.length} stories to Airtable (WeekOf: ${week})`);
  return created;
}

module.exports = { getNextPendingStory, markStoryUsed, archivePendingStories, deleteOldStories, saveStories };
