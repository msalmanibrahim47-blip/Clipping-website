"use client";
import Link from "next/link";
import { ArrowRight, Link2, UploadCloud } from "lucide-react";
import { isProjectActive } from "@longcut/shared";
import { PageContainer } from "@/components/app-shell";
import { ProjectTable } from "@/components/project-table";
import { useApi } from "@/lib/client";
import type { ProjectSummaryDto } from "@/lib/types";

export default function DashboardPage() {
  const { data } = useApi<{ projects: ProjectSummaryDto[] }>("/api/projects", {
    interval: (d) => (d?.projects.some((p) => isProjectActive(p.status)) ? 5000 : 30000),
  });
  const projects = data?.projects ?? [];

  return (
    <PageContainer>
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface px-5 py-8 sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/15 blur-3xl" />
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Long-form clipping studio</p>
        <h1 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">Create New Clip Project</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted sm:text-[15px]">
          Drop in a livestream, podcast or interview up to ~10 hours. We transcribe everything, map every topic, and hand you the strongest
          complete 5–20 minute segments — ranked, captioned and ready to publish.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Link
            href="/new?source=upload"
            className="group flex items-start gap-4 rounded-xl border border-line-strong bg-surface-2 p-5 transition-colors hover:border-primary/60 hover:bg-surface-3"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <UploadCloud className="size-5" />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-2 font-semibold">
                Upload Video <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-1 block text-sm text-muted">MP4, MOV, MKV, WebM or AVI. Resumable uploads for very large files.</span>
            </span>
          </Link>
          <Link
            href="/new?source=youtube"
            className="group flex items-start gap-4 rounded-xl border border-line-strong bg-surface-2 p-5 transition-colors hover:border-primary/60 hover:bg-surface-3"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-danger/12 text-danger">
              <Link2 className="size-5" />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-2 font-semibold">
                Paste YouTube URL <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-1 block text-sm text-muted">For videos you own or have permission to process.</span>
            </span>
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">My Projects</h2>
          {projects.length > 6 && (
            <Link href="/projects" className="text-sm text-primary hover:underline">
              View all
            </Link>
          )}
        </div>
        {data ? <ProjectTable projects={projects.slice(0, 8)} /> : <div className="h-40 animate-pulse rounded-lg bg-surface" />}
      </section>
    </PageContainer>
  );
}
