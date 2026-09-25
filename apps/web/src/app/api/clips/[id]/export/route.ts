import { z } from "zod";
import { exportOptionsSchema } from "@longcut/shared";
import { ownedClip, parseBody, route } from "@/lib/api";
import { createExport } from "@/lib/exports";
import { exportDto } from "@/lib/serialize";

const schema = exportOptionsSchema.partial().extend({ format: z.enum(["mp4", "srt", "vtt"]).default("mp4") });

export const POST = route<{ id: string }>(async (req, { params, session }) => {
  const { clip, project } = await ownedClip(session.userId, params.id);
  const body = await parseBody(req, schema);
  const exp = await createExport(session.userId, project, clip, { ...body, captionStyle: body.captionStyle ?? clip.captionStyle ?? undefined });
  return { export: exportDto(exp, clip.title) };
});
