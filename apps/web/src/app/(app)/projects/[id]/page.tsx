"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, Trash2, MonitorPlay } from "lucide-react";
import { humanDuration, isProjectActive } from "@longcut/shared";
import { PageContainer, PageHeader } from "@/components/app-shell";
import { ProcessingView } from "@/components/project/processing-view";
import { ResultsView } from "@/components/project/results-view";
import { UploadResume } from "@/components/project/upload-resume";
import { defaultDraft, draftToSettings, SettingsPanel, type SettingsDraft } from "@/components/settings-panel";
import { ProjectStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, useApi } from "@/lib/client";
import type { ProjectDetailDto } from "@/lib/types";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data, error, reload } = useApi<{ project: ProjectDetailDto }>(`/api/projects/${id}`, {
    interval: (d) => (!d ? 4000 : isProjectActive(d.project.status) || d.project.status === "uploaded" ? 2500 : d.project.previewPending ? 15000 : null),
  });
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft>(defaultDraft);
  const [busy, setBusy] = useState(false);

  if (error?.status === 404) {
    return (
      <PageContainer>
        <Card className="p-8 text-center text-muted">This project doesn't exist or you don't have access to it.</Card>
      </PageContainer>
    );
  }
  if (!data) {
    return (
      <PageContainer>
        <div className="h-8 w-64 animate-pulse rounded bg-surface" />
        <div className="mt-6 h-96 animate-pulse rounded-xl bg-surface" />
      </PageContainer>
    );
  }
  const project = data.project;

  const openReanalyze = () => {
    const s = project.settings;
    setDraft({ ...defaultDraft(), ...s, customLength: Boolean(s.minMinutes || s.maxMinutes) });
    setReanalyzeOpen(true);
  };

  const retry = async () => {
    setBusy(true);
    try {
      if (project.hasTranscript) await api(`/api/projects/${id}/analyze`, { method: "POST", json: {} });
      else await api(`/api/projects/${id}/process`, { method: "POST", json: {} });
      await reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const reanalyze = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${id}/analyze`, { method: "POST", json: { settings: draftToSettings(draft) } });
      setReanalyzeOpen(false);
      await reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this project, its clips, exports and stored video? This can't be undone.")) return;
    try {
      await api(`/api/projects/${id}`, { method: "DELETE" });
      router.push("/projects");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={project.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ProjectStatusBadge status={project.status} />
            {project.sourceType === "youtube" && project.sourceUrl && (
              <a href={project.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
                <MonitorPlay className="size-3.5 text-danger" /> YouTube
              </a>
            )}
            {project.duration && <span className="tabular">{humanDuration(project.duration)}</span>}
            <span>Uploaded {new Date(project.createdAt).toLocaleDateString()}</span>
          </span>
        }
        actions={
          <>
            {project.status === "completed" && (
              <Button variant="outline" onClick={openReanalyze}>
                <RefreshCw /> Re-analyze
              </Button>
            )}
            <Button variant="ghost" onClick={remove} title="Delete project">
              <Trash2 />
            </Button>
          </>
        }
      />

      {project.status === "uploading" && <UploadResume project={project} onDone={() => void reload()} />}

      {project.status === "uploaded" && (
        <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Your video is uploaded.</p>
            <p className="text-sm text-muted">{project.duration ? `Duration ${humanDuration(project.duration)}.` : "Reading video metadata…"} Start the analysis whenever you're ready.</p>
          </div>
          <Button onClick={retry} loading={busy}>
            Start Analysis
          </Button>
        </Card>
      )}

      {isProjectActive(project.status) && <ProcessingView project={project} />}

      {project.status === "failed" && (
        <Card className="mb-8 flex flex-col gap-4 border-danger/30 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div>
              <p className="font-medium">{project.error}</p>
              <p className="mt-1 text-sm text-muted">
                {project.hasTranscript ? "Your transcript is saved, so retrying only repeats the analysis." : "Retrying resumes from the last completed step."}
              </p>
            </div>
          </div>
          {project.errorCode !== "UPLOAD_INCOMPLETE" && (
            <Button onClick={retry} loading={busy}>
              <RefreshCw /> {project.hasTranscript ? "Retry analysis" : "Retry processing"}
            </Button>
          )}
        </Card>
      )}

      {(project.status === "completed" || (project.status === "failed" && project.clipCount > 0)) && (
        <ResultsView project={project} onReanalyze={openReanalyze} />
      )}

      <Dialog open={reanalyzeOpen} onOpenChange={setReanalyzeOpen}>
        <DialogContent
          title="Re-analyze with new settings"
          description="Uses the saved transcript — no re-upload or re-transcription. Exported clips are kept."
          className="max-w-2xl"
        >
          <SettingsPanel value={draft} onChange={setDraft} />
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReanalyzeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={reanalyze} loading={busy}>
              Start analysis
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
