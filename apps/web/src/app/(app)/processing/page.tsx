"use client";
import Link from "next/link";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@longcut/shared";
import { PageContainer, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useApi } from "@/lib/client";
import type { JobDto } from "@/lib/types";

const JOB_LABELS: Record<string, string> = {
  process: "Processing video",
  analyze: "Re-analyzing clips",
  render: "Rendering export",
  package: "Publishing package",
  captions: "Generating captions",
  preview: "Building preview",
  probe: "Reading metadata",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-primary" />;
  if (status === "queued") return <Clock className="size-4 text-muted" />;
  if (status === "completed") return <CheckCircle2 className="size-4 text-success" />;
  return <XCircle className="size-4 text-danger" />;
}

export default function ProcessingPage() {
  const { data } = useApi<{ jobs: JobDto[] }>("/api/jobs", {
    interval: (d) => (d?.jobs.some((j) => j.status === "running" || j.status === "queued") ? 2500 : 15000),
  });
  const jobs = data?.jobs ?? [];
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const recent = jobs.filter((j) => !(j.status === "running" || j.status === "queued"));

  const row = (j: JobDto) => {
    const isPipeline = j.type === "process" || j.type === "analyze";
    const progress = isPipeline && j.projectProgress != null ? j.projectProgress : j.progress;
    const message = isPipeline ? (j.projectMessage ?? PROJECT_STATUS_LABELS[j.projectStatus as ProjectStatus]) : j.message;
    return (
      <div key={j.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
        <StatusIcon status={j.status} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {JOB_LABELS[j.type] ?? j.type}
            {j.projectTitle && (
              <>
                {" · "}
                <Link href={`/projects/${j.projectId}`} className="text-muted hover:text-fg">
                  {j.projectTitle}
                </Link>
              </>
            )}
          </div>
          <div className="truncate text-xs text-muted">
            {j.status === "failed" ? <span className="text-danger">{j.error}</span> : j.status === "queued" ? (j.attempts > 0 ? `Retrying (attempt ${j.attempts + 1} of ${j.maxAttempts})…` : "Waiting for a worker…") : message}
          </div>
        </div>
        {j.status === "running" && (
          <div className="flex items-center gap-2 sm:w-56">
            <Progress value={progress} active className="h-1.5" />
            <span className="w-10 text-right text-xs tabular text-muted">{Math.round(progress * 100)}%</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Processing" description="Everything running in the background. You can leave any page — jobs keep going." />
      <h2 className="mb-2 text-sm font-semibold text-muted">Active ({active.length})</h2>
      <Card className="mb-8 divide-y divide-line">
        {active.length ? active.map(row) : <p className="px-4 py-8 text-center text-sm text-muted">Nothing is processing right now.</p>}
      </Card>
      <h2 className="mb-2 text-sm font-semibold text-muted">Last 24 hours</h2>
      <Card className="divide-y divide-line">{recent.length ? recent.map(row) : <p className="px-4 py-8 text-center text-sm text-muted">No recent jobs.</p>}</Card>
    </PageContainer>
  );
}
