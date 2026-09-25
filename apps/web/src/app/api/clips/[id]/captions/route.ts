import { z } from "zod";
import { and, enqueueJob, eq, getDb, inArray, jobs, sentenceTranslations, transcripts } from "@longcut/db";
import {
  CAPTION_LANGUAGES,
  captionStyleFor,
  captionStyleSchema,
  captionWords,
  resolveCaptionTransform,
  segmentCaptions,
  sentencesInRange,
  toSRT,
  toVTT,
  type CaptionLanguage,
} from "@longcut/shared";
import { HttpError, ownedClip, parseBody, route } from "@/lib/api";

type P = { id: string };

/**
 * Caption cues for a clip on the output timeline (preview overlay), or an SRT/VTT download.
 * Translated/romanized modes need a background captions job the first time (`needs_generation`).
 */
export const GET = route<P>(async (req, { params, session }) => {
  const { clip, project } = await ownedClip(session.userId, params.id);
  const sp = new URL(req.url).searchParams;
  const language = (CAPTION_LANGUAGES as readonly string[]).includes(sp.get("language") ?? "")
    ? (sp.get("language") as CaptionLanguage)
    : ((clip.captionLanguage as CaptionLanguage) ?? project.settings.captionLanguage ?? "auto");
  const format = sp.get("format");
  const style = clip.captionStyle ? captionStyleSchema.parse(clip.captionStyle) : captionStyleFor("clean");
  const maxChars = Number(sp.get("maxChars")) || style.maxCharsPerLine;
  const maxLines = Number(sp.get("maxLines")) || style.maxLines;

  const db = getDb();
  const t = await db.query.transcripts.findFirst({ where: eq(transcripts.projectId, project.id) });
  if (!t) throw new HttpError(404, "Transcript not available yet.");
  const transform = resolveCaptionTransform(language, project.languageStats ?? null);
  let overrides: Map<number, string> | null = null;
  if (transform !== "none") {
    const idxs = sentencesInRange(t.segments, clip.startTime, clip.endTime).map((s) => s.i);
    const rows = idxs.length
      ? await db.query.sentenceTranslations.findMany({
          where: and(eq(sentenceTranslations.projectId, project.id), eq(sentenceTranslations.mode, transform), inArray(sentenceTranslations.sentenceIdx, idxs)),
        })
      : [];
    if (rows.length < idxs.length) {
      const pending = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.dedupeKey, `captions:${clip.id}:${language}`), inArray(jobs.status, ["queued", "running"])))
        .limit(1);
      return { status: pending.length ? "pending" : "needs_generation", language, transform, cues: [] };
    }
    overrides = new Map(rows.map((r) => [r.sentenceIdx, r.text]));
  }
  const cues = segmentCaptions(captionWords(t.segments, clip.startTime, clip.endTime, clip.cuts, overrides), {
    maxCharsPerLine: maxChars,
    maxLines,
  });
  if (format === "srt" || format === "vtt") {
    const body = format === "srt" ? toSRT(cues) : toVTT(cues);
    const name = `${clip.title.replace(/[^\w\- ]+/g, "").slice(0, 60) || "captions"}.${format}`;
    return new Response(body, {
      headers: {
        "content-type": format === "srt" ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      },
    });
  }
  return { status: "ready", language, transform, cues };
});

/** Generates captions for a language that needs translation/romanization. */
export const POST = route<P>(async (req, { params, session }) => {
  const { clip, project } = await ownedClip(session.userId, params.id);
  const { language } = await parseBody(req, z.object({ language: z.enum(CAPTION_LANGUAGES) }));
  await enqueueJob({
    type: "captions",
    userId: session.userId,
    projectId: project.id,
    clipId: clip.id,
    payload: { language },
    dedupeKey: `captions:${clip.id}:${language}`,
    priority: 10,
  });
  return { status: "pending" };
});
