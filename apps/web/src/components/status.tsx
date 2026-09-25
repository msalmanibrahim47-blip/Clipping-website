import { EXPORT_STATUS_LABELS, isProjectActive, PROJECT_STATUS_LABELS, type ExportStatus, type ProjectStatus } from "@longcut/shared";
import { Badge } from "@/components/ui/badge";

export function ProjectStatusBadge({ status }: { status: string }) {
  const label = PROJECT_STATUS_LABELS[status as ProjectStatus] ?? status;
  if (status === "completed") return <Badge variant="success">{label}</Badge>;
  if (status === "failed") return <Badge variant="danger">{label}</Badge>;
  if (status === "uploading" || status === "uploaded") return <Badge variant="info">{label}</Badge>;
  if (isProjectActive(status))
    return (
      <Badge variant="primary">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        {label}
      </Badge>
    );
  return <Badge>{label}</Badge>;
}

export function ExportStatusBadge({ status }: { status: string }) {
  const label = EXPORT_STATUS_LABELS[status as ExportStatus] ?? status;
  if (status === "completed") return <Badge variant="success">{label}</Badge>;
  if (status === "failed") return <Badge variant="danger">{label}</Badge>;
  if (status === "expired") return <Badge variant="outline">{label}</Badge>;
  if (status === "queued") return <Badge>{label}</Badge>;
  return (
    <Badge variant="primary">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      {label}
    </Badge>
  );
}

export function ScorePill({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const tone = score >= 85 ? "text-success" : score >= 70 ? "text-gold" : "text-fg";
  return (
    <span className={`inline-flex items-baseline gap-0.5 font-semibold tabular ${tone} ${size === "lg" ? "text-3xl" : "text-base"}`}>
      {score}
      <span className={`font-medium text-subtle ${size === "lg" ? "text-sm" : "text-[11px]"}`}>/100</span>
    </span>
  );
}
