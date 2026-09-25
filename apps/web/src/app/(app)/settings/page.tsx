"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, XCircle } from "lucide-react";
import {
  CAPTION_LANGUAGE_LABELS,
  CAPTION_LANGUAGES,
  CAPTION_PRESETS,
  CLIP_LENGTH_PRESETS,
  RESOLUTION_LABELS,
  RESOLUTIONS,
  STT_PROVIDER_LABELS,
  STT_PROVIDERS,
  type UserDefaults,
} from "@longcut/shared";
import { PageContainer, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented, Switch } from "@/components/ui/controls";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api, useApi } from "@/lib/client";

interface SettingsResponse {
  defaults: UserDefaults;
  llmProvider: string | null;
  sttProvider: string | null;
  keys: Record<"anthropic" | "openai" | "deepgram" | "groq", string | null>;
  server: {
    anthropic: boolean;
    openai: boolean;
    deepgram: boolean;
    groq: boolean;
    youtubeApi: boolean;
    defaultLlm: string;
    defaultStt: string | null;
    storage: { provider: string; bucket: string } | null;
  };
  encryptionAvailable: boolean;
}

const KEY_LABELS = { anthropic: "Anthropic (Claude)", openai: "OpenAI", deepgram: "Deepgram", groq: "Groq" } as const;

export default function SettingsPage() {
  const toast = useToast();
  const { data, reload } = useApi<SettingsResponse>("/api/settings");
  const [defaults, setDefaults] = useState<UserDefaults | null>(null);
  const [llm, setLlm] = useState<string>("");
  const [stt, setStt] = useState<string>("");
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !defaults) {
      setDefaults(data.defaults);
      setLlm(data.llmProvider ?? "");
      setStt(data.sttProvider ?? "");
    }
  }, [data, defaults]);

  if (!data || !defaults) return <PageContainer><div className="h-96 animate-pulse rounded-xl bg-surface" /></PageContainer>;
  const set = <K extends keyof UserDefaults>(k: K, v: UserDefaults[K]) => setDefaults({ ...defaults, [k]: v });

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        json: { defaults, llmProvider: llm || null, sttProvider: stt || null, ...extra },
      });
      toast("Settings saved.", "success");
      setKeyDrafts({});
      await reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const Status = ({ ok }: { ok: boolean }) => (ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-subtle" />);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Settings" description="Defaults for new projects and exports, AI providers and storage." actions={<Button onClick={() => void save()} loading={saving}>Save settings</Button>} />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Defaults</CardTitle>
            <CardDescription>Applied to new projects and exports; you can override them per project.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>Default clip duration</Label>
              <Segmented
                size="sm"
                value={String(defaults.clipLength)}
                onChange={(v) => set("clipLength", v === "auto" ? "auto" : Number(v))}
                options={[...CLIP_LENGTH_PRESETS.map((m) => ({ value: String(m), label: `${m}m` })), { value: "auto", label: "Auto" }]}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Default number of clips</Label>
                <Input type="number" min={1} max={30} value={defaults.clipCount} onChange={(e) => set("clipCount", Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Export quality</Label>
                <NativeSelect value={defaults.exportResolution} onChange={(e) => set("exportResolution", e.target.value as UserDefaults["exportResolution"])}>
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {RESOLUTION_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Default caption language</Label>
              <Segmented size="sm" value={defaults.captionLanguage} onChange={(v) => set("captionLanguage", v)} options={CAPTION_LANGUAGES.map((c) => ({ value: c, label: CAPTION_LANGUAGE_LABELS[c] }))} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Default caption style</Label>
              <Segmented size="sm" value={defaults.captionPreset} onChange={(v) => set("captionPreset", v)} options={CAPTION_PRESETS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cleanup policy</CardTitle>
            <CardDescription>Source videos are kept until you delete the project. Rendered exports expire to control storage costs.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Segmented
              size="sm"
              value={defaults.exportCleanup}
              onChange={(v) => set("exportCleanup", v)}
              options={[
                { value: "7d", label: "Delete exports after 7 days" },
                { value: "30d", label: "After 30 days" },
                { value: "keep", label: "Keep forever" },
              ]}
            />
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                Delete intermediate files (extracted audio, preview proxy) 3 days after processing
                <span className="block text-xs text-muted">Transcripts and clips are kept; the waveform is kept for the editor.</span>
              </span>
              <Switch checked={defaults.purgeIntermediates} onCheckedChange={(v) => set("purgeIntermediates", v)} />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI &amp; speech providers</CardTitle>
            <CardDescription>
              Keys are stored encrypted on the server and never sent back to the browser. Leave blank to use the server’s configured keys.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>AI analysis provider</Label>
                <NativeSelect value={llm} onChange={(e) => setLlm(e.target.value)}>
                  <option value="">Server default ({data.server.defaultLlm})</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="openai">OpenAI</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Speech-to-text provider</Label>
                <NativeSelect value={stt} onChange={(e) => setStt(e.target.value)}>
                  <option value="">Server default{data.server.defaultStt ? ` (${data.server.defaultStt})` : ""}</option>
                  {STT_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {STT_PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {(Object.keys(KEY_LABELS) as Array<keyof typeof KEY_LABELS>).map((k) => (
                <div key={k} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex w-48 items-center gap-2 text-sm font-medium">
                    <KeyRound className="size-4 text-muted" /> {KEY_LABELS[k]}
                  </div>
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={data.keys[k] ? `Saved ${data.keys[k]}` : data.server[k] ? "Using server key" : "Not configured"}
                      value={keyDrafts[k] ?? ""}
                      onChange={(e) => setKeyDrafts({ ...keyDrafts, [k]: e.target.value })}
                      disabled={!data.encryptionAvailable}
                      className="h-8"
                    />
                    {data.keys[k] && (
                      <Button size="sm" variant="ghost" onClick={() => void save({ keys: { [k]: null } })}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <Status ok={Boolean(data.keys[k] || data.server[k])} /> {data.keys[k] ? "Your key" : data.server[k] ? "Server key" : "Missing"}
                  </div>
                </div>
              ))}
            </div>
            {!data.encryptionAvailable && <p className="text-xs text-warning">Per-user keys are disabled because APP_ENCRYPTION_KEY isn't set on the server.</p>}
            {Object.values(keyDrafts).some(Boolean) && (
              <div>
                <Button onClick={() => void save({ keys: Object.fromEntries(Object.entries(keyDrafts).filter(([, v]) => v)) })} loading={saving}>
                  Save keys
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>Configured on the server via environment variables.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted">Provider</div>
              <div className="font-medium">{data.server.storage?.provider ?? "Not configured"}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Bucket</div>
              <div className="font-medium">{data.server.storage?.bucket ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted">YouTube Data API</div>
              <div className="flex items-center gap-1.5 font-medium">
                <Status ok={data.server.youtubeApi} /> {data.server.youtubeApi ? "Enabled" : "oEmbed fallback"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
