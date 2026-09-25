import { AppError } from "@longcut/shared";
import { config } from "../config";
import { inputFlags, run } from "./exec";

export interface ProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  bitrate: number | null;
  size: number | null;
  hasAudio: boolean;
  /** Can a browser <video> element play the source directly? */
  browserPlayable: boolean;
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return null;
  return Math.round((n / d) * 100) / 100;
}

export async function probe(input: string, signal?: AbortSignal): Promise<ProbeResult> {
  let out: string;
  try {
    const res = await run(
      config.ffprobePath,
      ["-v", "error", ...inputFlags(input), "-print_format", "json", "-show_format", "-show_streams", input],
      { signal },
    );
    out = res.stdout;
  } catch (err) {
    throw new AppError("SOURCE_UNREADABLE", (err as Error).message, { retryable: false, cause: err });
  }
  const data = JSON.parse(out) as {
    format?: { duration?: string; format_name?: string; bit_rate?: string; size?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !(s.disposition as Record<string, number> | undefined)?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  if (!video) throw new AppError("UNSUPPORTED_FORMAT", "No video stream found", { retryable: false });
  if (!Number.isFinite(duration) || duration <= 0) throw new AppError("SOURCE_UNREADABLE", "Could not determine duration", { retryable: false });

  const container = data.format?.format_name ?? "";
  const videoCodec = (video.codec_name as string) ?? null;
  const audioCodec = (audio?.codec_name as string) ?? null;
  const height = (video.height as number) ?? null;
  // ffprobe reports both MKV and WebM as "matroska,webm"; only WebM-legal codecs play in browsers.
  const isMatroska = container.includes("matroska");
  const webmCodecs = ["vp8", "vp9", "av1"].includes(videoCodec ?? "") && (!audioCodec || ["opus", "vorbis"].includes(audioCodec));
  const browserContainer = isMatroska ? webmCodecs : /mp4|mov/.test(container);
  const browserVideo = ["h264", "vp8", "vp9", "av1"].includes(videoCodec ?? "");
  const browserAudio = !audioCodec || ["aac", "mp3", "opus", "vorbis"].includes(audioCodec);

  return {
    duration,
    width: (video.width as number) ?? null,
    height,
    fps: parseRate(video.avg_frame_rate as string) ?? parseRate(video.r_frame_rate as string),
    container,
    videoCodec,
    audioCodec,
    audioChannels: (audio?.channels as number) ?? null,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    bitrate: data.format?.bit_rate ? Number(data.format.bit_rate) : null,
    size: data.format?.size ? Number(data.format.size) : null,
    hasAudio: Boolean(audio),
    browserPlayable: browserContainer && browserVideo && browserAudio && (height ?? 0) <= 1080,
  };
}
