import { z } from "zod";
import { cancelJobsFor, count, eq, enqueueJob, getDb, clips, projects, transcripts } from "@longcut/db";
import { keys } from "@longcut/services";
import { ownedProject, parseBody, route } from "@/lib/api";
import { projectDetail } from "@/lib/serialize";

type P = { id: string };

export const GET = route<P>(async (_req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(clips).where(eq(clips.projectId, project.id));
  const t = await db.select({ id: transcripts.projectId }).from(transcripts).where(eq(transcripts.projectId, project.id)).limit(1);
  return { project: await projectDetail(project, Number(n), t.length > 0) };
});

export const PATCH = route<P>(async (req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const body = await parseBody(req, z.object({ title: z.string().min(1).max(200) }));
  const [updated] = await getDb().update(projects).set({ title: body.title }).where(eq(projects.id, project.id)).returning();
  return { project: await projectDetail(updated) };
});

/** Deletes the project, its clips/exports (cascade) and — asynchronously — every stored object. */
export const DELETE = route<P>(async (_req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  await cancelJobsFor({ projectId: project.id });
  await getDb().delete(projects).where(eq(projects.id, project.id));
  await enqueueJob({
    type: "cleanup",
    userId: session.userId,
    payload: {
      prefix: keys.projectPrefix(project.userId, project.id),
      upload: project.uploadId && project.storagePath ? { key: project.storagePath, uploadId: project.uploadId } : undefined,
    },
  });
  return { ok: true };
});
