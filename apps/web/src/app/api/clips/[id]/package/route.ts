import { clips, enqueueJob, eq, getDb } from "@longcut/db";
import { ownedClip, route } from "@/lib/api";

/** "Generate Publishing Package": titles, descriptions, hashtags, thumbnail concept & prompt, hook, CTA. */
export const POST = route<{ id: string }>(async (_req, { params, session }) => {
  const { clip, project } = await ownedClip(session.userId, params.id);
  await getDb().update(clips).set({ packageStatus: "queued" }).where(eq(clips.id, clip.id));
  await enqueueJob({
    type: "package",
    userId: session.userId,
    projectId: project.id,
    clipId: clip.id,
    dedupeKey: `package:${clip.id}`,
    priority: 10,
  });
  return { packageStatus: "queued" };
});
