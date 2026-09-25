import { and, count, desc, eq, getDb, clips, jobs, inArray } from "@longcut/db";
import { ownedProject, route } from "@/lib/api";
import { friendlyError } from "@longcut/shared";

/** Lightweight endpoint the UI polls while a project is processing. */
export const GET = route<{ id: string }>(async (_req, { params, session }) => {
  const project = await ownedProject(session.userId, params.id);
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(clips).where(eq(clips.projectId, project.id));
  const active = await db
    .select({ type: jobs.type, status: jobs.status, progress: jobs.progress, message: jobs.message, attempts: jobs.attempts })
    .from(jobs)
    .where(and(eq(jobs.projectId, project.id), inArray(jobs.status, ["queued", "running"])))
    .orderBy(desc(jobs.createdAt))
    .limit(20);
  return {
    id: project.id,
    status: project.status,
    progress: project.progress,
    statusMessage: project.statusMessage,
    error: project.status === "failed" ? friendlyError(project.errorCode) : null,
    errorCode: project.errorCode,
    duration: project.duration,
    width: project.width,
    height: project.height,
    clipCount: Number(n),
    updatedAt: project.updatedAt,
    jobs: active,
  };
});
