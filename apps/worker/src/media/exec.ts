import { spawn } from "node:child_process";
import { config } from "../config";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Strips query strings (presigned URL signatures) from anything that may reach logs or the DB. */
export function redact(text: string): string {
  return text.replace(/(https?:\/\/[^\s?'"]+)\?[^\s'"]*/g, "$1?<redacted>");
}

export class ExecError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "ExecError";
  }
}

/**
 * Spawns a process, keeping only the tail of stderr (FFmpeg logs can be huge on 10h inputs).
 * `onStdoutLine` receives stdout line-by-line, used for `-progress pipe:1` parsing.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { signal?: AbortSignal; onStdoutLine?: (line: string) => void; captureStdout?: boolean; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd: opts.cwd, env: opts.env ?? process.env });
    let stdout = "";
    let stderr = "";
    let buf = "";
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (opts.captureStdout !== false) stdout += s;
      if (opts.onStdoutLine) {
        buf += s;
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          opts.onStdoutLine(buf.slice(0, idx).trim());
          buf = buf.slice(idx + 1);
        }
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-12000);
    });
    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new ExecError(`${cmd} failed to start: ${err.message}`, -1, ""));
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve({ stdout, stderr, code: 0 });
      else reject(new ExecError(redact(`${cmd} exited with code ${code}: ${stderr.slice(-1500)}`), code ?? -1, redact(stderr)));
    });
  });
}

/** Input flags that make FFmpeg resilient when reading a presigned HTTPS URL for hours. */
export function inputFlags(input: string): string[] {
  if (/^https?:\/\//.test(input)) {
    return ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "30", "-rw_timeout", "60000000"];
  }
  return [];
}

/** Runs ffmpeg with machine-readable progress; `onProgress` receives processed output seconds. */
export function ffmpeg(args: string[], opts: { signal?: AbortSignal; onProgress?: (seconds: number) => void } = {}) {
  return run(config.ffmpegPath, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...args], {
    signal: opts.signal,
    captureStdout: false,
    onStdoutLine: (line) => {
      if (!opts.onProgress) return;
      const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
      if (m) opts.onProgress(Number(m[1]) / 1_000_000);
    },
  });
}
