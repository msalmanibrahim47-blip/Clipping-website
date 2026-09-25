import os from "node:os";
import path from "node:path";

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  workerId: process.env.WORKER_ID || `${os.hostname()}-${process.pid}`,
  tmpDir: process.env.WORKER_TMP_DIR || path.join(os.tmpdir(), "longcut"),
  /** Concurrent FFmpeg-heavy jobs (process, render, preview). */
  heavyConcurrency: num("WORKER_HEAVY_CONCURRENCY", 1),
  /** Concurrent light jobs (LLM analysis, packages, captions, probes, cleanup). */
  lightConcurrency: num("WORKER_LIGHT_CONCURRENCY", 4),
  leaseSeconds: num("WORKER_LEASE_SECONDS", 120),
  pollIntervalMs: num("WORKER_POLL_INTERVAL_MS", 3000),
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  ytDlpPath: process.env.YTDLP_PATH || "yt-dlp",
  ytDlpCookies: process.env.YTDLP_COOKIES_FILE || "",
  pythonPath: process.env.PYTHON_PATH || "python3",
  fontsDir: process.env.FONTS_DIR || "/usr/share/fonts",
  renderPreset: process.env.RENDER_PRESET || "medium",
  renderCrf: num("RENDER_CRF", 20),
  /** Seconds of audio per transcription chunk. */
  transcribeChunkSeconds: num("TRANSCRIBE_CHUNK_SECONDS", 600),
  transcribeConcurrency: num("TRANSCRIBE_CONCURRENCY", 3),
  /** Always build a 540p proxy for in-browser preview, even if the source is playable. */
  alwaysProxy: process.env.PREVIEW_ALWAYS_PROXY === "true",
  analysisConcurrency: num("ANALYSIS_CONCURRENCY", 4),
  /** Minutes of transcript per topic-segmentation window. */
  analysisWindowMinutes: num("ANALYSIS_WINDOW_MINUTES", 30),
  cleanupIntervalMinutes: num("CLEANUP_INTERVAL_MINUTES", 60),
};

export const MODELS = {
  anthropic: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  /** Cheaper model for high-volume passes (topic segmentation, caption translation). */
  anthropicFast: process.env.ANTHROPIC_FAST_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-5",
  openai: process.env.OPENAI_MODEL || "gpt-5",
  openaiFast: process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini",
};
