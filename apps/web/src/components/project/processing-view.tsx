"use client";
import { Check, Film } from "lucide-react";
import { CONTENT_TYPE_LABELS, formatBytes, humanDuration, isProjectActive, type ProjectStatus } from "@longcut/shared";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ProjectDetailDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS: Array<{ key: ProjectStatus[]; label: string }> = [
  { key: ["queued"], label: "Queued" },
  { key: ["downloading"], label: "Downloading source" },
  { key: ["extracting_audio"], label: "Extracting audio" },
  { key: ["transcribing"], label: "Transcribing" },
  { key: ["analyzing"], label: "Analyzing topics" },
  { key: ["finding_clips"], label: "Finding clips" },
  { key: ["completed"], label: "Completed" },
];

const HEADLINE: Partial<Record<ProjectStatus, string>> = {
  queued: "Waiting for a processing worker…",
  downloading: "Downloading your video…",
  extracting_audio: "Preparing audio for transcription…",
  transcribing: "Transcribing every word…",
  analyzing: "Analyzing your",
  finding_clips: "Finding strong long-form segments…",
};

export function ProcessingView({ project }: { project: ProjectDetailDto }) {
  const steps = project.sourceType === "youtube" ? STEPS : STEPS.filter((s) => !s.key.includes("downloading"));
  const currentIdx = steps.findIndex((s) => s.key.includes(project.status as ProjectStatus));
  const kind = CONTENT_TYPE_LABELS[project.settings.contentType]?.toLowerCase() ?? "video";
  const headline =
    project.status === "analyzing"
      ? `Analyzing your ${project.duration ? humanDuration(project.duration) + " " : ""}${kind}…`
      : (HEADLINE[project.status as ProjectStatus] ?? "Processing…");

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card className="overflow-hidden">
        <div className="relative aspect-video bg-surface-3">
          {project.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.thumbnailUrl} alt="" className="h-full w-full object-cover opacity-60" />
          ) : (
            <Film className="absolute inset-0 m-auto size-10 text-subtle" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <p className="text-lg font-semibold sm:text-xl">{headline}</p>
            <div className="mt-4 flex items-center gap-3">
              <Progress value={project.progress} active={isProjectActive(project.status)} className="h-2.5" />
              <span className="w-12 text-right text-sm font-semibold tabular">{Math.round(project.progress * 100)}%</span>
            </div>
            <p className="mt-3 min-h-5 text-sm text-muted">{project.statusMessage}</p>
            {project.status === "queued" && Date.now() - new Date(project.updatedAt).getTime() > 3 * 60_000 && (
              <p className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                No processing worker has picked this up yet. If this persists, check that the worker service is running (see /api/health).
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <Meta label="Duration" value={humanDuration(project.duration)} />
          <Meta label="Resolution" value={project.height ? `${project.width}×${project.height}` : "—"} />
          <Meta label="Frame rate" value={project.fps ? `${project.fps} fps` : "—"} />
          <Meta label="File size" value={formatBytes(project.fileSize)} />
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold">Pipeline</h3>
        <ol className="mt-4 flex flex-col">
          {steps.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <li key={s.label} className="flex items-center gap-3 py-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    done && "border-success/40 bg-success/15 text-success",
                    active && "border-primary bg-primary-soft text-primary",
                    !done && !active && "border-line-strong text-subtle",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : active ? <span className="size-2 animate-pulse rounded-full bg-primary" /> : i + 1}
                </span>
                <span className={cn("text-sm", active ? "font-medium text-fg" : done ? "text-muted" : "text-subtle")}>{s.label}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 rounded-md bg-surface-2 p-3 text-xs leading-relaxed text-muted">
          You can close this page — processing continues in the background and the project will be waiting for you in Projects.
        </p>
      </Card>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className="mt-0.5 font-medium tabular">{value}</div>
    </div>
  );
}
