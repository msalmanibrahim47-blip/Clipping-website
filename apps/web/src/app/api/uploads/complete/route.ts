import { z } from "zod";
import { enqueueJob, eq, getDb, projects } from "@longcut/db";
import { completeMultipartUpload, headObject } from "@longcut/services";
import { HttpError, ownedProject, parseBody, route } from "@/lib/api";
import { projectSummary } from "@/lib/serialize";

export const POST = route(async (req, { session }) => {
  const body = await parseBody(
    req,
    z.object({
      projectId: z.string(),
      parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) })).min(1).max(10_000),
      autoStart: z.boolean().default(false),
    }),
  );
  const project = await ownedProject(session.userId, body.projectId);
  if (!project.uploadId || !project.storagePath) throw new HttpError(409, "No upload in progress.");
  try {
    await completeMultipartUpload(project.storagePath, project.uploadId, body.parts);
  } catch {
    throw new HttpError(400, "Video upload failed. Please retry.", "UPLOAD_FAILED");
  }
  const head = await headObject(project.storagePath);
  if (!head || (project.fileSize && head.size !== project.fileSize)) {
    throw new HttpError(400, "Video upload failed. Please retry.", "UPLOAD_FAILED");
  }
  const db = getDb();
  const [updated] = await db
    .update(projects)
    .set({
      uploadId: null,
      status: body.autoStart ? "queued" : "uploaded",
      statusMessage: body.autoStart ? "Waiting for a worker…" : "Reading video metadata…",
      progress: 0,
    })
    .where(eq(projects.id, project.id))
    .returning();
  if (body.autoStart) {
    await enqueueJob({ type: "process", projectId: project.id, userId: session.userId, dedupeKey: `process:${project.id}` });
  } else {
    await enqueueJob({ type: "probe", projectId: project.id, userId: session.userId, dedupeKey: `probe:${project.id}`, priority: 5 });
  }
  return { project: await projectSummary(updated) };
});
