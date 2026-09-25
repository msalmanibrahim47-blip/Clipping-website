import { z } from "zod";
import { asc, clips, eq, getDb, transcripts } from "@longcut/db";
import { snapToSentence } from "@longcut/shared";
import { HttpError, ownedProject, parseBody, route } from "@/lib/api";
import { clipDto } from "@/lib/serialize";

export const GET = route<{ id: string }>(async (_req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const rows = await getDb().query.clips.findMany({ where: eq(clips.projectId, project.id), orderBy: [asc(clips.rank)] });
  return { clips: await Promise.all(rows.map(clipDto)), strategy: project.rankStrategy };
});

/** Manual clip from a time range (e.g. selected in the transcript). */
export const POST = route<{ id: string }>(async (req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const body = await parseBody(req, z.object({ startTime: z.number().min(0), endTime: z.number().positive(), title: z.string().max(200).optional() }));
  const db = getDb();
  const t = await db.query.transcripts.findFirst({ where: eq(transcripts.projectId, project.id) });
  let start = body.startTime;
  let end = Math.min(body.endTime, project.duration ?? body.endTime);
  if (t) {
    start = snapToSentence(t.segments, start, "start", 3);
    end = snapToSentence(t.segments, end, "end", 3);
  }
  if (end - start < 5) throw new HttpError(400, "A clip must be at least 5 seconds long.");
  const existing = await db.query.clips.findMany({ where: eq(clips.projectId, project.id) });
  const [clip] = await db
    .insert(clips)
    .values({
      projectId: project.id,
      origin: "manual",
      rank: existing.length + 1,
      startTime: start,
      endTime: end,
      originalStart: start,
      originalEnd: end,
      duration: end - start,
      title: body.title?.trim() || "Custom clip",
      reason: "Created manually",
    })
    .returning();
  return { clip: await clipDto(clip) };
});
