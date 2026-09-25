import { describe, expect, it } from "vitest";
import {
  buildSentences,
  clipWords,
  computeScore,
  detectLanguageStyle,
  durationWindow,
  keepRanges,
  outputToSource,
  parseYouTubeId,
  rankClips,
  resolveCaptionTransform,
  segmentCaptions,
  sourceToOutput,
  toSRT,
  toASS,
  captionStyleFor,
  formatTimestamp,
  formatDuration,
  parseTimestamp,
  type Word,
} from "../index";

function words(text: string, start = 0, step = 0.4): Word[] {
  return text.split(" ").map((w, i) => ({ s: start + i * step, e: start + i * step + step * 0.9, w }));
}

describe("time", () => {
  it("formats", () => {
    expect(formatTimestamp(6134)).toBe("01:42:14");
    expect(formatTimestamp(762)).toBe("12:42");
    expect(formatDuration(636)).toBe("10:36");
    expect(parseTimestamp("1:02:15")).toBe(3735);
    expect(parseTimestamp("abc")).toBeNull();
  });
});

describe("captions", () => {
  it("breaks Hinglish at natural phrase boundaries", () => {
    const w = words("Guys aaj hum basically ye dekhne wale hain ke business ko scale kaise karna hai.");
    const cues = segmentCaptions(w, { maxCharsPerLine: 42, maxLines: 1 });
    expect(cues.map((c) => c.lines.join(" "))).toEqual([
      "Guys aaj hum basically ye dekhne wale hain",
      "ke business ko scale kaise karna hai.",
    ]);
  });

  it("keeps cues within limits and in order", () => {
    const w = words(
      "So the first thing you need to understand is that most businesses never scale because the founder is doing everything. And that is exactly why they stay small forever, right?",
    );
    const cues = segmentCaptions(w, { maxCharsPerLine: 42, maxLines: 2 });
    for (const c of cues) {
      for (const line of c.lines) expect(line.length).toBeLessThanOrEqual(42);
      expect(c.lines.length).toBeLessThanOrEqual(2);
      expect(c.end).toBeGreaterThan(c.start);
    }
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end - 1e-6);
    const srt = toSRT(cues);
    expect(srt).toContain("00:00:00,000 --> ");
    const ass = toASS(cues, { width: 1920, height: 1080, style: captionStyleFor("highlight") });
    expect(ass).toContain("Dialogue:");
  });
});

describe("timeline", () => {
  it("maps across cuts", () => {
    const keeps = keepRanges(100, 200, [{ start: 120, end: 130 }]);
    expect(keeps).toEqual([
      { start: 100, end: 120 },
      { start: 130, end: 200 },
    ]);
    expect(sourceToOutput(keeps, 125)).toBeNull();
    expect(sourceToOutput(keeps, 140)).toBe(30);
    expect(outputToSource(keeps, 30)).toBe(140);
  });

  it("builds sentences and retimes clip words", () => {
    const w = [...words("Hello there friend.", 100), ...words("This is cut.", 102), ...words("And we continue.", 104)];
    const sentences = buildSentences(w);
    expect(sentences).toHaveLength(3);
    const cw = clipWords(sentences, 100, 106, [{ start: 102, end: 103.5 }]);
    expect(cw.map((x) => x.w)).toEqual(["Hello", "there", "friend.", "And", "we", "continue."]);
    expect(cw[0].s).toBe(0);
  });
});

describe("language", () => {
  it("detects Hinglish", () => {
    const r = detectLanguageStyle("Guys aaj hum basically ye dekhne wale hain ke business ko scale kaise karna hai aur kya problem hai");
    expect(r.style).toBe("hinglish");
    expect(resolveCaptionTransform("english", r)).toBe("translate_en");
    expect(resolveCaptionTransform("hinglish", r)).toBe("none");
  });
  it("detects English", () => {
    const r = detectLanguageStyle("Today we are going to talk about how most businesses never scale and what founders should do about it");
    expect(r.style).toBe("english");
  });
  it("detects Hindi script", () => {
    const r = detectLanguageStyle("आज हम देखने वाले हैं कि बिज़नेस को कैसे स्केल करना है और क्या समस्या है");
    expect(r.style).toBe("hindi");
    expect(resolveCaptionTransform("hinglish", r)).toBe("romanize");
  });
});

describe("scoring", () => {
  it("re-ranks by strategy", () => {
    const clips = [
      { id: "a", signals: { humor: 95, energy: 90, density: 30, standalone: 80, completeness: 80 } },
      { id: "b", signals: { humor: 10, energy: 40, density: 95, relevance: 95, standalone: 80, completeness: 85 } },
    ];
    expect(rankClips(clips, "comedy")[0].id).toBe("a");
    expect(rankClips(clips, "educational")[0].id).toBe("b");
    expect(computeScore({}, "balanced", { endsAbruptly: true })).toBeLessThan(computeScore({}, "balanced"));
  });
  it("duration windows", () => {
    expect(durationWindow({ clipLength: 10 })).toEqual({ min: 528, max: 672, target: 600 });
    expect(durationWindow({ clipLength: "auto" })).toEqual({ min: 300, max: 1200, target: null });
  });
});

describe("youtube", () => {
  it("parses ids", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtube.com/live/dQw4w9WgXcQ?feature=share")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});
