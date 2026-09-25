import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, type Word } from "@longcut/shared";
import { config } from "../config";
import { run } from "../media/exec";
import type { ChunkTranscript, SttProvider, TranscribeOptions } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Self-hosted faster-whisper (CTranslate2). Runs python/transcribe.py; use a GPU worker for
 * multi-hour sources (large-v3 on CPU is roughly real-time).
 */
export class LocalWhisperProvider implements SttProvider {
  readonly name = "local";
  readonly concurrency = Number(process.env.TRANSCRIBE_CONCURRENCY ?? 1);
  private script =
    process.env.LOCAL_WHISPER_SCRIPT ||
    [path.resolve(here, "../python/transcribe.py"), path.resolve(here, "../../python/transcribe.py")].find((p) => existsSync(p)) ||
    "python/transcribe.py";

  async transcribe(file: string, opts: TranscribeOptions): Promise<ChunkTranscript> {
    const args = [this.script, file, "--model", process.env.LOCAL_WHISPER_MODEL || "large-v3"];
    if (opts.language) args.push("--language", opts.language);
    if (opts.prompt) args.push("--prompt", opts.prompt);
    if (process.env.LOCAL_WHISPER_DEVICE) args.push("--device", process.env.LOCAL_WHISPER_DEVICE);
    if (process.env.LOCAL_WHISPER_COMPUTE_TYPE) args.push("--compute-type", process.env.LOCAL_WHISPER_COMPUTE_TYPE);
    let stdout: string;
    try {
      ({ stdout } = await run(config.pythonPath, args, { signal: opts.signal }));
    } catch (err) {
      throw new AppError("TRANSCRIPTION_FAILED", `faster-whisper failed: ${(err as Error).message}`, { cause: err });
    }
    const json = JSON.parse(stdout.trim().split("\n").pop() || "{}") as { language?: string; words?: Word[] };
    return { words: json.words ?? [], language: json.language };
  }
}
