import { AppError, type LlmProviderName } from "@longcut/shared";
import type { ResolvedKeys } from "../providers";
import { AnthropicProvider } from "./anthropic";
import { OpenAiProvider } from "./openai";
import type { LlmProvider } from "./types";

export type { LlmProvider, JsonRequest } from "./types";

export function createLlmProvider(name: LlmProviderName, keys: ResolvedKeys): LlmProvider {
  if (name === "openai") {
    if (!keys.openai) throw new AppError("PROVIDER_NOT_CONFIGURED", "OPENAI_API_KEY missing", { retryable: false });
    return new OpenAiProvider(keys.openai);
  }
  if (!keys.anthropic) throw new AppError("PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY missing", { retryable: false });
  return new AnthropicProvider(keys.anthropic);
}
