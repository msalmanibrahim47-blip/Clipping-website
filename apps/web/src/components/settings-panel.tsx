"use client";
import {
  CAPTION_LANGUAGE_LABELS,
  CAPTION_LANGUAGES,
  CLIP_LENGTH_PRESETS,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  STRATEGY_LABELS,
  type ProjectSettings,
  type Strategy,
} from "@longcut/shared";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/controls";

const CLIP_STRATEGIES: Array<{ value: Strategy; label: string }> = [
  { value: "balanced", label: "Best Overall" },
  { value: "educational", label: STRATEGY_LABELS.educational },
  { value: "storytelling", label: STRATEGY_LABELS.storytelling },
  { value: "controversial", label: STRATEGY_LABELS.controversial },
  { value: "comedy", label: "Funny" },
  { value: "energy", label: "High Energy" },
  { value: "business", label: STRATEGY_LABELS.business },
  { value: "gaming", label: STRATEGY_LABELS.gaming },
  { value: "custom", label: "Custom" },
];

export type SettingsDraft = ProjectSettings & { customLength: boolean };

export function defaultDraft(): SettingsDraft {
  return {
    contentType: "general",
    strategy: "balanced",
    clipLength: 10,
    clipCount: 5,
    captionLanguage: "auto",
    spokenLanguage: "auto",
    customLength: false,
  };
}

export function draftToSettings(d: SettingsDraft): Partial<ProjectSettings> {
  const { customLength, ...rest } = d;
  if (!customLength) {
    delete rest.minMinutes;
    delete rest.maxMinutes;
  }
  if (rest.strategy !== "custom") delete rest.customInstructions;
  return rest;
}

export function SettingsPanel({ value, onChange }: { value: SettingsDraft; onChange: (v: SettingsDraft) => void }) {
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => onChange({ ...value, [k]: v });
  const countPresets = [3, 5, 10, 15];
  const customCount = !countPresets.includes(value.clipCount);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Content type</Label>
          <NativeSelect value={value.contentType} onChange={(e) => set("contentType", e.target.value as SettingsDraft["contentType"])}>
            {CONTENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {CONTENT_TYPE_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Clip strategy</Label>
          <NativeSelect value={value.strategy} onChange={(e) => set("strategy", e.target.value as Strategy)}>
            {CLIP_STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {value.strategy === "custom" && (
        <div className="flex flex-col gap-2">
          <Label>Custom instructions</Label>
          <Textarea
            placeholder="e.g. Focus on the Q&A about hiring and team building. Skip sponsor segments."
            value={value.customInstructions ?? ""}
            maxLength={2000}
            onChange={(e) => set("customInstructions", e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>Clip length</Label>
        <Segmented
          value={value.customLength ? "custom" : String(value.clipLength)}
          onChange={(v) => {
            if (v === "custom") onChange({ ...value, customLength: true, minMinutes: value.minMinutes ?? 5, maxMinutes: value.maxMinutes ?? 20, clipLength: "auto" });
            else onChange({ ...value, customLength: false, clipLength: v === "auto" ? "auto" : Number(v) });
          }}
          options={[
            ...CLIP_LENGTH_PRESETS.map((m) => ({ value: String(m), label: `${m}m` })),
            { value: "auto", label: "Auto" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {value.customLength && (
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>Between</span>
            <Input
              type="number"
              min={1}
              max={60}
              className="w-20"
              value={value.minMinutes ?? 5}
              onChange={(e) => set("minMinutes", Math.max(1, Number(e.target.value) || 1))}
            />
            <span>and</span>
            <Input
              type="number"
              min={2}
              max={90}
              className="w-20"
              value={value.maxMinutes ?? 20}
              onChange={(e) => set("maxMinutes", Math.max(2, Number(e.target.value) || 2))}
            />
            <span>minutes</span>
          </div>
        )}
        <p className="text-xs text-subtle">Boundaries flex slightly so every clip starts and ends on a complete thought.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Number of clips</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={customCount ? "custom" : String(value.clipCount)}
              onChange={(v) => set("clipCount", v === "custom" ? 7 : Number(v))}
              options={[...countPresets.map((n) => ({ value: String(n), label: String(n) })), { value: "custom", label: "Custom" }]}
            />
            {customCount && (
              <Input
                type="number"
                min={1}
                max={30}
                className="w-20"
                value={value.clipCount}
                onChange={(e) => set("clipCount", Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
              />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Caption language</Label>
          <Segmented
            value={value.captionLanguage}
            onChange={(v) => set("captionLanguage", v)}
            options={CAPTION_LANGUAGES.map((c) => ({ value: c, label: CAPTION_LANGUAGE_LABELS[c] }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 md:max-w-sm">
        <Label>Spoken language hint</Label>
        <NativeSelect value={value.spokenLanguage} onChange={(e) => set("spokenLanguage", e.target.value as SettingsDraft["spokenLanguage"])}>
          <option value="auto">Auto-detect (recommended)</option>
          <option value="en">Mostly English</option>
          <option value="hi">Hindi / Hinglish</option>
          <option value="ur">Urdu / mixed</option>
        </NativeSelect>
      </div>
    </div>
  );
}
