"use client";
import { Download, Loader2, Sparkles } from "lucide-react";
import {
  CAPTION_FONTS,
  CAPTION_LANGUAGE_LABELS,
  CAPTION_LANGUAGES,
  CAPTION_PRESETS,
  captionStyleFor,
  type CaptionLanguage,
  type CaptionStyle,
} from "@longcut/shared";
import { Button } from "@/components/ui/button";
import { Segmented, Slider, Switch } from "@/components/ui/controls";
import { Label, NativeSelect } from "@/components/ui/input";

const PRESET_LABELS: Record<(typeof CAPTION_PRESETS)[number], string> = {
  clean: "Clean",
  bold: "Bold",
  podcast: "Podcast",
  minimal: "Minimal",
  highlight: "Highlight",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <span className="text-xs text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-7 cursor-pointer rounded border border-line-strong bg-transparent" />
      <span className="font-mono text-xs text-muted">{value}</span>
    </label>
  );
}

export function CaptionPanel({
  style,
  onStyle,
  language,
  onLanguage,
  status,
  onGenerate,
  generating,
  dirty,
  onSave,
  saving,
  clipId,
}: {
  style: CaptionStyle;
  onStyle: (s: CaptionStyle) => void;
  language: CaptionLanguage;
  onLanguage: (l: CaptionLanguage) => void;
  status: "ready" | "pending" | "needs_generation" | "loading";
  onGenerate: () => void;
  generating: boolean;
  dirty: boolean;
  onSave: () => void;
  saving: boolean;
  clipId: string;
}) {
  const set = <K extends keyof CaptionStyle>(k: K, v: CaptionStyle[K]) => onStyle({ ...style, [k]: v });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3">
        <div>
          <div className="text-sm font-medium">Captions</div>
          <div className="text-xs text-muted">Generated from real word timestamps.</div>
        </div>
        <Switch checked={style.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Captions on/off" />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Caption language</Label>
        <Segmented size="sm" value={language} onChange={onLanguage} options={CAPTION_LANGUAGES.map((l) => ({ value: l, label: CAPTION_LANGUAGE_LABELS[l] }))} />
        {status === "needs_generation" && (
          <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
            <span>This language needs a translation/romanization pass for this clip.</span>
            <Button size="sm" onClick={onGenerate} loading={generating}>
              <Sparkles /> Generate Captions
            </Button>
          </div>
        )}
        {status === "pending" && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Generating captions…
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Style</Label>
        <Segmented
          size="sm"
          value={style.preset}
          onChange={(p) => onStyle(captionStyleFor(p, { enabled: style.enabled }))}
          options={CAPTION_PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
        />
      </div>

      <div className="flex flex-col gap-3">
        <Row label="Font">
          <NativeSelect value={style.font} onChange={(e) => set("font", e.target.value as CaptionStyle["font"])} className="h-8">
            {CAPTION_FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </NativeSelect>
        </Row>
        <Row label={`Font size · ${style.fontSize}`}>
          <Slider min={20} max={110} step={1} value={[style.fontSize]} onValueChange={([v]) => set("fontSize", v)} />
        </Row>
        <Row label="Position">
          <Segmented size="sm" value={style.position} onChange={(v) => set("position", v)} options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }]} />
        </Row>
        <Row label={`Margin · ${style.marginPercent}%`}>
          <Slider min={0} max={30} step={1} value={[style.marginPercent]} onValueChange={([v]) => set("marginPercent", v)} />
        </Row>
        <Row label={`Max chars/line · ${style.maxCharsPerLine}`}>
          <Slider min={16} max={70} step={1} value={[style.maxCharsPerLine]} onValueChange={([v]) => set("maxCharsPerLine", v)} />
        </Row>
        <Row label="Lines">
          <Segmented size="sm" value={style.maxLines} onChange={(v) => set("maxLines", v)} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
        </Row>
        <Row label="Text color">
          <ColorInput value={style.textColor} onChange={(v) => set("textColor", v)} />
        </Row>
        <Row label="Bold / Uppercase">
          <div className="flex items-center gap-4">
            <Switch checked={style.bold} onCheckedChange={(v) => set("bold", v)} />
            <Switch checked={style.uppercase} onCheckedChange={(v) => set("uppercase", v)} />
          </div>
        </Row>
        <Row label="Background box">
          <div className="flex flex-wrap items-center gap-4">
            <Switch checked={style.background} onCheckedChange={(v) => set("background", v)} />
            {style.background && <ColorInput value={style.backgroundColor} onChange={(v) => set("backgroundColor", v)} />}
          </div>
        </Row>
        {style.background && (
          <Row label={`Box opacity · ${Math.round(style.backgroundOpacity * 100)}%`}>
            <Slider min={0} max={1} step={0.05} value={[style.backgroundOpacity]} onValueChange={([v]) => set("backgroundOpacity", v)} />
          </Row>
        )}
        {!style.background && (
          <>
            <Row label={`Outline · ${style.outline}`}>
              <Slider min={0} max={8} step={0.5} value={[style.outline]} onValueChange={([v]) => set("outline", v)} />
            </Row>
            <Row label="Outline color">
              <ColorInput value={style.outlineColor} onChange={(v) => set("outlineColor", v)} />
            </Row>
            <Row label={`Shadow · ${style.shadow}`}>
              <Slider min={0} max={8} step={0.5} value={[style.shadow]} onValueChange={([v]) => set("shadow", v)} />
            </Row>
          </>
        )}
        <Row label="Word highlighting">
          <Switch checked={style.wordHighlight} onCheckedChange={(v) => set("wordHighlight", v)} />
        </Row>
        <Row label="Highlight color">
          <ColorInput value={style.highlightColor} onChange={(v) => set("highlightColor", v)} />
        </Row>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button onClick={onSave} disabled={!dirty} loading={saving}>
          Save caption style
        </Button>
        <Button variant="outline" asChild>
          <a href={`/api/clips/${clipId}/captions?format=srt&language=${language}&maxChars=${style.maxCharsPerLine}&maxLines=${style.maxLines}`}>
            <Download /> SRT
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`/api/clips/${clipId}/captions?format=vtt&language=${language}&maxChars=${style.maxCharsPerLine}&maxLines=${style.maxLines}`}>
            <Download /> VTT
          </a>
        </Button>
      </div>
    </div>
  );
}
