"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatTimestamp, type TimeRange } from "@longcut/shared";
import { cn } from "@/lib/utils";

interface Props {
  viewStart: number;
  viewEnd: number;
  start: number;
  end: number;
  cuts: TimeRange[];
  currentTime: number;
  waveform: Uint8Array | null;
  waveformRate: number;
  onSeek: (t: number) => void;
  onChange: (range: { start?: number; end?: number }) => void;
  onScrub?: (t: number) => void;
}

function tickStep(span: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => span / s <= 10) ?? 3600;
}

/**
 * Clip timeline: waveform, in/out handles (drag), cut regions and playhead. Only the visible
 * window's slice of the waveform is drawn, so multi-hour sources stay smooth.
 */
export function Timeline({ viewStart, viewEnd, start, end, cuts, currentTime, waveform, waveformRate, onSeek, onChange, onScrub }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const span = Math.max(1, viewEnd - viewStart);
  const pct = (t: number) => `${((t - viewStart) / span) * 100}%`;

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = wrapRef.current!.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return viewStart + f * span;
    },
    [viewStart, span],
  );

  // Waveform drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      if (!waveform || !waveform.length) return;
      const mid = h / 2;
      for (let x = 0; x < w; x++) {
        const t0 = viewStart + (x / w) * span;
        const t1 = viewStart + ((x + 1) / w) * span;
        const i0 = Math.floor(t0 * waveformRate);
        const i1 = Math.max(i0 + 1, Math.floor(t1 * waveformRate));
        let peak = 0;
        for (let i = i0; i < i1 && i < waveform.length; i++) if (i >= 0 && waveform[i] > peak) peak = waveform[i];
        const amp = (peak / 255) * (h * 0.45);
        const inClip = t0 >= start && t0 <= end && !cuts.some((c) => t0 >= c.start && t0 <= c.end);
        ctx.fillStyle = inClip ? "rgba(160,150,255,0.85)" : "rgba(139,145,156,0.35)";
        ctx.fillRect(x, mid - amp, 1, Math.max(1, amp * 2));
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [waveform, waveformRate, viewStart, span, start, end, cuts]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const t = timeAt(e.clientX);
      if (dragging === "start") onChange({ start: Math.min(t, end - 5) });
      else onChange({ end: Math.max(t, start + 5) });
      onScrub?.(t);
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, timeAt, onChange, onScrub, start, end]);

  const step = tickStep(span);
  const ticks: number[] = [];
  for (let t = Math.ceil(viewStart / step) * step; t <= viewEnd; t += step) ticks.push(t);

  return (
    <div className="select-none">
      <div className="relative h-5 text-[10px] text-subtle">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 font-mono tabular" style={{ left: pct(t) }}>
            {formatTimestamp(t)}
          </span>
        ))}
      </div>
      <div
        ref={wrapRef}
        className="relative h-24 cursor-pointer overflow-hidden rounded-md border border-line bg-surface-2"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.handle) return;
          onSeek(timeAt(e.clientX));
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {/* dim outside the clip */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/45" style={{ width: pct(Math.max(viewStart, start)) }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/45" style={{ left: pct(Math.min(viewEnd, end)) }} />
        {/* clip band */}
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-primary/70 bg-primary/5"
          style={{ left: pct(Math.max(viewStart, start)), width: `${((Math.min(viewEnd, end) - Math.max(viewStart, start)) / span) * 100}%` }}
        />
        {cuts.map((c, i) => (
          <div
            key={i}
            className="pointer-events-none absolute inset-y-0 bg-[repeating-linear-gradient(135deg,rgba(248,113,113,0.35)_0,rgba(248,113,113,0.35)_4px,transparent_4px,transparent_8px)]"
            style={{ left: pct(c.start), width: `${((c.end - c.start) / span) * 100}%` }}
            title={`Removed ${formatTimestamp(c.start)}–${formatTimestamp(c.end)}`}
          />
        ))}
        {(["start", "end"] as const).map((edge) => {
          const t = edge === "start" ? start : end;
          if (t < viewStart || t > viewEnd) return null;
          return (
            <div
              key={edge}
              data-handle={edge}
              onPointerDown={(e) => {
                e.stopPropagation();
                setDragging(edge);
              }}
              className={cn(
                "absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize",
                "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
                dragging === edge && "after:bg-white",
              )}
              style={{ left: pct(t) }}
              title={edge === "start" ? "Drag to set start" : "Drag to set end"}
            >
              <span data-handle={edge} className="absolute top-1 left-1/2 -translate-x-1/2 rounded bg-primary px-1 text-[9px] font-bold text-white">
                {edge === "start" ? "IN" : "OUT"}
              </span>
            </div>
          );
        })}
        {currentTime >= viewStart && currentTime <= viewEnd && (
          <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white" style={{ left: pct(currentTime) }}>
            <div className="absolute -left-1 -top-0.5 size-2 rotate-45 bg-white" />
          </div>
        )}
      </div>
    </div>
  );
}
