/**
 * Stable error codes shared by the worker and the web app. The worker stores a code on the
 * failed entity; the UI only ever shows the friendly message mapped here — never raw errors.
 */
export const ERROR_MESSAGES = {
  UPLOAD_FAILED: "Video upload failed. Please retry.",
  UPLOAD_INCOMPLETE: "The upload did not finish. Re-select the same file to resume.",
  UNSUPPORTED_FORMAT: "This file format is not supported. Try MP4, MOV, MKV, WebM or AVI.",
  YOUTUBE_UNAVAILABLE: "Unable to access this YouTube video.",
  YOUTUBE_INVALID_URL: "That doesn't look like a valid YouTube link.",
  SOURCE_UNREADABLE: "We couldn't read this video file. It may be corrupted.",
  NO_AUDIO: "Audio could not be detected in this video.",
  NO_SPEECH: "No speech was detected, so there is nothing to transcribe.",
  TRANSCRIPTION_FAILED: "Transcription failed. Retry processing.",
  ANALYSIS_FAILED: "Clip analysis failed. Retry analysis — your transcript is saved.",
  NO_CLIPS_FOUND: "No complete long-form segments matched your settings. Try a shorter clip length or a different strategy.",
  PACKAGE_FAILED: "Publishing package generation failed. Please retry.",
  CAPTIONS_FAILED: "Caption generation failed. Please retry.",
  RENDER_FAILED: "Rendering failed. Your original source is safe.",
  PROVIDER_NOT_CONFIGURED: "A required AI or speech provider is not configured. Check Settings.",
  STORAGE_FAILED: "A storage error occurred. Your original source is safe — please retry.",
  TIMEOUT: "The job took too long and was stopped. Please retry.",
  INTERNAL: "Something went wrong. Please retry.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function friendlyError(code: string | null | undefined): string {
  if (code && code in ERROR_MESSAGES) return ERROR_MESSAGES[code as ErrorCode];
  return ERROR_MESSAGES.INTERNAL;
}

/** Error carrying a user-safe code. Anything else thrown is reported as INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** When false the job queue will not retry (e.g. invalid input). */
  readonly retryable: boolean;
  constructor(code: ErrorCode, detail?: string, opts: { retryable?: boolean; cause?: unknown } = {}) {
    super(detail ?? ERROR_MESSAGES[code], { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = opts.retryable ?? true;
  }
}
