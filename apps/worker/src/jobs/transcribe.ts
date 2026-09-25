import fs from "node:fs/promises";
import { and, eq, getDb, projects, transcriptChunks, transcripts, type Project } from "@longcut/db";
import { getObjectStream, keys, putObject, uploadStream } from "@longcut/services";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  AppError,
  buildSentences,
  detectLanguageStyle,
  humanDuration,
  type Sentence,
  type Word,
} from "@longcut/shared";
import { config } from "../config";
import { log } from "../log";
import { computeWaveform, cutAudioChunk, extractAudio } from "../media/audio";
import type { SttProvider } from "../stt";
import { cleanWords, mergeChunks } from "../stt/postprocess";
import { mapLimit, retry } from "../util";
import type { JobContext } from "./context";
import { sourceUrl } from "./ingest";
import { setProjectState } from "./projectState";

const OVERLAP = 4;
const WAVEFORM_RATE = 10;

/** Extracts (or re-downloads the cached) speech audio and builds the waveform. */
export async function ensureAudio(ctx: JobContext, project: Project, range: [number, number]): Promise<{ project: Project; audioFile: string }> {
  const audioFile = ctx.file("audio.ogg");
  const [p0, p1] = range;
  if (project.audioPath) {
    await pipeline(await getObjectStream(project.audioPath), createWriteStream(audioFile));
  } else {
    if (project.media && project.media.hasAudio === false) {
      throw new AppError("NO_AUDIO", "Source has no audio stream", { retryable: false });
    }
    await setProjectState(project.id, { status: "extracting_audio", progress: p0, statusMessage: `Extracting audio from ${humanDuration(project.duration)} of video…` });
    try {
      await extractAudio(await sourceUrl(project), audioFile, {
        duration: project.duration ?? 1,
        signal: ctx.signal,
        onProgress: (f) => void setProjectState(project.id, { progress: p0 + f * (p1 - p0) * 0.9 }),
      });
    } catch (err) {
      if (/matches no streams|does not contain any stream/i.test((err as Error).message)) {
        throw new AppError("NO_AUDIO", "No audio stream", { retryable: false, cause: err });
      }
      throw err;
    }
    const key = keys.audio(project.userId, project.id);
    await uploadStream(key, createReadStream(audioFile), "audio/ogg");
    [project] = await getDb().update(projects).set({ audioPath: key }).where(eq(projects.id, project.id)).returning();
  }
  if (!project.waveformPath) {
    try {
      const peaks = await computeWaveform(audioFile, WAVEFORM_RATE, ctx.signal);
      const key = keys.waveform(project.userId, project.id);
      await putObject(key, peaks, "application/octet-stream");
      [project] = await getDb()
        .update(projects)
        .set({ waveformPath: key, waveformRate: WAVEFORM_RATE })
        .where(eq(projects.id, project.id))
        .returning();
    } catch (err) {
      log.warn("waveform generation failed", { projectId: project.id, error: (err as Error).message });
    }
  }
  await setProjectState(project.id, { progress: p1 });
  return { project, audioFile };
}

const HINGLISH_PROMPT =
  "Guys aaj hum basically ye dekhne wale hain ke business ko scale kaise karna hai. Okay, so let's start, bilkul sahi baat hai.";

function sttHints(project: Project): { language?: string; prompt?: string } {
  const spoken = project.settings.spokenLanguage;
  const language = spoken === "auto" ? undefined : spoken;
  let prompt = process.env.TRANSCRIBE_PROMPT || undefined;
  // Whisper-family models follow the script/style of the prompt: a Roman Hinglish prompt keeps
  // code-mixed speech in natural Roman script instead of forcing Devanagari or translating.
  if (!prompt && (project.settings.captionLanguage === "hinglish" || spoken === "hi")) prompt = HINGLISH_PROMPT;
  return { language: language === "hi" && prompt === HINGLISH_PROMPT ? undefined : language, prompt };
}

/**
 * Chunked transcription with overlap. Every finished chunk is checkpointed in the DB, so a
 * crash or redeploy at hour 7 of a 10-hour video resumes at hour 7.
 */
export async function transcribeProject(
  ctx: JobContext,
  project: Project,
  audioFile: string,
  stt: SttProvider,
  range: [number, number],
): Promise<Sentence[]> {
  const db = getDb();
  const existing = await db.query.transcripts.findFirst({ where: eq(transcripts.projectId, project.id) });
  if (existing) return existing.segments;

  const duration = project.duration ?? 0;
  const chunkLen = config.transcribeChunkSeconds;
  const plan: Array<{ index: number; start: number; end: number; ownEnd: number }> = [];
  for (let i = 0, start = 0; start < duration; i++, start += chunkLen) {
    const end = Math.min(duration, start + chunkLen + OVERLAP);
    plan.push({ index: i, start, end, ownEnd: end >= duration ? Infinity : start + chunkLen + OVERLAP / 2 });
  }
  const done = await db.query.transcriptChunks.findMany({ where: eq(transcriptChunks.projectId, project.id) });
  const doneMap = new Map(done.filter((d) => d.provider === stt.name).map((d) => [d.index, d]));
  const [p0, p1] = range;
  let completed = doneMap.size;
  const report = () =>
    setProjectState(project.id, {
      status: "transcribing",
      progress: p0 + (completed / Math.max(1, plan.length)) * (p1 - p0),
      statusMessage: `Transcribing ${humanDuration(duration)} of audio — part ${Math.min(plan.length, completed + 1)} of ${plan.length}`,
    });
  await setProjectState(project.id, { status: "transcribing" });
  await report();

  const hints = sttHints(project);
  const detectedLanguages: string[] = [];
  await mapLimit(
    plan.filter((c) => !doneMap.has(c.index)),
    stt.concurrency,
    async (chunk) => {
      ctx.throwIfAborted();
      const file = ctx.file(`chunk-${chunk.index}.ogg`);
      await cutAudioChunk(audioFile, chunk.start, chunk.end - chunk.start, file, ctx.signal);
      const res = await retry(() => stt.transcribe(file, { ...hints, signal: ctx.signal }), {
        attempts: 3,
        baseMs: 3000,
        shouldRetry: (err) => !(err instanceof AppError) || err.retryable,
      });
      await fs.rm(file, { force: true });
      // Providers occasionally emit words past the end of the audio (hallucinated trailing
      // silence); never let a timestamp exceed the chunk or the source.
      const words: Word[] = cleanWords(res.words)
        .map((w) => ({ ...w, s: w.s + chunk.start, e: w.e + chunk.start }))
        .filter((w) => w.s < Math.min(chunk.end, duration) && w.e > chunk.start)
        .map((w) => ({ ...w, e: Math.min(w.e, duration) }));
      if (res.language) detectedLanguages.push(res.language);
      await db
        .insert(transcriptChunks)
        .values({ projectId: project.id, index: chunk.index, start: chunk.start, end: chunk.end, provider: stt.name, language: res.language ?? null, words })
        .onConflictDoUpdate({
          target: [transcriptChunks.projectId, transcriptChunks.index],
          set: { words, provider: stt.name, start: chunk.start, end: chunk.end, language: res.language ?? null },
        });
      completed++;
      await report();
    },
  );

  const rows = await db.query.transcriptChunks.findMany({
    where: and(eq(transcriptChunks.projectId, project.id), eq(transcriptChunks.provider, stt.name)),
  });
  const byIndex = new Map(rows.map((r) => [r.index, r]));
  const merged = mergeChunks(
    plan.map((c) => ({ start: c.start, end: c.end, ownEnd: c.ownEnd, words: byIndex.get(c.index)?.words ?? [] })),
  );
  if (merged.length < 5) throw new AppError("NO_SPEECH", "Transcript is empty", { retryable: false });

  const sentences = buildSentences(merged);
  const text = sentences.map((s) => s.t).join(" ");
  const stats = detectLanguageStyle(text);
  const speakers = new Set(merged.map((w) => w.sp).filter((v) => v != null));
  const languageCounts = rows.map((r) => r.language).filter(Boolean) as string[];
  const topLanguage = languageCounts.sort((a, b) => languageCounts.filter((x) => x === b).length - languageCounts.filter((x) => x === a).length)[0];

  await db.transaction(async (tx) => {
    await tx
      .insert(transcripts)
      .values({
        projectId: project.id,
        text,
        segments: sentences,
        language: stats.code !== "und" ? stats.code : (topLanguage ?? null),
        provider: stt.name,
        wordCount: merged.length,
        speakerCount: speakers.size || null,
      })
      .onConflictDoNothing();
    await tx.update(projects).set({ languageStats: stats }).where(eq(projects.id, project.id));
    // Chunk checkpoints are no longer needed once the merged transcript is stored.
    await tx.delete(transcriptChunks).where(eq(transcriptChunks.projectId, project.id));
  });
  return sentences;
}
