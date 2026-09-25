import { z } from "zod";
import type { TopicSection } from "@longcut/db";
import {
  CONTENT_TYPE_LABELS,
  formatDuration,
  formatTimestamp,
  STRATEGY_GUIDANCE,
  STRATEGY_LABELS,
  type ProjectSettings,
} from "@longcut/shared";
import type { LlmProvider } from "../llm";
import { CANDIDATE_SYSTEM } from "./prompts";

export interface Candidate {
  fromSection: number;
  toSection: number;
  start: number;
  end: number;
  workingTitle: string;
  angle: string;
}

const candidatesSchema = z.object({
  candidates: z.array(
    z.object({
      fromSection: z.number().int(),
      toSection: z.number().int(),
      workingTitle: z.string(),
      angle: z.string(),
    }),
  ),
});

export function candidateTarget(clipCount: number): number {
  return Math.min(40, Math.max(6, clipCount * 2 + 2));
}

export async function proposeCandidates(opts: {
  sections: TopicSection[];
  settings: ProjectSettings;
  window: { min: number; max: number; target: number | null };
  videoDuration: number;
  llm: LlmProvider;
  signal?: AbortSignal;
}): Promise<Candidate[]> {
  const { sections, settings, window } = opts;
  const want = candidateTarget(settings.clipCount);
  const map = sections
    .map(
      (s) =>
        `${s.id} | ${formatTimestamp(s.start, { alwaysHours: true })}–${formatTimestamp(s.end, { alwaysHours: true })} | ${formatDuration(s.end - s.start)} | ${s.kind} | value ${Math.round(s.value)} | energy ${Math.round(s.energy)} | ${s.title} — ${s.summary}`,
    )
    .join("\n");
  const prompt = [
    `Video length: ${formatDuration(opts.videoDuration)}. Content type: ${CONTENT_TYPE_LABELS[settings.contentType]}.`,
    `Strategy: ${STRATEGY_LABELS[settings.strategy]} — ${STRATEGY_GUIDANCE[settings.strategy]}`,
    settings.strategy === "custom" && settings.customInstructions ? `Creator instructions: ${settings.customInstructions}` : "",
    `Allowed clip duration: ${formatDuration(window.min)} to ${formatDuration(window.max)}${window.target ? ` (target ≈ ${formatDuration(window.target)})` : ""}.`,
    `Propose up to ${want} non-overlapping candidates, best first. Fewer is fine if the video doesn't contain that many strong complete segments.`,
    "",
    "Sections (id | span | duration | kind | value | energy | title — summary):",
    map,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await opts.llm.json({
    task: "propose_candidates",
    system: CANDIDATE_SYSTEM,
    prompt,
    schema: candidatesSchema,
    effort: "high",
    maxTokens: 16000,
    signal: opts.signal,
  });

  const out: Candidate[] = [];
  for (const c of res.candidates) {
    let from = Math.max(0, Math.min(sections.length - 1, Math.min(c.fromSection, c.toSection)));
    let to = Math.max(0, Math.min(sections.length - 1, Math.max(c.fromSection, c.toSection)));
    ({ from, to } = fitToWindow(sections, from, to, window));
    const cand = { fromSection: from, toSection: to, start: sections[from].start, end: sections[to].end, workingTitle: c.workingTitle, angle: c.angle };
    if (!out.some((o) => overlapRatio(o, cand) > 0.4)) out.push(cand);
  }
  if (out.length < Math.min(want, 3)) out.push(...fallbackCandidates(sections, window, out, want - out.length));
  return out.slice(0, want);
}

/** Grows a too-short range with neighbouring non-filler sections, shrinks a far-too-long one. */
function fitToWindow(sections: TopicSection[], from: number, to: number, window: { min: number; max: number }) {
  const dur = () => sections[to].end - sections[from].start;
  while (dur() < window.min) {
    const canNext = to + 1 < sections.length && sections[to + 1].kind !== "filler";
    const canPrev = from > 0 && sections[from - 1].kind !== "filler";
    if (!canNext && !canPrev) break;
    const nextDur = canNext ? sections[to + 1].end - sections[from].start : Infinity;
    const prevDur = canPrev ? sections[to].end - sections[from - 1].start : Infinity;
    if (Math.min(nextDur, prevDur) > window.max * 1.15) break;
    if (nextDur <= prevDur) to++;
    else from--;
  }
  while (dur() > window.max * 1.5 && to > from) {
    if (sections[to].value <= sections[from].value) to--;
    else from++;
  }
  return { from, to };
}

export function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? inter / shorter : 0;
}

/** Deterministic backup: grow windows around the highest-value sections. */
function fallbackCandidates(
  sections: TopicSection[],
  window: { min: number; max: number },
  existing: Candidate[],
  count: number,
): Candidate[] {
  const out: Candidate[] = [];
  const seeds = sections
    .filter((s) => s.kind !== "filler")
    .sort((a, b) => b.value - a.value);
  for (const seed of seeds) {
    if (out.length >= count) break;
    const { from, to } = fitToWindow(sections, seed.id, seed.id, window);
    const cand: Candidate = {
      fromSection: from,
      toSection: to,
      start: sections[from].start,
      end: sections[to].end,
      workingTitle: seed.title,
      angle: seed.summary,
    };
    if ([...existing, ...out].some((o) => overlapRatio(o, cand) > 0.4)) continue;
    out.push(cand);
  }
  return out;
}
