"use strict";

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { getPool } = require("../db");

async function seed() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("[seed] ADMIN_EMAIL and ADMIN_PASSWORD must be set");
    process.exit(1);
  }

  const pool = getPool();

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    console.log("[seed] Admin user already exists — skipping");
    await pool.end();
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
    [email, hash],
  );
  console.log(`[seed] Admin user created: ${email} (id=${result.rows[0].id})`);
  await pool.end();
}

seed().catch((err) => {
  console.error("[seed] Error:", err.message);
  process.exit(1);
});
