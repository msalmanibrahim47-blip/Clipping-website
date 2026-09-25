import { spawn } from "node:child_process";
import { config } from "../config";
import { ffmpeg, inputFlags } from "./exec";

/**
 * Extracts a speech-optimized mono 16 kHz Opus track. ~14 MB/hour, so even a 10-hour source
 * yields a small file that is cached in storage and reused for chunked transcription.
 */
export async function extractAudio(
  input: string,
  output: string,
  opts: { duration: number; signal?: AbortSignal; onProgress?: (fraction: number) => void },
) {
  await ffmpeg(
    [
      ...inputFlags(input),
      "-i",
      input,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-af",
      "highpass=f=60,lowpass=f=7800",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      "-application",
      "voip",
      output,
    ],
    { signal: opts.signal, onProgress: (s) => opts.onProgress?.(Math.min(1, s / Math.max(1, opts.duration))) },
  );
}

/** Cuts [start, start+length] from the audio file into its own small Opus file. */
export async function cutAudioChunk(audioPath: string, start: number, length: number, output: string, signal?: AbortSignal) {
  await ffmpeg(
    ["-ss", start.toFixed(3), "-t", length.toFixed(3), "-i", audioPath, "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", output],
    { signal },
  );
}

/**
 * Computes waveform peaks (uint8, `rate` values per second) by streaming raw PCM out of
 * FFmpeg — constant memory regardless of source length.
 */
export function computeWaveform(audioPath: string, rate = 10, signal?: AbortSignal): Promise<Buffer> {
  const sampleRate = 8000;
  const samplesPerPeak = Math.floor(sampleRate / rate);
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", audioPath, "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "pipe:1"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
    const peaks: number[] = [];
    let count = 0;
    let max = 0;
    let leftover: Buffer | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      const data: Buffer = leftover ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = data.length - (data.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(data.readInt16LE(i));
        if (v > max) max = v;
        if (++count >= samplesPerPeak) {
          peaks.push(max);
          count = 0;
          max = 0;
        }
      }
      leftover = usable < data.length ? data.subarray(usable) : null;
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`waveform ffmpeg failed: ${stderr.slice(-500)}`));
      if (count > 0) peaks.push(max);
      // Normalize against the 99th percentile so a single loud spike doesn't flatten everything.
      const sorted = [...peaks].sort((a, b) => a - b);
      const ref = Math.max(1, sorted[Math.floor(sorted.length * 0.99)] ?? 1);
      resolve(Buffer.from(peaks.map((p) => Math.min(255, Math.round((p / ref) * 255)))));
    });
  });
}

/** Grabs one JPEG frame (used for project thumbnails and clip source frames). */
export async function extractFrame(input: string, at: number, output: string, width = 1280, signal?: AbortSignal) {
  await ffmpeg(
    [...inputFlags(input), "-ss", Math.max(0, at).toFixed(2), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", output],
    { signal },
  );
}

/**
 * Builds a lightweight 540p H.264 proxy for in-browser preview/scrubbing when the source
 * can't be played by browsers (MKV/AVI/HEVC/ProRes) or is very large.
 */
export async function buildPreviewProxy(
  input: string,
  output: string,
  opts: { duration: number; signal?: AbortSignal; onProgress?: (fraction: number) => void },
) {
  await ffmpeg(
    [
      ...inputFlags(input),
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=-2:540,fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-g",
      "60",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      output,
    ],
    { signal: opts.signal, onProgress: (s) => opts.onProgress?.(Math.min(1, s / Math.max(1, opts.duration))) },
  );
}
