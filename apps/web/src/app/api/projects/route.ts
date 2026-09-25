import { z } from "zod";
import { count, desc, eq, enqueueJob, getDb, inArray, projects, clips } from "@longcut/db";
import { canonicalYouTubeUrl, parseYouTubeId, projectSettingsSchema } from "@longcut/shared";
import { HttpError, parseBody, route } from "@/lib/api";
import { projectSummary } from "@/lib/serialize";
import { resolveProjectSettings } from "@/lib/settings";
import { ALLOWED_EXTENSIONS, maxUploadBytes } from "@/lib/uploads";

export const GET = route(async (_req, { session }) => {
  const db = getDb();
  const rows = await db.query.projects.findMany({
    where: eq(projects.userId, session.userId),
    orderBy: [desc(projects.createdAt)],
    limit: 200,
  });
  const counts = rows.length
    ? await db
        .select({ projectId: clips.projectId, n: count() })
        .from(clips)
        .where(inArray(clips.projectId, rows.map((r) => r.id)))
        .groupBy(clips.projectId)
    : [];
  const byId = new Map(counts.map((c) => [c.projectId, Number(c.n)]));
  return { projects: await Promise.all(rows.map((p) => projectSummary(p, byId.get(p.id) ?? 0))) };
});

const createSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("upload"),
    title: z.string().min(1).max(200).optional(),
    settings: projectSettingsSchema.partial().optional(),
    file: z.object({
      name: z.string().min(1).max(500),
      size: z.number().int().positive(),
      type: z.string().max(200).default(""),
      /** Client-side duration read from the file header, when the browser could read it. */
      duration: z.number().positive().nullable().optional(),
    }),
  }),
  z.object({
    sourceType: z.literal("youtube"),
    title: z.string().min(1).max(200).optional(),
    settings: projectSettingsSchema.partial().optional(),
    autoStart: z.boolean().default(true),
    url: z.string().url(),
    rightsConfirmed: z.literal(true),
    meta: z
      .object({ title: z.string().max(300), author: z.string().max(200).optional(), thumbnailUrl: z.string().url().optional(), duration: z.number().nullable().optional() })
      .optional(),
  }),
]);

export const POST = route(async (req, { session }) => {
  const body = await parseBody(req, createSchema);
  const settings = await resolveProjectSettings(session.userId, body.settings);
  const db = getDb();

  if (body.sourceType === "upload") {
    const ext = body.file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) throw new HttpError(400, "This file format is not supported. Try MP4, MOV, MKV, WebM or AVI.", "UNSUPPORTED_FORMAT");
    if (body.file.size > maxUploadBytes()) throw new HttpError(400, "This file is larger than the maximum upload size.");
    const [project] = await db
      .insert(projects)
      .values({
        userId: session.userId,
        title: body.title ?? body.file.name.replace(/\.[^.]+$/, ""),
        sourceType: "upload",
        originalFilename: body.file.name,
        fileSize: body.file.size,
        mimeType: body.file.type || null,
        duration: null,
        status: "uploading",
        statusMessage: "Waiting for upload",
        settings: { ...settings },
        rankStrategy: settings.strategy,
      })
      .returning();
    // The client passes autoStart again when it completes the upload (uploads can resume later).
    return { project: await projectSummary(project) };
  }

  const videoId = parseYouTubeId(body.url);
  if (!videoId) throw new HttpError(400, "That doesn't look like a valid YouTube link.", "YOUTUBE_INVALID_URL");
  const [project] = await db
    .insert(projects)
    .values({
      userId: session.userId,
      title: body.title ?? body.meta?.title ?? "YouTube video",
      sourceType: "youtube",
      sourceUrl: canonicalYouTubeUrl(videoId),
      youtube: body.meta
        ? { videoId, title: body.meta.title, author: body.meta.author, thumbnailUrl: body.meta.thumbnailUrl, duration: body.meta.duration ?? null }
        : { videoId, title: body.title ?? "YouTube video" },
      status: body.autoStart ? "queued" : "uploaded",
      statusMessage: body.autoStart ? "Waiting for a worker…" : null,
      settings,
      rankStrategy: settings.strategy,
    })
    .returning();
  if (body.autoStart) {
    await enqueueJob({ type: "process", projectId: project.id, userId: session.userId, dedupeKey: `process:${project.id}` });
  }
  return { project: await projectSummary(project) };
});
