import { describe, expect, it } from "vitest";
import { buildSentences, type Word } from "@longcut/shared";
import { enforceWindow } from "../analysis/refine";
import { buildWindows } from "../analysis/segment";
import { attachPunctuation, cleanWords, mergeChunks } from "../stt/postprocess";

/** A synthetic transcript: one 10-second sentence every 12 seconds for `minutes`. */
function transcript(minutes: number) {
  const words: Word[] = [];
  for (let t = 0; t < minutes * 60; t += 12) {
    for (let k = 0; k < 20; k++) words.push({ s: t + k * 0.5, e: t + k * 0.5 + 0.4, w: k === 19 ? "end." : `w${k}` });
  }
  return buildSentences(words);
}

describe("enforceWindow", () => {
  const sentences = transcript(60);
  it("shrinks overly long ranges to a clean end within max", () => {
    const r = enforceWindow(sentences, 0, sentences.length - 1, { min: 540, max: 660 });
    const dur = sentences[r.endIdx].e - sentences[r.startIdx].s;
    expect(dur).toBeLessThanOrEqual(660 * 1.04);
    expect(dur).toBeGreaterThanOrEqual(540 * 0.96);
  });
  it("extends too-short ranges", () => {
    const r = enforceWindow(sentences, 10, 20, { min: 540, max: 660 });
    const dur = sentences[r.endIdx].e - sentences[r.startIdx].s;
    expect(dur).toBeGreaterThanOrEqual(540 * 0.96);
  });
});

describe("buildWindows", () => {
  it("covers every sentence exactly once", () => {
    const sentences = transcript(125);
    const windows = buildWindows(sentences, 30 * 60);
    expect(windows.length).toBeGreaterThanOrEqual(4);
    expect(windows.flat().map((s) => s.i)).toEqual(sentences.map((s) => s.i));
  });
});

describe("stt postprocess", () => {
  it("attaches punctuation from segment text", () => {
    const words = [
      { s: 0, e: 0.3, w: "hello" },
      { s: 0.3, e: 0.6, w: "there" },
      { s: 0.7, e: 1, w: "how" },
      { s: 1, e: 1.2, w: "are" },
      { s: 1.2, e: 1.5, w: "you" },
    ];
    expect(attachPunctuation(words, ["Hello there.", "How are you?"]).map((w) => w.w)).toEqual(["Hello", "there.", "How", "are", "you?"]);
  });
  it("removes hallucination loops", () => {
    const loop = Array.from({ length: 12 }, (_, i) => ({ s: i, e: i + 0.5, w: i % 2 ? "you" : "thank" }));
    expect(cleanWords(loop).length).toBe(2);
  });
  it("merges overlapping chunks without duplicates", () => {
    const merged = mergeChunks([
      { start: 0, end: 604, ownEnd: 602, words: [{ s: 599, e: 599.5, w: "a" }, { s: 601, e: 601.5, w: "b" }, { s: 603, e: 603.5, w: "c" }] },
      { start: 600, end: 1000, ownEnd: Infinity, words: [{ s: 601, e: 601.5, w: "b" }, { s: 603, e: 603.5, w: "c" }] },
    ]);
    expect(merged.map((w) => w.w)).toEqual(["a", "b", "c"]);
  });
});
