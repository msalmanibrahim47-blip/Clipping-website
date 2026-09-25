"use client";
import { useMemo, useState } from "react";
import { Film } from "lucide-react";
import {
  availableResolutions,
  CAPTION_LANGUAGE_LABELS,
  CAPTION_LANGUAGES,
  CLIP_LENGTH_PRESETS,
  formatDuration,
  RESOLUTION_LABELS,
  RESOLUTIONS,
  type CaptionLanguage,
  type CaptionMode,
  type Resolution,
} from "@longcut/shared";
import { Button } from "@/components/ui/button";
import { Checkbox, Segmented, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client";
import type { ClipDto, ExportDto } from "@/lib/types";

type DurationChoice = "original" | "custom" | `${number}`;

export function ExportDialog({
  open,
  onOpenChange,
  clips,
  sourceHeight,
  defaultCaptionLanguage = "auto",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clips: ClipDto[];
  sourceHeight: number | null;
  defaultCaptionLanguage?: CaptionLanguage;
  onCreated?: (exports: ExportDto[]) => void;
}) {
  const toast = useToast();
  const single = clips.length === 1 ? clips[0] : null;
  const allowed = useMemo(() => availableResolutions(sourceHeight), [sourceHeight]);
  const [resolution, setResolution] = useState<Resolution>(allowed.includes("1080p") ? "1080p" : "original");
  const [captionMode, setCaptionMode] = useState<CaptionMode>("burn");
  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguage>(defaultCaptionLanguage);
  const [srt, setSrt] = useState(true);
  const [vtt, setVtt] = useState(false);
  const [durationChoice, setDurationChoice] = useState<DurationChoice>("original");
  const [customMinutes, setCustomMinutes] = useState(10);
  const [useAiHook, setUseAiHook] = useState(false);
  const [busy, setBusy] = useState(false);

  const targetDuration = durationChoice === "original" ? null : durationChoice === "custom" ? customMinutes * 60 : Number(durationChoice) * 60;
  const hasHook = clips.some((c) => c.package?.hook.suggestion);

  const submit = async () => {
    setBusy(true);
    const options = {
      resolution,
      captionMode,
      captionLanguage,
      subtitleFormats: [...(srt ? ["srt"] : []), ...(vtt ? ["vtt"] : [])],
      targetDuration,
      useAiHook,
    };
    try {
      const res = single
        ? { exports: [(await api<{ export: ExportDto }>(`/api/clips/${single.id}/export`, { method: "POST", json: { ...options, format: "mp4" } })).export] }
        : await api<{ exports: ExportDto[] }>("/api/exports/batch", { method: "POST", json: { clipIds: clips.map((c) => c.id), options } });
      toast(`${res.exports.length} export${res.exports.length > 1 ? "s" : ""} queued — they render in the background.`, "success");
      onCreated?.(res.exports);
      onOpenChange(false);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={single ? "Export clip" : `Export ${clips.length} clips`}
        description="MP4 · H.264 video · AAC audio. Renders run in the background — you can leave this page."
        className="max-w-xl"
      >
        <div className="flex flex-col gap-5">
          {single && (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
              <Film className="size-4 text-primary" />
              <span className="text-sm text-muted">Clip Duration:</span>
              <span className="font-semibold tabular">{formatDuration(single.duration)}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Duration</Label>
            <Segmented
              size="sm"
              value={durationChoice}
              onChange={setDurationChoice}
              options={[
                ...CLIP_LENGTH_PRESETS.map((m) => ({ value: `${m}` as DurationChoice, label: `${m} min` })),
                { value: "original" as DurationChoice, label: "Original Clip" },
                { value: "custom" as DurationChoice, label: "Custom" },
              ]}
            />
            {durationChoice === "custom" && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Input type="number" min={1} max={120} className="w-20" value={customMinutes} onChange={(e) => setCustomMinutes(Math.max(1, Number(e.target.value) || 1))} />
                minutes
              </div>
            )}
            {targetDuration && single && targetDuration < single.duration - 5 && (
              <p className="text-xs text-muted">Shorter than the clip: we keep the strongest complete section of ~{formatDuration(targetDuration)} rather than cutting from the start.</p>
            )}
            {targetDuration && single && targetDuration > single.duration + 5 && (
              <p className="text-xs text-muted">Longer than the clip: the range extends evenly on both sides to natural sentence breaks.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Video quality</Label>
            <Segmented
              size="sm"
              value={resolution}
              onChange={setResolution}
              options={RESOLUTIONS.map((r) => ({ value: r, label: RESOLUTION_LABELS[r], disabled: !allowed.includes(r) }))}
            />
            {sourceHeight && <p className="text-xs text-subtle">Source is {sourceHeight}p — higher options are disabled because upscaling doesn't add detail.</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Captions</Label>
            <Segmented
              size="sm"
              value={captionMode}
              onChange={setCaptionMode}
              options={[
                { value: "burn", label: "Burn into video" },
                { value: "none", label: "No captions" },
                { value: "subtitle", label: "Subtitle files" },
              ]}
            />
          </div>

          {captionMode !== "none" && (
            <div className="flex flex-col gap-2">
              <Label>Caption language</Label>
              <Segmented size="sm" value={captionLanguage} onChange={setCaptionLanguage} options={CAPTION_LANGUAGES.map((c) => ({ value: c, label: CAPTION_LANGUAGE_LABELS[c] }))} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-5 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Also export</span>
            <label className="flex items-center gap-2">
              <Checkbox checked={srt || captionMode === "subtitle"} disabled={captionMode === "subtitle"} onCheckedChange={(v) => setSrt(v === true)} /> SRT
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={vtt || captionMode === "subtitle"} disabled={captionMode === "subtitle"} onCheckedChange={(v) => setVtt(v === true)} /> VTT
            </label>
          </div>

          {hasHook && (
            <label className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
              <span>
                <span className="font-medium">Use AI hook overlay</span>
                <span className="block text-xs text-muted">Shows the suggested hook as on-screen text for the first 5 seconds. Off keeps the original opening only.</span>
              </span>
              <Switch checked={useAiHook} onCheckedChange={setUseAiHook} />
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy}>
              {single ? "Export MP4" : "Export Selected"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
