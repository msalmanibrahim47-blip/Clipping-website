import { listUploadedParts } from "@longcut/services";
import { HttpError, ownedProject, route } from "@/lib/api";

/** Parts already stored — lets a reloaded browser resume exactly where it left off. */
export const GET = route(async (req, { session }) => {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const project = await ownedProject(session.userId, projectId);
  if (!project.uploadId || !project.storagePath) throw new HttpError(409, "No upload in progress.");
  try {
    return { parts: await listUploadedParts(project.storagePath, project.uploadId) };
  } catch {
    throw new HttpError(410, "The upload session expired. Please start the upload again.", "UPLOAD_INCOMPLETE");
  }
});
