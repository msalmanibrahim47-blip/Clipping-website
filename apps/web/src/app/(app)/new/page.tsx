"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FileVideo, Link2, Loader2, UploadCloud, X } from "lucide-react";
import { formatBytes, formatDuration, humanDuration } from "@longcut/shared";
import { PageContainer, PageHeader } from "@/components/app-shell";
import { defaultDraft, draftToSettings, SettingsPanel, type SettingsDraft } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/controls";
import { Input, Label } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { api, useApi } from "@/lib/client";
import type { ProjectSummaryDto } from "@/lib/types";
import { readLocalDuration, uploadFile, type UploadProgress } from "@/lib/uploader";
import { cn } from "@/lib/utils";

interface YtMeta {
  videoId: string;
  url: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  duration: number | null;
  isLive: boolean;
}

const ACCEPT = ".mp4,.mov,.m4v,.mkv,.webm,.avi,video/*";

function NewProject() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [source, setSource] = useState<"upload" | "youtube">(params.get("source") === "youtube" ? "youtube" : "upload");
  const [draft, setDraft] = useState<SettingsDraft>(defaultDraft);
  const { data: settings } = useApi<{ defaults: { clipLength: number | "auto"; clipCount: number; captionLanguage: SettingsDraft["captionLanguage"] } }>("/api/settings");
  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (settings && !appliedDefaults.current) {
      appliedDefaults.current = true;
      setDraft((d) => ({ ...d, clipLength: settings.defaults.clipLength, clipCount: settings.defaults.clipCount, captionLanguage: settings.defaults.captionLanguage }));
    }
  }, [settings]);

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [localDuration, setLocalDuration] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // YouTube state
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<YtMeta | null>(null);
  const [fetching, setFetching] = useState(false);
  const [rights, setRights] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const pickFile = async (f: File | undefined | null) => {
    if (!f) return;
    setFile(f);
    setLocalDuration(null);
    setLocalDuration(await readLocalDuration(f));
  };

  const startUpload = async () => {
    if (!file) return;
    setUploading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { project } = await api<{ project: ProjectSummaryDto }>("/api/projects", {
        method: "POST",
        json: {
          sourceType: "upload",
          settings: draftToSettings(draft),
          file: { name: file.name, size: file.size, type: file.type, duration: localDuration },
        },
      });
      await uploadFile({ projectId: project.id, file, autoStart: true, signal: controller.signal, onProgress: setProgress });
      toast("Upload complete — analysis has started.", "success");
      router.push(`/projects/${project.id}`);
    } catch (err) {
      if ((err as Error).name === "AbortError") toast("Upload paused. Open the project and re-select the file to resume.", "info");
      else toast((err as Error).message?.startsWith("Part upload") || (err as Error).message === "Network error" ? "Video upload failed. Please retry." : (err as Error).message, "error");
      setUploading(false);
    }
  };

  const fetchMeta = async () => {
    setFetching(true);
    setMeta(null);
    try {
      setMeta(await api<YtMeta>("/api/youtube", { method: "POST", json: { url } }));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setFetching(false);
    }
  };

  const startYouTube = async () => {
    if (!meta) return;
    setStarting(true);
    try {
      const { project } = await api<{ project: ProjectSummaryDto }>("/api/projects", {
        method: "POST",
        json: {
          sourceType: "youtube",
          url: meta.url,
          rightsConfirmed: true,
          autoStart: true,
          settings: draftToSettings(draft),
          meta: { title: meta.title, author: meta.author, thumbnailUrl: meta.thumbnailUrl, duration: meta.duration },
        },
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      toast((err as Error).message, "error");
      setStarting(false);
    }
  };

  const eta = progress && progress.speed > 0 ? (progress.total - progress.loaded) / progress.speed : null;

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="New project" description="Add a long video, choose how you want it clipped, and start the analysis." />

      <div className="mb-6 inline-flex rounded-lg border border-line bg-surface p-1">
        {(
          [
            ["upload", "Upload video", UploadCloud],
            ["youtube", "YouTube URL", Link2],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            disabled={uploading}
            onClick={() => setSource(key)}
            className={cn(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
              source === key ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>1 · Source</CardTitle>
          </CardHeader>
          <CardContent>
            {source === "upload" ? (
              <div className="flex flex-col gap-4">
                {!file ? (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      void pickFile(e.dataTransfer.files[0]);
                    }}
                    className={cn(
                      "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
                      dragging ? "border-primary bg-primary-soft" : "border-line-strong hover:border-primary/50 hover:bg-surface-2",
                    )}
                  >
                    <UploadCloud className="size-8 text-primary" />
                    <span className="font-medium">Drop a video here or click to browse</span>
                    <span className="text-xs text-muted">MP4 · MOV · MKV · WebM · AVI — up to ~10 hours</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-line bg-surface-2 p-4">
                    <div className="flex items-start gap-3">
                      <FileVideo className="mt-0.5 size-5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{file.name}</div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted tabular">
                          <span>{formatBytes(file.size)}</span>
                          <span>{localDuration ? `Duration ${humanDuration(localDuration)}` : "Duration shown after upload"}</span>
                        </div>
                      </div>
                      {!uploading && (
                        <button onClick={() => setFile(null)} className="text-muted hover:text-fg" aria-label="Remove file">
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                    {progress && (
                      <div className="mt-4">
                        <Progress value={progress.loaded / progress.total} active={uploading} />
                        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted tabular">
                          <span className="font-semibold text-fg">{((progress.loaded / progress.total) * 100).toFixed(1)}%</span>
                          <span>
                            {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
                          </span>
                          <span>{progress.speed > 0 ? `${formatBytes(progress.speed)}/s` : "…"}</span>
                          <span>{eta != null && eta < 360000 ? `~${formatDuration(eta)} left` : ""}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
                <p className="text-xs text-subtle">
                  Files upload directly to secure storage in resumable parts — nothing large passes through our servers. Keep this tab open until
                  the upload finishes; if it's interrupted you can resume from the project page.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="yt">YouTube URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="yt"
                      placeholder="https://youtube.com/watch?v=…"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && url && void fetchMeta()}
                    />
                    <Button variant="secondary" onClick={fetchMeta} loading={fetching} disabled={!url}>
                      Fetch
                    </Button>
                  </div>
                </div>
                {meta && (
                  <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={meta.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />
                    <div className="p-4">
                      <div className="font-medium">{meta.title}</div>
                      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                        <span>{meta.author}</span>
                        <span className="tabular">{meta.duration ? `Duration ${humanDuration(meta.duration)}` : "Duration shown after download"}</span>
                      </div>
                      {meta.isLive && <p className="mt-2 text-xs text-warning">This stream is live — process it after it ends.</p>}
                    </div>
                  </div>
                )}
                <label className="flex items-start gap-3 text-sm text-muted">
                  <Checkbox checked={rights} onCheckedChange={(v) => setRights(v === true)} className="mt-0.5" />
                  <span>I own this video or have permission to download and process it.</span>
                </label>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Clip settings</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsPanel value={draft} onChange={setDraft} />
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-bg/90 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {draft.customLength
              ? `${draft.clipCount} clips · ${draft.minMinutes}–${draft.maxMinutes} min`
              : `${draft.clipCount} clips · ${draft.clipLength === "auto" ? "5–20 min (auto)" : `~${draft.clipLength} min each`}`}
          </p>
          {source === "upload" ? (
            uploading ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                  Pause upload
                </Button>
                <Button disabled>
                  <Loader2 className="animate-spin" /> Uploading…
                </Button>
              </div>
            ) : (
              <Button size="lg" onClick={startUpload} disabled={!file}>
                {progress ? <CheckCircle2 /> : <UploadCloud />} Upload &amp; Start Analysis
              </Button>
            )
          ) : (
            <Button size="lg" onClick={startYouTube} disabled={!meta || !rights || meta.isLive} loading={starting}>
              Start Analysis
            </Button>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense>
      <NewProject />
    </Suspense>
  );
}
