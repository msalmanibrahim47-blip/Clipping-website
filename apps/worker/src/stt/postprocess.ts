import type { Word } from "@longcut/shared";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");

/**
 * Whisper's word list has no punctuation, but its segment text does. Walks both sequences and
 * copies punctuated tokens onto timed words so sentence detection has real boundaries.
 */
export function attachPunctuation(words: Word[], segmentTexts: string[]): Word[] {
  const tokens = segmentTexts.join(" ").split(/\s+/).filter(Boolean);
  const out = words.map((w) => ({ ...w }));
  let t = 0;
  for (const w of out) {
    const target = norm(w.w);
    if (!target) continue;
    for (let look = t; look < Math.min(tokens.length, t + 6); look++) {
      if (norm(tokens[look]) === target) {
        w.w = tokens[look];
        t = look + 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Removes classic ASR hallucination loops (the same phrase repeated many times over silence
 * or music) and zero/negative-length words.
 */
export function cleanWords(words: Word[]): Word[] {
  const valid = words
    .map((w) => ({ ...w, w: w.w.trim() }))
    .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e))
    .map((w) => (w.e <= w.s ? { ...w, e: w.s + 0.05 } : w));
  const out: Word[] = [];
  for (let i = 0; i < valid.length; i++) {
    let removed = false;
    for (let n = 1; n <= 6 && !removed; n++) {
      // Count how many times the n-gram starting at i repeats back-to-back.
      let reps = 1;
      while (i + (reps + 1) * n <= valid.length) {
        let same = true;
        for (let k = 0; k < n; k++) {
          if (norm(valid[i + k].w) !== norm(valid[i + reps * n + k].w)) {
            same = false;
            break;
          }
        }
        if (!same) break;
        reps++;
      }
      if (reps >= (n === 1 ? 6 : 4)) {
        for (let k = 0; k < n; k++) out.push(valid[i + k]);
        i += reps * n - 1;
        removed = true;
      }
    }
    if (!removed) out.push(valid[i]);
  }
  return out;
}

/**
 * Merges chunk transcripts transcribed with overlap. Each chunk owns the words whose midpoint
 * lies before the midpoint of its overlap with the next chunk, so no word is lost or doubled.
 */
export function mergeChunks(chunks: Array<{ start: number; end: number; ownEnd: number; words: Word[] }>): Word[] {
  const out: Word[] = [];
  let prevOwnEnd = -Infinity;
  for (const c of chunks) {
    for (const w of c.words) {
      const mid = (w.s + w.e) / 2;
      if (mid >= prevOwnEnd && mid < c.ownEnd) out.push(w);
    }
    prevOwnEnd = c.ownEnd;
  }
  return out.sort((a, b) => a.s - b.s);
}
