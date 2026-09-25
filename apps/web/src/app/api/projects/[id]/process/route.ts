import { z } from "zod";
import { enqueueJob, eq, getDb, projects } from "@longcut/db";
import { isProjectActive, projectSettingsSchema } from "@longcut/shared";
import { HttpError, ownedProject, parseBody, route } from "@/lib/api";
import { projectSummary } from "@/lib/serialize";

/**
 * Starts (or resumes) the processing pipeline. Idempotent: a queued/running job for the same
 * project is reused instead of creating a duplicate.
 */
export const POST = route<{ id: string }>(async (req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const body = await parseBody(req, z.object({ settings: projectSettingsSchema.partial().optional() }).default({}));
  if (project.status === "uploading") throw new HttpError(409, "The upload hasn't finished yet.");
  if (!project.storagePath && project.sourceType === "upload") throw new HttpError(409, "The upload hasn't finished yet.");
  const settings = body.settings ? projectSettingsSchema.parse({ ...project.settings, ...body.settings }) : project.settings;
  if (!isProjectActive(project.status)) {
    await getDb()
      .update(projects)
      .set({ status: "queued", progress: 0, errorCode: null, statusMessage: "Waiting for a worker…", settings, rankStrategy: settings.strategy })
      .where(eq(projects.id, project.id));
  }
  const job = await enqueueJob({ type: "process", projectId: project.id, userId: session.userId, dedupeKey: `process:${project.id}` });
  const updated = await getDb().query.projects.findFirst({ where: eq(projects.id, project.id) });
  return { project: await projectSummary(updated!), jobId: job.id, duplicate: !job.created };
});
