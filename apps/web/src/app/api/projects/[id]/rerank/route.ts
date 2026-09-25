import { z } from "zod";
import { asc, clips, eq, getDb, projects } from "@longcut/db";
import { rankClips, SIGNAL_KEYS, STRATEGIES } from "@longcut/shared";
import { ownedProject, parseBody, route } from "@/lib/api";
import { clipDto } from "@/lib/serialize";

const schema = z.object({
  strategy: z.enum(STRATEGIES),
  customWeights: z.partialRecord(z.enum(SIGNAL_KEYS), z.number().min(0).max(5)).optional(),
});

/** Re-ranks existing clips for a different performance strategy — instant, no reprocessing. */
export const POST = route<{ id: string }>(async (req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const body = await parseBody(req, schema);
  const db = getDb();
  const all = await db.query.clips.findMany({ where: eq(clips.projectId, project.id), orderBy: [asc(clips.rank)] });
  const scorable = all.filter((c) => c.signals);
  const ranked = rankClips(scorable, body.strategy, body.customWeights);
  const unscored = all.filter((c) => !c.signals);
  await db.transaction(async (tx) => {
    for (const c of ranked) await tx.update(clips).set({ score: c.score, rank: c.rank }).where(eq(clips.id, c.id));
    for (const [i, c] of unscored.entries()) await tx.update(clips).set({ rank: ranked.length + i + 1 }).where(eq(clips.id, c.id));
    await tx
      .update(projects)
      .set({
        rankStrategy: body.strategy,
        settings: { ...project.settings, customWeights: body.customWeights ?? project.settings.customWeights },
      })
      .where(eq(projects.id, project.id));
  });
  const fresh = await db.query.clips.findMany({ where: eq(clips.projectId, project.id), orderBy: [asc(clips.rank)] });
  return { clips: await Promise.all(fresh.map(clipDto)), strategy: body.strategy };
});
