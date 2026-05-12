"use strict";

const { PgBoss } = require("pg-boss");
const { getPool } = require("../db");
const { buildAgentContext } = require("./agentContext");
const { runIngest } = require("../../../src/ingestion/ingest");
const { runPipeline, produceVideo } = require("../../../pipeline");
const { markStoryUsed } = require("../../../src/airtable/stories");
const { sendVideoToTelegram } = require("../../../src/social/telegram");

let boss = null;

// ── Init / start ──────────────────────────────────────────────────────────────

async function startJobQueue() {
  const connectionString = process.env.DATABASE_URL;
  boss = new PgBoss({ connectionString, max: 2 });

  boss.on("error", (err) => console.error("[jobQueue] pg-boss error:", err));

  await boss.start();
  console.log("[jobQueue] pg-boss started");

  // pg-boss v12: create queues explicitly before registering workers
  for (const name of ["run-ingest", "generate-scripts", "produce-videos"]) {
    await boss.createQueue(name);
    console.log(`[jobQueue] Queue ready: ${name}`);
  }

  await boss.work("run-ingest", { batchSize: 1, localConcurrency: 1 }, handleIngest);
  console.log("[jobQueue] Worker registered: run-ingest");
  await boss.work("generate-scripts", { batchSize: 1, localConcurrency: 1 }, handleGenerateScripts);
  console.log("[jobQueue] Worker registered: generate-scripts");
  await boss.work("produce-videos", { batchSize: 1, localConcurrency: 2 }, handleProduceVideos);
  console.log("[jobQueue] Worker registered: produce-videos");

  // Check for any jobs that were queued before this server started
  const pool = getPool();
  const { rows: stale } = await pool.query(
    `SELECT id, run_mode, status, created_at FROM pipeline_runs
     WHERE status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 5`,
  );
  if (stale.length > 0) {
    console.log(`[jobQueue] Found ${stale.length} stale run(s) from before restart:`);
    stale.forEach((r) => console.log(`  run ${r.id} status=${r.status} mode=${r.run_mode} created=${r.created_at}`));
    console.log("[jobQueue] These may need to be re-triggered or cancelled via the UI.");
  }

  // Each schedule gets its own queue (sched-<uuid> — hyphens are allowed)
  await registerAllSchedules();

  return boss;
}

async function stopJobQueue() {
  if (boss) await boss.stop();
}

// ── Schedule management ───────────────────────────────────────────────────────

async function registerAllSchedules() {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM agent_schedules WHERE is_active = true");
  for (const schedule of rows) {
    await registerSchedule(schedule);
  }
  console.log(`[jobQueue] Registered ${rows.length} active schedule(s)`);
}

async function registerSchedule(schedule) {
  const queueName = `sched-${schedule.id}`;
  await boss.createQueue(queueName);
  await boss.work(queueName, { batchSize: 1, localConcurrency: 1 }, handleScheduledRun);
  await boss.schedule(queueName, schedule.cron_utc, {
    agentId: schedule.agent_id,
    mode: schedule.run_mode,
    scheduleId: schedule.id,
  });
  console.log(`[jobQueue] Scheduled ${queueName} (${schedule.cron_utc}) mode=${schedule.run_mode}`);
}

async function unregisterSchedule(scheduleId) {
  const queueName = `sched-${scheduleId}`;
  await boss.unschedule(queueName);
  console.log(`[jobQueue] Unscheduled ${queueName}`);
}

// ── Ad-hoc enqueuers ──────────────────────────────────────────────────────────

async function enqueueRun(agentId, runId, mode) {
  if (mode === "ingest") {
    await boss.send("run-ingest", { agentId, runId });
  } else {
    // Determine if HITL is needed by reading agent settings
    const pool = getPool();
    const { rows } = await pool.query("SELECT human_in_the_loop FROM agent_settings WHERE agent_id = $1", [agentId]);
    const hitl = rows[0]?.human_in_the_loop || false;
    const jobName = hitl ? "generate-scripts" : "produce-videos";
    await boss.send(jobName, { agentId, runId });
  }
}

async function enqueueProduceVideos(agentId, runId) {
  await boss.send("produce-videos", { agentId, runId });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setRunStatus(pool, runId, status, extra = {}) {
  const fields = ["status = $2"];
  const values = [runId, status];
  let i = 3;
  if (extra.startedAt) { fields.push(`started_at = $${i++}`); values.push(extra.startedAt); }
  if (extra.finishedAt) { fields.push(`finished_at = $${i++}`); values.push(extra.finishedAt); }
  if (extra.outputPaths) { fields.push(`output_paths = $${i++}`); values.push(extra.outputPaths); }
  if (extra.scriptsData !== undefined) { fields.push(`scripts_data = $${i++}`); values.push(JSON.stringify(extra.scriptsData)); }
  await pool.query(`UPDATE pipeline_runs SET ${fields.join(", ")} WHERE id = $1`, values);
}

// ── Job handlers ──────────────────────────────────────────────────────────────

async function handleIngest([job]) {
  const { agentId, runId } = job.data;
  console.log(`[jobQueue] handleIngest picked up: agentId=${agentId} runId=${runId}`);
  const pool = getPool();
  const { rows: runCheck } = await pool.query("SELECT status FROM pipeline_runs WHERE id = $1", [runId]);
  if (runCheck[0]?.status === "failed") {
    console.log(`[jobQueue] run ${runId} was cancelled — skipping`);
    return;
  }
  await setRunStatus(pool, runId, "running", { startedAt: new Date() });
  const ts = new Date().toISOString();
  await pool.query(
    `UPDATE pipeline_runs SET logs = COALESCE(logs, '') || $1 WHERE id = $2`,
    [`[${ts}] Worker picked up ingest job. Starting...\n`, runId],
  );
  try {
    const agentCtx = await buildAgentContext(agentId, runId, pool);
    await runIngest(agentCtx);
    await setRunStatus(pool, runId, "done", { finishedAt: new Date() });
  } catch (err) {
    console.error(`[jobQueue] Ingest failed for run ${runId}:`, err.message);
    await pool.query(
      `UPDATE pipeline_runs SET status = 'failed', finished_at = now(),
       logs = COALESCE(logs, '') || $1 WHERE id = $2`,
      [`\n[ERROR] ${err.message}`, runId],
    );
    throw err; // Let pg-boss mark job failed
  }
}

async function handleGenerateScripts([job]) {
  const { agentId, runId } = job.data;
  console.log(`[jobQueue] handleGenerateScripts picked up: agentId=${agentId} runId=${runId}`);
  const pool = getPool();
  const { rows: runCheck } = await pool.query("SELECT status FROM pipeline_runs WHERE id = $1", [runId]);
  if (runCheck[0]?.status === "failed") {
    console.log(`[jobQueue] run ${runId} was cancelled — skipping`);
    return;
  }
  await setRunStatus(pool, runId, "running", { startedAt: new Date() });
  const ts = new Date().toISOString();
  await pool.query(
    `UPDATE pipeline_runs SET logs = COALESCE(logs, '') || $1 WHERE id = $2`,
    [`[${ts}] Worker picked up generate-scripts job. Starting...\n`, runId],
  );
  try {
    const agentCtx = await buildAgentContext(agentId, runId, pool);
    agentCtx.log("[generate-scripts] HITL mode — generating scripts for review. Full video will be produced after approval.");
    // Run pipeline in script-only mode to get scripts for HITL review
    agentCtx.pipelineStopAfter = "script";
    agentCtx.humanInTheLoop = false; // No readline in web mode
    const result = await runPipeline(agentCtx);

    // result is { jobs: [{script, storyRecord}, ...] } when pipelineStopAfter=script
    const scripts = result.jobs
      ? result.jobs.map((j) => ({ ...j.script, storyId: j.storyRecord.id }))
      : [];

    await setRunStatus(pool, runId, "awaiting_review", { scriptsData: { pending: scripts } });
  } catch (err) {
    console.error(`[jobQueue] generate-scripts failed for run ${runId}:`, err.message);
    await pool.query(
      `UPDATE pipeline_runs SET status = 'failed', finished_at = now(),
       logs = COALESCE(logs, '') || $1 WHERE id = $2`,
      [`\n[ERROR] ${err.message}`, runId],
    );
    throw err;
  }
}

async function handleProduceVideos([job]) {
  const { agentId, runId } = job.data;
  console.log(`[jobQueue] handleProduceVideos picked up: agentId=${agentId} runId=${runId}`);
  const pool = getPool();
  const { rows: runCheck } = await pool.query("SELECT status FROM pipeline_runs WHERE id = $1", [runId]);
  if (runCheck[0]?.status === "failed") {
    console.log(`[jobQueue] run ${runId} was cancelled — skipping`);
    return;
  }
  await setRunStatus(pool, runId, "running", { startedAt: new Date() });
  const ts = new Date().toISOString();
  await pool.query(
    `UPDATE pipeline_runs SET logs = COALESCE(logs, '') || $1 WHERE id = $2`,
    [`[${ts}] Worker picked up produce-videos job. Starting...\n`, runId],
  );
  try {
    const agentCtx = await buildAgentContext(agentId, runId, pool);
    agentCtx.humanInTheLoop = false; // No readline in web mode

    // Check if we have pre-approved scripts from HITL
    const { rows } = await pool.query("SELECT scripts_data FROM pipeline_runs WHERE id = $1", [runId]);
    const scriptsData = rows[0]?.scripts_data;
    const approvedScripts = scriptsData?.approved || null;

    // outputs: [{ videoPath, captionText }]
    let outputs = [];

    if (approvedScripts) {
      // HITL path: produce videos from pre-approved scripts
      const path = require("path");
      const fs = require("fs");
      const baseOutputDir = path.resolve(agentCtx.outputDir);
      fs.mkdirSync(baseOutputDir, { recursive: true });

      for (let i = 0; i < approvedScripts.length; i++) {
        const script = approvedScripts[i];
        const videoOutputDir = approvedScripts.length === 1
          ? baseOutputDir
          : path.join(baseOutputDir, `video_${i + 1}`);
        agentCtx.log(`[produce-videos] Producing video ${i + 1}/${approvedScripts.length}...`);
        const output = await produceVideo(agentCtx, script, null, [], videoOutputDir);
        if (script.storyId) await markStoryUsed(agentCtx, script.storyId);
        agentCtx.log(`[produce-videos] Video ${i + 1} done. Story marked as Used.`);
        if (output.videoPath) outputs.push({ videoPath: output.videoPath, captionText: output.captionText || null });
      }
    } else {
      // Non-HITL path: run full pipeline end-to-end
      const result = await runPipeline(agentCtx);
      const resultArr = Array.isArray(result) ? result : (result?.videoPath ? [result] : []);
      outputs = resultArr.filter((r) => r.videoPath).map((r) => ({ videoPath: r.videoPath, captionText: r.captionText || null }));
    }

    // Telegram delivery — non-fatal, runs for both HITL and non-HITL paths
    if (agentCtx.autoSendToTelegram && agentCtx.telegramBotToken && agentCtx.telegramChatId) {
      for (const { videoPath, captionText } of outputs) {
        agentCtx.log(`[telegram] Queuing send — captionText ${captionText ? `${captionText.length} chars` : "null (will use fallback)"}`);
        try {
          await sendVideoToTelegram(agentCtx, videoPath, captionText);
        } catch (err) {
          agentCtx.log(`[telegram] Send failed (non-fatal): ${err.message}`);
        }
      }
    }

    // Mark run done after all delivery (including Telegram) so UI logs are complete
    await setRunStatus(pool, runId, "done", { finishedAt: new Date(), outputPaths: outputs.map((o) => o.videoPath) });
  } catch (err) {
    console.error(`[jobQueue] produce-videos failed for run ${runId}:`, err.message);
    await pool.query(
      `UPDATE pipeline_runs SET status = 'failed', finished_at = now(),
       logs = COALESCE(logs, '') || $1 WHERE id = $2`,
      [`\n[ERROR] ${err.message}`, runId],
    );
    throw err;
  }
}

async function handleScheduledRun([job]) {
  const { agentId, mode, scheduleId } = job.data;
  const pool = getPool();

  // Skip if a run is already active for this agent
  const { rows: active } = await pool.query(
    "SELECT id FROM pipeline_runs WHERE agent_id = $1 AND status IN ('queued', 'running', 'awaiting_review')",
    [agentId],
  );
  if (active.length > 0) {
    console.log(`[jobQueue] Scheduled run skipped — agent ${agentId} already has an active run`);
    return;
  }

  // Create pipeline_runs row
  const { rows } = await pool.query(
    "INSERT INTO pipeline_runs (agent_id, run_mode) VALUES ($1, $2) RETURNING id",
    [agentId, mode],
  );
  const runId = rows[0].id;

  console.log(`[jobQueue] Scheduled run fired: scheduleId=${scheduleId} agentId=${agentId} mode=${mode} runId=${runId}`);

  // Delegate to the appropriate handler (wrap in array to match pg-boss handler signature)
  if (mode === "ingest") {
    await handleIngest([{ data: { agentId, runId } }]);
  } else {
    // Scheduled runs never have HITL
    await handleProduceVideos([{ data: { agentId, runId } }]);
  }
}

module.exports = {
  startJobQueue,
  stopJobQueue,
  enqueueRun,
  enqueueProduceVideos,
  registerSchedule,
  unregisterSchedule,
};
