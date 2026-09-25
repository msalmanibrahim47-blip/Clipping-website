"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Scissors, Search, Undo2 } from "lucide-react";
import { formatTimestamp, type TimeRange } from "@longcut/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import type { SentenceDto } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  sentences: SentenceDto[];
  loading: boolean;
  start: number;
  end: number;
  cuts: TimeRange[];
  currentTime: number;
  onSeek: (t: number) => void;
  onSetStart: (t: number) => void;
  onSetEnd: (t: number) => void;
  onCut: (range: TimeRange) => void;
  onRestore: (range: TimeRange) => void;
  onFocusTime: (t: number) => void;
}

const inCut = (s: SentenceDto, cuts: TimeRange[]) => cuts.some((c) => s.s >= c.start - 0.05 && s.e <= c.end + 0.05);

/**
 * Transcript-based editing: click to seek, set in/out points from sentences, remove
 * sentences (or a shift-selected range) and search the whole transcript.
 */
export function TranscriptPanel(p: Props) {
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [globalHits, setGlobalHits] = useState<SentenceDto[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const activeIdx = useMemo(() => p.sentences.findIndex((s) => p.currentTime >= s.s && p.currentTime < s.e + 0.3), [p.sentences, p.currentTime]);

  useEffect(() => {
    if (follow && activeRef.current && listRef.current) {
      const list = listRef.current;
      const el = activeRef.current;
      const top = el.offsetTop - list.offsetTop;
      if (top < list.scrollTop + 40 || top > list.scrollTop + list.clientHeight - 80) list.scrollTo({ top: top - list.clientHeight / 3, behavior: "smooth" });
    }
  }, [activeIdx, follow]);

  // On first load, bring the clip's opening sentence into view.
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (initialScrollDone.current || !p.sentences.length || !listRef.current) return;
    const idx = p.sentences.findIndex((s) => s.e > p.start + 0.05);
    const el = listRef.current.children[idx] as HTMLElement | undefined;
    if (el) {
      listRef.current.scrollTop = el.offsetTop - listRef.current.offsetTop - 12;
      initialScrollDone.current = true;
    }
  }, [p.sentences, p.start]);

  const q = query.trim().toLowerCase();
  const selected = (i: number) => selection && i >= selection[0] && i <= selection[1];
  const selRange = selection ? { start: p.sentences[selection[0]].s, end: p.sentences[selection[1]].e } : null;

  const searchAll = async () => {
    if (!q) return;
    const res = await api<{ sentences: SentenceDto[] }>(`/api/projects/${p.projectId}/transcript?q=${encodeURIComponent(q)}`);
    setGlobalHits(res.sentences);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 pb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setGlobalHits(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void searchAll()}
            placeholder="Search transcript (Enter = whole video)"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          <Switch checked={follow} onCheckedChange={setFollow} /> Follow
        </label>
      </div>

      {selection && selRange && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary-soft px-3 py-2 text-xs">
          <span className="font-medium text-fg">
            {selection[1] - selection[0] + 1} sentences · {formatTimestamp(selRange.start)}–{formatTimestamp(selRange.end)}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="secondary" className="h-7" onClick={() => { p.onSetStart(selRange.start); p.onSetEnd(selRange.end); setSelection(null); }}>
            Set as clip
          </Button>
          <Button size="sm" variant="destructive" className="h-7" onClick={() => { p.onCut(selRange); setSelection(null); }}>
            <Scissors /> Remove
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelection(null)}>
            Clear
          </Button>
        </div>
      )}

      {globalHits && (
        <div className="mb-2 max-h-40 overflow-y-auto rounded-md border border-line bg-surface-2 scroll-thin">
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-subtle">{globalHits.length} matches in the full video</div>
          {globalHits.map((s) => (
            <button key={s.i} onClick={() => p.onFocusTime(s.s)} className="flex w-full gap-3 px-3 py-1.5 text-left text-xs hover:bg-surface-3">
              <span className="font-mono text-subtle tabular">{formatTimestamp(s.s)}</span>
              <span className="line-clamp-1 text-muted">{s.t}</span>
            </button>
          ))}
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1 scroll-thin">
        {p.loading && !p.sentences.length && <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded bg-surface-2" />)}</div>}
        {p.sentences.map((s, i) => {
          const inside = s.e > p.start + 0.05 && s.s < p.end - 0.05;
          const cut = inCut(s, p.cuts);
          const match = q && s.t.toLowerCase().includes(q);
          const newPara = i > 0 && p.sentences[i - 1].p !== s.p;
          return (
            <div
              key={s.i}
              ref={i === activeIdx ? activeRef : undefined}
              className={cn(
                "group relative flex gap-3 rounded-md px-2 py-1.5 text-[13px] leading-relaxed transition-colors",
                newPara && "mt-2",
                inside ? "text-fg" : "text-subtle",
                cut && "text-subtle line-through decoration-danger/70",
                i === activeIdx && "bg-primary-soft",
                selected(i) && "bg-primary/20",
                match && "ring-1 ring-gold/60",
                "hover:bg-surface-2",
              )}
              onClick={(e) => {
                if (e.shiftKey && anchor != null) {
                  setSelection([Math.min(anchor, i), Math.max(anchor, i)]);
                  return;
                }
                setAnchor(i);
                setSelection(null);
                p.onSeek(s.s);
              }}
            >
              {s.s <= p.start + 0.05 && s.e > p.start && <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded bg-primary" />}
              <button className="w-14 shrink-0 pt-px text-left font-mono text-[11px] text-subtle tabular hover:text-primary">{formatTimestamp(s.s)}</button>
              <span className="flex-1">
                {s.sp != null && <span className="mr-1.5 text-[11px] font-semibold text-info">S{s.sp + 1}</span>}
                {s.t}
              </span>
              <span className="absolute right-1 top-1 hidden gap-0.5 rounded-md border border-line bg-surface-3 p-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                <IconBtn title="Start clip here" onClick={() => p.onSetStart(s.s)}>
                  <ArrowUpToLine />
                </IconBtn>
                <IconBtn title="End clip here" onClick={() => p.onSetEnd(s.e)}>
                  <ArrowDownToLine />
                </IconBtn>
                {inside &&
                  (cut ? (
                    <IconBtn title="Restore sentence" onClick={() => p.onRestore({ start: s.s, end: s.e })}>
                      <Undo2 />
                    </IconBtn>
                  ) : (
                    <IconBtn title="Remove sentence" onClick={() => p.onCut({ start: s.s, end: s.e })}>
                      <Scissors />
                    </IconBtn>
                  ))}
              </span>
            </div>
          );
        })}
      </div>
      <p className="pt-2 text-[11px] text-subtle">Click to seek · Shift+click to select a range · hover a line to set in/out or remove it.</p>
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-3.5">
      {children}
    </button>
  );
}
