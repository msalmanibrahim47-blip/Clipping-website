import { z } from "zod";
import { eq, getDb, projects } from "@longcut/db";
import { createMultipartUpload, keys, MAX_PARTS, partSizeFor } from "@longcut/services";
import { HttpError, ownedProject, parseBody, route } from "@/lib/api";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
};

/**
 * Starts (or returns the existing) resumable multipart upload for a project. The browser
 * uploads parts straight to object storage with presigned URLs.
 */
export const POST = route(async (req, { session }) => {
  const { projectId } = await parseBody(req, z.object({ projectId: z.string() }));
  const project = await ownedProject(session.userId, projectId);
  if (project.sourceType !== "upload" || project.status !== "uploading") throw new HttpError(409, "This project is not waiting for an upload.");
  const size = project.fileSize ?? 0;
  const partSize = partSizeFor(size);
  const totalParts = Math.max(1, Math.ceil(size / partSize));
  if (totalParts > MAX_PARTS) throw new HttpError(400, "This file is too large.");
  if (project.uploadId && project.storagePath) {
    return { uploadId: project.uploadId, partSize, totalParts, resumed: true };
  }
  const ext = project.originalFilename?.split(".").pop()?.toLowerCase() ?? "mp4";
  const key = keys.source(session.userId, project.id, project.originalFilename ?? `source.${ext}`);
  const uploadId = await createMultipartUpload(key, MIME[ext] ?? project.mimeType ?? "application/octet-stream");
  await getDb().update(projects).set({ uploadId, storagePath: key }).where(eq(projects.id, project.id));
  return { uploadId, partSize, totalParts, resumed: false };
});
