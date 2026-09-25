"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Captions, Download, Image as ImageIcon, Pencil, Play, RefreshCw, Sparkles, Trash2, Trophy, Wand2 } from "lucide-react";
import {
  formatDuration,
  formatTimestamp,
  LANGUAGE_STYLE_LABELS,
  STRATEGIES,
  STRATEGY_LABELS,
  type Strategy,
} from "@longcut/shared";
import { ExportDialog } from "@/components/clips/export-dialog";
import { PackageStatus, PackageSummary, SignalBars } from "@/components/clips/package-view";
import { ClipPreviewPlayer } from "@/components/clips/preview-player";
import { ExportStatusBadge, ScorePill } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { api, useApi } from "@/lib/client";
import type { ClipDto, ExportDto, ProjectDetailDto } from "@/lib/types";

function Range({ clip }: { clip: ClipDto }) {
  return (
    <span className="font-mono text-[13px] tabular text-muted">
      {formatTimestamp(clip.startTime, { alwaysHours: true })} → {formatTimestamp(clip.endTime, { alwaysHours: true })}
    </span>
  );
}

export function ResultsView({ project, onReanalyze }: { project: ProjectDetailDto; onReanalyze: () => void }) {
  const toast = useToast();
  const { data, setData, reload } = useApi<{ clips: ClipDto[]; strategy: Strategy }>(`/api/projects/${project.id}/clips`, {
    interval: (d) => (d?.clips.some((c) => c.packageStatus === "queued" || c.packageStatus === "generating" || c.status === "rendering") ? 3000 : null),
  });
  const { data: exportsData, reload: reloadExports } = useApi<{ exports: ExportDto[] }>(`/api/exports?projectId=${project.id}`, {
    interval: (d) => (d?.exports.some((e) => !["completed", "failed", "expired"].includes(e.status)) ? 3000 : 20000),
  });
  const clips = useMemo(() => data?.clips ?? [], [data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportTargets, setExportTargets] = useState<ClipDto[] | null>(null);
  const [preview, setPreview] = useState<ClipDto | null>(null);
  const [reranking, setReranking] = useState(false);
  const strategy = (data?.strategy ?? project.rankStrategy) as Strategy;

  const best = clips.find((c) => c.rank === 1) ?? clips[0];
  const others = clips.filter((c) => c !== best).slice(0, 4);

  const rerank = async (s: Strategy) => {
    setReranking(true);
    try {
      setData(await api<{ clips: ClipDto[]; strategy: Strategy }>(`/api/projects/${project.id}/rerank`, { method: "POST", json: { strategy: s } }));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setReranking(false);
    }
  };

  const generatePackage = async (clipIds: string[]) => {
    try {
      await Promise.all(clipIds.map((id) => api(`/api/clips/${id}/package`, { method: "POST" })));
      await reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const generate = async (clipIds: string[]) => {
    try {
      await Promise.all(clipIds.map((id) => api(`/api/clips/${id}/render`, { method: "POST" })));
      toast(`${clipIds.length} clip${clipIds.length > 1 ? "s" : ""} queued for rendering.`, "success");
      await Promise.all([reload(), reloadExports()]);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const removeClip = async (clip: ClipDto) => {
    if (!confirm(`Delete “${clip.title}”?`)) return;
    await api(`/api/clips/${clip.id}`, { method: "DELETE" }).catch((err) => toast((err as Error).message, "error"));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(clip.id);
      return n;
    });
    await reload();
  };

  if (!data) return <div className="h-96 animate-pulse rounded-xl bg-surface" />;

  if (clips.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="font-medium">No complete long-form segments matched these settings.</p>
        <p className="mt-1 text-sm text-muted">Try a shorter clip length, “Auto” length, or a different strategy — the transcript is saved, so this is quick.</p>
        <Button className="mt-4" onClick={onReanalyze}>
          <RefreshCw /> Re-analyze
        </Button>
      </Card>
    );
  }

  const allSelected = selected.size === clips.length;
  const selectedClips = clips.filter((c) => selected.has(c.id));
  const activeExports = (exportsData?.exports ?? []).filter((e) => e.createdAt > new Date(Date.now() - 6 * 3600_000).toISOString());

  return (
    <div className="flex flex-col gap-10">
      {/* Summary + strategy */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {clips.length} Strong Clip{clips.length > 1 ? "s" : ""} Found
          </h2>
          <p className="mt-1 text-sm text-muted">
            Ranked by Predicted Performance Potential — a content-based prediction, not a forecast of views.
            {project.languageStats && <> Detected language: {LANGUAGE_STYLE_LABELS[project.languageStats.style]}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Performance strategy</span>
          <NativeSelect className="w-44" value={strategy} disabled={reranking} onChange={(e) => void rerank(e.target.value as Strategy)}>
            {STRATEGIES.filter((s) => s !== "custom").map((s) => (
              <option key={s} value={s}>
                {STRATEGY_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {/* SECTION 1 — #1 BEST CLIP */}
      {best && (
        <section>
          <Card className="relative overflow-hidden border-gold/30">
            <div className="pointer-events-none absolute -left-20 -top-20 size-72 rounded-full bg-gold/10 blur-3xl" />
            <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.1fr_1fr]">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <Badge variant="gold" className="px-2.5 py-1 text-xs">
                    <Trophy className="size-3.5" /> #1 BEST CLIP
                  </Badge>
                  {best.origin === "manual" && <Badge>Manual</Badge>}
                </div>
                <h3 className="text-xl font-semibold leading-snug sm:text-2xl">{best.package?.titles.recommended ?? best.title}</h3>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <Range clip={best} />
                  <span className="text-sm">
                    <span className="text-muted">Duration:</span> <span className="font-semibold tabular">{formatDuration(best.duration)}</span>
                  </span>
                </div>
                <div className="flex items-end gap-3">
                  <ScorePill score={best.score} size="lg" />
                  <span className="pb-1 text-xs font-medium uppercase tracking-wide text-muted">Predicted Performance Potential</span>
                </div>
                {best.reason && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Why this was selected</div>
                    <p className="mt-1 text-[15px] leading-relaxed">{best.reason}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="gold" onClick={() => setPreview(best)} disabled={!project.videoUrl}>
                    <Play /> Preview
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link href={`/projects/${project.id}/clips/${best.id}`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link href={`/projects/${project.id}/clips/${best.id}?tab=captions`}>
                      <Captions /> Captions
                    </Link>
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link href={`/projects/${project.id}/clips/${best.id}?tab=thumbnail`}>
                      <ImageIcon /> Thumbnail
                    </Link>
                  </Button>
                  <Button variant="secondary" onClick={() => setExportTargets([best])}>
                    <Download /> Export
                  </Button>
                  <Button variant="outline" onClick={() => void generate([best.id])}>
                    <Wand2 /> Generate
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/60 p-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">Why it stands out</div>
                <SignalBars signals={best.signals} limit={9} />
              </div>
            </div>
            <div className="relative border-t border-line p-5 sm:p-7">
              {best.package ? (
                <PackageSummary clip={best} pkg={best.package} />
              ) : (
                <PackageStatus status={best.packageStatus} onGenerate={() => void generatePackage([best.id])} />
              )}
            </div>
          </Card>
        </section>
      )}

      {/* SECTION 2 — other high-potential clips */}
      {others.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Other High-Potential Clips</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {others.map((c) => (
              <Card key={c.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-2xl font-semibold text-subtle tabular">#{c.rank}</span>
                  <div className="text-right">
                    <ScorePill score={c.score} />
                    <div className="text-[10px] uppercase tracking-wide text-subtle">Performance Potential</div>
                  </div>
                </div>
                <h3 className="font-semibold leading-snug">{c.package?.titles.recommended ?? c.title}</h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Range clip={c} />
                  <span className="text-sm tabular text-muted">{formatDuration(c.duration)}</span>
                </div>
                {c.reason && <p className="text-sm text-muted">{c.reason}</p>}
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Button size="sm" variant="secondary" onClick={() => setPreview(c)} disabled={!project.videoUrl}>
                    <Play /> Preview
                  </Button>
                  <Button size="sm" variant="secondary" asChild>
                    <Link href={`/projects/${project.id}/clips/${c.id}`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setExportTargets([c])}>
                    <Download /> Export
                  </Button>
                  {!c.package && c.packageStatus !== "queued" && c.packageStatus !== "generating" && (
                    <Button size="sm" variant="ghost" onClick={() => void generatePackage([c.id])}>
                      <Sparkles /> Package
                    </Button>
                  )}
                  {(c.packageStatus === "queued" || c.packageStatus === "generating") && <Badge variant="primary">Writing package…</Badge>}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 3 — full clip list */}
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">Full Clip List</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!selected.size} onClick={() => void generatePackage([...selected])}>
              <Sparkles /> Generate Packages
            </Button>
            <Button size="sm" variant="outline" disabled={!selected.size} onClick={() => void generate([...selected])}>
              <Wand2 /> Generate Selected Clips
            </Button>
            <Button size="sm" disabled={!selected.size} onClick={() => setExportTargets(selectedClips)}>
              <Download /> Export Selected{selected.size ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allSelected ? true : selected.size ? "indeterminate" : false}
                    onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(clips.map((c) => c.id)))}
                    aria-label="Select all clips"
                  />
                </th>
                <th className="px-2 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Clip</th>
                <th className="px-4 py-3 font-medium">Range</th>
                <th className="px-4 py-3 text-right font-medium">Duration</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {clips.map((c) => (
                <tr key={c.id} className="bg-bg hover:bg-surface">
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(c.id);
                          else n.delete(c.id);
                          return n;
                        })
                      }
                      aria-label={`Select clip ${c.rank}`}
                    />
                  </td>
                  <td className="px-2 py-3 font-semibold tabular text-muted">{c.rank}</td>
                  <td className="max-w-[340px] px-4 py-3">
                    <Link href={`/projects/${project.id}/clips/${c.id}`} className="block truncate font-medium hover:text-primary">
                      {c.package?.titles.recommended ?? c.title}
                    </Link>
                    {c.status === "rendering" && <span className="text-xs text-primary">Rendering…</span>}
                    {c.status === "ready" && <span className="text-xs text-success">Generated</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Range clip={c} />
                  </td>
                  <td className="px-4 py-3 text-right tabular">{formatDuration(c.duration)}</td>
                  <td className="px-4 py-3 text-right">{c.signals ? <ScorePill score={c.score} /> : <span className="text-subtle">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Preview" onClick={() => setPreview(c)} disabled={!project.videoUrl}>
                        <Play />
                      </Button>
                      <Button size="icon" variant="ghost" title="Edit" asChild>
                        <Link href={`/projects/${project.id}/clips/${c.id}`}>
                          <Pencil />
                        </Link>
                      </Button>
                      <Button size="icon" variant="ghost" title="Generate captions" asChild>
                        <Link href={`/projects/${project.id}/clips/${c.id}?tab=captions`}>
                          <Captions />
                        </Link>
                      </Button>
                      <Button size="icon" variant="ghost" title="Export" onClick={() => setExportTargets([c])}>
                        <Download />
                      </Button>
                      <Button size="icon" variant="ghost" title="Delete" onClick={() => void removeClip(c)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Batch export status */}
      {activeExports.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Export queue</h2>
            <Link href="/exports" className="text-sm text-primary hover:underline">
              All exports
            </Link>
          </div>
          <Card className="divide-y divide-line">
            {activeExports.map((e) => (
              <div key={e.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.clipTitle}</div>
                  <div className="text-xs text-muted">
                    {e.resolution} · {e.captionMode === "burn" ? "captions burned in" : e.captionMode === "subtitle" ? "subtitle files" : "no captions"}
                    {e.targetDuration ? ` · ${formatDuration(e.targetDuration)} target` : ""}
                  </div>
                </div>
                {!["completed", "failed", "expired"].includes(e.status) && <Progress value={e.progress} active className="h-1.5 sm:w-40" />}
                <ExportStatusBadge status={e.status} />
                {e.status === "completed" && e.files.mp4 && (
                  <Button size="sm" variant="secondary" asChild>
                    <a href={`/api/exports/${e.id}/download?file=mp4`}>
                      <Download /> MP4
                    </a>
                  </Button>
                )}
                {e.status === "failed" && <span className="text-xs text-danger">{e.error}</span>}
              </div>
            ))}
          </Card>
        </section>
      )}

      <ExportDialog
        open={Boolean(exportTargets)}
        onOpenChange={(v) => !v && setExportTargets(null)}
        clips={exportTargets ?? []}
        sourceHeight={project.height}
        defaultCaptionLanguage={project.settings.captionLanguage}
        onCreated={() => {
          void reloadExports();
          setSelected(new Set());
        }}
      />

      <Dialog open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)}>
        {preview && project.videoUrl && (
          <DialogContent title={preview.package?.titles.recommended ?? preview.title} description={`${formatTimestamp(preview.startTime)} → ${formatTimestamp(preview.endTime)} · ${formatDuration(preview.duration)}`} className="max-w-4xl">
            <ClipPreviewPlayer src={project.videoUrl} start={preview.startTime} end={preview.endTime} cuts={preview.cuts} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
