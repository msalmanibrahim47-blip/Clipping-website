import { claimJob, completeJob, failJob, heartbeatJob, JOB_CHANNEL, getPool, type JobRow } from "@longcut/db";
import { AppError, type JobType } from "@longcut/shared";
import { config } from "./config";
import { JobContext } from "./jobs/context";
import { onPermanentFailure, onRetryScheduled } from "./jobs/failures";
import { errFields, log } from "./log";
import { redact } from "./media/exec";
import { sleep } from "./util";

export type JobHandler = (ctx: JobContext) => Promise<void>;

function classify(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof AppError) return { code: err.code, message: redact(err.message), retryable: err.retryable };
  const message = err instanceof Error ? err.message : String(err);
  return { code: "INTERNAL", message: redact(message), retryable: true };
}

/**
 * A pool of `concurrency` loops that claim jobs of the given types. Wakes immediately on
 * NOTIFY from the web app, and polls as a fallback.
 */
export class JobPool {
  private running = 0;
  private stopped = false;
  private wake: (() => void) | null = null;
  private active = new Set<AbortController>();

  constructor(
    readonly name: string,
    private types: JobType[],
    private concurrency: number,
    private handlers: Partial<Record<JobType, JobHandler>>,
  ) {}

  notify() {
    this.wake?.();
  }

  start() {
    for (let i = 0; i < this.concurrency; i++) void this.loop(i);
    log.info("job pool started", { pool: this.name, types: this.types, concurrency: this.concurrency });
  }

  async stop(graceMs: number) {
    this.stopped = true;
    this.notify();
    const deadline = Date.now() + graceMs;
    while (this.running > 0 && Date.now() < deadline) await sleep(500);
    // Abort whatever is still running; its lease expires and another worker resumes it.
    for (const c of this.active) c.abort();
  }

  private async idle() {
    await Promise.race([sleep(config.pollIntervalMs), new Promise<void>((r) => (this.wake = r))]);
    this.wake = null;
  }

  private async loop(slot: number) {
    while (!this.stopped) {
      let job: JobRow | null = null;
      try {
        job = await claimJob(`${config.workerId}:${this.name}:${slot}`, this.types, config.leaseSeconds);
      } catch (err) {
        log.error("claim failed", errFields(err));
      }
      if (!job) {
        await this.idle();
        continue;
      }
      this.running++;
      try {
        await this.execute(job, `${config.workerId}:${this.name}:${slot}`);
      } finally {
        this.running--;
      }
    }
  }

  private async execute(job: JobRow, lockId: string) {
    const handler = this.handlers[job.type];
    const controller = new AbortController();
    this.active.add(controller);
    const ctx = new JobContext(job, controller.signal);
    const started = Date.now();
    const beat = setInterval(async () => {
      try {
        const ok = await heartbeatJob(job.id, lockId, config.leaseSeconds);
        if (!ok) {
          log.warn("lost job lease (cancelled or deleted); aborting", { jobId: job.id });
          controller.abort();
        }
      } catch (err) {
        log.warn("heartbeat failed", { jobId: job.id, ...errFields(err) });
      }
    }, Math.max(5000, (config.leaseSeconds * 1000) / 3));

    log.info("job started", { jobId: job.id, type: job.type, attempt: job.attempts, projectId: job.projectId });
    try {
      if (!handler) throw new AppError("INTERNAL", `No handler for ${job.type}`, { retryable: false });
      await ctx.init();
      await handler(ctx);
      await completeJob(job.id);
      log.info("job completed", { jobId: job.id, type: job.type, seconds: Math.round((Date.now() - started) / 1000) });
    } catch (err) {
      const info = classify(err);
      if (controller.signal.aborted && this.stopped) {
        log.warn("job interrupted by shutdown", { jobId: job.id });
      } else {
        log.error("job failed", { jobId: job.id, type: job.type, code: info.code, ...errFields(err) });
        try {
          const permanent = await failJob(job, info);
          if (permanent) await onPermanentFailure(job, info.code);
          else await onRetryScheduled(job);
        } catch (e) {
          log.error("failed to record job failure", errFields(e));
        }
      }
    } finally {
      clearInterval(beat);
      this.active.delete(controller);
      await ctx.cleanup();
    }
  }
}

/** LISTEN for enqueue notifications so jobs start without waiting for the poll interval. */
export async function listenForJobs(onNotify: (type: string) => void): Promise<() => Promise<void>> {
  const client = await getPool().connect();
  await client.query(`LISTEN ${JOB_CHANNEL}`);
  client.on("notification", (msg) => onNotify(msg.payload ?? ""));
  client.on("error", (err) => log.error("listen connection error", errFields(err)));
  return async () => {
    await client.query(`UNLISTEN ${JOB_CHANNEL}`).catch(() => undefined);
    client.release();
  };
}
