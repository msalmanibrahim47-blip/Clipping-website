import type { z } from "zod";

export interface JsonRequest<T> {
  /** Stable instructions (cached across calls where the provider supports it). */
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Optional JPEG images (base64) — e.g. a source frame for thumbnail prompts. */
  images?: Array<{ mediaType: "image/jpeg" | "image/png"; data: string }>;
  maxTokens?: number;
  /** Use the cheaper/faster model tier (bulk passes). */
  fast?: boolean;
  /** Reasoning effort hint. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  /** Label for logs. */
  task: string;
}

/**
 * The AI intelligence layer. It only ever sees text/images derived from the transcript and
 * returns validated JSON — all media work stays in the FFmpeg processing layer.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  json<T>(req: JsonRequest<T>): Promise<T>;
}
