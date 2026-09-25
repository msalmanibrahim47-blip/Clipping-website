import { clips, eq, getDb, sentenceTranslations, and, inArray, transcripts, type Clip, type Project } from "@longcut/db";
import {
  AppError,
  resolveCaptionTransform,
  sentencesInRange,
  type CaptionLanguage,
  type Sentence,
} from "@longcut/shared";
import { transformSentences } from "../analysis/translate";
import { config } from "../config";
import type { LlmProvider } from "../llm";
import { providersForUser } from "../providers";
import { buildPackage } from "./analysisRun";
import type { JobContext } from "./context";
import { loadProject } from "./projectState";

export async function loadClipContext(clipId: string): Promise<{ clip: Clip; project: Project; sentences: Sentence[] } | null> {
  const db = getDb();
  const clip = await db.query.clips.findFirst({ where: eq(clips.id, clipId) });
  if (!clip) return null;
  const project = await loadProject(clip.projectId);
  if (!project) return null;
  const transcript = await db.query.transcripts.findFirst({ where: eq(transcripts.projectId, project.id) });
  if (!transcript) throw new AppError("TRANSCRIPTION_FAILED", "Transcript missing", { retryable: false });
  return { clip, project, sentences: transcript.segments };
}

export async function packageJob(ctx: JobContext): Promise<void> {
  const loaded = await loadClipContext(ctx.job.clipId!);
  if (!loaded) return;
  const llm = (await providersForUser(loaded.project.userId)).llm();
  await buildPackage(ctx, loaded.project, loaded.clip, loaded.sentences, llm);
}

/**
 * Ensures caption-language text exists for every sentence in [start, end] and returns the
 * override map (sentence index → caption text), or null when captions use the original words.
 */
export async function ensureCaptionText(opts: {
  project: Project;
  sentences: Sentence[];
  start: number;
  end: number;
  language: CaptionLanguage;
  llm: () => LlmProvider;
  signal?: AbortSignal;
}): Promise<Map<number, string> | null> {
  const mode = resolveCaptionTransform(opts.language, opts.project.languageStats ?? null);
  if (mode === "none") return null;
  const db = getDb();
  const inRange = sentencesInRange(opts.sentences, opts.start, opts.end);
  const idxs = inRange.map((s) => s.i);
  const cached = idxs.length
    ? await db.query.sentenceTranslations.findMany({
        where: and(eq(sentenceTranslations.projectId, opts.project.id), eq(sentenceTranslations.mode, mode), inArray(sentenceTranslations.sentenceIdx, idxs)),
      })
    : [];
  const map = new Map(cached.map((c) => [c.sentenceIdx, c.text]));
  const missing = inRange.filter((s) => !map.has(s.i));
  if (missing.length) {
    const fresh = await transformSentences({ llm: opts.llm(), mode, sentences: missing, concurrency: config.analysisConcurrency, signal: opts.signal });
    const rows = [...fresh.entries()].map(([sentenceIdx, text]) => ({ projectId: opts.project.id, mode, sentenceIdx, text }));
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(sentenceTranslations).values(rows.slice(i, i + 500)).onConflictDoNothing();
    }
    for (const [k, v] of fresh) map.set(k, v);
  }
  return map;
}

export async function captionsJob(ctx: JobContext): Promise<void> {
  const loaded = await loadClipContext(ctx.job.clipId!);
  if (!loaded) return;
  const { clip, project, sentences } = loaded;
  const providers = await providersForUser(project.userId);
  const language = (ctx.job.payload.language as CaptionLanguage) ?? "auto";
  // Translate a margin around the clip so small boundary edits don't need another pass.
  await ensureCaptionText({
    project,
    sentences,
    start: Math.max(0, clip.startTime - 120),
    end: clip.endTime + 120,
    language,
    llm: providers.llm,
    signal: ctx.signal,
  });
  await getDb().update(clips).set({ captionLanguage: language }).where(eq(clips.id, clip.id));
}
