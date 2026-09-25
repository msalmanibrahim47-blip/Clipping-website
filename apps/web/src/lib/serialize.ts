import "server-only";
import type { Clip, Export, Project } from "@longcut/db";
import { signedGetUrl } from "@longcut/services";
import { friendlyError } from "@longcut/shared";

async function url(key: string | null | undefined, expiresIn = 6 * 3600): Promise<string | null> {
  if (!key) return null;
  try {
    return await signedGetUrl(key, { expiresIn });
  } catch {
    return null;
  }
}

export async function projectSummary(p: Project, clipCount = 0) {
  return {
    id: p.id,
    title: p.title,
    sourceType: p.sourceType,
    sourceUrl: p.sourceUrl,
    originalFilename: p.originalFilename,
    fileSize: p.fileSize,
    duration: p.duration,
    width: p.width,
    height: p.height,
    fps: p.fps,
    status: p.status,
    progress: p.progress,
    statusMessage: p.statusMessage,
    errorCode: p.errorCode,
    error: p.status === "failed" || p.errorCode ? friendlyError(p.errorCode) : null,
    settings: p.settings,
    rankStrategy: p.rankStrategy,
    languageStats: p.languageStats,
    youtube: p.youtube,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    completedAt: p.completedAt,
    thumbnailUrl: (await url(p.thumbnailPath)) ?? p.youtube?.thumbnailUrl ?? null,
    clipCount,
  };
}

export async function projectDetail(p: Project, clipCount = 0, hasTranscript = false) {
  const playableSource = p.media?.browserPlayable && p.storagePath;
  return {
    ...(await projectSummary(p, clipCount)),
    media: p.media,
    hasTranscript,
    // Preview proxy when the source can't play in browsers; otherwise stream the source itself.
    videoUrl: p.previewPath ? await url(p.previewPath) : playableSource ? await url(p.storagePath) : null,
    previewPending: !p.previewPath && !playableSource && Boolean(p.duration),
    waveformUrl: await url(p.waveformPath),
    waveformRate: p.waveformRate,
    uploadInProgress: p.status === "uploading",
  };
}

export async function clipDto(c: Clip) {
  return {
    id: c.id,
    projectId: c.projectId,
    origin: c.origin,
    rank: c.rank,
    startTime: c.startTime,
    endTime: c.endTime,
    duration: c.duration,
    cuts: c.cuts,
    originalStart: c.originalStart,
    originalEnd: c.originalEnd,
    score: c.score,
    signals: c.signals,
    flags: c.flags,
    title: c.title,
    reason: c.reason,
    summary: c.summary,
    topics: c.topics,
    hookText: c.hookText,
    hookStart: c.hookStart,
    status: c.status,
    package: c.package,
    packageStatus: c.packageStatus,
    captionStyle: c.captionStyle,
    captionLanguage: c.captionLanguage,
    frameUrl: await url(c.frameThumbPath),
    updatedAt: c.updatedAt,
  };
}

export function exportDto(e: Export, clipTitle?: string, projectTitle?: string) {
  return {
    id: e.id,
    clipId: e.clipId,
    projectId: e.projectId,
    clipTitle: clipTitle ?? null,
    projectTitle: projectTitle ?? null,
    resolution: e.resolution,
    captionMode: e.captionMode,
    captionLanguage: e.captionLanguage,
    format: e.format,
    targetDuration: e.options.targetDuration,
    status: e.status,
    progress: e.progress,
    error: e.status === "failed" ? friendlyError(e.errorCode ?? "RENDER_FAILED") : null,
    fileSize: e.fileSize,
    duration: e.duration,
    createdAt: e.createdAt,
    completedAt: e.completedAt,
    expiresAt: e.expiresAt,
    files: {
      mp4: Boolean(e.storagePath),
      srt: Boolean(e.subtitlePaths?.srt),
      vtt: Boolean(e.subtitlePaths?.vtt),
    },
  };
}
