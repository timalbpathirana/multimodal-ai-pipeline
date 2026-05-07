"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getPool } = require("../db");
const { DEFAULT_PROMPTS } = require("../lib/defaultPrompts");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const VALID_KEYS = Object.keys(DEFAULT_PROMPTS);

async function ownsAgent(pool, agentId, userId) {
  const { rows } = await pool.query("SELECT id FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return rows.length > 0;
}

router.get("/", async (req, res) => {
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query("SELECT prompt_key, content FROM agent_prompts WHERE agent_id = $1", [req.params.id]);
  const dbMap = Object.fromEntries(rows.map((r) => [r.prompt_key, r.content]));
  const result = VALID_KEYS.map((key) => ({
    key,
    content: dbMap[key] || DEFAULT_PROMPTS[key],
    is_default: !dbMap[key],
  }));
  res.json(result);
});

router.get("/:key", async (req, res) => {
  if (!VALID_KEYS.includes(req.params.key)) return res.status(404).json({ error: "Unknown prompt key" });
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    "SELECT content FROM agent_prompts WHERE agent_id = $1 AND prompt_key = $2",
    [req.params.id, req.params.key],
  );
  res.json({
    key: req.params.key,
    content: rows[0]?.content || DEFAULT_PROMPTS[req.params.key],
    is_default: !rows[0],
  });
});

router.put("/:key", async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.includes(key)) return res.status(404).json({ error: "Unknown prompt key" });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "content required" });
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  const { rows } = await pool.query(
    `INSERT INTO agent_prompts (agent_id, prompt_key, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (agent_id, prompt_key) DO UPDATE SET content = $3, updated_at = now()
     RETURNING *`,
    [req.params.id, key, content],
  );
  res.json({ key, content: rows[0].content, is_default: false });
});

router.delete("/:key", async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.includes(key)) return res.status(404).json({ error: "Unknown prompt key" });
  const pool = getPool();
  if (!(await ownsAgent(pool, req.params.id, req.session.userId))) return res.status(404).json({ error: "Agent not found" });
  await pool.query("DELETE FROM agent_prompts WHERE agent_id = $1 AND prompt_key = $2", [req.params.id, key]);
  res.json({ key, content: DEFAULT_PROMPTS[key], is_default: true });
});

module.exports = router;
