"use client";
import { Image as ImageIcon, Sparkles } from "lucide-react";
import { formatDuration, formatPackageText, formatTimestamp, SIGNAL_LABELS, type PublishingPackage, type SignalKey } from "@longcut/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { ClipDto } from "@/lib/types";
import { cn } from "@/lib/utils";

export function packageText(clip: ClipDto, pkg: PublishingPackage) {
  return formatPackageText(pkg, {
    start: formatTimestamp(clip.startTime, { alwaysHours: true }),
    end: formatTimestamp(clip.endTime, { alwaysHours: true }),
    duration: formatDuration(clip.duration),
  });
}

export function Field({ label, children, copy, className }: { label: string; children: React.ReactNode; copy?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</span>
        {copy && <CopyButton text={copy} size="sm" variant="ghost" className="h-6 px-2 text-[11px]" />}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function Hashtags({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="rounded-md bg-primary-soft px-2 py-0.5 text-[13px] text-primary">
          {t}
        </span>
      ))}
    </div>
  );
}

export function TitleOptions({ pkg }: { pkg: PublishingPackage }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Recommended title" copy={pkg.titles.recommended}>
        <span className="text-base font-semibold">{pkg.titles.recommended}</span>
      </Field>
      {pkg.titles.alternatives.map((t, i) => (
        <Field key={i} label={`Alternative ${i + 1}`} copy={t}>
          {t}
        </Field>
      ))}
    </div>
  );
}

export function ThumbnailBlock({ pkg, frameUrl }: { pkg: PublishingPackage; frameUrl?: string | null }) {
  const t = pkg.thumbnail;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-surface-3">
          {frameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frameUrl} alt="Source frame" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="absolute inset-0 m-auto size-6 text-subtle" />
          )}
          <div className="absolute inset-x-2 bottom-2 rounded bg-black/70 px-2 py-1 text-center text-[11px] font-extrabold uppercase tracking-wide text-white">
            {t.recommendedText}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject">{t.subject}</Field>
          <Field label="Emotion">{t.emotion}</Field>
          <Field label="Composition">{t.composition}</Field>
          <Field label="Background">{t.background}</Field>
          {t.visualElement && <Field label="Visual element">{t.visualElement}</Field>}
        </div>
      </div>
      <Field label="Thumbnail text">
        <div className="flex flex-wrap gap-2">
          {t.textOptions.map((o) => (
            <span
              key={o}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-bold uppercase tracking-wide",
                o === t.recommendedText ? "border-gold/50 bg-gold-soft text-gold" : "border-line-strong text-muted",
              )}
            >
              {o}
              {o === t.recommendedText && <span className="ml-1.5 font-medium normal-case tracking-normal">· recommended</span>}
            </span>
          ))}
        </div>
      </Field>
      <Field label="AI image prompt" copy={t.prompt}>
        <p className="rounded-md bg-surface-2 p-3 font-mono text-xs leading-relaxed text-muted">{t.prompt}</p>
      </Field>
      {t.sourceFramePrompt && (
        <Field label="Use Source Frame · image-to-image prompt" copy={t.sourceFramePrompt}>
          <p className="rounded-md bg-surface-2 p-3 font-mono text-xs leading-relaxed text-muted">{t.sourceFramePrompt}</p>
          {frameUrl && (
            <Button asChild variant="link" size="sm" className="mt-1 h-auto">
              <a href={frameUrl} download="source-frame.jpg" target="_blank" rel="noreferrer">
                Download source frame
              </a>
            </Button>
          )}
        </Field>
      )}
    </div>
  );
}

export function HookBlock({ pkg }: { pkg: PublishingPackage }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Existing hook (original opening)" copy={pkg.hook.original}>
        <blockquote className="border-l-2 border-primary pl-3 italic">“{pkg.hook.original}”</blockquote>
        {pkg.hook.originalStart != null && <span className="mt-1 block text-xs text-subtle tabular">at {formatTimestamp(pkg.hook.originalStart)}</span>}
      </Field>
      <Field label="Hook strength">
        <span className="text-lg font-semibold tabular">{pkg.hook.strength}/100</span>
      </Field>
      <Field label="AI hook suggestion" copy={pkg.hook.suggestion}>
        <span className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /> {pkg.hook.suggestion}
        </span>
        <span className="mt-1 block text-xs text-subtle">Choose “Use AI hook overlay” when exporting to show it on screen; otherwise the original opening is used.</span>
      </Field>
    </div>
  );
}

/** The complete publishing package in one place (used on the #1 card). */
export function PackageSummary({ clip, pkg }: { clip: ClipDto; pkg: PublishingPackage }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <Field label="Recommended title" copy={pkg.titles.recommended}>
          <span className="text-base font-semibold">{pkg.titles.recommended}</span>
          {pkg.titles.alternatives.length > 0 && (
            <ul className="mt-2 space-y-1 text-muted">
              {pkg.titles.alternatives.map((t) => (
                <li key={t}>· {t}</li>
              ))}
            </ul>
          )}
        </Field>
        <Field label="YouTube / Facebook description" copy={pkg.description.long}>
          {pkg.description.long}
        </Field>
        <Field label="Short description" copy={pkg.description.short}>
          {pkg.description.short}
        </Field>
        <Field label="Hashtags" copy={pkg.hashtags.join(" ")}>
          <Hashtags tags={pkg.hashtags} />
        </Field>
        <Field label="Hook" copy={pkg.hook.original}>
          <blockquote className="border-l-2 border-primary pl-3 italic">“{pkg.hook.original}”</blockquote>
        </Field>
        <Field label="CTA" copy={pkg.cta}>
          {pkg.cta}
        </Field>
      </div>
      <div className="flex flex-col gap-5">
        <Field label="Thumbnail text">
          <span className="inline-block rounded-md bg-gold-soft px-2.5 py-1 text-sm font-extrabold uppercase tracking-wide text-gold">{pkg.thumbnail.recommendedText}</span>
        </Field>
        <Field label="Thumbnail idea">
          {pkg.thumbnail.subject} · {pkg.thumbnail.emotion} · {pkg.thumbnail.composition}
        </Field>
        <Field label="Thumbnail prompt" copy={pkg.thumbnail.prompt}>
          <p className="line-clamp-6 rounded-md bg-surface-2 p-3 font-mono text-xs leading-relaxed text-muted">{pkg.thumbnail.prompt}</p>
        </Field>
        <div>
          <CopyButton text={packageText(clip, pkg)} label="Copy All" variant="secondary" size="md" />
        </div>
      </div>
    </div>
  );
}

export function SignalBars({ signals, limit }: { signals: Record<string, number> | null; limit?: number }) {
  if (!signals) return null;
  const entries = (Object.entries(signals) as Array<[SignalKey, number]>).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return (
    <div className="grid gap-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 text-xs">
          <span className="w-36 shrink-0 text-muted">{SIGNAL_LABELS[k] ?? k}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${v}%` }} />
          </div>
          <span className="w-7 text-right tabular text-muted">{Math.round(v)}</span>
        </div>
      ))}
    </div>
  );
}

export function PackageStatus({ status, onGenerate, busy }: { status: string; onGenerate: () => void; busy?: boolean }) {
  if (status === "queued" || status === "generating")
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> Writing titles, description, hashtags and thumbnail ideas…
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-2">
      {status === "failed" && <Badge variant="danger">Publishing package generation failed. Please retry.</Badge>}
      <Button onClick={onGenerate} loading={busy} variant={status === "failed" ? "outline" : "default"}>
        <Sparkles /> Generate Publishing Package
      </Button>
    </div>
  );
}
