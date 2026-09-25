export const PROJECT_STATUSES = [
  "uploading",
  "uploaded",
  "queued",
  "downloading",
  "extracting_audio",
  "transcribing",
  "analyzing",
  "finding_clips",
  "completed",
  "failed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  uploading: "Uploading",
  uploaded: "Uploaded",
  queued: "Queued",
  downloading: "Downloading source",
  extracting_audio: "Extracting audio",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  finding_clips: "Finding clips",
  completed: "Completed",
  failed: "Failed",
};

export const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [
  "queued",
  "downloading",
  "extracting_audio",
  "transcribing",
  "analyzing",
  "finding_clips",
];

export function isProjectActive(status: string): boolean {
  return (ACTIVE_PROJECT_STATUSES as string[]).includes(status);
}

export const EXPORT_STATUSES = [
  "queued",
  "generating_captions",
  "rendering",
  "exporting",
  "completed",
  "failed",
  "expired",
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const EXPORT_STATUS_LABELS: Record<ExportStatus, string> = {
  queued: "Queued",
  generating_captions: "Generating captions",
  rendering: "Rendering",
  exporting: "Uploading file",
  completed: "Completed",
  failed: "Failed",
  expired: "Expired",
};

export const CLIP_STATUSES = ["candidate", "rendering", "ready", "failed"] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

export const PACKAGE_STATUSES = ["none", "queued", "generating", "ready", "failed"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const JOB_TYPES = [
  "probe",
  "process",
  "preview",
  "analyze",
  "package",
  "captions",
  "render",
  "cleanup",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Jobs that need FFmpeg-heavy CPU and large temp disk; the worker runs these on a separate, smaller pool. */
export const HEAVY_JOB_TYPES: JobType[] = ["process", "preview", "render"];

export const JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
