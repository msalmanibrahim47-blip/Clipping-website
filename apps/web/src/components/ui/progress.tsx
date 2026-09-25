import { cn } from "@/lib/utils";

export function Progress({ value, className, active, tone = "primary" }: { value: number; className?: string; active?: boolean; tone?: "primary" | "success" | "danger" }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const color = tone === "success" ? "bg-success" : tone === "danger" ? "bg-danger" : "bg-primary";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color, active && "progress-active")} style={{ width: `${pct}%` }} />
    </div>
  );
}
