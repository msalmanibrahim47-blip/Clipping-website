"use client";
import Link from "next/link";
import { Download } from "lucide-react";
import { formatBytes, formatDuration } from "@longcut/shared";
import { PageContainer, PageHeader } from "@/components/app-shell";
import { ExportStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useApi } from "@/lib/client";
import type { ExportDto } from "@/lib/types";

export default function ExportsPage() {
  const { data } = useApi<{ exports: ExportDto[] }>("/api/exports", {
    interval: (d) => (d?.exports.some((e) => !["completed", "failed", "expired"].includes(e.status)) ? 3000 : 30000),
  });
  const exps = data?.exports ?? [];
  return (
    <PageContainer>
      <PageHeader title="Exports" description="Rendered clips and subtitle files. Download links are generated on demand and expire quickly." />
      {data && exps.length === 0 && (
        <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">No exports yet. Export a clip from a project’s results.</div>
      )}
      {exps.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Clip</th>
                <th className="px-4 py-3 font-medium">Settings</th>
                <th className="px-4 py-3 text-right font-medium">Length</th>
                <th className="px-4 py-3 text-right font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Files</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {exps.map((e) => (
                <tr key={e.id} className="bg-bg hover:bg-surface">
                  <td className="max-w-[320px] px-4 py-3">
                    <Link href={`/projects/${e.projectId}/clips/${e.clipId}?tab=export`} className="block truncate font-medium hover:text-primary">
                      {e.clipTitle}
                    </Link>
                    <span className="block truncate text-xs text-muted">{e.projectTitle}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {e.format.toUpperCase()} · {e.resolution} · {e.captionMode === "burn" ? "burned captions" : e.captionMode === "subtitle" ? "subtitle files" : "no captions"} · {e.captionLanguage}
                  </td>
                  <td className="px-4 py-3 text-right tabular">{e.duration ? formatDuration(e.duration) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular text-muted">{formatBytes(e.fileSize)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      <ExportStatusBadge status={e.status} />
                      {!["completed", "failed", "expired"].includes(e.status) && <Progress value={e.progress} active className="h-1 w-28" />}
                      {e.error && <span className="text-xs text-danger">{e.error}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {(["mp4", "srt", "vtt"] as const)
                        .filter((f) => e.files[f] && e.status === "completed")
                        .map((f) => (
                          <Button key={f} size="sm" variant="secondary" asChild>
                            <a href={`/api/exports/${e.id}/download?file=${f}`}>
                              <Download /> {f.toUpperCase()}
                            </a>
                          </Button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
