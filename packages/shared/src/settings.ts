import { z } from "zod";
import { STRATEGIES, SIGNAL_KEYS } from "./scoring";

export const CONTENT_TYPES = ["livestream", "podcast", "interview", "webinar", "gaming", "general"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  livestream: "Livestream",
  podcast: "Podcast",
  interview: "Interview",
  webinar: "Webinar",
  gaming: "Gaming stream",
  general: "General",
};

/** Clip-length presets in minutes; "auto" lets the analysis choose 5–20 min per segment. */
export const CLIP_LENGTH_PRESETS = [5, 8, 10, 12, 15, 20] as const;
export const CAPTION_LANGUAGES = ["auto", "english", "hinglish", "original"] as const;
export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];
export const CAPTION_LANGUAGE_LABELS: Record<CaptionLanguage, string> = {
  auto: "Auto Detect",
  english: "English",
  hinglish: "Hinglish",
  original: "Original Speech",
};

export const MIN_CLIP_SECONDS = 5 * 60;
export const MAX_CLIP_SECONDS = 20 * 60;

const customWeights = z.partialRecord(z.enum(SIGNAL_KEYS), z.number().min(0).max(5));

export const projectSettingsSchema = z.object({
  contentType: z.enum(CONTENT_TYPES).default("general"),
  strategy: z.enum(STRATEGIES).default("balanced"),
  customInstructions: z.string().max(2000).optional(),
  customWeights: customWeights.optional(),
  /** Target length in minutes, or "auto". */
  clipLength: z.union([z.literal("auto"), z.number().min(1).max(60)]).default("auto"),
  /** Optional explicit bounds (minutes) — "Custom duration". */
  minMinutes: z.number().min(1).max(60).optional(),
  maxMinutes: z.number().min(1).max(90).optional(),
  clipCount: z.number().int().min(1).max(30).default(5),
  captionLanguage: z.enum(CAPTION_LANGUAGES).default("auto"),
  /** Hint for the speech-to-text engine: "auto", "en", "hi", "ur". */
  spokenLanguage: z.enum(["auto", "en", "hi", "ur"]).default("auto"),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

/**
 * Resolves the acceptable duration window (seconds) for clips. A fixed target allows roughly
 * ±12% so boundaries can land on natural sentence breaks (10 min → ~8:48–11:12).
 */
export function durationWindow(settings: Pick<ProjectSettings, "clipLength" | "minMinutes" | "maxMinutes">): {
  min: number;
  max: number;
  target: number | null;
} {
  if (settings.minMinutes || settings.maxMinutes) {
    const min = (settings.minMinutes ?? 5) * 60;
    const max = Math.max(min + 60, (settings.maxMinutes ?? 20) * 60);
    return { min, max, target: settings.clipLength === "auto" ? null : settings.clipLength * 60 };
  }
  if (settings.clipLength === "auto") return { min: MIN_CLIP_SECONDS, max: MAX_CLIP_SECONDS, target: null };
  const target = settings.clipLength * 60;
  return { min: Math.round(target * 0.88), max: Math.round(target * 1.12), target };
}

export const CAPTION_PRESETS = ["clean", "bold", "podcast", "minimal", "highlight"] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

export const CAPTION_FONTS = ["Inter", "Montserrat", "Roboto", "Noto Sans", "Liberation Sans"] as const;

export const captionStyleSchema = z.object({
  enabled: z.boolean().default(true),
  preset: z.enum(CAPTION_PRESETS).default("clean"),
  font: z.enum(CAPTION_FONTS).default("Inter"),
  /** Font size relative to a 1080p frame. */
  fontSize: z.number().min(16).max(120).default(52),
  bold: z.boolean().default(true),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
  /** Vertical margin as % of frame height. */
  marginPercent: z.number().min(0).max(40).default(8),
  maxCharsPerLine: z.number().int().min(16).max(80).default(42),
  maxLines: z.number().int().min(1).max(3).default(2),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
  background: z.boolean().default(false),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  backgroundOpacity: z.number().min(0).max(1).default(0.6),
  outline: z.number().min(0).max(8).default(3),
  outlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  shadow: z.number().min(0).max(8).default(1),
  highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FACC15"),
  wordHighlight: z.boolean().default(false),
  uppercase: z.boolean().default(false),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const CAPTION_PRESET_STYLES: Record<CaptionPreset, Partial<CaptionStyle>> = {
  clean: { preset: "clean", font: "Inter", fontSize: 52, bold: true, outline: 3, shadow: 1, background: false, wordHighlight: false, uppercase: false },
  bold: { preset: "bold", font: "Montserrat", fontSize: 64, bold: true, outline: 5, shadow: 2, background: false, uppercase: true, maxCharsPerLine: 32, wordHighlight: false },
  podcast: { preset: "podcast", font: "Inter", fontSize: 48, bold: true, outline: 0, shadow: 0, background: true, backgroundOpacity: 0.65, maxLines: 2, wordHighlight: false },
  minimal: { preset: "minimal", font: "Roboto", fontSize: 42, bold: false, outline: 1.5, shadow: 0, background: false, maxLines: 1, wordHighlight: false },
  highlight: { preset: "highlight", font: "Montserrat", fontSize: 58, bold: true, outline: 4, shadow: 1, background: false, wordHighlight: true, highlightColor: "#FACC15", maxCharsPerLine: 34 },
};

export function captionStyleFor(preset: CaptionPreset, overrides: Partial<CaptionStyle> = {}): CaptionStyle {
  return captionStyleSchema.parse({ ...CAPTION_PRESET_STYLES[preset], ...overrides, preset });
}

export const RESOLUTIONS = ["original", "1080p", "1440p", "2160p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const RESOLUTION_HEIGHT: Record<Exclude<Resolution, "original">, number> = {
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
};
export const RESOLUTION_LABELS: Record<Resolution, string> = {
  original: "Original",
  "1080p": "1080p",
  "1440p": "1440p (2K)",
  "2160p": "4K (2160p)",
};

/** Upscaling never improves quality, so only resolutions at or below the source are offered. */
export function availableResolutions(sourceHeight: number | null | undefined): Resolution[] {
  const h = sourceHeight ?? 0;
  return RESOLUTIONS.filter((r) => r === "original" || RESOLUTION_HEIGHT[r] <= h);
}

export const CAPTION_MODES = ["burn", "none", "subtitle"] as const;
export type CaptionMode = (typeof CAPTION_MODES)[number];

export const exportOptionsSchema = z.object({
  resolution: z.enum(RESOLUTIONS).default("1080p"),
  /** burn = captions rendered into the video; none = clean video; subtitle = video + SRT/VTT sidecar files. */
  captionMode: z.enum(CAPTION_MODES).default("burn"),
  captionLanguage: z.enum(CAPTION_LANGUAGES).default("auto"),
  /** Also produce SRT/VTT files regardless of captionMode. */
  subtitleFormats: z.array(z.enum(["srt", "vtt"])).default(["srt"]),
  /** Seconds; null = original clip duration. Shorter targets are smart-trimmed to the strongest section. */
  targetDuration: z.number().min(30).max(3 * 3600).nullable().default(null),
  /** Overlay the AI hook suggestion as on-screen text for the first seconds. */
  useAiHook: z.boolean().default(false),
  captionStyle: captionStyleSchema.optional(),
});
export type ExportOptions = z.infer<typeof exportOptionsSchema>;

export const CLEANUP_POLICIES = ["keep", "30d", "7d"] as const;
export type CleanupPolicy = (typeof CLEANUP_POLICIES)[number];

export const userDefaultsSchema = z.object({
  captionPreset: z.enum(CAPTION_PRESETS).default("clean"),
  captionLanguage: z.enum(CAPTION_LANGUAGES).default("auto"),
  clipLength: z.union([z.literal("auto"), z.number().min(1).max(60)]).default("auto"),
  clipCount: z.number().int().min(1).max(30).default(5),
  exportResolution: z.enum(RESOLUTIONS).default("1080p"),
  /** How long rendered exports are kept. Sources are kept until the project is deleted. */
  exportCleanup: z.enum(CLEANUP_POLICIES).default("30d"),
  /** Delete intermediate files (audio, preview proxy) once a project completes. */
  purgeIntermediates: z.boolean().default(false),
});
export type UserDefaults = z.infer<typeof userDefaultsSchema>;

export const LLM_PROVIDERS = ["anthropic", "openai"] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];
export const STT_PROVIDERS = ["deepgram", "openai", "groq", "local"] as const;
export type SttProviderName = (typeof STT_PROVIDERS)[number];
export const STT_PROVIDER_LABELS: Record<SttProviderName, string> = {
  deepgram: "Deepgram Nova-3 (multilingual, speakers)",
  openai: "OpenAI Whisper API",
  groq: "Groq Whisper Large v3",
  local: "Local faster-whisper (GPU/CPU worker)",
};
