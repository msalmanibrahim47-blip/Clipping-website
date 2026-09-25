import type { Word } from "@longcut/shared";

export interface TranscribeOptions {
  /** ISO code hint ("en", "hi", "ur") or undefined for auto-detect. */
  language?: string;
  /** Vocabulary / style prompt (Whisper-family providers). */
  prompt?: string;
  signal?: AbortSignal;
}

export interface ChunkTranscript {
  /** Word timings relative to the start of the chunk file. */
  words: Word[];
  language?: string;
}

export interface SttProvider {
  readonly name: string;
  /** Parallel chunk requests this provider tolerates. */
  readonly concurrency: number;
  transcribe(file: string, opts: TranscribeOptions): Promise<ChunkTranscript>;
}
