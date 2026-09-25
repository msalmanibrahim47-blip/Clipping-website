import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { enqueueJob, eq, getDb, projects, type MediaInfo, type Project } from "@longcut/db";
import { keys, putObject, signedGetUrl, uploadStream } from "@longcut/services";
import { AppError, humanDuration } from "@longcut/shared";
import { config } from "../config";
import { extractFrame } from "../media/audio";
import { probe } from "../media/probe";
import { downloadYouTube } from "../media/youtube";
import type { JobContext } from "./context";
import { setProjectState } from "./projectState";

/** Presigned URL FFmpeg reads directly (range requests) — valid long enough for 10h sources. */
export function sourceUrl(project: Project): Promise<string> {
  if (!project.storagePath) throw new AppError("UPLOAD_INCOMPLETE", "Project has no stored source", { retryable: false });
  return signedGetUrl(project.storagePath, { internal: true, expiresIn: 7 * 24 * 3600 });
}

/** YouTube → local disk → object storage. Skipped when the source is already stored. */
export async function ingestYouTube(ctx: JobContext, project: Project, range: [number, number]): Promise<Project> {
  if (project.sourceType !== "youtube" || project.storagePath) return project;
  if (!project.sourceUrl) throw new AppError("YOUTUBE_INVALID_URL", "Missing YouTube URL", { retryable: false });
  const [p0, p1] = range;
  await setProjectState(project.id, { status: "downloading", progress: p0, statusMessage: "Downloading source video…", errorCode: null });
  const { file } = await downloadYouTube(project.sourceUrl, ctx.file("yt"), {
    signal: ctx.signal,
    onProgress: (f) => void setProjectState(project.id, { progress: p0 + f * (p1 - p0) * 0.7, statusMessage: `Downloading source video… ${Math.round(f * 100)}%` }),
  });
  const stat = await fs.stat(file);
  const key = keys.source(project.userId, project.id, `source${file.slice(file.lastIndexOf("."))}`);
  await setProjectState(project.id, { statusMessage: "Saving source to storage…" }, { force: true });
  await uploadStream(key, createReadStream(file), "video/mp4", (loaded) =>
    void setProjectState(project.id, { progress: p0 + (p1 - p0) * (0.7 + 0.3 * (loaded / stat.size)) }),
  );
  await fs.rm(file, { force: true });
  const [updated] = await getDb()
    .update(projects)
    .set({ storagePath: key, fileSize: stat.size, mimeType: "video/mp4" })
    .where(eq(projects.id, project.id))
    .returning();
  return updated;
}

/** ffprobe + thumbnail. Idempotent; skipped when metadata already exists. */
export async function ensureMetadata(ctx: JobContext, project: Project): Promise<Project> {
  if (project.duration && project.media) return project;
  const url = await sourceUrl(project);
  const info = await probe(url, ctx.signal);
  const media: MediaInfo = {
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    audioChannels: info.audioChannels,
    audioSampleRate: info.audioSampleRate,
    bitrate: info.bitrate,
    hasAudio: info.hasAudio,
    browserPlayable: info.browserPlayable,
  };
  let thumbnailPath = project.thumbnailPath;
  if (!thumbnailPath) {
    try {
      const out = ctx.file("thumb.jpg");
      await extractFrame(url, Math.min(info.duration * 0.1, 120), out, 1280, ctx.signal);
      thumbnailPath = keys.thumbnail(project.userId, project.id);
      await putObject(thumbnailPath, await fs.readFile(out), "image/jpeg");
    } catch {
      thumbnailPath = null; // thumbnails are cosmetic; never fail ingestion over one
    }
  }
  const [updated] = await getDb()
    .update(projects)
    .set({
      duration: info.duration,
      width: info.width,
      height: info.height,
      fps: info.fps,
      fileSize: project.fileSize ?? info.size,
      media,
      thumbnailPath,
    })
    .where(eq(projects.id, project.id))
    .returning();
  // Browser-unfriendly sources (MKV/AVI/HEVC/4K) get a lightweight preview proxy in the background.
  if (!updated.previewPath && (!info.browserPlayable || config.alwaysProxy)) {
    await enqueueJob({ type: "preview", projectId: project.id, userId: project.userId, dedupeKey: `preview:${project.id}`, priority: -1 });
  }
  return updated;
}

export function describeLength(project: Project): string {
  return project.duration ? humanDuration(project.duration) : "";
}
