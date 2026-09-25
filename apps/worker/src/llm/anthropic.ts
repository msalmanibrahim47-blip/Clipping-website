import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@longcut/shared";
import { MODELS } from "../config";
import { log } from "../log";
import type { JsonRequest, LlmProvider } from "./types";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model = MODELS.anthropic;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 4 });
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const model = req.fast ? MODELS.anthropicFast : MODELS.anthropic;
    const format = zodOutputFormat(req.schema as never);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data },
        }),
      ),
      { type: "text", text: req.prompt },
    ];
    let message: Anthropic.Beta.BetaMessage;
    try {
      // Streaming avoids HTTP timeouts on long transcript windows; the server-side fallback
      // re-runs a declined request on a fallback model inside the same call.
      message = await this.client.beta.messages
        .stream(
          {
            model,
            max_tokens: req.maxTokens ?? 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            thinking: { type: "adaptive" },
            output_config: {
              effort: req.effort ?? "medium",
              format: { type: "json_schema", schema: format.schema },
            },
            system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content }],
          },
          { signal: req.signal },
        )
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AppError("PROVIDER_NOT_CONFIGURED", `Anthropic auth failed: ${err.message}`, { retryable: false, cause: err });
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new AppError("ANALYSIS_FAILED", `Anthropic rejected request (${req.task}): ${err.message}`, { retryable: false, cause: err });
      }
      throw err;
    }
    if (message.stop_reason === "refusal") {
      throw new AppError("ANALYSIS_FAILED", `Model declined ${req.task}`, { retryable: false });
    }
    if (message.stop_reason === "max_tokens") {
      throw new AppError("ANALYSIS_FAILED", `Output truncated for ${req.task}`);
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    log.debug("llm call", {
      task: req.task,
      model,
      input: message.usage.input_tokens,
      cached: message.usage.cache_read_input_tokens,
      output: message.usage.output_tokens,
    });
    try {
      return format.parse(text) as T;
    } catch (err) {
      throw new AppError("ANALYSIS_FAILED", `Invalid JSON from model for ${req.task}: ${(err as Error).message}`, { cause: err });
    }
  }
}
