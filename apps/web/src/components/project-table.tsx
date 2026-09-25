"use client";
import Link from "next/link";
import { Film, MonitorPlay } from "lucide-react";
import { humanDuration, isProjectActive } from "@longcut/shared";
import type { ProjectSummaryDto } from "@/lib/types";
import { Progress } from "@/components/ui/progress";
import { ProjectStatusBadge } from "./status";

function relativeDate(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ProjectTable({ projects }: { projects: ProjectSummaryDto[] }) {
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
        No projects yet. Upload a video or paste a YouTube link to create your first one.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Project</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Duration</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Clips</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {projects.map((p) => (
            <tr key={p.id} className="bg-bg transition-colors hover:bg-surface">
              <td className="px-4 py-3">
                <Link href={`/projects/${p.id}`} className="flex min-w-0 items-center gap-3">
                  <div className="relative hidden h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-3 sm:block">
                    {p.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Film className="absolute inset-0 m-auto size-4 text-subtle" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      {p.sourceType === "youtube" && <MonitorPlay className="size-3.5 shrink-0 text-danger" />}
                      <span className="truncate">{p.title}</span>
                    </div>
                    {isProjectActive(p.status) && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <Progress value={p.progress} active className="h-1 w-32" />
                        <span className="text-[11px] text-muted tabular">{Math.round(p.progress * 100)}%</span>
                      </div>
                    )}
                  </div>
                </Link>
              </td>
              <td className="hidden px-4 py-3 text-right text-muted tabular sm:table-cell">{humanDuration(p.duration)}</td>
              <td className="hidden px-4 py-3 text-right tabular sm:table-cell">{p.clipCount || "—"}</td>
              <td className="px-4 py-3">
                <ProjectStatusBadge status={p.status} />
              </td>
              <td className="hidden px-4 py-3 text-muted md:table-cell">{relativeDate(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
