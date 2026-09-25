import { getDb, eq, userSettings } from "@longcut/db";
import { decryptJson, type UserApiKeys } from "@longcut/services";
import { LLM_PROVIDERS, STT_PROVIDERS, type LlmProviderName, type SttProviderName } from "@longcut/shared";
import { createLlmProvider, type LlmProvider } from "./llm";
import { createSttProvider, type SttProvider } from "./stt";

export interface ResolvedKeys {
  anthropic?: string;
  openai?: string;
  deepgram?: string;
  groq?: string;
}

export interface UserProviders {
  llm: () => LlmProvider;
  stt: () => SttProvider;
  llmName: LlmProviderName;
  sttName: SttProviderName;
}

function envSttDefault(): SttProviderName {
  const v = process.env.STT_PROVIDER as SttProviderName | undefined;
  if (v && STT_PROVIDERS.includes(v)) return v;
  if (process.env.DEEPGRAM_API_KEY) return "deepgram";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "local";
}

function envLlmDefault(): LlmProviderName {
  const v = process.env.LLM_PROVIDER as LlmProviderName | undefined;
  if (v && LLM_PROVIDERS.includes(v)) return v;
  return process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY ? "anthropic" : "openai";
}

/**
 * Per-user provider selection: a user's own (encrypted) keys and preferences override the
 * server defaults from the environment. Keys never leave the server.
 */
export async function providersForUser(userId: string | null): Promise<UserProviders> {
  let userKeys: UserApiKeys | null = null;
  let llmPref: string | null = null;
  let sttPref: string | null = null;
  if (userId) {
    const row = await getDb().query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
    if (row) {
      userKeys = decryptJson<UserApiKeys>(row.encryptedKeys);
      llmPref = row.llmProvider;
      sttPref = row.sttProvider;
    }
  }
  const keys: ResolvedKeys = {
    anthropic: userKeys?.anthropic || process.env.ANTHROPIC_API_KEY,
    openai: userKeys?.openai || process.env.OPENAI_API_KEY,
    deepgram: userKeys?.deepgram || process.env.DEEPGRAM_API_KEY,
    groq: userKeys?.groq || process.env.GROQ_API_KEY,
  };
  const llmName = (LLM_PROVIDERS as readonly string[]).includes(llmPref ?? "") ? (llmPref as LlmProviderName) : envLlmDefault();
  const sttName = (STT_PROVIDERS as readonly string[]).includes(sttPref ?? "") ? (sttPref as SttProviderName) : envSttDefault();
  return {
    llmName,
    sttName,
    llm: () => createLlmProvider(llmName, keys),
    stt: () => createSttProvider(sttName, keys),
  };
}
