import { eq, getDb, projects, type Project } from "@longcut/db";
import type { ProjectStatus } from "@longcut/shared";

let lastWrite = new Map<string, number>();

/**
 * Updates the project row the UI polls. Progress-only updates are throttled; status changes
 * are always written immediately.
 */
export async function setProjectState(
  projectId: string,
  patch: { status?: ProjectStatus; progress?: number; statusMessage?: string | null; errorCode?: string | null },
  opts: { force?: boolean } = {},
) {
  const now = Date.now();
  if (!patch.status && !opts.force && now - (lastWrite.get(projectId) ?? 0) < 2000) return;
  lastWrite.set(projectId, now);
  if (lastWrite.size > 1000) lastWrite = new Map();
  await getDb()
    .update(projects)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.progress != null ? { progress: Math.max(0, Math.min(1, patch.progress)) } : {}),
      ...(patch.statusMessage !== undefined ? { statusMessage: patch.statusMessage } : {}),
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
    })
    .where(eq(projects.id, projectId));
}

export async function loadProject(projectId: string): Promise<Project | undefined> {
  return getDb().query.projects.findFirst({ where: eq(projects.id, projectId) });
}
