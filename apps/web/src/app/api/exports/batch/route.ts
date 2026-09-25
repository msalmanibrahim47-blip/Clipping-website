import { z } from "zod";
import { exportOptionsSchema } from "@longcut/shared";
import { ownedClip, parseBody, route } from "@/lib/api";
import { createExport } from "@/lib/exports";
import { exportDto } from "@/lib/serialize";

const schema = z.object({
  clipIds: z.array(z.string().uuid()).min(1).max(50),
  options: exportOptionsSchema.partial().default({}),
  format: z.enum(["mp4", "srt", "vtt"]).default("mp4"),
});

/** Batch export: one background render job per selected clip. */
export const POST = route(async (req, { session }) => {
  const body = await parseBody(req, schema);
  const created = [];
  for (const clipId of body.clipIds) {
    const { clip, project } = await ownedClip(session.userId, clipId);
    const exp = await createExport(session.userId, project, clip, {
      ...body.options,
      format: body.format,
      captionStyle: body.options.captionStyle ?? clip.captionStyle ?? undefined,
    });
    created.push(exportDto(exp, clip.title, project.title));
  }
  return { exports: created };
});
