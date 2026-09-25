"use client";
import { api } from "./client";

/**
 * Resumable multipart upload, browser → object storage. The file is read slice by slice
 * (never loaded into memory), parts upload in parallel with retries, and progress state is
 * kept in localStorage so a reload or a dropped connection can resume with the same file.
 */
export interface UploadProgress {
  loaded: number;
  total: number;
  /** Bytes per second (smoothed). */
  speed: number;
  partsDone: number;
  partsTotal: number;
}

interface StoredState {
  projectId: string;
  name: string;
  size: number;
  lastModified: number;
}

const STORAGE_KEY = "longcut.uploads";
const CONCURRENCY = 4;
const MAX_PART_ATTEMPTS = 6;

export function rememberUpload(state: StoredState) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, StoredState>;
    all[state.projectId] = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — resume still works by re-selecting the file */
  }
}

export function forgetUpload(projectId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, StoredState>;
    delete all[projectId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function storedUpload(projectId: string): StoredState | null {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, StoredState>;
    return all[projectId] ?? null;
  } catch {
    return null;
  }
}

function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) reject(new Error("Missing ETag — storage CORS must expose the ETag header"));
        else resolve(etag);
      } else reject(new Error(`Part upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadFile(opts: {
  projectId: string;
  file: File;
  autoStart: boolean;
  signal: AbortSignal;
  onProgress: (p: UploadProgress) => void;
}): Promise<void> {
  const { projectId, file, signal } = opts;
  rememberUpload({ projectId, name: file.name, size: file.size, lastModified: file.lastModified });
  const init = await api<{ uploadId: string; partSize: number; totalParts: number; resumed: boolean }>("/api/uploads", {
    method: "POST",
    json: { projectId },
  });
  const done = new Map<number, string>();
  if (init.resumed) {
    const { parts } = await api<{ parts: Array<{ partNumber: number; etag: string; size: number }> }>(`/api/uploads/parts?projectId=${projectId}`);
    for (const p of parts) {
      const expected = p.partNumber === init.totalParts ? file.size - (init.totalParts - 1) * init.partSize : init.partSize;
      if (p.size === expected) done.set(p.partNumber, p.etag);
    }
  }

  const inFlight = new Map<number, number>();
  let completedBytes = 0;
  for (const n of done.keys()) completedBytes += Math.min(init.partSize, file.size - (n - 1) * init.partSize);
  let lastBytes = completedBytes;
  let lastTime = performance.now();
  let speed = 0;
  const report = () => {
    const loaded = completedBytes + [...inFlight.values()].reduce((a, b) => a + b, 0);
    const now = performance.now();
    if (now - lastTime > 800) {
      const inst = ((loaded - lastBytes) / (now - lastTime)) * 1000;
      speed = speed ? speed * 0.7 + inst * 0.3 : inst;
      lastBytes = loaded;
      lastTime = now;
    }
    opts.onProgress({ loaded, total: file.size, speed, partsDone: done.size, partsTotal: init.totalParts });
  };
  report();

  const queue = Array.from({ length: init.totalParts }, (_, i) => i + 1).filter((n) => !done.has(n));
  const urlCache = new Map<number, { url: string; at: number }>();
  const signBatch = async (from: number) => {
    const batch = queue.slice(from, from + 50).filter((n) => !urlCache.has(n) || Date.now() - urlCache.get(n)!.at > 45 * 60_000);
    if (!batch.length) return;
    const { urls } = await api<{ urls: Array<{ partNumber: number; url: string }> }>("/api/uploads/sign", {
      method: "POST",
      json: { projectId, partNumbers: batch },
    });
    for (const u of urls) urlCache.set(u.partNumber, { url: u.url, at: Date.now() });
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const idx = cursor++;
      const partNumber = queue[idx];
      const start = (partNumber - 1) * init.partSize;
      const blob = file.slice(start, Math.min(file.size, start + init.partSize));
      for (let attempt = 1; ; attempt++) {
        try {
          if (!urlCache.has(partNumber)) await signBatch(idx);
          const etag = await putPart(
            urlCache.get(partNumber)!.url,
            blob,
            (loaded) => {
              inFlight.set(partNumber, loaded);
              report();
            },
            signal,
          );
          inFlight.delete(partNumber);
          done.set(partNumber, etag);
          completedBytes += blob.size;
          report();
          break;
        } catch (err) {
          inFlight.delete(partNumber);
          if ((err as Error).name === "AbortError" || attempt >= MAX_PART_ATTEMPTS) throw err;
          urlCache.delete(partNumber); // the URL may have expired
          await sleep(Math.min(30_000, 1000 * 2 ** attempt));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));

  await api("/api/uploads/complete", {
    method: "POST",
    json: {
      projectId,
      autoStart: opts.autoStart,
      parts: [...done.entries()].map(([partNumber, etag]) => ({ partNumber, etag })),
    },
  });
  forgetUpload(projectId);
}

/** Reads duration from the file header in the browser (works for most MP4/MOV/WebM files). */
export function readLocalDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    video.src = url;
  });
}
