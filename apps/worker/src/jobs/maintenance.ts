import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, exportsTable, getDb, lt, projects, userSettings, inArray, sql } from "@longcut/db";
import { abortMultipartUpload, deleteObjects, deletePrefix, keys, uploadStream } from "@longcut/services";
import { config } from "../config";
import { log } from "../log";
import { buildPreviewProxy } from "../media/audio";
import { createReadStream } from "node:fs";
import type { JobContext } from "./context";
import { sourceUrl } from "./ingest";
import { loadProject } from "./projectState";

export async function previewJob(ctx: JobContext): Promise<void> {
  const project = await loadProject(ctx.job.projectId!);
  if (!project || project.previewPath || !project.storagePath) return;
  const out = ctx.file("preview.mp4");
  await buildPreviewProxy(await sourceUrl(project), out, {
    duration: project.duration ?? 1,
    signal: ctx.signal,
    onProgress: (f) => void ctx.progress(f, "Building preview"),
  });
  const key = keys.preview(project.userId, project.id);
  await uploadStream(key, createReadStream(out), "video/mp4");
  await getDb().update(projects).set({ previewPath: key }).where(eq(projects.id, project.id));
}

/** Deletes storage for a removed project (payload.prefix) — enqueued by the web app. */
export async function cleanupJob(ctx: JobContext): Promise<void> {
  const prefix = ctx.job.payload.prefix as string | undefined;
  if (prefix && /^users\/[0-9a-f-]+\/projects\/[0-9a-f-]+\/$/.test(prefix)) {
    const n = await deletePrefix(prefix);
    log.info("deleted project storage", { prefix, objects: n });
  }
  const upload = ctx.job.payload.upload as { key: string; uploadId: string } | undefined;
  if (upload) await abortMultipartUpload(upload.key, upload.uploadId).catch(() => undefined);
}

/**
 * Periodic housekeeping: expire old exports, purge intermediates when users opt in, abort
 * abandoned multipart uploads and clear stale temp directories on this worker.
 */
export async function sweep(): Promise<void> {
  const db = getDb();
  const expired = await db.query.exportsTable.findMany({
    where: and(lt(exportsTable.expiresAt, new Date()), eq(exportsTable.status, "completed")),
    limit: 500,
  });
  for (const e of expired) {
    await deleteObjects([e.storagePath ?? "", ...Object.values(e.subtitlePaths ?? {})]);
    await db.update(exportsTable).set({ status: "expired", storagePath: null, subtitlePaths: {} }).where(eq(exportsTable.id, e.id));
  }
  if (expired.length) log.info("expired exports cleaned", { count: expired.length });

  // Uploads abandoned for 7+ days.
  const stale = await db.query.projects.findMany({
    where: and(eq(projects.status, "uploading"), lt(projects.updatedAt, new Date(Date.now() - 7 * 86400_000))),
    limit: 200,
  });
  for (const p of stale) {
    if (p.uploadId && p.storagePath) await abortMultipartUpload(p.storagePath, p.uploadId).catch(() => undefined);
    await db.update(projects).set({ status: "failed", errorCode: "UPLOAD_INCOMPLETE", uploadId: null }).where(eq(projects.id, p.id));
  }

  // Intermediates (audio + preview proxy) for users who opted in, 3 days after completion.
  const purgeUsers = await db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(sql`(${userSettings.defaults} ->> 'purgeIntermediates')::boolean is true`);
  if (purgeUsers.length) {
    const done = await db.query.projects.findMany({
      where: and(
        inArray(projects.userId, purgeUsers.map((u) => u.userId)),
        eq(projects.status, "completed"),
        lt(projects.completedAt, new Date(Date.now() - 3 * 86400_000)),
      ),
      limit: 200,
    });
    for (const p of done) {
      if (!p.audioPath && !p.previewPath) continue;
      await deleteObjects([p.audioPath ?? "", p.previewPath ?? ""]);
      await db.update(projects).set({ audioPath: null, previewPath: null }).where(eq(projects.id, p.id));
    }
  }

  // Temp directories left behind by crashed jobs.
  const entries = await fs.readdir(config.tmpDir).catch(() => [] as string[]);
  for (const entry of entries) {
    const full = path.join(config.tmpDir, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 36 * 3600_000) await fs.rm(full, { recursive: true, force: true });
  }
}
