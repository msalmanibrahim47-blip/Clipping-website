import { eq, getDb, transcripts } from "@longcut/db";
import { AppError } from "@longcut/shared";
import { providersForUser } from "../providers";
import { runAnalysis } from "./analysisRun";
import type { JobContext } from "./context";
import { ensureMetadata, ingestYouTube } from "./ingest";
import { loadProject, setProjectState } from "./projectState";
import { ensureAudio, transcribeProject } from "./transcribe";

/**
 * The full asynchronous pipeline. Each stage checks for its own checkpoint first (stored
 * source, metadata, audio, transcript chunks, transcript) so a retry resumes where it stopped.
 * Progress bands: download 0–10%, audio 10–20%, transcription 20–70%, analysis 70–100%.
 */
export async function processJob(ctx: JobContext): Promise<void> {
  let project = await loadProject(ctx.job.projectId!);
  if (!project) return; // project deleted meanwhile
  const providers = await providersForUser(project.userId);
  // Validate providers up front so misconfiguration fails fast with a clear message.
  const stt = providers.stt();
  const llm = providers.llm();

  project = await ingestYouTube(ctx, project, [0, 0.1]);
  if (!project.storagePath) throw new AppError("UPLOAD_INCOMPLETE", "Source not uploaded", { retryable: false });
  await setProjectState(project.id, { status: "extracting_audio", progress: 0.1, statusMessage: "Reading video metadata…", errorCode: null });
  project = await ensureMetadata(ctx, project);

  const existingTranscript = await getDb().query.transcripts.findFirst({ where: eq(transcripts.projectId, project.id) });
  let sentences = existingTranscript?.segments;
  if (!sentences) {
    const audio = await ensureAudio(ctx, project, [0.1, 0.2]);
    project = audio.project;
    sentences = await transcribeProject(ctx, project, audio.audioFile, stt, [0.2, 0.7]);
    project = (await loadProject(project.id))!;
  } else if (!project.waveformPath) {
    // Waveform is only cosmetic; rebuild opportunistically if missing.
    project = (await ensureAudio(ctx, project, [0.68, 0.7])).project;
  }

  await runAnalysis(ctx, project, sentences, llm, { range: [0.7, 1], reuseSections: false });
}

/** Re-analysis with new settings; reuses the transcript (and topic map when only ranking inputs changed). */
export async function analyzeJob(ctx: JobContext): Promise<void> {
  const project = await loadProject(ctx.job.projectId!);
  if (!project) return;
  const transcript = await getDb().query.transcripts.findFirst({ where: eq(transcripts.projectId, project.id) });
  if (!transcript) throw new AppError("TRANSCRIPTION_FAILED", "No transcript to analyze", { retryable: false });
  const llm = (await providersForUser(project.userId)).llm();
  await runAnalysis(ctx, project, transcript.segments, llm, {
    range: [0, 1],
    reuseSections: ctx.job.payload.reuseSections !== false,
  });
}

/** Metadata-only job run right after an upload completes (shows duration/resolution quickly). */
export async function probeJob(ctx: JobContext): Promise<void> {
  const project = await loadProject(ctx.job.projectId!);
  if (!project || project.duration) return;
  await ensureMetadata(ctx, project);
}
