import fs from "node:fs/promises";
import { analyses, and, clips, eq, exportsTable, getDb, inArray, projects, type Clip, type Project } from "@longcut/db";
import { keys, putObject, signedGetUrl } from "@longcut/services";
import { rankClips, sentencesInRange, keepRanges, keptDuration, type Sentence, type Strategy } from "@longcut/shared";
import { analyzeTranscript } from "../analysis/pipeline";
import { generatePackage } from "../analysis/package";
import type { LlmProvider } from "../llm";
import { log } from "../log";
import { extractFrame } from "../media/audio";
import type { JobContext } from "./context";
import { setProjectState } from "./projectState";

/**
 * Runs long-form clip detection over a stored transcript and replaces the project's AI clips.
 * Used by the full pipeline and by "re-analyze" (new settings, no re-transcription).
 */
export async function runAnalysis(
  ctx: JobContext,
  project: Project,
  sentences: Sentence[],
  llm: LlmProvider,
  opts: { range: [number, number]; reuseSections: boolean },
): Promise<void> {
  const db = getDb();
  const [p0, p1] = opts.range;
  await setProjectState(project.id, { status: "analyzing", progress: p0, statusMessage: "Reading the full transcript…", errorCode: null });

  const existing = opts.reuseSections ? await db.query.analyses.findFirst({ where: eq(analyses.projectId, project.id) }) : null;
  let phase: "analyzing" | "finding_clips" = "analyzing";
  const result = await analyzeTranscript({
    sentences,
    videoDuration: project.duration ?? sentences[sentences.length - 1]?.e ?? 0,
    settings: project.settings,
    llm,
    existingSections: existing?.sections ?? null,
    signal: ctx.signal,
    onProgress: async (f, message) => {
      if (f >= 0.42 && phase === "analyzing") phase = "finding_clips";
      await setProjectState(project.id, { status: phase, progress: p0 + f * (p1 - p0) * 0.9, statusMessage: message });
      await ctx.progress(f, message);
    },
    onSections: async (sections) => {
      await db
        .insert(analyses)
        .values({ projectId: project.id, sections, model: llm.model })
        .onConflictDoUpdate({ target: analyses.projectId, set: { sections, model: llm.model, createdAt: new Date() } });
    },
  });

  const strategy = project.settings.strategy as Strategy;
  const ranked = rankClips(
    result.clips.map((c, i) => ({ ...c, id: String(i) })),
    strategy,
    project.settings.customWeights,
  );

  const inserted = await db.transaction(async (tx) => {
    // Replace previous AI suggestions, but never delete clips the user already exported.
    const old = await tx.query.clips.findMany({ where: and(eq(clips.projectId, project.id), eq(clips.origin, "ai")) });
    if (old.length) {
      const exported = await tx
        .selectDistinct({ clipId: exportsTable.clipId })
        .from(exportsTable)
        .where(inArray(exportsTable.clipId, old.map((c) => c.id)));
      const keep = new Set(exported.map((e) => e.clipId));
      const drop = old.filter((c) => !keep.has(c.id)).map((c) => c.id);
      if (drop.length) await tx.delete(clips).where(inArray(clips.id, drop));
    }
    const rows = ranked.length
      ? await tx
          .insert(clips)
          .values(
            ranked.map((c) => ({
              projectId: project.id,
              origin: "ai" as const,
              rank: c.rank,
              startTime: c.start,
              endTime: c.end,
              originalStart: c.start,
              originalEnd: c.end,
              duration: c.end - c.start,
              score: c.score,
              signals: c.signals,
              flags: c.flags,
              title: c.title,
              reason: c.reason,
              summary: c.summary,
              topics: c.topics,
              hookText: c.hookText,
              hookStart: c.hookStart,
            })),
          )
          .returning()
      : [];
    await tx.update(projects).set({ rankStrategy: strategy }).where(eq(projects.id, project.id));
    return rows;
  });

  // Publishing package for the #1 clip is part of the analysis result.
  const top = inserted.find((c) => c.rank === 1);
  if (top) {
    await setProjectState(project.id, { status: "finding_clips", progress: p0 + (p1 - p0) * 0.93, statusMessage: "Writing the publishing package for your #1 clip…" });
    try {
      await buildPackage(ctx, project, top, sentences, llm);
    } catch (err) {
      log.warn("top clip package failed", { projectId: project.id, error: (err as Error).message });
      await db.update(clips).set({ packageStatus: "failed" }).where(eq(clips.id, top.id));
    }
  }

  await db
    .update(projects)
    .set({
      status: "completed",
      progress: 1,
      statusMessage: `${inserted.length} long-form clip${inserted.length === 1 ? "" : "s"} found`,
      errorCode: null,
      completedAt: new Date(),
    })
    .where(eq(projects.id, project.id));
}

/** Extracts the clip's hook frame (for thumbnail prompts) and generates its publishing package. */
export async function buildPackage(ctx: JobContext, project: Project, clip: Clip, sentences: Sentence[], llm: LlmProvider): Promise<void> {
  const db = getDb();
  await db.update(clips).set({ packageStatus: "generating" }).where(eq(clips.id, clip.id));

  let frame: { data: string } | null = null;
  if (project.storagePath) {
    try {
      const out = ctx.file(`frame-${clip.id}.jpg`);
      const at = (clip.hookStart ?? clip.startTime) + 2;
      await extractFrame(await signedGetUrl(project.storagePath, { internal: true }), at, out, 1280, ctx.signal);
      const buf = await fs.readFile(out);
      const key = keys.clipFrame(project.userId, project.id, clip.id);
      await putObject(key, buf, "image/jpeg");
      await db.update(clips).set({ frameThumbPath: key }).where(eq(clips.id, clip.id));
      frame = { data: buf.toString("base64") };
    } catch (err) {
      log.warn("frame extraction failed", { clipId: clip.id, error: (err as Error).message });
    }
  }

  const keeps = keepRanges(clip.startTime, clip.endTime, clip.cuts);
  const clipSentences = sentencesInRange(sentences, clip.startTime, clip.endTime).filter((s) =>
    keeps.some((k) => (s.s + s.e) / 2 >= k.start && (s.s + s.e) / 2 <= k.end),
  );
  const pkg = await generatePackage({
    llm,
    sentences: clipSentences,
    clip: { title: clip.title, summary: clip.summary, reason: clip.reason, duration: keptDuration(keeps) },
    contentType: project.settings.contentType,
    languageStyle: project.languageStats?.style ?? null,
    frame,
    signal: ctx.signal,
  });
  await db.update(clips).set({ package: pkg, packageStatus: "ready" }).where(eq(clips.id, clip.id));
}
