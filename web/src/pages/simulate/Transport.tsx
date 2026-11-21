import { Pause, Play, RotateCcw } from "lucide-react";
import { Slider } from "radix-ui";
import { useEffect, useMemo } from "react";
import { cx, Segmented, Tip } from "../../components/ui.tsx";
import { fmtTime, insideSeries } from "../../sim/derive.ts";
import { getRun, useStore } from "../../store.ts";

const SPEEDS = [1, 2, 4, 8, 16] as const;

export function Transport({ maxSec, targetSec, className }: { maxSec: number; targetSec: number | null; className?: string }) {
  const channel = useStore((s) => s.channel);
  const runVersion = useStore((s) => s.runVersion);
  const t = useStore((s) => Math.round(s.t * 4) / 4);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const follow = useStore((s) => s.follow);
  const { togglePlay, seek, setSpeed } = useStore.getState();
  const run = getRun(channel);
  const end = run?.done ? run.frames.at(-1)?.t ?? maxSec : Math.max(maxSec, run?.frames.at(-1)?.t ?? 0);
  const loaded = run?.frames.at(-1)?.t ?? 0;
  const occupants = run?.frames[0]?.n ?? 1;
  const path = useMemo(() => {
    const pts = insideSeries(run);
    if (pts.length < 2 || end <= 0) return "";
    const W = 1000, H = 56;
    const xy = pts.map(([tt, v]) => `${((tt / end) * W).toFixed(1)} ${(H - (v / occupants) * (H - 4)).toFixed(1)}`);
    return `M${xy.join(" L")}`;
  }, [run, runVersion, end, occupants]);
  const done = !!run?.done && t >= (run.frames.at(-1)?.t ?? 0) - 0.01;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || (e.key === " " && (el.tagName === "BUTTON" || el.getAttribute("role") === "radio" || el.getAttribute("role") === "slider")))) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      if (e.key === " ") { e.preventDefault(); useStore.getState().togglePlay(); }
      else if (e.key === "ArrowRight" && !el?.closest("[role=slider],[role=radiogroup],[role=group]")) useStore.getState().seek(useStore.getState().t + 5);
      else if (e.key === "ArrowLeft" && !el?.closest("[role=slider],[role=radiogroup],[role=group]")) useStore.getState().seek(useStore.getState().t - 5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / Math.max(1, end)) * 100))}%`;
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-panel px-4 md:flex-nowrap", className)} data-testid="transport">
      <Tip label={done ? "Replay (space)" : playing ? "Pause (space)" : "Play (space)"}>
        <button type="button" onClick={togglePlay} aria-label={done ? "Replay" : playing ? "Pause" : "Play"} data-testid="play" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-white hover:bg-[#2a2f37]">
          {done ? <RotateCcw size={16} /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
        </button>
      </Tip>
      <div className="num shrink-0 text-[15px]" data-testid="clock"><span>{fmtTime(t)}</span><span className="text-ink-4"> / {fmtTime(end)}</span></div>
      <div className="relative order-last h-11 min-w-[200px] basis-full md:order-none md:basis-auto md:flex-1">
        <svg viewBox="0 0 1000 56" preserveAspectRatio="none" className="absolute top-1 left-0 h-7 w-full" aria-hidden="true">
          {path ? <path d={`${path} L${((loaded / end) * 1000).toFixed(1)} 56 L0 56 Z`} fill="#6a7280" fillOpacity="0.13" /> : null}
          {path ? <path d={path} fill="none" stroke="#4b5361" strokeOpacity="0.8" strokeWidth="1.4" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        <span aria-hidden="true" className="absolute top-1 left-0 h-7 bg-[rgba(20,23,28,0.05)]" style={{ width: pct(t) }} />
        {targetSec !== null && targetSec < end ? (
          <>
            <span aria-hidden="true" className="absolute top-0 h-8 border-l border-dashed border-ink-4" style={{ left: pct(targetSec) }} />
            <span className="absolute -top-0.5 translate-x-1 text-[10px] whitespace-nowrap text-ink-3" style={{ left: pct(targetSec) }}>target</span>
          </>
        ) : null}
        <Slider.Root value={[Math.min(t, end)]} max={Math.max(1, end)} step={0.25} onValueChange={([v]) => seek(v ?? 0)} aria-label="Simulation time" className="absolute inset-x-0 top-0 flex h-8 touch-none items-center select-none">
          <Slider.Track className="relative h-8 grow bg-transparent">
            <Slider.Range className="absolute h-full bg-transparent" />
          </Slider.Track>
          <Slider.Thumb aria-valuetext={fmtTime(t)} className="block h-8 w-[2px] cursor-ew-resize bg-ink outline-none before:absolute before:-top-1 before:-left-[4px] before:h-2.5 before:w-2.5 before:rounded-full before:bg-ink focus-visible:ring-2 focus-visible:ring-focus" />
        </Slider.Root>
        <div className="num pointer-events-none absolute right-0 bottom-0 left-0 flex justify-between text-[10px] text-ink-3" aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{fmtTime(end * f)}</span>)}
        </div>
      </div>
      {follow ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-danger-ink"><span className="h-2 w-2 rounded-full bg-danger-strong" />Live</span>
      ) : (
        <Segmented size="sm" label="Playback speed" value={String(speed)} onChange={(v) => setSpeed(Number(v))} options={SPEEDS.map((s) => ({ value: String(s), label: <span className="num">{s}×</span> }))} tone="light" className="shrink-0 bg-inset" testId="speed" />
      )}
    </div>
  );
}
