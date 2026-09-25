import { z } from "zod";
import {
  CONTENT_TYPE_LABELS,
  formatDuration,
  LANGUAGE_STYLE_LABELS,
  normalizeHashtag,
  type ContentType,
  type LanguageStyle,
  type PublishingPackage,
  type Sentence,
} from "@longcut/shared";
import type { LlmProvider } from "../llm";
import { formatSentences, hasSpeakers } from "./format";
import { PACKAGE_SYSTEM } from "./prompts";

const packageSchema = z.object({
  titles: z.object({ recommended: z.string(), alternatives: z.array(z.string()) }),
  description: z.object({ long: z.string(), short: z.string() }),
  hashtags: z.array(z.string()),
  keywords: z.array(z.string()),
  thumbnail: z.object({
    subject: z.string(),
    emotion: z.string(),
    composition: z.string(),
    background: z.string(),
    visualElement: z.string(),
    textOptions: z.array(z.string()),
    recommendedTextIndex: z.number().int(),
    prompt: z.string(),
    sourceFramePrompt: z.string().nullable(),
  }),
  hook: z.object({ hookIdx: z.number().int(), strength: z.number(), suggestion: z.string() }),
  cta: z.string(),
});

export async function generatePackage(opts: {
  llm: LlmProvider;
  sentences: Sentence[];
  clip: { title: string; summary: string | null; reason: string | null; duration: number };
  contentType: ContentType;
  languageStyle: LanguageStyle | null;
  frame?: { data: string } | null;
  signal?: AbortSignal;
}): Promise<PublishingPackage> {
  const { sentences } = opts;
  const prompt = [
    `Content type: ${CONTENT_TYPE_LABELS[opts.contentType]}. Spoken language style: ${opts.languageStyle ? LANGUAGE_STYLE_LABELS[opts.languageStyle] : "unknown"}.`,
    `Clip duration: ${formatDuration(opts.clip.duration)}. Working title: "${opts.clip.title}".`,
    opts.clip.summary ? `Editor summary: ${opts.clip.summary}` : "",
    opts.frame ? "A source frame from the clip is attached (use it for the thumbnail concept and sourceFramePrompt)." : "No source frame is attached: set sourceFramePrompt to null.",
    "",
    "<clip_transcript>",
    formatSentences(sentences, { speakers: hasSpeakers(sentences) }),
    "</clip_transcript>",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await opts.llm.json({
    task: "publishing_package",
    system: PACKAGE_SYSTEM,
    prompt,
    schema: packageSchema,
    images: opts.frame ? [{ mediaType: "image/jpeg", data: opts.frame.data }] : undefined,
    effort: "medium",
    maxTokens: 10000,
    signal: opts.signal,
  });

  const hookSentence = sentences.find((s) => s.i === res.hook.hookIdx) ?? sentences[0];
  const hashtags = [...new Set(res.hashtags.map(normalizeHashtag).filter(Boolean))].slice(0, 12);
  const textOptions = res.thumbnail.textOptions.map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const recommendedText = textOptions[res.thumbnail.recommendedTextIndex] ?? textOptions[0] ?? "";
  return {
    titles: {
      recommended: res.titles.recommended.trim(),
      alternatives: res.titles.alternatives.map((t) => t.trim()).filter((t) => t && t !== res.titles.recommended.trim()).slice(0, 2),
    },
    description: { long: res.description.long.trim(), short: res.description.short.trim() },
    hashtags,
    keywords: res.keywords.slice(0, 12),
    thumbnail: {
      subject: res.thumbnail.subject,
      emotion: res.thumbnail.emotion,
      composition: res.thumbnail.composition,
      background: res.thumbnail.background,
      visualElement: res.thumbnail.visualElement,
      textOptions,
      recommendedText,
      prompt: res.thumbnail.prompt,
      sourceFramePrompt: opts.frame ? res.thumbnail.sourceFramePrompt : null,
    },
    hook: {
      original: hookSentence?.t ?? "",
      originalStart: hookSentence?.s ?? null,
      strength: Math.round(Math.max(0, Math.min(100, res.hook.strength))),
      suggestion: res.hook.suggestion.trim(),
    },
    cta: res.cta.trim(),
  };
}
