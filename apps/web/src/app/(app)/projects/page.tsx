"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { isProjectActive } from "@longcut/shared";
import { PageContainer, PageHeader } from "@/components/app-shell";
import { ProjectTable } from "@/components/project-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/controls";
import { useApi } from "@/lib/client";
import type { ProjectSummaryDto } from "@/lib/types";

export default function ProjectsPage() {
  const { data } = useApi<{ projects: ProjectSummaryDto[] }>("/api/projects", {
    interval: (d) => (d?.projects.some((p) => isProjectActive(p.status)) ? 5000 : 30000),
  });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed" | "failed">("all");
  const list = useMemo(
    () =>
      (data?.projects ?? []).filter((p) => {
        if (q && !p.title.toLowerCase().includes(q.toLowerCase())) return false;
        if (filter === "active") return isProjectActive(p.status) || p.status === "uploading";
        if (filter === "completed") return p.status === "completed";
        if (filter === "failed") return p.status === "failed";
        return true;
      }),
    [data, q, filter],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        description="Every source video, its transcript, clips and export history."
        actions={
          <Button asChild>
            <Link href="/new">
              <Plus /> New project
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "In progress" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
          ]}
        />
      </div>
      {data ? <ProjectTable projects={list} /> : <div className="h-60 animate-pulse rounded-lg bg-surface" />}
    </PageContainer>
  );
}
