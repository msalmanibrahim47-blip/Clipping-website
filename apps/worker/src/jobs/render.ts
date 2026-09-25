import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { clips, eq, exportsTable, getDb, userSettings } from "@longcut/db";
import { keys, putObject, signedGetUrl, uploadStream } from "@longcut/services";
import {
  AppError,
  captionStyleFor,
  captionStyleSchema,
  captionWords,
  keepRanges,
  keptDuration,
  RESOLUTION_HEIGHT,
  segmentCaptions,
  sentencesInRange,
  snapToSentence,
  toASS,
  toSRT,
  toVTT,
  type CaptionStyle,
  type TimeRange,
} from "@longcut/shared";
import { smartTrim } from "../analysis/trim";
import { probe } from "../media/probe";
import { renderClip } from "../media/render";
import { providersForUser } from "../providers";
import { ensureCaptionText, loadClipContext } from "./clipJobs";
import type { JobContext } from "./context";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "clip";
}

const CLEANUP_DAYS: Record<string, number | null> = { keep: null, "30d": 30, "7d": 7 };

/**
 * Renders one export: optional smart trim to a target duration, caption text in the chosen
 * language, ASS burn-in or sidecar SRT/VTT, H.264/AAC MP4. The original source is only read.
 */
export async function renderJob(ctx: JobContext): Promise<void> {
  const db = getDb();
  const exp = await db.query.exportsTable.findFirst({ where: eq(exportsTable.id, ctx.job.exportId!) });
  if (!exp) return;
  const loaded = await loadClipContext(exp.clipId);
  if (!loaded) return;
  const { clip, project, sentences } = loaded;
  const providers = await providersForUser(project.userId);
  const setExport = (patch: Partial<typeof exportsTable.$inferInsert>) => db.update(exportsTable).set(patch).where(eq(exportsTable.id, exp.id));
  await db.update(clips).set({ status: "rendering" }).where(eq(clips.id, clip.id));

  // 1. Resolve the final range (smart trim / extension for duration presets).
  let start = exp.startTime;
  let end = exp.endTime;
  let cuts: TimeRange[] = exp.cuts ?? [];
  const current = keptDuration(keepRanges(start, end, cuts));
  const target = exp.options.targetDuration;
  if (target && Math.abs(target - current) > 5) {
    await setExport({ status: "generating_captions", progress: 0.02 });
    if (target < current) {
      const inClip = sentencesInRange(sentences, start, end).filter((s) => !cuts.some((c) => s.s >= c.start && s.e <= c.end));
      if (inClip.length > 1) {
        const trimmed = await smartTrim({ llm: providers.llm(), sentences: inClip, target, signal: ctx.signal }).catch(() => null);
        if (trimmed) {
          start = trimmed.start;
          end = trimmed.end;
          cuts = cuts.filter((c) => c.end > start && c.start < end);
        }
      }
    } else {
      // Extend evenly on both sides to the nearest sentence boundaries, within the source.
      const extra = target - current;
      const maxEnd = project.duration ?? end + extra;
      start = snapToSentence(sentences, Math.max(0, start - extra / 2), "start", 15);
      end = snapToSentence(sentences, Math.min(maxEnd, end + extra / 2), "end", 15);
    }
  }
  if (project.duration) {
    start = Math.max(0, Math.min(start, project.duration));
    end = Math.min(end, project.duration);
  }
  const keeps = keepRanges(start, end, cuts);
  const outDuration = keptDuration(keeps);
  if (outDuration <= 1) throw new AppError("RENDER_FAILED", "Clip is empty", { retryable: false });

  // 2. Captions.
  await setExport({ status: "generating_captions", progress: 0.05, duration: outDuration });
  const userRow = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, project.userId) });
  const style: CaptionStyle = exp.options.captionStyle
    ? captionStyleSchema.parse(exp.options.captionStyle)
    : clip.captionStyle
      ? captionStyleSchema.parse(clip.captionStyle)
      : captionStyleFor(userRow?.defaults?.captionPreset ?? "clean", userRow?.captionStyle ?? {});
  const wantsCaptions = exp.captionMode !== "none" || exp.format !== "mp4" || (exp.options.subtitleFormats?.length ?? 0) > 0;
  let cues: ReturnType<typeof segmentCaptions> = [];
  if (wantsCaptions) {
    const overrides = await ensureCaptionText({
      project,
      sentences,
      start,
      end,
      language: exp.options.captionLanguage,
      llm: providers.llm,
      signal: ctx.signal,
    });
    cues = segmentCaptions(captionWords(sentences, start, end, cuts, overrides), {
      maxCharsPerLine: style.maxCharsPerLine,
      maxLines: style.maxLines,
    });
  }

  const baseName = `${String(clip.rank).padStart(2, "0")}-${slug(clip.package?.titles.recommended ?? clip.title)}`;
  const subtitlePaths: Record<string, string> = {};
  const subtitleFormats = new Set<string>(exp.options.subtitleFormats ?? []);
  if (exp.format === "srt" || exp.format === "vtt") subtitleFormats.add(exp.format);
  if (exp.captionMode === "subtitle") {
    subtitleFormats.add("srt");
    subtitleFormats.add("vtt");
  }
  for (const fmt of subtitleFormats) {
    const key = keys.exportFile(project.userId, project.id, exp.id, `${baseName}.${fmt}`);
    await putObject(key, fmt === "srt" ? toSRT(cues) : toVTT(cues), fmt === "srt" ? "application/x-subrip" : "text/vtt");
    subtitlePaths[fmt] = key;
  }

  const expiryDays = CLEANUP_DAYS[userRow?.defaults?.exportCleanup ?? "30d"];
  const expiresAt = expiryDays ? new Date(Date.now() + expiryDays * 86400_000) : null;

  if (exp.format !== "mp4") {
    await setExport({ status: "completed", progress: 1, subtitlePaths, completedAt: new Date(), expiresAt });
    await db.update(clips).set({ status: "ready" }).where(eq(clips.id, clip.id));
    return;
  }

  // 3. Render video.
  const srcH = project.height ?? 1080;
  const srcW = project.width ?? 1920;
  const height = exp.resolution === "original" ? null : Math.min(srcH, RESOLUTION_HEIGHT[exp.resolution as keyof typeof RESOLUTION_HEIGHT] ?? srcH);
  const outH = height ?? srcH;
  const outW = Math.round((srcW * outH) / srcH / 2) * 2;
  let assPath: string | null = null;
  const hook = exp.options.useAiHook && clip.package?.hook.suggestion ? { text: clip.package.hook.suggestion, duration: 5 } : null;
  if ((exp.captionMode === "burn" && style.enabled && cues.length) || hook) {
    assPath = ctx.file("captions.ass");
    await fs.writeFile(
      assPath,
      toASS(cues, { width: outW, height: outH, style, hook, showCaptions: exp.captionMode === "burn" && style.enabled }),
    );
  }
  await setExport({ status: "rendering", progress: 0.08 });
  const output = ctx.file("out.mp4");
  let lastWrite = 0;
  await renderClip({
    source: await signedGetUrl(project.storagePath!, { internal: true, expiresIn: 24 * 3600 }),
    keeps,
    height,
    assPath,
    output,
    hasAudio: project.media?.hasAudio !== false,
    signal: ctx.signal,
    onProgress: (f) => {
      const now = Date.now();
      if (now - lastWrite > 2000) {
        lastWrite = now;
        void setExport({ progress: 0.08 + f * 0.82 });
      }
    },
  });

  // Never publish a broken file: the output must contain video of roughly the expected length.
  const check = await probe(output).catch(() => null);
  if (!check || !check.videoCodec || Math.abs(check.duration - outDuration) > Math.max(2, outDuration * 0.05)) {
    throw new AppError("RENDER_FAILED", `Render verification failed (expected ${outDuration.toFixed(1)}s, got ${check?.duration ?? "none"})`);
  }
  await setExport({ status: "exporting", progress: 0.92 });
  const stat = await fs.stat(output);
  const key = keys.exportFile(project.userId, project.id, exp.id, `${baseName}.mp4`);
  await uploadStream(key, createReadStream(output), "video/mp4");
  await setExport({
    status: "completed",
    progress: 1,
    storagePath: key,
    subtitlePaths,
    fileSize: stat.size,
    duration: outDuration,
    completedAt: new Date(),
    expiresAt,
  });
  await db.update(clips).set({ status: "ready" }).where(eq(clips.id, clip.id));
}
