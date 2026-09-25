import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { AppError } from "@longcut/shared";
import { MODELS } from "../config";
import type { JsonRequest, LlmProvider } from "./types";

/** Alternative intelligence provider (any OpenAI-compatible chat endpoint via OPENAI_BASE_URL). */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  readonly model = MODELS.openai;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined, maxRetries: 4, timeout: 15 * 60 * 1000 });
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const format = zodResponseFormat(req.schema as never, req.task.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60));
    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      ...(req.images ?? []).map(
        (img): OpenAI.Chat.ChatCompletionContentPart => ({
          type: "image_url",
          image_url: { url: `data:${img.mediaType};base64,${img.data}` },
        }),
      ),
      { type: "text", text: req.prompt },
    ];
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await this.client.chat.completions.create(
        {
          model: req.fast ? MODELS.openaiFast : MODELS.openai,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: userContent },
          ],
          response_format: format,
          max_completion_tokens: req.maxTokens ?? 16000,
        },
        { signal: req.signal },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AppError("PROVIDER_NOT_CONFIGURED", `OpenAI auth failed`, { retryable: false, cause: err });
      }
      throw err;
    }
    const choice = res.choices[0];
    if (choice?.finish_reason === "length") throw new AppError("ANALYSIS_FAILED", `Output truncated for ${req.task}`);
    const text = choice?.message?.content ?? "";
    try {
      return req.schema.parse(JSON.parse(text));
    } catch (err) {
      throw new AppError("ANALYSIS_FAILED", `Invalid JSON for ${req.task}: ${(err as Error).message}`, { cause: err });
    }
  }
}
