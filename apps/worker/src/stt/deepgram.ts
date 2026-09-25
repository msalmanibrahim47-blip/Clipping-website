import fs from "node:fs/promises";
import { AppError, type Word } from "@longcut/shared";
import type { ChunkTranscript, SttProvider, TranscribeOptions } from "./types";

/**
 * Deepgram Nova-3. `language=multi` handles English/Hindi code-switching natively, and it
 * returns punctuated words plus speaker diarization.
 */
export class DeepgramProvider implements SttProvider {
  readonly name = "deepgram";
  readonly concurrency = Number(process.env.TRANSCRIBE_CONCURRENCY ?? 4);
  constructor(
    private apiKey: string,
    private model = process.env.DEEPGRAM_MODEL || "nova-3",
  ) {}

  async transcribe(file: string, opts: TranscribeOptions): Promise<ChunkTranscript> {
    const params = new URLSearchParams({
      model: this.model,
      smart_format: "true",
      punctuate: "true",
      diarize: "true",
      utterances: "false",
      language: opts.language ?? "multi",
    });
    const body = await fs.readFile(file);
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": "audio/ogg" },
      body,
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AppError("TRANSCRIPTION_FAILED", `Deepgram ${res.status}: ${text.slice(0, 500)}`, {
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const json = (await res.json()) as {
      results?: {
        channels?: Array<{
          detected_language?: string;
          alternatives?: Array<{
            words?: Array<{ word: string; punctuated_word?: string; start: number; end: number; confidence?: number; speaker?: number }>;
          }>;
        }>;
      };
    };
    const channel = json.results?.channels?.[0];
    const words: Word[] = (channel?.alternatives?.[0]?.words ?? []).map((w) => ({
      s: w.start,
      e: w.end,
      w: w.punctuated_word ?? w.word,
      c: w.confidence,
      sp: w.speaker,
    }));
    return { words, language: channel?.detected_language };
  }
}
