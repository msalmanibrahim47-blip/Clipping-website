import { z } from "zod";
import { eq, getDb, userSettings } from "@longcut/db";
import { decryptJson, encryptJson, maskKey, storageConfig, type UserApiKeys } from "@longcut/services";
import {
  captionStyleSchema,
  LLM_PROVIDERS,
  STT_PROVIDERS,
  userDefaultsSchema,
} from "@longcut/shared";
import { parseBody, route } from "@/lib/api";

function serverProviders() {
  let storage: { provider: string; bucket: string } | null = null;
  try {
    const cfg = storageConfig();
    storage = { provider: cfg.provider, bucket: cfg.bucket };
  } catch {
    storage = null;
  }
  return {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    youtubeApi: Boolean(process.env.YOUTUBE_API_KEY),
    defaultLlm: process.env.LLM_PROVIDER || "anthropic",
    defaultStt: process.env.STT_PROVIDER || null,
    storage,
  };
}

/** Settings. API keys are write-only: the browser only ever sees a masked suffix. */
export const GET = route(async (_req, { session }) => {
  const row = await getDb().query.userSettings.findFirst({ where: eq(userSettings.userId, session.userId) });
  const keys = decryptJson<UserApiKeys>(row?.encryptedKeys) ?? {};
  return {
    defaults: userDefaultsSchema.parse(row?.defaults ?? {}),
    captionStyle: row?.captionStyle ?? null,
    llmProvider: row?.llmProvider ?? null,
    sttProvider: row?.sttProvider ?? null,
    keys: {
      anthropic: maskKey(keys.anthropic),
      openai: maskKey(keys.openai),
      deepgram: maskKey(keys.deepgram),
      groq: maskKey(keys.groq),
    },
    server: serverProviders(),
    encryptionAvailable: Boolean(process.env.APP_ENCRYPTION_KEY),
  };
});

const keyField = z.string().max(300).nullable().optional();
const putSchema = z.object({
  defaults: userDefaultsSchema.partial().optional(),
  captionStyle: captionStyleSchema.partial().nullable().optional(),
  llmProvider: z.enum(LLM_PROVIDERS).nullable().optional(),
  sttProvider: z.enum(STT_PROVIDERS).nullable().optional(),
  /** null clears a key; undefined leaves it unchanged. */
  keys: z.object({ anthropic: keyField, openai: keyField, deepgram: keyField, groq: keyField }).optional(),
});

export const PUT = route(async (req, { session }) => {
  const body = await parseBody(req, putSchema);
  const db = getDb();
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.userId) });
  let encryptedKeys = row?.encryptedKeys ?? null;
  if (body.keys) {
    const current = decryptJson<UserApiKeys>(encryptedKeys) ?? {};
    for (const [k, v] of Object.entries(body.keys) as Array<[keyof UserApiKeys, string | null | undefined]>) {
      if (v === null || v === "") delete current[k];
      else if (typeof v === "string") current[k] = v.trim();
    }
    encryptedKeys = Object.keys(current).length ? encryptJson(current) : null;
  }
  const values = {
    userId: session.userId,
    defaults: userDefaultsSchema.parse({ ...(row?.defaults ?? {}), ...(body.defaults ?? {}) }),
    captionStyle: body.captionStyle === undefined ? (row?.captionStyle ?? null) : body.captionStyle,
    llmProvider: body.llmProvider === undefined ? (row?.llmProvider ?? null) : body.llmProvider,
    sttProvider: body.sttProvider === undefined ? (row?.sttProvider ?? null) : body.sttProvider,
    encryptedKeys,
    updatedAt: new Date(),
  };
  await db.insert(userSettings).values(values).onConflictDoUpdate({ target: userSettings.userId, set: values });
  return { ok: true };
});
