import type { TimeRange } from "@longcut/shared";
import { config } from "../config";
import { ffmpeg, inputFlags } from "./exec";

export interface RenderInput {
  source: string;
  /** Source-time ranges to keep, in order. */
  keeps: TimeRange[];
  /** Target output height, or null to keep the source resolution. */
  height: number | null;
  assPath: string | null;
  output: string;
  hasAudio: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Renders a clip: seeks straight to the first kept range (HTTP range requests, so a 10-hour
 * source is never downloaded in full), stitches kept ranges, scales, burns captions via
 * libass and encodes H.264/AAC MP4 with faststart.
 */
export async function renderClip(input: RenderInput): Promise<void> {
  const { keeps } = input;
  if (keeps.length === 0) throw new Error("Nothing to render");
  const base = Math.max(0, keeps[0].start - 0.5);
  const span = keeps[keeps.length - 1].end - base + 0.5;
  const total = keeps.reduce((s, k) => s + (k.end - k.start), 0);

  const post: string[] = [];
  if (input.height) post.push(`scale=-2:${input.height}:flags=lanczos`);
  else post.push("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  post.push("setsar=1");
  if (input.assPath) post.push(`ass='${escapeFilterPath(input.assPath)}':fontsdir='${escapeFilterPath(config.fontsDir)}'`);
  post.push("format=yuv420p");

  const parts: string[] = [];
  const concatInputs: string[] = [];
  keeps.forEach((k, i) => {
    const a = (k.start - base).toFixed(3);
    const b = (k.end - base).toFixed(3);
    parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
    if (input.hasAudio) parts.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
    concatInputs.push(input.hasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  const audioOut = input.hasAudio ? 1 : 0;
  parts.push(`${concatInputs.join("")}concat=n=${keeps.length}:v=1:a=${audioOut}[vc]${audioOut ? "[ac]" : ""}`);
  parts.push(`[vc]${post.join(",")}[vout]`);

  const encoder = process.env.RENDER_ENCODER || "libx264";
  const videoArgs =
    encoder === "libx264"
      ? ["-c:v", "libx264", "-preset", config.renderPreset, "-crf", String(config.renderCrf), "-profile:v", "high"]
      : ["-c:v", encoder, "-b:v", process.env.RENDER_BITRATE || "12M"];

  await ffmpeg(
    [
      ...inputFlags(input.source),
      "-ss",
      base.toFixed(3),
      "-t",
      span.toFixed(3),
      "-i",
      input.source,
      "-filter_complex",
      parts.join(";"),
      "-map",
      "[vout]",
      ...(audioOut ? ["-map", "[ac]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : []),
      ...videoArgs,
      "-movflags",
      "+faststart",
      input.output,
    ],
    { signal: input.signal, onProgress: (s) => input.onProgress?.(Math.min(1, s / Math.max(1, total))) },
  );
}
