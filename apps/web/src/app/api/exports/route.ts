import { and, clips, desc, eq, exportsTable, getDb, projects } from "@longcut/db";
import { route } from "@/lib/api";
import { exportDto } from "@/lib/serialize";

export const GET = route(async (req, { session }) => {
  const projectId = new URL(req.url).searchParams.get("projectId");
  const rows = await getDb()
    .select({ e: exportsTable, clipTitle: clips.title, projectTitle: projects.title })
    .from(exportsTable)
    .innerJoin(clips, eq(clips.id, exportsTable.clipId))
    .innerJoin(projects, eq(projects.id, exportsTable.projectId))
    .where(and(eq(exportsTable.userId, session.userId), projectId ? eq(exportsTable.projectId, projectId) : undefined))
    .orderBy(desc(exportsTable.createdAt))
    .limit(300);
  return { exports: rows.map((r) => exportDto(r.e, r.clipTitle, r.projectTitle)) };
});
