import "server-only";

/** Environment variables the web app (Netlify) needs. Values are never returned to clients. */
export const REQUIRED_WEB_ENV = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "APP_ENCRYPTION_KEY",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
] as const;

export function envReport() {
  const missing = REQUIRED_WEB_ENV.filter((k) => !process.env[k]);
  const problems: string[] = [];
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) problems.push("AUTH_SECRET must be at least 32 characters");
  if (process.env.APP_ENCRYPTION_KEY && Buffer.from(process.env.APP_ENCRYPTION_KEY, "base64").length !== 32)
    problems.push("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  if (process.env.STORAGE_ENDPOINT && /localhost|127\.0\.0\.1/.test(process.env.STORAGE_ENDPOINT) && process.env.NODE_ENV === "production")
    problems.push("STORAGE_ENDPOINT points at localhost in production");
  return { missing, problems };
}
