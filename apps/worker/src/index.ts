import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool, reapExpiredJobs } from "@longcut/db";
import { HEAVY_JOB_TYPES, JOB_TYPES, type JobType } from "@longcut/shared";
import { config } from "./config";
import { onPermanentFailure } from "./jobs/failures";
import { captionsJob, packageJob } from "./jobs/clipJobs";
import { cleanupJob, previewJob, sweep } from "./jobs/maintenance";
import { analyzeJob, probeJob, processJob } from "./jobs/process";
import { renderJob } from "./jobs/render";
import { errFields, log } from "./log";
import { JobPool, listenForJobs, type JobHandler } from "./runner";

const handlers: Record<JobType, JobHandler> = {
  probe: probeJob,
  process: processJob,
  preview: previewJob,
  analyze: analyzeJob,
  package: packageJob,
  captions: captionsJob,
  render: renderJob,
  cleanup: cleanupJob,
};

const LIGHT_JOB_TYPES = JOB_TYPES.filter((t) => !HEAVY_JOB_TYPES.includes(t));

async function withAdvisoryLock(key: number, fn: () => Promise<void>) {
  const client = await getPool().connect();
  try {
    const res = await client.query("select pg_try_advisory_lock($1) as ok", [key]);
    if (!res.rows[0].ok) return;
    try {
      await fn();
    } finally {
      await client.query("select pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  await fs.mkdir(config.tmpDir, { recursive: true });
  if (process.env.RUN_MIGRATIONS === "true") {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = process.env.MIGRATIONS_DIR || path.resolve(here, "../../../packages/db/migrations");
    // Advisory lock so several worker replicas starting together don't race.
    await withAdvisoryLock(42_000, () => migrate(getDb(), { migrationsFolder }));
    log.info("database migrations applied", { migrationsFolder });
  }
  const roles = (process.env.WORKER_ROLES || "heavy,light").split(",").map((r) => r.trim());
  const pools: JobPool[] = [];
  if (roles.includes("heavy")) pools.push(new JobPool("heavy", HEAVY_JOB_TYPES, config.heavyConcurrency, handlers));
  if (roles.includes("light")) pools.push(new JobPool("light", LIGHT_JOB_TYPES, config.lightConcurrency, handlers));
  pools.forEach((p) => p.start());

  const unlisten = await listenForJobs(() => pools.forEach((p) => p.notify())).catch((err) => {
    log.warn("LISTEN unavailable, relying on polling", errFields(err));
    return async () => undefined;
  });

  // Re-queue jobs whose worker died mid-run; mark entities failed when attempts are exhausted.
  const reaper = setInterval(async () => {
    try {
      for (const job of await reapExpiredJobs()) await onPermanentFailure(job, "TIMEOUT");
    } catch (err) {
      log.error("reaper failed", errFields(err));
    }
  }, 60_000);

  const sweeper = setInterval(
    () => void withAdvisoryLock(42_001, sweep).catch((err) => log.error("sweep failed", errFields(err))),
    config.cleanupIntervalMinutes * 60_000,
  );
  void withAdvisoryLock(42_001, sweep).catch((err) => log.error("sweep failed", errFields(err)));

  // Minimal health endpoint for Railway/Fly/Render health checks.
  const port = Number(process.env.PORT || 0);
  const server = port
    ? http
        .createServer(async (_req, res) => {
          try {
            await getPool().query("select 1");
            res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, worker: config.workerId }));
          } catch {
            res.writeHead(503).end(JSON.stringify({ ok: false }));
          }
        })
        .listen(port, () => log.info("health server listening", { port }))
    : null;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    clearInterval(reaper);
    clearInterval(sweeper);
    server?.close();
    // Give running jobs time to finish; anything unfinished resumes on another worker via its checkpoints.
    await Promise.all(pools.map((p) => p.stop(Number(process.env.WORKER_SHUTDOWN_GRACE_MS || 25_000))));
    await unlisten();
    await getPool().end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  log.info("worker ready", { workerId: config.workerId, roles });
}

main().catch((err) => {
  log.error("worker crashed on startup", errFields(err));
  process.exit(1);
});
