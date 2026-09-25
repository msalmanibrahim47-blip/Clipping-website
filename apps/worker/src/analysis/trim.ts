import { z } from "zod";
import { formatDuration, type Sentence } from "@longcut/shared";
import type { LlmProvider } from "../llm";
import { log } from "../log";
import { formatSentences } from "./format";
import { TRIM_SYSTEM } from "./prompts";
import { enforceWindow } from "./refine";

const trimSchema = z.object({ startIdx: z.number().int(), endIdx: z.number().int(), reason: z.string() });

/**
 * Picks the strongest complete sub-section of about `target` seconds inside a clip (used when
 * an export preset is shorter than the clip). Falls back to a deterministic window if the
 * model is unavailable.
 */
export async function smartTrim(opts: {
  llm: LlmProvider | null;
  sentences: Sentence[];
  target: number;
  signal?: AbortSignal;
}): Promise<{ start: number; end: number }> {
  const { sentences, target } = opts;
  const window = { min: target * 0.92, max: target * 1.08 };
  let startIdx = sentences[0].i;
  let endIdx = sentences[sentences.length - 1].i;
  if (opts.llm) {
    try {
      const res = await opts.llm.json({
        task: "smart_trim",
        system: TRIM_SYSTEM,
        prompt: `Target duration: ${formatDuration(target)} (clip is ${formatDuration(sentences[sentences.length - 1].e - sentences[0].s)}).\n\n<transcript>\n${formatSentences(sentences)}\n</transcript>`,
        schema: trimSchema,
        effort: "medium",
        maxTokens: 4000,
        signal: opts.signal,
      });
      startIdx = res.startIdx;
      endIdx = res.endIdx;
    } catch (err) {
      log.warn("smart trim fell back to deterministic", { error: (err as Error).message });
    }
  }
  const first = sentences[0].i;
  const last = sentences[sentences.length - 1].i;
  startIdx = Math.max(first, Math.min(last, startIdx));
  endIdx = Math.max(startIdx, Math.min(last, endIdx));
  const fitted = enforceWindow(sentences, startIdx, endIdx, window);
  const s = sentences.find((x) => x.i === fitted.startIdx)!;
  const e = sentences.find((x) => x.i === fitted.endIdx)!;
  return { start: s.s, end: e.e };
}
