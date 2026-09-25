import { AppError, type SttProviderName } from "@longcut/shared";
import type { ResolvedKeys } from "../providers";
import { DeepgramProvider } from "./deepgram";
import { LocalWhisperProvider } from "./local";
import type { SttProvider } from "./types";
import { WhisperApiProvider } from "./whisperApi";

export type { SttProvider } from "./types";

export function createSttProvider(name: SttProviderName, keys: ResolvedKeys): SttProvider {
  switch (name) {
    case "deepgram":
      if (!keys.deepgram) throw new AppError("PROVIDER_NOT_CONFIGURED", "DEEPGRAM_API_KEY missing", { retryable: false });
      return new DeepgramProvider(keys.deepgram);
    case "openai":
      if (!keys.openai) throw new AppError("PROVIDER_NOT_CONFIGURED", "OPENAI_API_KEY missing", { retryable: false });
      return new WhisperApiProvider("openai", keys.openai, process.env.OPENAI_STT_MODEL || "whisper-1");
    case "groq":
      if (!keys.groq) throw new AppError("PROVIDER_NOT_CONFIGURED", "GROQ_API_KEY missing", { retryable: false });
      return new WhisperApiProvider("groq", keys.groq, process.env.GROQ_STT_MODEL || "whisper-large-v3");
    case "local":
      return new LocalWhisperProvider();
  }
}
