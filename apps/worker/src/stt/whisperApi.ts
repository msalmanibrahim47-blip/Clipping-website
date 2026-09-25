import fs from "node:fs";
import OpenAI from "openai";
import { AppError, type Word } from "@longcut/shared";
import { attachPunctuation } from "./postprocess";
import type { ChunkTranscript, SttProvider, TranscribeOptions } from "./types";

/** OpenAI Whisper API, and Groq's OpenAI-compatible Whisper Large v3 endpoint. */
export class WhisperApiProvider implements SttProvider {
  readonly concurrency: number;
  private client: OpenAI;
  constructor(
    readonly name: "openai" | "groq",
    apiKey: string,
    private model: string,
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: name === "groq" ? "https://api.groq.com/openai/v1" : process.env.OPENAI_BASE_URL || undefined,
      maxRetries: 4,
      timeout: 10 * 60 * 1000,
    });
    this.concurrency = Number(process.env.TRANSCRIBE_CONCURRENCY ?? (name === "groq" ? 2 : 4));
  }

  async transcribe(file: string, opts: TranscribeOptions): Promise<ChunkTranscript> {
    let res: {
      language?: string;
      words?: Array<{ word: string; start: number; end: number }>;
      segments?: Array<{ text: string; start: number; end: number }>;
    };
    try {
      res = (await this.client.audio.transcriptions.create(
        {
          file: fs.createReadStream(file),
          model: this.model,
          response_format: "verbose_json",
          timestamp_granularities: ["word", "segment"],
          language: opts.language,
          prompt: opts.prompt,
        },
        { signal: opts.signal },
      )) as unknown as typeof res;
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new AppError("TRANSCRIPTION_FAILED", `${this.name} transcription failed: ${(err as Error).message}`, {
        retryable: status !== 400 && status !== 401 && status !== 403,
        cause: err,
      });
    }
    const words: Word[] = (res.words ?? []).map((w) => ({ s: w.start, e: w.end, w: w.word }));
    return {
      words: attachPunctuation(words, (res.segments ?? []).map((s) => s.text)),
      language: res.language,
    };
  }
}
