import { clips, eq, exportsTable, getDb, projects, type JobRow } from "@longcut/db";
import { log } from "../log";

/** Marks the entity behind a permanently failed job so the UI can show a friendly error + retry. */
export async function onPermanentFailure(job: JobRow, code: string): Promise<void> {
  const db = getDb();
  switch (job.type) {
    case "process":
    case "analyze":
    case "probe":
      if (job.projectId) {
        await db
          .update(projects)
          .set({ status: "failed", errorCode: code, statusMessage: null })
          .where(eq(projects.id, job.projectId));
      }
      break;
    case "render":
      if (job.exportId) {
        await db.update(exportsTable).set({ status: "failed", errorCode: code === "INTERNAL" ? "RENDER_FAILED" : code }).where(eq(exportsTable.id, job.exportId));
      }
      if (job.clipId) await db.update(clips).set({ status: "failed" }).where(eq(clips.id, job.clipId));
      break;
    case "package":
      if (job.clipId) await db.update(clips).set({ packageStatus: "failed" }).where(eq(clips.id, job.clipId));
      break;
    default:
      log.warn("job failed permanently", { jobId: job.id, type: job.type, code });
  }
}

export async function onRetryScheduled(job: JobRow): Promise<void> {
  if ((job.type === "process" || job.type === "analyze") && job.projectId) {
    await getDb()
      .update(projects)
      .set({ statusMessage: "Hit a temporary problem — retrying automatically…" })
      .where(eq(projects.id, job.projectId));
  }
  if (job.type === "render" && job.exportId) {
    await getDb().update(exportsTable).set({ status: "queued" }).where(eq(exportsTable.id, job.exportId));
  }
}
