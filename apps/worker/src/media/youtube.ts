import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@longcut/shared";
import { config } from "../config";
import { run } from "./exec";

/**
 * Downloads a YouTube source with yt-dlp into `dir`. Prefers MP4/H.264 up to 4K so the
 * result is browser-playable and renders quickly; falls back to the best available format.
 */
export async function downloadYouTube(
  url: string,
  dir: string,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<{ file: string; title?: string }> {
  await fs.mkdir(dir, { recursive: true });
  const args = [
    "--no-playlist",
    "--no-progress",
    "--newline",
    "--progress-template",
    "download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
    "-f",
    "bv*[height<=2160][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=2160]+ba/b",
    "--merge-output-format",
    "mp4",
    "--concurrent-fragments",
    "4",
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "-o",
    path.join(dir, "source.%(ext)s"),
    "--print",
    "after_move:FILE %(filepath)s",
    "--print",
    "before_dl:TITLE %(title)s",
  ];
  if (config.ytDlpCookies) args.push("--cookies", config.ytDlpCookies);
  args.push(url);

  let file: string | undefined;
  let title: string | undefined;
  try {
    await run(config.ytDlpPath, args, {
      signal: opts.signal,
      onStdoutLine: (line) => {
        if (line.startsWith("FILE ")) file = line.slice(5).trim();
        else if (line.startsWith("TITLE ")) title = line.slice(6).trim();
        else if (line.startsWith("PROGRESS ")) {
          const [, done, total, est] = line.split(" ");
          const t = Number(total) || Number(est);
          if (t > 0) opts.onProgress?.(Math.min(1, Number(done) / t));
        }
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    const permanent = /private|unavailable|removed|copyright|sign in|members-only|not available/i.test(msg);
    throw new AppError("YOUTUBE_UNAVAILABLE", msg, { retryable: !permanent, cause: err });
  }
  if (!file) {
    const entries = await fs.readdir(dir);
    const found = entries.find((e) => e.startsWith("source."));
    if (found) file = path.join(dir, found);
  }
  if (!file) throw new AppError("YOUTUBE_UNAVAILABLE", "yt-dlp produced no file");
  return { file, title };
}
