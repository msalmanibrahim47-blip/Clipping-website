import { and, desc, eq, getDb, gte, jobs, or, projects, inArray } from "@longcut/db";
import { friendlyError } from "@longcut/shared";
import { route } from "@/lib/api";

/** Active and recent background jobs for the Processing page. */
export const GET = route(async (_req, { session }) => {
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await getDb()
    .select({
      id: jobs.id,
      type: jobs.type,
      status: jobs.status,
      progress: jobs.progress,
      message: jobs.message,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      errorCode: jobs.errorCode,
      projectId: jobs.projectId,
      clipId: jobs.clipId,
      exportId: jobs.exportId,
      createdAt: jobs.createdAt,
      startedAt: jobs.startedAt,
      finishedAt: jobs.finishedAt,
      projectTitle: projects.title,
      projectStatus: projects.status,
      projectProgress: projects.progress,
      projectMessage: projects.statusMessage,
    })
    .from(jobs)
    .leftJoin(projects, eq(projects.id, jobs.projectId))
    .where(
      and(
        eq(jobs.userId, session.userId),
        inArray(jobs.type, ["process", "analyze", "render", "package", "captions", "preview", "probe"]),
        or(inArray(jobs.status, ["queued", "running"]), gte(jobs.updatedAt, since)),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(100);
  return {
    jobs: rows.map((r) => ({ ...r, error: r.status === "failed" ? friendlyError(r.errorCode) : null })),
  };
});
