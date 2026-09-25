export const ALLOWED_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"];

export function maxUploadBytes(): number {
  const v = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isFinite(v) && v > 0 ? v : 100 * 1024 ** 3; // 100 GB
}
