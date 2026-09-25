"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Network error — check your connection and retry.", 0);
  }
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong. Please retry.", res.status, data.code);
  return data as T;
}

/**
 * Minimal data hook with optional polling. Polling pauses while the tab is hidden and
 * `interval` can be a function of the latest data (stop polling once work is done).
 */
export function useApi<T>(path: string | null, opts: { interval?: number | ((data: T | undefined) => number | null) } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const dataRef = useRef<T | undefined>(undefined);
  const intervalRef = useRef(opts.interval);
  intervalRef.current = opts.interval;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      dataRef.current = d;
      setData(d);
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") await load();
      const iv = intervalRef.current;
      const ms = typeof iv === "function" ? iv(dataRef.current) : iv;
      if (ms && !cancelled) timer = setTimeout(tick, ms);
    };
    setLoading(true);
    void tick();
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, load]);

  return { data, error, loading, reload: load, setData };
}
