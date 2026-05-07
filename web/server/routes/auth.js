"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../db");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  const pool = getPool();
  const result = await pool.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.userId = user.id;
  req.session.email = user.email;
  res.json({ id: user.id, email: user.email });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
  res.json({ id: req.session.userId, email: req.session.email });
});

module.exports = router;
