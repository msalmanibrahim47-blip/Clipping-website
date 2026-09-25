import { z } from "zod";

/** Publishing package generated from the actual content of a clip. */
export const publishingPackageSchema = z.object({
  titles: z.object({
    recommended: z.string(),
    alternatives: z.array(z.string()),
  }),
  description: z.object({
    long: z.string(),
    short: z.string(),
  }),
  hashtags: z.array(z.string()),
  keywords: z.array(z.string()),
  thumbnail: z.object({
    subject: z.string(),
    emotion: z.string(),
    composition: z.string(),
    background: z.string(),
    visualElement: z.string(),
    textOptions: z.array(z.string()),
    recommendedText: z.string(),
    prompt: z.string(),
    /** Prompt variant for image-to-image generation from an actual source frame. */
    sourceFramePrompt: z.string().nullable(),
  }),
  hook: z.object({
    original: z.string(),
    originalStart: z.number().nullable(),
    strength: z.number(),
    suggestion: z.string(),
  }),
  cta: z.string(),
});
export type PublishingPackage = z.infer<typeof publishingPackageSchema>;

export function normalizeHashtag(tag: string): string {
  const core = tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return core ? `#${core}` : "";
}

/** Plain-text rendering used by "Copy All". */
export function formatPackageText(pkg: PublishingPackage, meta: { start: string; end: string; duration: string }): string {
  return [
    `TITLE: ${pkg.titles.recommended}`,
    ...pkg.titles.alternatives.map((t, i) => `ALT TITLE ${i + 1}: ${t}`),
    "",
    `CLIP: ${meta.start} → ${meta.end} (${meta.duration})`,
    "",
    "DESCRIPTION:",
    pkg.description.long,
    "",
    `SHORT: ${pkg.description.short}`,
    "",
    `HASHTAGS: ${pkg.hashtags.join(" ")}`,
    `KEYWORDS: ${pkg.keywords.join(", ")}`,
    "",
    `HOOK (original): ${pkg.hook.original}`,
    `HOOK (AI suggestion): ${pkg.hook.suggestion}`,
    "",
    `THUMBNAIL TEXT: ${pkg.thumbnail.recommendedText}`,
    `THUMBNAIL TEXT OPTIONS: ${pkg.thumbnail.textOptions.join(" | ")}`,
    `THUMBNAIL SUBJECT: ${pkg.thumbnail.subject}`,
    `THUMBNAIL EMOTION: ${pkg.thumbnail.emotion}`,
    `THUMBNAIL COMPOSITION: ${pkg.thumbnail.composition}`,
    `THUMBNAIL BACKGROUND: ${pkg.thumbnail.background}`,
    `THUMBNAIL VISUAL: ${pkg.thumbnail.visualElement}`,
    "",
    "THUMBNAIL PROMPT:",
    pkg.thumbnail.prompt,
    "",
    `CTA: ${pkg.cta}`,
  ].join("\n");
}
