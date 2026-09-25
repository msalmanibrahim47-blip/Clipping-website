"use client";
import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { formatBytes } from "@longcut/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client";
import type { ProjectDetailDto } from "@/lib/types";
import { uploadFile, type UploadProgress } from "@/lib/uploader";

/** Resume an interrupted upload by re-selecting the same file; finished parts are skipped. */
export function UploadResume({ project, onDone }: { project: ProjectDetailDto; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const resume = async (file: File | undefined) => {
    if (!file) return;
    if (file.name !== project.originalFilename || file.size !== project.fileSize) {
      toast(`Please select the original file: ${project.originalFilename} (${formatBytes(project.fileSize)}).`, "error");
      return;
    }
    setBusy(true);
    try {
      await uploadFile({ projectId: project.id, file, autoStart: true, signal: new AbortController().signal, onProgress: setProgress });
      toast("Upload complete — analysis has started.", "success");
      onDone();
    } catch (err) {
      toast((err as Error).message || "Video upload failed. Please retry.", "error");
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto max-w-xl p-6 text-center">
      <UploadCloud className="mx-auto size-8 text-primary" />
      <h2 className="mt-3 text-lg font-semibold">Upload not finished</h2>
      <p className="mt-1 text-sm text-muted">
        Re-select <span className="font-medium text-fg">{project.originalFilename}</span> ({formatBytes(project.fileSize)}) to resume. Parts that already
        reached storage won't be uploaded again.
      </p>
      {progress && (
        <div className="mt-5">
          <Progress value={progress.loaded / progress.total} active={busy} />
          <p className="mt-2 text-xs text-muted tabular">
            {((progress.loaded / progress.total) * 100).toFixed(1)}% · {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
          </p>
        </div>
      )}
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={() => input.current?.click()} loading={busy}>
          Select file to resume
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            await api("/api/uploads/abort", { method: "POST", json: { projectId: project.id } }).catch(() => undefined);
            onDone();
          }}
        >
          Cancel upload
        </Button>
      </div>
      <input ref={input} type="file" className="hidden" onChange={(e) => void resume(e.target.files?.[0])} />
    </Card>
  );
}
