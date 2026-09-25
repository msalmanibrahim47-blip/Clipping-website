import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { captionStyleFor, keepRanges, segmentCaptions, toASS } from "@longcut/shared";
import { computeWaveform, cutAudioChunk, extractAudio, extractFrame } from "../media/audio";
import { probe } from "../media/probe";
import { renderClip } from "../media/render";

let hasFfmpeg = true;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "longcut-media-"));
const src = path.join(dir, "src.mkv");

describe.skipIf(!hasFfmpeg)("media pipeline (ffmpeg)", () => {
  beforeAll(() => {
    // 40s 640x360 test pattern + tone, in MKV (not browser playable).
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=40",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=40",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", src,
    ]);
  }, 60_000);

  it("probes", async () => {
    const info = await probe(src);
    expect(Math.round(info.duration)).toBe(40);
    expect(info.height).toBe(360);
    expect(info.hasAudio).toBe(true);
    expect(info.browserPlayable).toBe(false);
  });

  it("extracts audio, chunks and waveform", async () => {
    const audio = path.join(dir, "audio.ogg");
    await extractAudio(src, audio, { duration: 40 });
    const a = await probe(audio).catch(() => null);
    expect(a).toBeNull(); // audio-only files are rejected as video sources
    const chunk = path.join(dir, "chunk.ogg");
    await cutAudioChunk(audio, 10, 10, chunk);
    expect(fs.statSync(chunk).size).toBeGreaterThan(1000);
    const peaks = await computeWaveform(audio, 10);
    expect(peaks.length).toBeGreaterThanOrEqual(395);
    expect(Math.max(...peaks)).toBeGreaterThan(100);
  }, 60_000);

  it("renders a clip with cuts and burned captions", async () => {
    const words = Array.from({ length: 20 }, (_, i) => ({ s: i * 0.5, e: i * 0.5 + 0.4, w: i === 19 ? "done." : `word${i}` }));
    const cues = segmentCaptions(words, { maxCharsPerLine: 42, maxLines: 2 });
    const ass = path.join(dir, "c.ass");
    fs.writeFileSync(ass, toASS(cues, { width: 640, height: 360, style: captionStyleFor("highlight"), hook: { text: "Hook text", duration: 2 } }));
    const out = path.join(dir, "out.mp4");
    let last = 0;
    await renderClip({
      source: src,
      keeps: keepRanges(5, 25, [{ start: 10, end: 15 }]),
      height: 360,
      assPath: ass,
      output: out,
      hasAudio: true,
      onProgress: (f) => (last = f),
    });
    const info = await probe(out);
    expect(Math.round(info.duration)).toBe(15);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
    expect(last).toBeGreaterThan(0.5);
    const frame = path.join(dir, "f.jpg");
    await extractFrame(out, 1, frame, 320);
    expect(fs.statSync(frame).size).toBeGreaterThan(1000);
  }, 120_000);
});
