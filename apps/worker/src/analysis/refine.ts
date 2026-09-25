import { z } from "zod";
import {
  CONTENT_TYPE_LABELS,
  formatDuration,
  formatTimestamp,
  normalizeSignals,
  SIGNAL_KEYS,
  SIGNAL_LABELS,
  STRATEGY_GUIDANCE,
  STRATEGY_LABELS,
  type ContextFlags,
  type ProjectSettings,
  type Sentence,
  type SignalKey,
  type Signals,
} from "@longcut/shared";
import type { LlmProvider } from "../llm";
import type { Candidate } from "./candidates";
import { formatSentences, hasSpeakers, isCleanEnd, isCleanStart } from "./format";
import { REFINE_SYSTEM } from "./prompts";

const signalShape = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, z.number()])) as Record<SignalKey, z.ZodNumber>;

const refineSchema = z.object({
  startIdx: z.number().int(),
  endIdx: z.number().int(),
  title: z.string(),
  reason: z.string(),
  summary: z.string(),
  topics: z.array(z.string()),
  hookIdx: z.number().int(),
  signals: z.object(signalShape),
  flags: z.object({
    startsMidThought: z.boolean(),
    endsAbruptly: z.boolean(),
    needsPriorContext: z.boolean(),
  }),
});

export interface RefinedClip {
  startIdx: number;
  endIdx: number;
  start: number;
  end: number;
  title: string;
  reason: string;
  summary: string;
  topics: string[];
  hookText: string;
  hookStart: number;
  signals: Signals;
  flags: ContextFlags;
}

/**
 * Enforces the duration window on sentence boundaries, preferring clean (conclusive) ends.
 * Exported for tests.
 */
export function enforceWindow(
  sentences: Sentence[],
  startIdx: number,
  endIdx: number,
  window: { min: number; max: number },
): { startIdx: number; endIdx: number } {
  const byPos = (idx: number) => sentences.findIndex((s) => s.i === idx);
  let a = Math.max(0, byPos(startIdx));
  let b = Math.max(a, byPos(endIdx));
  const dur = () => sentences[b].e - sentences[a].s;
  const maxAllowed = window.max * 1.04;
  const minAllowed = window.min * 0.96;

  if (dur() > maxAllowed) {
    // Pull the end back to the latest clean ending that fits; else any sentence end that fits.
    let clean = -1;
    let any = -1;
    for (let k = b; k > a; k--) {
      if (sentences[k].e - sentences[a].s <= maxAllowed) {
        if (any < 0) any = k;
        if (isCleanEnd(sentences, k)) {
          clean = k;
          break;
        }
      }
    }
    b = clean >= 0 && sentences[clean].e - sentences[a].s >= minAllowed ? clean : any >= 0 ? any : b;
  }
  if (dur() < minAllowed) {
    // Extend forward to a clean end, then backward to a clean start if still short.
    for (let k = b + 1; k < sentences.length && sentences[k].e - sentences[a].s <= maxAllowed; k++) {
      b = k;
      if (dur() >= minAllowed && isCleanEnd(sentences, k)) break;
    }
    for (let k = a - 1; k >= 0 && dur() < minAllowed && sentences[b].e - sentences[k].s <= maxAllowed; k--) {
      a = k;
      if (dur() >= minAllowed && isCleanStart(sentences, k)) break;
    }
  }
  return { startIdx: sentences[a].i, endIdx: sentences[b].i };
}

export async function refineCandidate(opts: {
  candidate: Candidate;
  sentences: Sentence[];
  settings: ProjectSettings;
  window: { min: number; max: number; target: number | null };
  llm: LlmProvider;
  signal?: AbortSignal;
}): Promise<RefinedClip> {
  const { candidate, sentences, window, settings } = opts;
  const dur = candidate.end - candidate.start;
  const margin = Math.min(420, Math.max(150, (window.max - dur) / 2 + 60));
  const ctx = sentences.filter((s) => s.e > candidate.start - margin && s.s < candidate.end + margin);
  const proposedStart = ctx.find((s) => s.s >= candidate.start - 0.01) ?? ctx[0];
  const proposedEnd = [...ctx].reverse().find((s) => s.e <= candidate.end + 0.01) ?? ctx[ctx.length - 1];

  const prompt = [
    `Content type: ${CONTENT_TYPE_LABELS[settings.contentType]}. Strategy: ${STRATEGY_LABELS[settings.strategy]} — ${STRATEGY_GUIDANCE[settings.strategy]}`,
    settings.strategy === "custom" && settings.customInstructions ? `Creator instructions: ${settings.customInstructions}` : "",
    `Candidate: "${candidate.workingTitle}" — ${candidate.angle}`,
    `Proposed boundaries: #${proposedStart.i} (${formatTimestamp(proposedStart.s, { alwaysHours: true })}) to #${proposedEnd.i} (${formatTimestamp(proposedEnd.e, { alwaysHours: true })}), ${formatDuration(proposedEnd.e - proposedStart.s)}.`,
    `Allowed duration: ${formatDuration(window.min)} to ${formatDuration(window.max)}${window.target ? `, target ≈ ${formatDuration(window.target)}` : ""}.`,
    `Signals to rate (0–100): ${SIGNAL_KEYS.map((k) => `${k} (${SIGNAL_LABELS[k]})`).join(", ")}.`,
    "",
    "<transcript>",
    formatSentences(ctx, { speakers: hasSpeakers(ctx) }),
    "</transcript>",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await opts.llm.json({
    task: "refine_clip",
    system: REFINE_SYSTEM,
    prompt,
    schema: refineSchema,
    effort: "medium",
    maxTokens: 8000,
    signal: opts.signal,
  });

  const firstIdx = ctx[0].i;
  const lastIdx = ctx[ctx.length - 1].i;
  const clampIdx = (i: number) => Math.max(firstIdx, Math.min(lastIdx, i));
  let s = clampIdx(Math.min(res.startIdx, res.endIdx));
  let e = clampIdx(Math.max(res.startIdx, res.endIdx));
  ({ startIdx: s, endIdx: e } = enforceWindow(sentences, s, e, window));
  const startSentence = sentences.find((x) => x.i === s)!;
  const endSentence = sentences.find((x) => x.i === e)!;
  const hookIdx = res.hookIdx >= s && res.hookIdx <= e ? res.hookIdx : s;
  const hook = sentences.find((x) => x.i === hookIdx) ?? startSentence;

  return {
    startIdx: s,
    endIdx: e,
    start: startSentence.s,
    end: endSentence.e,
    title: res.title.trim(),
    reason: res.reason.trim(),
    summary: res.summary.trim(),
    topics: res.topics.slice(0, 8),
    hookText: hook.t,
    hookStart: hook.s,
    signals: normalizeSignals(res.signals),
    flags: res.flags,
  };
}
