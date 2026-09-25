/** A single recognized word, times in seconds from the start of the source video. */
export interface Word {
  s: number;
  e: number;
  w: string;
  /** Speaker index when diarization is available. */
  sp?: number;
  /** Recognition confidence 0–1 when available. */
  c?: number;
}

/** Compact word stored inside sentences: [start, end, text]. */
export type CompactWord = [number, number, string];

export interface Sentence {
  /** Sentence index within the transcript. */
  i: number;
  s: number;
  e: number;
  t: string;
  /** Paragraph index. */
  p: number;
  sp?: number;
  w: CompactWord[];
}

export interface TimeRange {
  start: number;
  end: number;
}

const TERMINAL = /[.?!।۔؟…]["'”’)\]]*$/;
const SOFT = /[,;:،]["'”’)\]]*$/;

export interface SentenceOptions {
  /** Pause (s) that always ends a sentence. */
  hardPause?: number;
  /** Pause that ends a paragraph. */
  paragraphPause?: number;
  /** Force a break after this many words (falls back to the best soft break). */
  maxWords?: number;
  maxSentencesPerParagraph?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Groups words into sentences and paragraphs using punctuation, pauses and speaker changes.
 * Works for unpunctuated output too (pauses + length caps), which matters for Hinglish ASR.
 */
export function buildSentences(words: Word[], opts: SentenceOptions = {}): Sentence[] {
  const hardPause = opts.hardPause ?? 1.2;
  const paragraphPause = opts.paragraphPause ?? 2.5;
  const maxWords = opts.maxWords ?? 45;
  const maxPerParagraph = opts.maxSentencesPerParagraph ?? 8;

  const sentences: Sentence[] = [];
  let current: Word[] = [];
  let paragraph = 0;
  let inParagraph = 0;
  let pendingParagraphBreak = false;

  const flush = () => {
    if (current.length === 0) return;
    if (pendingParagraphBreak && sentences.length > 0) {
      paragraph++;
      inParagraph = 0;
    }
    pendingParagraphBreak = false;
    const first = current[0];
    const last = current[current.length - 1];
    sentences.push({
      i: sentences.length,
      s: r3(first.s),
      e: r3(last.e),
      t: current.map((w) => w.w).join(" ").replace(/\s+([,.?!;:])/g, "$1").trim(),
      p: paragraph,
      sp: first.sp,
      w: current.map((w) => [r3(w.s), r3(w.e), w.w] as CompactWord),
    });
    inParagraph++;
    if (inParagraph >= maxPerParagraph) pendingParagraphBreak = true;
    current = [];
  };

  for (let idx = 0; idx < words.length; idx++) {
    const word = words[idx];
    const prev = current[current.length - 1];
    if (prev) {
      const gap = word.s - prev.e;
      const speakerChange = word.sp !== undefined && prev.sp !== undefined && word.sp !== prev.sp;
      if (gap >= hardPause || speakerChange) {
        flush();
        if (gap >= paragraphPause || speakerChange) pendingParagraphBreak = true;
      }
    }
    current.push(word);
    if (TERMINAL.test(word.w)) {
      flush();
    } else if (current.length >= maxWords) {
      // Break at the last soft punctuation or largest pause in the second half.
      let best = current.length - 1;
      let bestScore = -1;
      for (let k = Math.floor(current.length / 2); k < current.length - 1; k++) {
        const score = (SOFT.test(current[k].w) ? 1 : 0) + Math.min(1, current[k + 1].s - current[k].e);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
      const rest = current.slice(best + 1);
      current = current.slice(0, best + 1);
      flush();
      current = rest;
    }
  }
  flush();
  return sentences;
}

export function sentencesToWords(sentences: Sentence[]): Word[] {
  const out: Word[] = [];
  for (const s of sentences) for (const [ws, we, w] of s.w) out.push({ s: ws, e: we, w, sp: s.sp });
  return out;
}

/** Binary search: index of the first sentence ending after `time`. */
export function sentenceIndexAt(sentences: Sentence[], time: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  let ans = sentences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].e > time) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return Math.max(0, ans);
}

/** Sentences overlapping [start, end]. */
export function sentencesInRange(sentences: Sentence[], start: number, end: number): Sentence[] {
  if (sentences.length === 0) return [];
  const out: Sentence[] = [];
  for (let i = sentenceIndexAt(sentences, start); i < sentences.length && sentences[i].s < end; i++) {
    if (sentences[i].e > start) out.push(sentences[i]);
  }
  return out;
}

/** Words whose midpoint falls inside [start, end). */
export function wordsInRange(sentences: Sentence[], start: number, end: number): Word[] {
  const out: Word[] = [];
  for (const s of sentencesInRange(sentences, start, end)) {
    for (const [ws, we, w] of s.w) {
      const mid = (ws + we) / 2;
      if (mid >= start && mid < end) out.push({ s: ws, e: we, w, sp: s.sp });
    }
  }
  return out;
}

/**
 * Snap a time to the nearest sentence start (for clip starts) or end (for clip ends) within
 * `tolerance` seconds. Keeps clips from starting or ending mid-sentence.
 */
export function snapToSentence(sentences: Sentence[], time: number, edge: "start" | "end", tolerance = 8): number {
  if (sentences.length === 0) return time;
  const idx = sentenceIndexAt(sentences, time);
  let best = time;
  let bestDist = Infinity;
  for (let k = Math.max(0, idx - 3); k <= Math.min(sentences.length - 1, idx + 3); k++) {
    const t = edge === "start" ? sentences[k].s : sentences[k].e;
    const d = Math.abs(t - time);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return bestDist <= tolerance ? best : time;
}

// ---------------------------------------------------------------------------------------------
// Cut-aware timeline mapping. A clip is [start, end] in source time minus a list of removed
// ranges ("cuts" from transcript editing). Output time is the position in the rendered clip.
// ---------------------------------------------------------------------------------------------

/** Normalized, merged keep-ranges (source time) for a clip. */
export function keepRanges(start: number, end: number, cuts: TimeRange[] = []): TimeRange[] {
  const sorted = cuts
    .map((c) => ({ start: Math.max(start, c.start), end: Math.min(end, c.end) }))
    .filter((c) => c.end - c.start > 0.05)
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  const keeps: TimeRange[] = [];
  let cursor = start;
  for (const c of merged) {
    if (c.start > cursor) keeps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (end > cursor) keeps.push({ start: cursor, end });
  return keeps.filter((k) => k.end - k.start > 0.05);
}

export function keptDuration(keeps: TimeRange[]): number {
  return keeps.reduce((sum, k) => sum + (k.end - k.start), 0);
}

/** Maps a source time to output time, or null if the time falls inside a cut or outside the clip. */
export function sourceToOutput(keeps: TimeRange[], t: number): number | null {
  let offset = 0;
  for (const k of keeps) {
    if (t >= k.start && t <= k.end) return offset + (t - k.start);
    offset += k.end - k.start;
  }
  return null;
}

/** Maps output time back to source time. */
export function outputToSource(keeps: TimeRange[], t: number): number {
  let offset = 0;
  for (const k of keeps) {
    const len = k.end - k.start;
    if (t <= offset + len) return k.start + (t - offset);
    offset += len;
  }
  const last = keeps[keeps.length - 1];
  return last ? last.end : t;
}

/** Words of a clip re-timed onto the output timeline (words inside cuts are dropped). */
export function clipWords(sentences: Sentence[], start: number, end: number, cuts: TimeRange[] = []): Word[] {
  const keeps = keepRanges(start, end, cuts);
  const out: Word[] = [];
  for (const w of wordsInRange(sentences, start, end)) {
    const mid = (w.s + w.e) / 2;
    const k = keeps.find((r) => mid >= r.start && mid <= r.end);
    if (!k) continue;
    const s = sourceToOutput(keeps, Math.max(w.s, k.start));
    const e = sourceToOutput(keeps, Math.min(w.e, k.end));
    if (s == null || e == null) continue;
    out.push({ ...w, s: r3(s), e: r3(Math.max(e, s + 0.05)) });
  }
  return out;
}
