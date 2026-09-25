import { z } from "zod";
import { enqueueJob, eq, getDb, projects, transcripts } from "@longcut/db";
import { isProjectActive, projectSettingsSchema } from "@longcut/shared";
import { HttpError, ownedProject, parseBody, route } from "@/lib/api";
import { projectSummary } from "@/lib/serialize";

/** Re-runs clip detection with new settings on the saved transcript — no re-transcription. */
export const POST = route<{ id: string }>(async (req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const body = await parseBody(
    req,
    z.object({ settings: projectSettingsSchema.partial().optional(), reuseSections: z.boolean().optional() }).default({}),
  );
  if (isProjectActive(project.status)) throw new HttpError(409, "This project is already being processed.");
  const db = getDb();
  const t = await db.select({ id: transcripts.projectId }).from(transcripts).where(eq(transcripts.projectId, project.id)).limit(1);
  if (!t.length) throw new HttpError(409, "There's no transcript yet — start processing first.");
  const settings = projectSettingsSchema.parse({ ...project.settings, ...body.settings });
  const contentChanged = settings.contentType !== project.settings.contentType;
  await db
    .update(projects)
    .set({ status: "queued", progress: 0, errorCode: null, statusMessage: "Waiting for a worker…", settings })
    .where(eq(projects.id, project.id));
  await enqueueJob({
    type: "analyze",
    projectId: project.id,
    userId: session.userId,
    dedupeKey: `analyze:${project.id}`,
    payload: { reuseSections: body.reuseSections ?? !contentChanged },
  });
  const updated = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
  return { project: await projectSummary(updated!) };
});
