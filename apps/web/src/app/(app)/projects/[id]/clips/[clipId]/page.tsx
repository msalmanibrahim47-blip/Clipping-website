"use client";
import Link from "next/link";
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Maximize2, Pause, Play, Repeat, RotateCcw, Save, ZoomIn, ZoomOut } from "lucide-react";
import {
  captionStyleFor,
  captionStyleSchema,
  formatDuration,
  formatTimestamp,
  keepRanges,
  keptDuration,
  parseTimestamp,
  type CaptionLanguage,
  type CaptionStyle,
  type TimeRange,
} from "@longcut/shared";
import { PageContainer } from "@/components/app-shell";
import { CaptionOverlay } from "@/components/clips/caption-overlay";
import { ExportDialog } from "@/components/clips/export-dialog";
import { Field, Hashtags, HookBlock, packageText, PackageStatus, SignalBars, ThumbnailBlock, TitleOptions } from "@/components/clips/package-view";
import { CaptionPanel } from "@/components/editor/caption-panel";
import { Timeline } from "@/components/editor/timeline";
import { TranscriptPanel } from "@/components/editor/transcript-panel";
import { ExportStatusBadge, ScorePill } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { api, useApi } from "@/lib/client";
import type { CaptionCueDto, ClipDto, ExportDto, ProjectDetailDto, SentenceDto } from "@/lib/types";

type Edit = { startTime: number; endTime: number; cuts: TimeRange[] };

function mergeCut(cuts: TimeRange[], add: TimeRange): TimeRange[] {
  const all = [...cuts, add].sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const c of all) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end + 0.05) last.end = Math.max(last.end, c.end);
    else out.push({ ...c });
  }
  return out;
}

function removeCut(cuts: TimeRange[], range: TimeRange): TimeRange[] {
  const out: TimeRange[] = [];
  for (const c of cuts) {
    if (range.end <= c.start || range.start >= c.end) out.push(c);
    else {
      if (range.start > c.start) out.push({ start: c.start, end: range.start });
      if (range.end < c.end) out.push({ start: range.end, end: c.end });
    }
  }
  return out.filter((c) => c.end - c.start > 0.05);
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatTimestamp(value, { alwaysHours: true }));
  useEffect(() => setText(formatTimestamp(value, { alwaysHours: true })), [value]);
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      {label}
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const t = parseTimestamp(text);
          if (t != null) onCommit(t);
          else setText(formatTimestamp(value, { alwaysHours: true }));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-7 w-24 px-2 font-mono text-xs tabular"
      />
    </label>
  );
}

function Editor({ projectId, clipId }: { projectId: string; clipId: string }) {
  const toast = useToast();
  const search = useSearchParams();
  const [tab, setTab] = useState(search.get("tab") ?? "transcript");
  const { data: pData } = useApi<{ project: ProjectDetailDto }>(`/api/projects/${projectId}`, {
    interval: (d) => (d?.project.previewPending ? 15000 : null),
  });
  const { data: cData, setData: setClipData, reload: reloadClip } = useApi<{ clip: ClipDto }>(`/api/clips/${clipId}`, {
    interval: (d) => (d && ["queued", "generating"].includes(d.clip.packageStatus) ? 3000 : null),
  });
  const { data: exportsData, reload: reloadExports } = useApi<{ exports: ExportDto[] }>(`/api/exports?projectId=${projectId}`, {
    interval: (d) => (d?.exports.some((e) => e.clipId === clipId && !["completed", "failed", "expired"].includes(e.status)) ? 3000 : null),
  });
  const project = pData?.project;
  const clip = cData?.clip;

  // ----- boundary editing state -----
  const [edit, setEdit] = useState<Edit | null>(null);
  useEffect(() => {
    if (clip && !edit) setEdit({ startTime: clip.startTime, endTime: clip.endTime, cuts: clip.cuts });
  }, [clip, edit]);
  const dirty = Boolean(clip && edit && (edit.startTime !== clip.startTime || edit.endTime !== clip.endTime || JSON.stringify(edit.cuts) !== JSON.stringify(clip.cuts)));
  const [saving, setSaving] = useState(false);

  // ----- player -----
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clipMode, setClipMode] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [loop, setLoop] = useState(false);
  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, t);
    setTime(t);
  }, []);
  useEffect(() => {
    if (clip && videoRef.current && videoRef.current.readyState >= 1 && time === 0) seek(clip.startTime);
  }, [clip, seek, time]);

  useEffect(() => {
    let raf = 0;
    const tickFn = () => {
      const v = videoRef.current;
      if (v && edit) {
        let t = v.currentTime;
        if (clipMode && !v.paused) {
          const cut = edit.cuts.find((c) => t >= c.start && t < c.end - 0.05);
          if (cut) v.currentTime = t = cut.end;
          if (t >= edit.endTime) {
            if (loop) v.currentTime = t = edit.startTime;
            else {
              v.pause();
              v.currentTime = t = edit.endTime;
            }
          }
        }
        setTime(t);
      }
      raf = requestAnimationFrame(tickFn);
    };
    raf = requestAnimationFrame(tickFn);
    return () => cancelAnimationFrame(raf);
  }, [edit, clipMode, loop]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !edit) return;
    if (v.paused) {
      if (clipMode && (v.currentTime < edit.startTime - 0.5 || v.currentTime >= edit.endTime - 0.1)) v.currentTime = edit.startTime;
      void v.play();
    } else v.pause();
  }, [edit, clipMode]);

  // ----- view window -----
  const duration = project?.duration ?? (edit ? edit.endTime + 60 : 0);
  const [zoomSpan, setZoomSpan] = useState<number | null>(null);
  const view = useMemo(() => {
    if (!edit) return { start: 0, end: 1 };
    if (zoomSpan) {
      const s = Math.max(0, Math.min(duration - zoomSpan, time - zoomSpan / 2));
      return { start: s, end: Math.min(duration, s + zoomSpan) };
    }
    const pad = Math.max(20, (edit.endTime - edit.startTime) * 0.12);
    return { start: Math.max(0, edit.startTime - pad), end: Math.min(duration || edit.endTime + pad, edit.endTime + pad) };
  }, [edit, zoomSpan, duration, time]);

  // ----- waveform -----
  const [waveform, setWaveform] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!project?.waveformUrl || waveform) return;
    fetch(project.waveformUrl)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => b && setWaveform(new Uint8Array(b)))
      .catch(() => undefined);
  }, [project?.waveformUrl, waveform]);

  // ----- transcript window -----
  const [focus, setFocus] = useState<number | null>(null);
  const tWindow = useMemo(() => {
    if (!clip) return null;
    const center = focus ?? (clip.startTime + clip.endTime) / 2;
    const half = Math.max(600, (clip.endTime - clip.startTime) / 2 + 300);
    return { from: Math.max(0, Math.floor(center - half)), to: Math.ceil(center + half) };
  }, [clip, focus]);
  const { data: tData, loading: tLoading } = useApi<{ sentences: SentenceDto[] }>(
    tWindow ? `/api/projects/${projectId}/transcript?from=${tWindow.from}&to=${tWindow.to}` : null,
  );

  // ----- captions -----
  const [style, setStyle] = useState<CaptionStyle | null>(null);
  const [styleDirty, setStyleDirty] = useState(false);
  const [language, setLanguage] = useState<CaptionLanguage>("auto");
  useEffect(() => {
    if (clip && project && !style) {
      setStyle(clip.captionStyle ? captionStyleSchema.parse(clip.captionStyle) : captionStyleFor("clean"));
      setLanguage((clip.captionLanguage as CaptionLanguage) ?? project.settings.captionLanguage ?? "auto");
    }
  }, [clip, project, style]);
  const captionsPath = style ? `/api/clips/${clipId}/captions?language=${language}&maxChars=${style.maxCharsPerLine}&maxLines=${style.maxLines}&v=${clip?.updatedAt}` : null;
  const { data: capData, reload: reloadCaptions } = useApi<{ status: "ready" | "pending" | "needs_generation"; cues: CaptionCueDto[] }>(captionsPath, {
    interval: (d) => (d?.status === "pending" ? 3000 : null),
  });
  const [genCaptions, setGenCaptions] = useState(false);

  const savedKeeps = useMemo(() => (clip ? keepRanges(clip.startTime, clip.endTime, clip.cuts) : []), [clip]);
  const outTime = useMemo(() => {
    let offset = 0;
    for (const k of savedKeeps) {
      if (time >= k.start && time <= k.end) return offset + (time - k.start);
      offset += k.end - k.start;
    }
    return -1;
  }, [savedKeeps, time]);

  // ----- keyboard shortcuts -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "i" && edit) setEdit({ ...edit, startTime: Math.min(time, edit.endTime - 5) });
      else if (e.key === "o" && edit) setEdit({ ...edit, endTime: Math.max(time, edit.startTime + 5) });
      else if (e.key === "ArrowLeft") seek(time - (e.shiftKey ? 10 : 1));
      else if (e.key === "ArrowRight") seek(time + (e.shiftKey ? 10 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, edit, time, seek]);

  const [exportOpen, setExportOpen] = useState(false);
  const [title, setTitle] = useState<string | null>(null);

  if (!project || !clip || !edit || !style) {
    return (
      <PageContainer>
        <div className="h-8 w-80 animate-pulse rounded bg-surface" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="aspect-video animate-pulse rounded-xl bg-surface" />
          <div className="h-[520px] animate-pulse rounded-xl bg-surface" />
        </div>
      </PageContainer>
    );
  }

  const editDuration = keptDuration(keepRanges(edit.startTime, edit.endTime, edit.cuts));
  const clamp = (t: number) => Math.max(0, Math.min(duration, t));
  const nudge = (edge: "startTime" | "endTime", d: number) =>
    setEdit((e) => {
      if (!e) return e;
      const v = clamp(e[edge] + d);
      return edge === "startTime" ? { ...e, startTime: Math.min(v, e.endTime - 5) } : { ...e, endTime: Math.max(v, e.startTime + 5) };
    });

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await api<{ clip: ClipDto }>(`/api/clips/${clipId}`, { method: "PATCH", json: edit });
      setClipData(res);
      setEdit({ startTime: res.clip.startTime, endTime: res.clip.endTime, cuts: res.clip.cuts });
      toast("Clip saved.", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const resetEdit = async () => {
    if (!confirm("Reset to the AI-selected boundaries and remove all cuts?")) return;
    const res = await api<{ clip: ClipDto }>(`/api/clips/${clipId}`, { method: "PATCH", json: { reset: true } });
    setClipData(res);
    setEdit({ startTime: res.clip.startTime, endTime: res.clip.endTime, cuts: res.clip.cuts });
  };

  const saveStyle = async () => {
    setSaving(true);
    try {
      const res = await api<{ clip: ClipDto }>(`/api/clips/${clipId}`, { method: "PATCH", json: { captionStyle: style, captionLanguage: language } });
      setClipData(res);
      setStyleDirty(false);
      toast("Caption style saved.", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const generatePackage = async () => {
    await api(`/api/clips/${clipId}/package`, { method: "POST" }).catch((err) => toast((err as Error).message, "error"));
    await reloadClip();
  };

  const pkg = clip.package;
  const clipExports = (exportsData?.exports ?? []).filter((e) => e.clipId === clipId);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0">
            <Link href={`/projects/${projectId}`} aria-label="Back to results">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Link href={`/projects/${projectId}`} className="truncate hover:text-fg">
                {project.title}
              </Link>
              <span>·</span>
              <span>Clip #{clip.rank}</span>
              {clip.signals && <ScorePill score={clip.score} />}
            </div>
            <input
              value={title ?? clip.title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={async () => {
                if (title && title !== clip.title) setClipData(await api(`/api/clips/${clipId}`, { method: "PATCH", json: { title } }));
              }}
              className="w-full min-w-0 truncate bg-transparent text-lg font-semibold outline-none focus:underline sm:text-xl"
              aria-label="Clip title"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <Badge variant="warning">Unsaved changes</Badge>}
          <Button variant="ghost" onClick={resetEdit} title="Reset to AI boundaries">
            <RotateCcw /> Reset
          </Button>
          <Button variant="secondary" onClick={saveEdit} disabled={!dirty} loading={saving}>
            <Save /> Save
          </Button>
          <Button onClick={() => (dirty ? toast("Save your changes before exporting.", "info") : setExportOpen(true))}>
            <Download /> Export
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,1fr)]">
        {/* Left: player + timeline */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-line bg-black" style={{ containerType: "size" }}>
            {project.videoUrl ? (
              <video
                ref={videoRef}
                src={project.videoUrl}
                preload="metadata"
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
                onLoadedMetadata={() => seek(clip.startTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={togglePlay}
                onError={() => setVideoError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
                {project.previewPending ? "Building a browser preview of this video (MKV/AVI/HEVC/4K sources)…" : "Video preview unavailable."}
              </div>
            )}
            {videoError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-sm text-muted">
                This browser can't play the source format. Editing, captions and exports still work — or try Chrome, Edge or Safari.
              </div>
            )}
            {!dirty && style.enabled && capData?.status === "ready" && outTime >= 0 && <CaptionOverlay cues={capData.cues} time={outTime} style={style} />}
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/65 px-2 py-0.5 font-mono text-[11px] text-white/85 tabular">
              {formatTimestamp(time, { alwaysHours: true })}
            </div>
          </div>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={togglePlay} disabled={!project.videoUrl}>
                {playing ? <Pause /> : <Play />} {playing ? "Pause" : clipMode ? "Play clip" : "Play"}
              </Button>
              <Button size="sm" variant={clipMode ? "secondary" : "ghost"} onClick={() => setClipMode((v) => !v)} title="Stay within the clip and skip removed parts">
                Clip only
              </Button>
              <Button size="sm" variant={loop ? "secondary" : "ghost"} onClick={() => setLoop((v) => !v)} title="Loop clip">
                <Repeat />
              </Button>
              <span className="flex-1" />
              <span className="text-xs text-muted">
                Clip duration <span className="font-semibold text-fg tabular">{formatDuration(editDuration)}</span>
                {edit.cuts.length > 0 && <span className="text-subtle"> · {edit.cuts.length} cut{edit.cuts.length > 1 ? "s" : ""}</span>}
              </span>
              <Button size="icon" variant="ghost" title="Zoom in around playhead" onClick={() => setZoomSpan((z) => Math.max(10, (z ?? view.end - view.start) / 2))}>
                <ZoomIn />
              </Button>
              <Button size="icon" variant="ghost" title="Zoom out" onClick={() => setZoomSpan((z) => (z ? (z * 2 >= duration ? null : z * 2) : null))}>
                <ZoomOut />
              </Button>
              <Button size="icon" variant="ghost" title="Fit clip" onClick={() => setZoomSpan(null)}>
                <Maximize2 />
              </Button>
            </div>
            <Timeline
              viewStart={view.start}
              viewEnd={view.end}
              start={edit.startTime}
              end={edit.endTime}
              cuts={edit.cuts}
              currentTime={time}
              waveform={waveform}
              waveformRate={project.waveformRate ?? 10}
              onSeek={seek}
              onScrub={seek}
              onChange={({ start, end }) => setEdit((e) => (e ? { ...e, startTime: start != null ? clamp(start) : e.startTime, endTime: end != null ? clamp(end) : e.endTime } : e))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-1">
                <TimeField label="In" value={edit.startTime} onCommit={(v) => setEdit({ ...edit, startTime: Math.min(clamp(v), edit.endTime - 5) })} />
                {[-1, -0.1, 0.1, 1].map((d) => (
                  <Button key={d} size="sm" variant="ghost" className="h-7 px-1.5 font-mono text-[11px]" onClick={() => nudge("startTime", d)}>
                    {d > 0 ? "+" : ""}
                    {d}s
                  </Button>
                ))}
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEdit({ ...edit, startTime: Math.min(time, edit.endTime - 5) })}>
                  Set to playhead (I)
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <TimeField label="Out" value={edit.endTime} onCommit={(v) => setEdit({ ...edit, endTime: Math.max(clamp(v), edit.startTime + 5) })} />
                {[-1, -0.1, 0.1, 1].map((d) => (
                  <Button key={d} size="sm" variant="ghost" className="h-7 px-1.5 font-mono text-[11px]" onClick={() => nudge("endTime", d)}>
                    {d > 0 ? "+" : ""}
                    {d}s
                  </Button>
                ))}
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEdit({ ...edit, endTime: Math.max(time, edit.startTime + 5) })}>
                  Set to playhead (O)
                </Button>
              </div>
            </div>
            {edit.cuts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {edit.cuts.map((c, i) => (
                  <button key={i} onClick={() => setEdit({ ...edit, cuts: edit.cuts.filter((_, j) => j !== i) })} className="rounded-md bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger hover:bg-danger/20" title="Restore this section">
                    ✕ {formatTimestamp(c.start)}–{formatTimestamp(c.end)}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-subtle">Space play/pause · I / O set in/out at playhead · ←/→ seek 1s (Shift = 10s)</p>
          </Card>
        </div>

        {/* Right: transcript + package tabs */}
        <Card className="flex min-h-[560px] flex-col p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="title">Title</TabsTrigger>
              <TabsTrigger value="description">Description</TabsTrigger>
              <TabsTrigger value="hashtags">Hashtags</TabsTrigger>
              <TabsTrigger value="thumbnail">Thumbnail</TabsTrigger>
              <TabsTrigger value="hook">Hook</TabsTrigger>
              <TabsTrigger value="captions">Captions</TabsTrigger>
              <TabsTrigger value="export">Export</TabsTrigger>
            </TabsList>

            <TabsContent value="transcript" className="flex min-h-0 flex-1 flex-col">
              <TranscriptPanel
                projectId={projectId}
                sentences={tData?.sentences ?? []}
                loading={tLoading}
                start={edit.startTime}
                end={edit.endTime}
                cuts={edit.cuts}
                currentTime={time}
                onSeek={seek}
                onSetStart={(t) => setEdit((e) => (e ? { ...e, startTime: Math.min(t, e.endTime - 5) } : e))}
                onSetEnd={(t) => setEdit((e) => (e ? { ...e, endTime: Math.max(t, e.startTime + 5) } : e))}
                onCut={(r) => setEdit((e) => (e ? { ...e, cuts: mergeCut(e.cuts, r) } : e))}
                onRestore={(r) => setEdit((e) => (e ? { ...e, cuts: removeCut(e.cuts, r) } : e))}
                onFocusTime={(t) => {
                  setFocus(t);
                  seek(t);
                }}
              />
            </TabsContent>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1 scroll-thin data-[hidden=true]:hidden" data-hidden={tab === "transcript"}>
              <TabsContent value="overview">
                <div className="flex flex-col gap-5">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Performance Potential">{clip.signals ? <ScorePill score={clip.score} size="lg" /> : "—"}</Field>
                    <Field label="Duration">
                      <span className="text-lg font-semibold tabular">{formatDuration(clip.duration)}</span>
                    </Field>
                    <Field label="Start">
                      <span className="font-mono tabular">{formatTimestamp(clip.startTime, { alwaysHours: true })}</span>
                    </Field>
                    <Field label="End">
                      <span className="font-mono tabular">{formatTimestamp(clip.endTime, { alwaysHours: true })}</span>
                    </Field>
                  </div>
                  {clip.reason && <Field label="Why it stands out">{clip.reason}</Field>}
                  {clip.summary && <Field label="Summary">{clip.summary}</Field>}
                  {clip.topics.length > 0 && (
                    <Field label="Topics">
                      <div className="flex flex-wrap gap-1.5">
                        {clip.topics.map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </div>
                    </Field>
                  )}
                  {clip.signals && (
                    <Field label="Content signals">
                      <SignalBars signals={clip.signals} />
                    </Field>
                  )}
                </div>
              </TabsContent>

              {(["title", "description", "hashtags", "thumbnail", "hook"] as const).map((t) => (
                <TabsContent key={t} value={t}>
                  {!pkg ? (
                    <PackageStatus status={clip.packageStatus} onGenerate={generatePackage} />
                  ) : (
                    <div className="flex flex-col gap-5">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={generatePackage}>
                          Regenerate
                        </Button>
                        <CopyButton text={packageText(clip, pkg)} label="Copy All" />
                      </div>
                      {t === "title" && <TitleOptions pkg={pkg} />}
                      {t === "description" && (
                        <>
                          <Field label="YouTube / Facebook description" copy={pkg.description.long}>
                            {pkg.description.long}
                          </Field>
                          <Field label="Short description" copy={pkg.description.short}>
                            {pkg.description.short}
                          </Field>
                          <Field label="Keywords / topics" copy={pkg.keywords.join(", ")}>
                            {pkg.keywords.join(", ")}
                          </Field>
                          <Field label="CTA" copy={pkg.cta}>
                            {pkg.cta}
                          </Field>
                        </>
                      )}
                      {t === "hashtags" && (
                        <Field label={`${pkg.hashtags.length} hashtags`} copy={pkg.hashtags.join(" ")}>
                          <Hashtags tags={pkg.hashtags} />
                        </Field>
                      )}
                      {t === "thumbnail" && <ThumbnailBlock pkg={pkg} frameUrl={clip.frameUrl} />}
                      {t === "hook" && <HookBlock pkg={pkg} />}
                    </div>
                  )}
                </TabsContent>
              ))}

              <TabsContent value="captions">
                {dirty && <p className="mb-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">Save your boundary changes to refresh the caption preview.</p>}
                <CaptionPanel
                  clipId={clipId}
                  style={style}
                  onStyle={(s) => {
                    setStyle(s);
                    setStyleDirty(true);
                  }}
                  language={language}
                  onLanguage={(l) => {
                    setLanguage(l);
                    setStyleDirty(true);
                  }}
                  status={capData?.status ?? "loading"}
                  generating={genCaptions}
                  onGenerate={async () => {
                    setGenCaptions(true);
                    await api(`/api/clips/${clipId}/captions`, { method: "POST", json: { language } }).catch((err) => toast((err as Error).message, "error"));
                    setGenCaptions(false);
                    await reloadCaptions();
                  }}
                  dirty={styleDirty}
                  onSave={saveStyle}
                  saving={saving}
                />
              </TabsContent>

              <TabsContent value="export">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3">
                    <span className="text-sm text-muted">Clip Duration</span>
                    <span className="text-lg font-semibold tabular">{formatDuration(clip.duration)}</span>
                  </div>
                  <Button onClick={() => (dirty ? toast("Save your changes before exporting.", "info") : setExportOpen(true))}>
                    <Download /> Export MP4 / SRT / VTT…
                  </Button>
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Export history</div>
                    {clipExports.length === 0 && <p className="text-sm text-muted">No exports yet.</p>}
                    <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
                      {clipExports.map((e) => (
                        <div key={e.id} className="flex flex-col gap-2 px-3 py-2.5 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted">
                              {new Date(e.createdAt).toLocaleString()} · {e.resolution} · {e.captionMode}
                            </span>
                            <ExportStatusBadge status={e.status} />
                          </div>
                          {e.status === "completed" && (
                            <div className="flex flex-wrap gap-2">
                              {(["mp4", "srt", "vtt"] as const)
                                .filter((f) => e.files[f])
                                .map((f) => (
                                  <Button key={f} size="sm" variant="secondary" asChild>
                                    <a href={`/api/exports/${e.id}/download?file=${f}`}>
                                      <Download /> {f.toUpperCase()}
                                    </a>
                                  </Button>
                                ))}
                            </div>
                          )}
                          {e.status === "failed" && <span className="text-xs text-danger">{e.error}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </Card>
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        clips={[clip]}
        sourceHeight={project.height}
        defaultCaptionLanguage={language}
        onCreated={() => {
          void reloadExports();
          setTab("export");
        }}
      />
    </div>
  );
}

export default function ClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { id, clipId } = use(params);
  return (
    <Suspense>
      <Editor projectId={id} clipId={clipId} />
    </Suspense>
  );
}
