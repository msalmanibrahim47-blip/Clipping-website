import { z } from "zod";
import type { TopicSection } from "@longcut/db";
import { CONTENT_TYPE_LABELS, formatDuration, type ContentType, type Sentence } from "@longcut/shared";
import type { LlmProvider } from "../llm";
import { mapLimit } from "../util";
import { formatSentences, hasSpeakers } from "./format";
import { SEGMENT_SYSTEM } from "./prompts";

const SECTION_KINDS = [
  "story",
  "explanation",
  "argument",
  "debate",
  "qa",
  "opinion",
  "interview",
  "tutorial",
  "gameplay",
  "banter",
  "reaction",
  "announcement",
  "filler",
] as const;

const sectionsSchema = z.object({
  sections: z.array(
    z.object({
      startIdx: z.number().int(),
      endIdx: z.number().int(),
      title: z.string(),
      summary: z.string(),
      kind: z.enum(SECTION_KINDS),
      value: z.number(),
      energy: z.number(),
    }),
  ),
});

/**
 * Splits the transcript into ~N-minute windows, cutting at the largest pause near each
 * boundary so windows rarely split a sentence cluster.
 */
export function buildWindows(sentences: Sentence[], windowSeconds: number): Sentence[][] {
  const windows: Sentence[][] = [];
  let startIdx = 0;
  while (startIdx < sentences.length) {
    const windowStart = sentences[startIdx].s;
    let endIdx = startIdx;
    while (endIdx < sentences.length - 1 && sentences[endIdx + 1].e - windowStart <= windowSeconds) endIdx++;
    if (endIdx < sentences.length - 1) {
      // Look back up to 20% of the window for the widest pause / paragraph break.
      let best = endIdx;
      let bestGap = -1;
      for (let k = endIdx; k > startIdx && sentences[endIdx].e - sentences[k].e < windowSeconds * 0.2; k--) {
        const gap = sentences[k + 1].s - sentences[k].e + (sentences[k + 1].p !== sentences[k].p ? 2 : 0);
        if (gap > bestGap) {
          bestGap = gap;
          best = k;
        }
      }
      endIdx = best;
    }
    windows.push(sentences.slice(startIdx, endIdx + 1));
    startIdx = endIdx + 1;
  }
  return windows;
}

/** Normalizes model output into contiguous, in-range sections covering the whole window. */
function normalizeSections(raw: z.infer<typeof sectionsSchema>["sections"], window: Sentence[]): Omit<TopicSection, "id">[] {
  const first = window[0].i;
  const last = window[window.length - 1].i;
  const byIdx = new Map(window.map((s) => [s.i, s]));
  const sorted = raw
    .map((s) => ({ ...s, startIdx: Math.max(first, Math.min(last, s.startIdx)), endIdx: Math.max(first, Math.min(last, s.endIdx)) }))
    .filter((s) => s.endIdx >= s.startIdx)
    .sort((a, b) => a.startIdx - b.startIdx);
  const out: Omit<TopicSection, "id">[] = [];
  let cursor = first;
  for (const s of sorted) {
    if (s.endIdx < cursor) continue;
    const startIdx = cursor;
    const endIdx = s.endIdx;
    out.push({
      startIdx,
      endIdx,
      start: byIdx.get(startIdx)!.s,
      end: byIdx.get(endIdx)!.e,
      title: s.title,
      summary: s.summary,
      kind: s.kind,
      value: Math.max(0, Math.min(100, s.value)),
      energy: Math.max(0, Math.min(100, s.energy)),
    });
    cursor = endIdx + 1;
  }
  if (cursor <= last) {
    if (out.length > 0) {
      const tail = out[out.length - 1];
      tail.endIdx = last;
      tail.end = byIdx.get(last)!.e;
    } else {
      out.push({ startIdx: first, endIdx: last, start: window[0].s, end: window[window.length - 1].e, title: "Discussion", summary: "", kind: "banter", value: 40, energy: 50 });
    }
  }
  return out;
}

export async function segmentTopics(opts: {
  sentences: Sentence[];
  llm: LlmProvider;
  contentType: ContentType;
  windowMinutes: number;
  concurrency: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<TopicSection[]> {
  const windows = buildWindows(opts.sentences, opts.windowMinutes * 60);
  const speakers = hasSpeakers(opts.sentences);
  let done = 0;
  const perWindow = await mapLimit(windows, opts.concurrency, async (window, w) => {
    const prompt = [
      `Content type: ${CONTENT_TYPE_LABELS[opts.contentType]}`,
      `Window ${w + 1} of ${windows.length}: ${formatDuration(window[0].s)} – ${formatDuration(window[window.length - 1].e)} (sentences #${window[0].i}–#${window[window.length - 1].i}).`,
      w > 0 ? "This window continues directly from the previous one; the first section may continue a discussion already in progress." : "",
      "",
      "<transcript>",
      formatSentences(window, { speakers }),
      "</transcript>",
    ]
      .filter(Boolean)
      .join("\n");
    const res = await opts.llm.json({
      task: "segment_topics",
      system: SEGMENT_SYSTEM,
      prompt,
      schema: sectionsSchema,
      fast: true,
      effort: "low",
      maxTokens: 12000,
      signal: opts.signal,
    });
    opts.onProgress?.(++done, windows.length);
    return normalizeSections(res.sections, window);
  });
  return perWindow.flat().map((s, id) => ({ ...s, id }));
}
