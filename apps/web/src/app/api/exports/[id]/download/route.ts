import { NextResponse } from "next/server";
import { signedGetUrl } from "@longcut/services";
import { HttpError, ownedExport, route } from "@/lib/api";

/** Redirects to a short-lived signed URL for the requested file (mp4 | srt | vtt). */
export const GET = route<{ id: string }>(async (req, { params, session }) => {
  const exp = await ownedExport(session.userId, params.id);
  const file = new URL(req.url).searchParams.get("file") ?? "mp4";
  const key = file === "mp4" ? exp.storagePath : exp.subtitlePaths?.[file];
  if (!key || exp.status !== "completed") throw new HttpError(404, "This file is not available.");
  const url = await signedGetUrl(key, { expiresIn: 900, downloadName: key.split("/").pop() });
  return NextResponse.redirect(url, 302);
});
