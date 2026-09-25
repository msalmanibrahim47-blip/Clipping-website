import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, clips, eq, exportsTable, getDb, projects, type Clip, type Export, type Project } from "@longcut/db";
import { AppError, ERROR_MESSAGES, type ErrorCode } from "@longcut/shared";
import { getSession, type Session } from "./auth";

/** Error that is safe to show to the user. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "Not found");

export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Please sign in");
  return session;
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(400, `Invalid request: ${first?.path.join(".") || "body"} ${first?.message ?? ""}`.trim());
  }
  return parsed.data;
}

type Handler<P> = (req: Request, ctx: { params: P; session: Session }) => Promise<Response | unknown>;

/**
 * Wraps a route handler: authenticates, resolves params, converts thrown errors into
 * friendly JSON — raw server errors are logged, never returned.
 */
export function route<P = Record<string, never>>(handler: Handler<P>, opts: { auth?: boolean } = {}) {
  return async (req: Request, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = opts.auth === false ? (null as unknown as Session) : await requireUser();
      const params = (await context?.params) ?? ({} as P);
      const result = await handler(req, { params, session });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof AppError) {
        return NextResponse.json({ error: ERROR_MESSAGES[err.code as ErrorCode], code: err.code }, { status: 400 });
      }
      console.error("[api]", req.method, new URL(req.url).pathname, err);
      return NextResponse.json({ error: "Something went wrong. Please retry." }, { status: 500 });
    }
  };
}

const uuid = z.string().uuid();

/** Ownership checks: users can only ever touch their own projects, clips and exports. */
export async function ownedProject(userId: string, projectId: string): Promise<Project> {
  if (!uuid.safeParse(projectId).success) throw notFound();
  const project = await getDb().query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.userId, userId)) });
  if (!project) throw notFound();
  return project;
}

export async function ownedClip(userId: string, clipId: string): Promise<{ clip: Clip; project: Project }> {
  if (!uuid.safeParse(clipId).success) throw notFound();
  const clip = await getDb().query.clips.findFirst({ where: eq(clips.id, clipId) });
  if (!clip) throw notFound();
  const project = await ownedProject(userId, clip.projectId);
  return { clip, project };
}

export async function ownedExport(userId: string, exportId: string): Promise<Export> {
  if (!uuid.safeParse(exportId).success) throw notFound();
  const exp = await getDb().query.exportsTable.findFirst({ where: and(eq(exportsTable.id, exportId), eq(exportsTable.userId, userId)) });
  if (!exp) throw notFound();
  return exp;
}
