import { z } from "zod";
import { MAX_PARTS, signUploadParts } from "@longcut/services";
import { HttpError, ownedProject, parseBody, route } from "@/lib/api";

/** Presigned PUT URLs for a batch of parts (valid 1 hour; the client re-signs as needed). */
export const POST = route(async (req, { session }) => {
  const body = await parseBody(
    req,
    z.object({ projectId: z.string(), partNumbers: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(100) }),
  );
  const project = await ownedProject(session.userId, body.projectId);
  if (!project.uploadId || !project.storagePath || project.status !== "uploading") throw new HttpError(409, "No upload in progress.");
  return { urls: await signUploadParts(project.storagePath, project.uploadId, body.partNumbers) };
});
