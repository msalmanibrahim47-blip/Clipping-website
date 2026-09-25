import { ownedClip, route } from "@/lib/api";
import { createExport } from "@/lib/exports";
import { exportDto } from "@/lib/serialize";

/** "Generate": renders the clip as an MP4 with the user's default export settings. */
export const POST = route<{ id: string }>(async (_req, { params, session }) => {
  const { clip, project } = await ownedClip(session.userId, params.id);
  const exp = await createExport(session.userId, project, clip, { captionStyle: clip.captionStyle ?? undefined });
  return { export: exportDto(exp, clip.title) };
});
