import { z } from "zod";
import type { Sentence } from "@longcut/shared";
import type { LlmProvider } from "../llm";
import { mapLimit } from "../util";
import { translateSystem } from "./prompts";

const schema = z.object({ sentences: z.array(z.object({ idx: z.number().int(), text: z.string() })) });

/**
 * Converts transcript sentences for a caption language (English translation or Roman-script
 * Hinglish). Results are cached per sentence, so clip boundary edits don't re-translate.
 */
export async function transformSentences(opts: {
  llm: LlmProvider;
  mode: "translate_en" | "romanize";
  sentences: Sentence[];
  concurrency: number;
  signal?: AbortSignal;
}): Promise<Map<number, string>> {
  const batches: Sentence[][] = [];
  for (let i = 0; i < opts.sentences.length; i += 40) batches.push(opts.sentences.slice(i, i + 40));
  const out = new Map<number, string>();
  await mapLimit(batches, opts.concurrency, async (batch) => {
    const res = await opts.llm.json({
      task: `captions_${opts.mode}`,
      system: translateSystem(opts.mode),
      prompt: JSON.stringify(batch.map((s) => ({ idx: s.i, text: s.t }))),
      schema,
      fast: true,
      effort: "low",
      maxTokens: 8000,
      signal: opts.signal,
    });
    const allowed = new Set(batch.map((s) => s.i));
    for (const r of res.sentences) if (allowed.has(r.idx) && r.text.trim()) out.set(r.idx, r.text.trim());
    // Any sentence the model skipped keeps its original text rather than disappearing.
    for (const s of batch) if (!out.has(s.i)) out.set(s.i, s.t);
  });
  return out;
}
