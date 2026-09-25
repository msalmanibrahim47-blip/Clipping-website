import { NextResponse } from "next/server";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getPool } from "@longcut/db";
import { s3, storageConfig } from "@longcut/services";
import { envReport } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Deployment health check: configuration, database + migrations, storage access and worker
 * liveness. Reports booleans and counts only — never secret values.
 */
export async function GET() {
  const env = envReport();
  const checks: Record<string, { ok: boolean; detail?: string }> = {
    env: { ok: env.missing.length === 0 && env.problems.length === 0, detail: [...env.missing.map((k) => `missing ${k}`), ...env.problems].join("; ") || undefined },
  };

  let worker: { queued: number; running: number; oldestQueuedSeconds: number | null; lastActivitySeconds: number | null } | null = null;
  try {
    const { rows } = await getPool().query(`
      select count(*) filter (where status = 'queued' and run_at <= now())::int as queued,
             count(*) filter (where status = 'running')::int as running,
             extract(epoch from now() - min(run_at) filter (where status = 'queued' and run_at <= now()))::int as oldest,
             extract(epoch from now() - max(updated_at) filter (where status in ('running','completed','failed')))::int as last
        from jobs`);
    worker = { queued: rows[0].queued, running: rows[0].running, oldestQueuedSeconds: rows[0].oldest, lastActivitySeconds: rows[0].last };
    checks.database = { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    checks.database = { ok: false, detail: /relation .* does not exist/.test(msg) ? "tables missing — run migrations" : "cannot connect" };
  }

  try {
    await s3().send(new HeadBucketCommand({ Bucket: storageConfig().bucket }));
    checks.storage = { ok: true };
  } catch (err) {
    checks.storage = { ok: false, detail: (err as Error).message.includes("STORAGE_BUCKET") ? "not configured" : "bucket not reachable with these credentials" };
  }

  // A queued job nobody has claimed for 3+ minutes means no worker is running.
  checks.worker = {
    ok: !worker || worker.oldestQueuedSeconds == null || worker.oldestQueuedSeconds < 180,
    detail: worker && worker.oldestQueuedSeconds != null && worker.oldestQueuedSeconds >= 180 ? "jobs are waiting — is the worker service running?" : undefined,
  };

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks, queue: worker }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
