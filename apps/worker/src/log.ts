type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < min) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};

const scrub = (t: string) => t.replace(/(https?:\/\/[^\s?'"]+)\?[^\s'"]*/g, "$1?<redacted>");

export function errFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: scrub(err.message), stack: scrub(err.stack?.split("\n").slice(0, 6).join("\n") ?? "") };
  return { error: scrub(String(err)) };
}
