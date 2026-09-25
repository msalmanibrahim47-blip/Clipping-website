import fs from "node:fs/promises";
import path from "node:path";
import { updateJobProgress, type JobRow } from "@longcut/db";
import { config } from "../config";

export class JobContext {
  readonly tmp: string;
  private lastProgressWrite = 0;

  constructor(
    readonly job: JobRow,
    readonly signal: AbortSignal,
  ) {
    this.tmp = path.join(config.tmpDir, job.id);
  }

  async init() {
    await fs.mkdir(this.tmp, { recursive: true });
  }

  file(name: string) {
    return path.join(this.tmp, name);
  }

  /** Throttled job progress write (at most every 2s unless forced). */
  async progress(fraction: number, message?: string, force = false) {
    const now = Date.now();
    if (!force && now - this.lastProgressWrite < 2000) return;
    this.lastProgressWrite = now;
    await updateJobProgress(this.job.id, fraction, message);
  }

  throwIfAborted() {
    if (this.signal.aborted) throw new Error("Job aborted");
  }

  async cleanup() {
    await fs.rm(this.tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
