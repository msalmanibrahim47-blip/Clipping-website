import "server-only";
import { enqueueJob, getDb, exportsTable, type Clip, type Project } from "@longcut/db";
import { availableResolutions, exportOptionsSchema, type ExportOptions } from "@longcut/shared";
import { HttpError } from "./api";
import { userDefaults } from "./settings";

/** Creates an export row (snapshotting the clip's current edit) and queues its render job. */
export async function createExport(
  userId: string,
  project: Project,
  clip: Clip,
  input: Partial<ExportOptions> & { format?: "mp4" | "srt" | "vtt" },
) {
  const defaults = await userDefaults(userId);
  const options = exportOptionsSchema.parse({
    resolution: defaults.exportResolution,
    captionLanguage: project.settings.captionLanguage ?? defaults.captionLanguage,
    ...input,
  });
  const allowed = availableResolutions(project.height);
  if (!allowed.includes(options.resolution)) {
    // Never upscale: fall back to the best resolution the source supports.
    options.resolution = allowed.includes("1080p") ? "1080p" : "original";
  }
  if (!project.storagePath) throw new HttpError(409, "The source video is not available.");
  const [exp] = await getDb()
    .insert(exportsTable)
    .values({
      clipId: clip.id,
      projectId: project.id,
      userId,
      resolution: options.resolution,
      captionMode: options.captionMode,
      captionLanguage: options.captionLanguage,
      format: input.format ?? "mp4",
      options,
      startTime: clip.startTime,
      endTime: clip.endTime,
      cuts: clip.cuts,
      status: "queued",
    })
    .returning();
  await enqueueJob({
    type: "render",
    userId,
    projectId: project.id,
    clipId: clip.id,
    exportId: exp.id,
    dedupeKey: `render:${exp.id}`,
    // Subtitle-only exports are quick; let them jump ahead of video renders.
    priority: exp.format === "mp4" ? 0 : 5,
  });
  return exp;
}
