"use strict";

const axios = require("axios");

function getConfig(agentCtx) {
  const apiKey = agentCtx.airtableApiKey;
  const baseId = agentCtx.airtableBaseId;
  if (!apiKey) throw new Error("airtableApiKey is not set on this agent");
  if (!baseId) throw new Error("airtableBaseId is not set on this agent");
  return {
    baseUrl: `https://api.airtable.com/v0/${baseId}`,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
}

async function listRecords(agentCtx, table, filterFormula, sort) {
  const { baseUrl, headers } = getConfig(agentCtx);
  const params = {};
  if (filterFormula) params.filterByFormula = filterFormula;
  if (sort) params["sort[0][field]"] = sort.field, params["sort[0][direction]"] = sort.direction || "asc";

  const records = [];
  let offset;

  do {
    if (offset) params.offset = offset;
    const res = await axios.get(`${baseUrl}/${encodeURIComponent(table)}`, { headers, params, timeout: 15000 });
    records.push(...(res.data.records || []));
    offset = res.data.offset;
  } while (offset);

  return records;
}

async function createRecords(agentCtx, table, fieldsList) {
  const { baseUrl, headers } = getConfig(agentCtx);
  const created = [];

  for (let i = 0; i < fieldsList.length; i += 10) {
    const chunk = fieldsList.slice(i, i + 10).map((fields) => ({ fields }));
    const res = await axios.post(
      `${baseUrl}/${encodeURIComponent(table)}`,
      { records: chunk },
      { headers, timeout: 15000 },
    );
    created.push(...(res.data.records || []));
  }

  return created;
}

async function updateRecord(agentCtx, table, recordId, fields) {
  const { baseUrl, headers } = getConfig(agentCtx);
  const res = await axios.patch(
    `${baseUrl}/${encodeURIComponent(table)}/${recordId}`,
    { fields },
    { headers, timeout: 15000 },
  );
  return res.data;
}

async function deleteRecord(agentCtx, table, recordId) {
  const { baseUrl, headers } = getConfig(agentCtx);
  await axios.delete(`${baseUrl}/${encodeURIComponent(table)}/${recordId}`, { headers, timeout: 15000 });
}

async function deleteRecords(agentCtx, table, recordIds) {
  for (let i = 0; i < recordIds.length; i += 10) {
    const chunk = recordIds.slice(i, i + 10);
    const { baseUrl, headers } = getConfig(agentCtx);
    const params = chunk.reduce((acc, id, idx) => {
      acc[`records[${idx}]`] = id;
      return acc;
    }, {});
    await axios.delete(`${baseUrl}/${encodeURIComponent(table)}`, { headers, params, timeout: 15000 });
  }
}

module.exports = { listRecords, createRecords, updateRecord, deleteRecord, deleteRecords };
