import type { TopicSection } from "@longcut/db";
import { AppError, computeScore, durationWindow, type ProjectSettings, type Sentence } from "@longcut/shared";
import { config } from "../config";
import type { LlmProvider } from "../llm";
import { log } from "../log";
import { mapLimit } from "../util";
import { overlapRatio, proposeCandidates } from "./candidates";
import { refineCandidate, type RefinedClip } from "./refine";
import { segmentTopics } from "./segment";

export interface AnalysisResult {
  sections: TopicSection[];
  clips: Array<RefinedClip & { score: number }>;
}

/** Duration window adapted to short sources (a 12-minute video can still yield one clip). */
export function effectiveWindow(settings: ProjectSettings, videoDuration: number) {
  const w = durationWindow(settings);
  if (videoDuration < w.min * 1.1) {
    const max = Math.min(w.max, videoDuration);
    return { min: Math.max(60, Math.min(w.min, videoDuration * 0.5)), max, target: w.target ? Math.min(w.target, max) : null };
  }
  return w;
}

/**
 * Long-form clip detection:
 *   1. segment the whole transcript into topics (map over ~30 min windows)
 *   2. propose contiguous multi-section candidates in the 5–20 min window (global reduce)
 *   3. refine every candidate's boundaries on sentence edges and rate its content signals
 *   4. drop weak-context / abrupt candidates, de-duplicate overlaps, rank by strategy
 */
export async function analyzeTranscript(opts: {
  sentences: Sentence[];
  videoDuration: number;
  settings: ProjectSettings;
  llm: LlmProvider;
  existingSections?: TopicSection[] | null;
  signal?: AbortSignal;
  onProgress: (fraction: number, message: string) => Promise<void> | void;
  onSections?: (sections: TopicSection[]) => Promise<void>;
}): Promise<AnalysisResult> {
  const { sentences, settings, llm } = opts;
  const window = effectiveWindow(settings, opts.videoDuration);

  let sections = opts.existingSections ?? null;
  if (!sections || sections.length === 0) {
    await opts.onProgress(0, "Mapping topics across the full transcript…");
    sections = await segmentTopics({
      sentences,
      llm,
      contentType: settings.contentType,
      windowMinutes: config.analysisWindowMinutes,
      concurrency: config.analysisConcurrency,
      signal: opts.signal,
      onProgress: (done, total) => void opts.onProgress((done / total) * 0.4, `Mapping topics… (${done}/${total} sections of the video)`),
    });
    await opts.onSections?.(sections);
  }

  await opts.onProgress(0.42, "Finding strong long-form segments…");
  const candidates = await proposeCandidates({ sections, settings, window, videoDuration: opts.videoDuration, llm, signal: opts.signal });
  if (candidates.length === 0) throw new AppError("NO_CLIPS_FOUND", "No candidates proposed", { retryable: false });

  let refinedCount = 0;
  const refined = (
    await mapLimit(candidates, config.analysisConcurrency, async (candidate) => {
      try {
        const r = await refineCandidate({ candidate, sentences, settings, window, llm, signal: opts.signal });
        return r;
      } catch (err) {
        if (err instanceof AppError && err.code === "PROVIDER_NOT_CONFIGURED") throw err;
        log.warn("candidate refinement failed", { error: (err as Error).message });
        return null;
      } finally {
        refinedCount++;
        await opts.onProgress(0.45 + (refinedCount / candidates.length) * 0.5, `Scoring candidates… (${refinedCount}/${candidates.length})`);
      }
    })
  ).filter((r): r is RefinedClip => r !== null);
  if (refined.length === 0) throw new AppError("ANALYSIS_FAILED", "All candidate refinements failed");

  const scored = refined
    .filter((r) => r.start < opts.videoDuration - 1)
    .map((r) => ({ ...r, end: Math.min(r.end, opts.videoDuration) }))
    .map((r) => ({ ...r, score: computeScore(r.signals, settings.strategy, r.flags, settings.customWeights) }));
  if (scored.length === 0) throw new AppError("NO_CLIPS_FOUND", "No candidates inside the source", { retryable: false });
  // Quality gate: weak standalone context or broken both ends means it's not a real segment.
  const strong = scored.filter(
    (c) => c.signals.standalone >= 40 && !(c.flags.startsMidThought && c.flags.endsAbruptly) && c.end - c.start >= window.min * 0.9,
  );
  const pool = (strong.length > 0 ? strong : scored).sort((a, b) => b.score - a.score);

  const kept: typeof pool = [];
  for (const c of pool) {
    if (kept.some((k) => overlapRatio(k, c) > 0.35)) continue;
    kept.push(c);
    if (kept.length >= settings.clipCount) break;
  }
  return { sections, clips: kept };
}
