import { formatTimestamp, type Sentence } from "@longcut/shared";

/** One transcript line per sentence: `[#123 1:42:14] S1: text`. Indices let the model cite exact boundaries. */
export function formatSentences(sentences: Sentence[], opts: { speakers?: boolean } = {}): string {
  return sentences
    .map((s) => {
      const speaker = opts.speakers && s.sp != null ? `S${s.sp + 1}: ` : "";
      return `[#${s.i} ${formatTimestamp(s.s, { alwaysHours: true })}] ${speaker}${s.t}`;
    })
    .join("\n");
}

export function hasSpeakers(sentences: Sentence[]): boolean {
  const set = new Set<number>();
  for (const s of sentences) if (s.sp != null) set.add(s.sp);
  return set.size > 1;
}

/** Is sentence `i` a natural ending point (terminal punctuation or followed by a pause/paragraph break)? */
export function isCleanEnd(sentences: Sentence[], i: number): boolean {
  const s = sentences[i];
  if (!s) return false;
  const next = sentences[i + 1];
  if (!next) return true;
  return /[.?!।۔؟…]["'”’)\]]*$/.test(s.t) || next.p !== s.p || next.s - s.e > 1.0;
}

export function isCleanStart(sentences: Sentence[], i: number): boolean {
  if (i === 0) return true;
  return isCleanEnd(sentences, i - 1);
}
