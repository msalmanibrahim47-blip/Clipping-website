import { keepRanges, sentencesInRange, sourceToOutput, type Sentence, type TimeRange, type Word } from "./transcript";
import type { CaptionStyle } from "./settings";

export interface CaptionCue {
  start: number;
  end: number;
  /** Lines of the cue (already split per maxLines/maxCharsPerLine). */
  lines: string[];
  /** Words with output-timeline timing, used for word highlighting. */
  words: Word[];
}

export interface SegmentOptions {
  maxCharsPerLine: number;
  maxLines: number;
  /** Longest a single cue may stay on screen (s). */
  maxCueDuration?: number;
  minCueDuration?: number;
}

/**
 * Words that naturally begin a new phrase. A break *before* them reads naturally, e.g.
 * "Guys aaj hum basically ye dekhne wale hain" | "ke business ko scale kaise karna hai."
 */
const PHRASE_STARTERS = new Set([
  // English
  "and", "but", "so", "because", "that", "which", "who", "when", "where", "while", "if", "then",
  "or", "although", "though", "since", "unless", "until", "after", "before", "like", "actually",
  // Hinglish / Urdu (romanized)
  "ke", "ki", "aur", "lekin", "magar", "par", "toh", "to", "kyunki", "kyonki", "kyun", "jab",
  "agar", "phir", "fir", "ya", "yaani", "matlab", "balki", "warna", "jaise", "taaki", "jo", "jis",
  "jisme", "isliye", "kyuki", "bas", "abhi",
  // Devanagari / Urdu script equivalents
  "कि", "के", "और", "लेकिन", "मगर", "पर", "तो", "क्योंकि", "जब", "अगर", "फिर", "या", "मतलब", "जो",
  "کہ", "کے", "اور", "لیکن", "مگر", "پر", "تو", "کیونکہ", "جب", "اگر", "پھر", "یا", "مطلب", "جو",
]);

/** Words that should not end a caption line (they bind to what follows). */
const DANGLING = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "my", "your", "his", "her", "our",
  "their", "is", "was", "i", "we", "you", "ek", "ye", "yeh", "wo", "woh", "is", "us", "hum", "main",
  "mein", "apne", "apna", "apni",
]);

const TERMINAL = /[.?!।۔؟…]["'”’)\]]*$/;
const SOFT = /[,;:،—–-]["'”’)\]]*$/;

function clean(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Cost of breaking *after* word i (lower is better). */
function breakCost(words: Word[], i: number): number {
  const w = words[i];
  const next = words[i + 1];
  if (!next) return 0;
  const gap = next.s - w.e;
  let cost = 6;
  if (TERMINAL.test(w.w)) cost = 0;
  else if (SOFT.test(w.w)) cost = 1.5;
  else if (PHRASE_STARTERS.has(clean(next.w))) cost = 2.5;
  if (gap >= 0.7) cost = Math.min(cost, 0.5);
  else if (gap >= 0.35) cost = Math.min(cost, 2);
  if (DANGLING.has(clean(w.w)) && !TERMINAL.test(w.w)) cost += 4;
  return cost;
}

function textLength(words: Word[], from: number, to: number): number {
  let len = 0;
  for (let k = from; k <= to; k++) len += words[k].w.length + (k > from ? 1 : 0);
  return len;
}

/**
 * Optimal (dynamic-programming) caption segmentation over natural break points.
 * Each cue fits in maxLines × maxCharsPerLine and prefers to end at sentence ends, pauses,
 * commas or before connective words — never mid-phrase when avoidable.
 */
export function segmentCaptions(words: Word[], opts: SegmentOptions): CaptionCue[] {
  const n = words.length;
  if (n === 0) return [];
  const maxChars = opts.maxCharsPerLine * opts.maxLines;
  const ideal = maxChars * 0.72;
  const maxDur = opts.maxCueDuration ?? 6.5;
  const minDur = opts.minCueDuration ?? 0.8;

  const best = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    // cue = words[i .. j-1]
    for (let i = j - 1; i >= 0; i--) {
      const len = textLength(words, i, j - 1);
      if (len > maxChars && i < j - 1) break;
      const dur = words[j - 1].e - words[i].s;
      if (dur > maxDur * 1.6 && i < j - 1) break;
      // Never let a cue swallow a long pause between words.
      let internalPause = 0;
      for (let k = i; k < j - 1; k++) internalPause = Math.max(internalPause, words[k + 1].s - words[k].e);
      let cost = best[i] + breakCost(words, j - 1) * 3;
      cost += Math.pow((len - ideal) / ideal, 2) * 4;
      if (dur > maxDur) cost += (dur - maxDur) * 3;
      if (dur < minDur) cost += (minDur - dur) * 4;
      if (j - i === 1 && n > 1) cost += 3;
      if (internalPause > 1.2) cost += 10 * internalPause;
      if (cost < best[j]) {
        best[j] = cost;
        prev[j] = i;
      }
    }
  }

  const ranges: Array<[number, number]> = [];
  for (let j = n; j > 0; j = prev[j]) ranges.unshift([prev[j], j - 1]);

  const cues: CaptionCue[] = ranges.map(([i, j]) => {
    const cueWords = words.slice(i, j + 1);
    return {
      start: cueWords[0].s,
      end: cueWords[cueWords.length - 1].e,
      lines: splitLines(cueWords, opts.maxCharsPerLine, opts.maxLines),
      words: cueWords,
    };
  });

  // Smooth timing: hold each cue until the next one when the gap is short, and enforce a
  // minimum on-screen time without overlapping the following cue.
  for (let k = 0; k < cues.length; k++) {
    const next = cues[k + 1];
    const c = cues[k];
    if (next && next.start - c.end < 0.6) c.end = next.start;
    if (c.end - c.start < minDur) c.end = next ? Math.min(next.start, c.start + minDur) : c.start + minDur;
  }
  return cues;
}

/** Splits one cue into balanced lines, preferring natural breaks. */
export function splitLines(words: Word[], maxCharsPerLine: number, maxLines: number): string[] {
  const full = words.map((w) => w.w).join(" ");
  if (maxLines <= 1 || full.length <= maxCharsPerLine) return [full];
  const n = words.length;
  let bestCost = Infinity;
  let bestSplit: number[] = [];
  const search = (startIdx: number, linesLeft: number, acc: number[], cost: number) => {
    if (cost >= bestCost) return;
    if (linesLeft === 1) {
      const len = textLength(words, startIdx, n - 1);
      const over = Math.max(0, len - maxCharsPerLine);
      const total = cost + over * 5 + Math.abs(len - full.length / maxLines) * 0.05;
      if (total < bestCost) {
        bestCost = total;
        bestSplit = [...acc];
      }
      return;
    }
    for (let k = startIdx; k < n - 1; k++) {
      const len = textLength(words, startIdx, k);
      if (len > maxCharsPerLine && k > startIdx) break;
      const balance = Math.abs(len - full.length / maxLines) * 0.08;
      search(k + 1, linesLeft - 1, [...acc, k], cost + breakCost(words, k) + balance);
    }
  };
  const lineCount = Math.min(maxLines, Math.max(2, Math.ceil(full.length / maxCharsPerLine)));
  search(0, lineCount, [], 0);
  const lines: string[] = [];
  let from = 0;
  for (const cut of bestSplit) {
    lines.push(words.slice(from, cut + 1).map((w) => w.w).join(" "));
    from = cut + 1;
  }
  lines.push(words.slice(from).map((w) => w.w).join(" "));
  return lines.filter(Boolean);
}

// ------------------------------------------------------------------------------------------
// Subtitle file formats
// ------------------------------------------------------------------------------------------

function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSRT(cues: CaptionCue[]): string {
  return (
    cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join("\n")}\n`).join("\n") + "\n"
  );
}

export function toVTT(cues: CaptionCue[]): string {
  const body = cues
    .map((c) => `${srtTime(c.start).replace(",", ".")} --> ${srtTime(c.end).replace(",", ".")}\n${c.lines.join("\n")}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

// ------------------------------------------------------------------------------------------
// ASS (burned-in captions via FFmpeg/libass)
// ------------------------------------------------------------------------------------------

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const r = cs % 100;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(r)}`;
}

/** #RRGGBB + alpha(0 opaque..1 transparent) → ASS &HAABBGGRR */
function assColor(hex: string, transparency = 0): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const a = Math.round(Math.min(1, Math.max(0, transparency)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function assEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
}

export interface AssOptions {
  width: number;
  height: number;
  style: CaptionStyle;
  /** Optional on-screen hook text shown at the top for the first seconds. */
  hook?: { text: string; duration: number } | null;
  showCaptions?: boolean;
}

export function toASS(cues: CaptionCue[], opts: AssOptions): string {
  const { width, height, style } = opts;
  const scale = height / 1080;
  const fontSize = Math.round(style.fontSize * scale);
  const alignment = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const marginV = Math.round((style.marginPercent / 100) * height);
  const borderStyle = style.background ? 3 : 1;
  const outlineColour = style.background ? assColor(style.backgroundColor, 1 - style.backgroundOpacity) : assColor(style.outlineColor);
  const backColour = style.background ? assColor(style.backgroundColor, 1 - style.backgroundOpacity) : assColor("#000000", 0.5);
  const outline = style.background ? Math.max(6, Math.round(10 * scale)) : Math.round(style.outline * scale * 10) / 10;
  const shadow = style.background ? 0 : Math.round(style.shadow * scale * 10) / 10;
  const bold = style.bold ? -1 : 0;
  const font = style.font;
  const hookSize = Math.round(fontSize * 1.1);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${font},${fontSize},${assColor(style.textColor)},${assColor(style.highlightColor)},${outlineColour},${backColour},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},${Math.round(width * 0.06)},${Math.round(width * 0.06)},${marginV},1
Style: Hook,${font},${hookSize},${assColor("#FFFFFF")},${assColor(style.highlightColor)},${assColor("#000000", 0.25)},${assColor("#000000", 0.25)},-1,0,0,0,100,100,0,0,3,${Math.max(8, Math.round(14 * scale))},0,8,${Math.round(width * 0.08)},${Math.round(width * 0.08)},${Math.round(height * 0.07)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  const transform = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  const hl = assColor(style.highlightColor);
  const base = assColor(style.textColor);

  if (opts.showCaptions !== false) {
    for (const cue of cues) {
      if (style.wordHighlight && cue.words.length > 0) {
        // One event per spoken word, with the active word recoloured.
        const lineBreakAfter = new Set<number>();
        let count = 0;
        for (const line of cue.lines.slice(0, -1)) {
          count += line.split(/\s+/).filter(Boolean).length;
          lineBreakAfter.add(count - 1);
        }
        for (let k = 0; k < cue.words.length; k++) {
          const s = k === 0 ? cue.start : cue.words[k].s;
          const e = k === cue.words.length - 1 ? cue.end : cue.words[k + 1].s;
          if (e - s <= 0.01) continue;
          const text = cue.words
            .map((w, idx) => {
              const t = assEscape(transform(w.w));
              const colored = idx === k ? `{\\c${hl}}${t}{\\c${base}}` : t;
              return colored + (lineBreakAfter.has(idx) ? "\\N" : " ");
            })
            .join("")
            .trim();
          events.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Caption,,0,0,0,,${text}`);
        }
      } else {
        const text = cue.lines.map((l) => assEscape(transform(l))).join("\\N");
        events.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${text}`);
      }
    }
  }
  if (opts.hook?.text) {
    events.push(
      `Dialogue: 1,${assTime(0)},${assTime(opts.hook.duration)},Hook,,0,0,0,,{\\fad(250,400)}${assEscape(opts.hook.text)}`,
    );
  }
  return header + events.join("\n") + "\n";
}

/**
 * Distributes timing across replacement text (translation/transliteration) for a sentence.
 * When the word count is unchanged, original word timings are reused 1:1 (common for
 * Devanagari → Roman Hinglish), which keeps word highlighting accurate.
 */
export function retimeText(text: string, original: Word[]): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || original.length === 0) return [];
  if (tokens.length === original.length) return tokens.map((w, i) => ({ ...original[i], w }));
  const start = original[0].s;
  const end = original[original.length - 1].e;
  const totalChars = tokens.reduce((sum, t) => sum + t.length + 1, 0);
  const out: Word[] = [];
  let cursor = start;
  for (const t of tokens) {
    const dur = ((t.length + 1) / totalChars) * (end - start);
    out.push({ s: cursor, e: cursor + dur, w: t, sp: original[0].sp });
    cursor += dur;
  }
  return out;
}

/**
 * Caption words for a clip on the output timeline: honours cuts, and swaps in translated /
 * romanized sentence text (`overrides`, keyed by sentence index) with redistributed timing.
 */
export function captionWords(
  sentences: Sentence[],
  start: number,
  end: number,
  cuts: TimeRange[] = [],
  overrides?: Map<number, string> | null,
): Word[] {
  const keeps = keepRanges(start, end, cuts);
  const out: Word[] = [];
  for (const s of sentencesInRange(sentences, start, end)) {
    const original: Word[] = s.w.map(([ws, we, w]) => ({ s: ws, e: we, w, sp: s.sp }));
    const override = overrides?.get(s.i);
    const words = override ? retimeText(override, original) : original;
    for (const w of words) {
      const mid = (w.s + w.e) / 2;
      if (mid < start || mid >= end) continue;
      const k = keeps.find((r) => mid >= r.start && mid <= r.end);
      if (!k) continue;
      const os = sourceToOutput(keeps, Math.max(w.s, k.start));
      const oe = sourceToOutput(keeps, Math.min(w.e, k.end));
      if (os == null || oe == null) continue;
      out.push({ ...w, s: Math.round(os * 1000) / 1000, e: Math.round(Math.max(oe, os + 0.05) * 1000) / 1000 });
    }
  }
  return out;
}
