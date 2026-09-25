import { z } from "zod";
import { clips, eq, getDb } from "@longcut/db";
import { captionStyleSchema, CAPTION_LANGUAGES, keepRanges, keptDuration } from "@longcut/shared";
import { HttpError, ownedClip, parseBody, route } from "@/lib/api";
import { clipDto } from "@/lib/serialize";

type P = { id: string };

export const GET = route<P>(async (_req, { params, session }) => {
  const { clip } = await ownedClip(session.userId, params.id);
  return { clip: await clipDto(clip) };
});

const patchSchema = z.object({
  startTime: z.number().min(0).optional(),
  endTime: z.number().positive().optional(),
  cuts: z.array(z.object({ start: z.number().min(0), end: z.number().positive() })).max(500).optional(),
  title: z.string().min(1).max(200).optional(),
  captionStyle: captionStyleSchema.optional(),
  captionLanguage: z.enum(CAPTION_LANGUAGES).optional(),
  reset: z.boolean().optional(),
});

export const PATCH = route<P>(async (req, { params, session }) => {
  const { clip, project } = await ownedClip(session.userId, params.id);
  const body = await parseBody(req, patchSchema);
  let start = body.startTime ?? clip.startTime;
  let end = body.endTime ?? clip.endTime;
  let cuts = body.cuts ?? clip.cuts;
  if (body.reset) {
    start = clip.originalStart ?? start;
    end = clip.originalEnd ?? end;
    cuts = [];
  }
  const max = project.duration ?? end;
  start = Math.max(0, Math.min(start, max));
  end = Math.max(0, Math.min(end, max));
  if (end - start < 5) throw new HttpError(400, "A clip must be at least 5 seconds long.");
  cuts = cuts.filter((c) => c.end > c.start && c.end > start && c.start < end);
  const duration = keptDuration(keepRanges(start, end, cuts));
  if (duration < 5) throw new HttpError(400, "Too much of this clip has been removed.");
  const [updated] = await getDb()
    .update(clips)
    .set({
      startTime: start,
      endTime: end,
      cuts,
      duration,
      ...(body.title ? { title: body.title } : {}),
      ...(body.captionStyle ? { captionStyle: body.captionStyle } : {}),
      ...(body.captionLanguage ? { captionLanguage: body.captionLanguage } : {}),
    })
    .where(eq(clips.id, clip.id))
    .returning();
  return { clip: await clipDto(updated) };
});

export const DELETE = route<P>(async (_req, { params, session }) => {
  const { clip } = await ownedClip(session.userId, params.id);
  await getDb().delete(clips).where(eq(clips.id, clip.id));
  return { ok: true };
});
