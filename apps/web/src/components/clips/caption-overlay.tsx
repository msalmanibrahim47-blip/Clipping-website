"use client";
import { captionStyleFor, type CaptionStyle } from "@longcut/shared";
import type { CaptionCueDto } from "@/lib/types";

const FONT_STACK: Record<string, string> = {
  Inter: "Inter, sans-serif",
  Montserrat: "Montserrat, sans-serif",
  Roboto: "Roboto, sans-serif",
  "Noto Sans": "'Noto Sans', sans-serif",
  "Liberation Sans": "Arial, 'Liberation Sans', sans-serif",
};

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Browser preview of burned-in captions. Sizes are expressed relative to the player height
 * (container query units) so the preview matches the libass render at any resolution.
 */
export function CaptionOverlay({ cues, time, style: raw }: { cues: CaptionCueDto[]; time: number; style: CaptionStyle | null }) {
  const style = raw ?? captionStyleFor("clean");
  const cue = cues.find((c) => time >= c.start && time < c.end);
  if (!cue) return null;
  const scale = (px: number) => `${(px / 1080) * 100}cqh`;
  const outline = style.background ? "none" : Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    const d = scale(style.outline * 1.2);
    return `calc(${Math.cos(a).toFixed(2)} * ${d}) calc(${Math.sin(a).toFixed(2)} * ${d}) 0 ${style.outlineColor}`;
  }).join(", ");
  const shadow = style.shadow > 0 && !style.background ? `, ${scale(style.shadow * 2)} ${scale(style.shadow * 2)} ${scale(4)} rgba(0,0,0,0.7)` : "";
  const posClass = style.position === "top" ? "top-0" : style.position === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-0";
  const margin = `${style.marginPercent}cqh`;

  // Map active word index across lines.
  let wordIndex = 0;
  const activeIdx = style.wordHighlight ? cue.words.findIndex((w, i) => time >= w.s && (i === cue.words.length - 1 || time < cue.words[i + 1].s)) : -1;

  return (
    <div className={`pointer-events-none absolute inset-x-0 ${posClass} flex justify-center px-[6%]`} style={{ [style.position === "top" ? "paddingTop" : "paddingBottom"]: style.position === "middle" ? 0 : margin }}>
      <div
        className="text-center leading-[1.2]"
        style={{
          fontFamily: FONT_STACK[style.font] ?? "sans-serif",
          fontSize: scale(style.fontSize),
          fontWeight: style.bold ? 700 : 400,
          color: style.textColor,
          textShadow: `${outline}${shadow}`.replace(/^none, /, ""),
          textTransform: style.uppercase ? "uppercase" : "none",
        }}
      >
        {cue.lines.map((line, li) => (
          <div key={li}>
            <span
              style={
                style.background
                  ? { background: hexToRgba(style.backgroundColor, style.backgroundOpacity), padding: `0 ${scale(12)}`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
                  : undefined
              }
            >
              {line.split(/\s+/).map((word, wi) => {
                const idx = wordIndex++;
                return (
                  <span key={wi} style={idx === activeIdx ? { color: style.highlightColor } : undefined}>
                    {word}
                    {" "}
                  </span>
                );
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
