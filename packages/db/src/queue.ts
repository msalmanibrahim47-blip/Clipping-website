import type pg from "pg";
import type { JobType } from "@longcut/shared";
import { getPool } from "./client";

/**
 * Postgres-backed job queue (SELECT … FOR UPDATE SKIP LOCKED). No extra infrastructure:
 * the web app enqueues inside its normal DB connection, the worker claims jobs, renews a
 * lease with heartbeats while it works, and a reaper re-queues jobs whose worker died.
 */
export const JOB_CHANNEL = "longcut_jobs";

export interface JobRow {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  maxAttempts: number;
  userId: string | null;
  projectId: string | null;
  clipId: string | null;
  exportId: string | null;
  dedupeKey: string | null;
}

function mapRow(r: Record<string, unknown>): JobRow {
  return {
    id: r.id as string,
    type: r.type as JobType,
    payload: (r.payload as Record<string, unknown>) ?? {},
    status: r.status as string,
    attempts: r.attempts as number,
    maxAttempts: r.max_attempts as number,
    userId: (r.user_id as string) ?? null,
    projectId: (r.project_id as string) ?? null,
    clipId: (r.clip_id as string) ?? null,
    exportId: (r.export_id as string) ?? null,
    dedupeKey: (r.dedupe_key as string) ?? null,
  };
}

export interface EnqueueInput {
  type: JobType;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
  userId?: string | null;
  projectId?: string | null;
  clipId?: string | null;
  exportId?: string | null;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
}

const DEFAULT_ATTEMPTS: Record<JobType, number> = {
  probe: 3,
  process: 4,
  preview: 2,
  analyze: 3,
  package: 3,
  captions: 3,
  render: 2,
  cleanup: 5,
};

/**
 * Enqueue a job. If a queued/running job with the same dedupeKey exists, returns it instead
 * of creating a duplicate (`created: false`).
 */
export async function enqueueJob(
  input: EnqueueInput,
  client: pg.Pool | pg.PoolClient = getPool(),
): Promise<{ id: string; created: boolean }> {
  const res = await client.query(
    `insert into jobs (type, payload, dedupe_key, user_id, project_id, clip_id, export_id, priority, max_attempts, run_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, now()))
     on conflict (dedupe_key) where status in ('queued','running') and dedupe_key is not null do nothing
     returning id`,
    [
      input.type,
      JSON.stringify(input.payload ?? {}),
      input.dedupeKey ?? null,
      input.userId ?? null,
      input.projectId ?? null,
      input.clipId ?? null,
      input.exportId ?? null,
      input.priority ?? 0,
      input.maxAttempts ?? DEFAULT_ATTEMPTS[input.type],
      input.runAt ?? null,
    ],
  );
  if (res.rows[0]) {
    await client.query(`select pg_notify($1, $2)`, [JOB_CHANNEL, input.type]);
    return { id: res.rows[0].id as string, created: true };
  }
  const existing = await client.query(
    `select id from jobs where dedupe_key = $1 and status in ('queued','running') limit 1`,
    [input.dedupeKey],
  );
  return { id: existing.rows[0]?.id as string, created: false };
}

export async function claimJob(workerId: string, types: JobType[], leaseSeconds: number): Promise<JobRow | null> {
  const res = await getPool().query(
    `update jobs set status = 'running', attempts = attempts + 1, locked_by = $1,
            locked_until = now() + make_interval(secs => $3), started_at = coalesce(started_at, now()),
            last_error = null, updated_at = now()
      where id = (
        select id from jobs
         where status = 'queued' and run_at <= now() and type = any($2)
         order by priority desc, run_at asc
         for update skip locked
         limit 1)
      returning *`,
    [workerId, types, leaseSeconds],
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

/** Extends the lease. Returns false if the job was taken away (e.g. cancelled). */
export async function heartbeatJob(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
  const res = await getPool().query(
    `update jobs set locked_until = now() + make_interval(secs => $3), updated_at = now()
      where id = $1 and locked_by = $2 and status = 'running'`,
    [jobId, workerId, leaseSeconds],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function updateJobProgress(jobId: string, progress: number, message?: string | null): Promise<void> {
  await getPool().query(`update jobs set progress = $2, message = coalesce($3, message), updated_at = now() where id = $1`, [
    jobId,
    Math.max(0, Math.min(1, progress)),
    message ?? null,
  ]);
}

export async function completeJob(jobId: string): Promise<void> {
  await getPool().query(
    `update jobs set status = 'completed', progress = 1, locked_by = null, locked_until = null, finished_at = now(), updated_at = now() where id = $1`,
    [jobId],
  );
}

/**
 * Records a failure. Retries with exponential backoff while attempts remain and the error is
 * retryable; returns true when the job failed permanently.
 */
export async function failJob(
  job: Pick<JobRow, "id" | "attempts" | "maxAttempts">,
  error: { message: string; code: string; retryable: boolean },
): Promise<boolean> {
  const permanent = !error.retryable || job.attempts >= job.maxAttempts;
  if (permanent) {
    await getPool().query(
      `update jobs set status = 'failed', last_error = $2, error_code = $3, locked_by = null, locked_until = null,
              finished_at = now(), updated_at = now() where id = $1`,
      [job.id, error.message.slice(0, 4000), error.code],
    );
  } else {
    const backoff = Math.min(15 * 60, 20 * 2 ** (job.attempts - 1));
    await getPool().query(
      `update jobs set status = 'queued', last_error = $2, error_code = $3, locked_by = null, locked_until = null,
              run_at = now() + make_interval(secs => $4), updated_at = now() where id = $1`,
      [job.id, error.message.slice(0, 4000), error.code, backoff],
    );
  }
  return permanent;
}

/**
 * Finds running jobs whose lease expired (worker crashed / was redeployed). Jobs with attempts
 * left are re-queued; the rest are returned so the caller can mark their entities failed.
 */
export async function reapExpiredJobs(): Promise<JobRow[]> {
  const pool = getPool();
  await pool.query(
    `update jobs set status = 'queued', locked_by = null, locked_until = null, run_at = now(),
            last_error = 'Worker lease expired; retrying', updated_at = now()
      where status = 'running' and locked_until < now() and attempts < max_attempts`,
  );
  const res = await pool.query(
    `update jobs set status = 'failed', locked_by = null, locked_until = null, error_code = 'TIMEOUT',
            last_error = 'Worker lease expired; no attempts left', finished_at = now(), updated_at = now()
      where status = 'running' and locked_until < now() and attempts >= max_attempts
      returning *`,
  );
  return res.rows.map(mapRow);
}

export async function cancelJobsFor(where: { projectId?: string; clipId?: string; exportId?: string }): Promise<void> {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [col, val] of [
    ["project_id", where.projectId],
    ["clip_id", where.clipId],
    ["export_id", where.exportId],
  ] as const) {
    if (val) {
      params.push(val);
      clauses.push(`${col} = $${params.length}`);
    }
  }
  if (clauses.length === 0) return;
  await getPool().query(
    `update jobs set status = 'cancelled', finished_at = now(), updated_at = now()
      where status = 'queued' and (${clauses.join(" or ")})`,
    params,
  );
}
