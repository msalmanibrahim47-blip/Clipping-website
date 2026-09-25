import { z } from "zod";
import { eq, getDb, projects } from "@longcut/db";
import { abortMultipartUpload } from "@longcut/services";
import { ownedProject, parseBody, route } from "@/lib/api";

/** Cancels an in-progress upload and frees the stored parts. */
export const POST = route(async (req, { session }) => {
  const { projectId } = await parseBody(req, z.object({ projectId: z.string() }));
  const project = await ownedProject(session.userId, projectId);
  if (project.uploadId && project.storagePath) {
    await abortMultipartUpload(project.storagePath, project.uploadId).catch(() => undefined);
  }
  await getDb()
    .update(projects)
    .set({ uploadId: null, storagePath: null, status: "failed", errorCode: "UPLOAD_INCOMPLETE" })
    .where(eq(projects.id, project.id));
  return { ok: true };
});
