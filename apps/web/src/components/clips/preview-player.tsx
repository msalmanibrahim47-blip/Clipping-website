"use client";
import { useEffect, useRef, useState } from "react";
import { formatTimestamp, keepRanges, type TimeRange } from "@longcut/shared";
import type { CaptionCueDto } from "@/lib/types";
import { CaptionOverlay } from "./caption-overlay";
import type { CaptionStyle } from "@longcut/shared";

/**
 * Plays [start, end] of the source, jumping over cut ranges, without loading the whole
 * file (the browser streams via HTTP range requests).
 */
export function ClipPreviewPlayer({
  src,
  start,
  end,
  cuts = [],
  cues,
  style,
  autoPlay = true,
}: {
  src: string;
  start: number;
  end: number;
  cuts?: TimeRange[];
  cues?: CaptionCueDto[] | null;
  style?: CaptionStyle | null;
  autoPlay?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [outTime, setOutTime] = useState(0);
  const [now, setNow] = useState(start);
  const keeps = keepRanges(start, end, cuts);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onMeta = () => {
      v.currentTime = start;
      if (autoPlay) void v.play().catch(() => undefined);
    };
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1) onMeta();
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [src, start, autoPlay]);

  const onTime = () => {
    const v = ref.current;
    if (!v) return;
    const t = v.currentTime;
    if (t >= end - 0.05) {
      v.pause();
      v.currentTime = end;
    }
    const cut = cuts.find((c) => t >= c.start && t < c.end - 0.05);
    if (cut) v.currentTime = cut.end;
    let offset = 0;
    for (const k of keeps) {
      if (t >= k.start && t <= k.end) {
        setOutTime(offset + (t - k.start));
        break;
      }
      offset += k.end - k.start;
    }
    setNow(t);
  };

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-black" style={{ containerType: "size" }}>
      <video ref={ref} src={src} controls playsInline preload="metadata" onTimeUpdate={onTime} className="absolute inset-0 h-full w-full object-contain" />
      {cues && style?.enabled !== false && <CaptionOverlay cues={cues} time={outTime} style={style ?? null} />}
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white/80">
        {formatTimestamp(now)}
      </div>
    </div>
  );
}
