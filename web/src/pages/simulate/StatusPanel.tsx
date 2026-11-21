import { useMemo } from "react";
import { cx, Dot } from "../../components/ui.tsx";
import { useGeometry } from "../../geometry.ts";
import { elementColor } from "../../lib/colors.ts";
import { countAgents, exitStats, fmtTime, smokeCoverage } from "../../sim/derive.ts";
import { getRun, useStore } from "../../store.ts";

export function StatusPanel({ onStats, className }: { onStats: () => void; className?: string }) {
  const { geo } = useGeometry();
  const frame = useStore((s) => s.frame);
  const hazard = useStore((s) => s.hazard);
  const channel = useStore((s) => s.channel);
  const counts = useMemo(() => countAgents(frame, geo, hazard), [frame, geo, hazard]);
  const exits = useMemo(() => exitStats(getRun(channel), frame, geo), [channel, frame, geo]);
  const cover = useMemo(() => (geo ? smokeCoverage(geo, hazard) : []), [geo, hazard]);
  if (!counts || !frame || !geo) {
    return <aside className={cx("rounded-xl border border-line bg-panel p-4 text-ink-3 shadow-[0_8px_24px_rgba(16,24,40,0.06)]", className)} aria-label="Evacuation status">Waiting for the first frame…</aside>;
  }
  const n = counts.occupants || 1;
  const pct = (v: number) => `${(v / n) * 100}%`;
  const smokeFloors = cover.flatMap((c, i) => (geo.twin.floors[i] ? [{ id: geo.twin.floors[i]!.id, c }] : [])).filter((x) => x.c > 0.005);
  const c95 = frame.metrics.clearance95Sec;
  return (
    <aside aria-label="Evacuation status" data-testid="status-panel" className={cx("flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-4 shadow-[0_8px_24px_rgba(16,24,40,0.06)]", className)}>
      <div>
        <div className="flex justify-between text-[12px] text-ink-2"><span>Out of the building</span><span className="num">{fmtTime(frame.t)}</span></div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="num text-[36px] leading-none font-medium text-safe-ink" data-testid="status-out">{counts.out}</span>
          <span className="num text-[15px] text-ink-3">/ {counts.occupants}</span>
        </div>
        <div aria-hidden="true" className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
          <span style={{ width: pct(counts.out) }} className="bg-safe" />
          {counts.inPlace ? <span style={{ width: pct(counts.inPlace) }} className="bg-[#0f766e]" /> : null}
          <span style={{ width: pct(counts.inSmoke) }} className="bg-danger" />
          <span style={{ width: pct(counts.queuing) }} className="bg-warn" />
          <span style={{ width: pct(counts.moving) }} className="bg-moving" />
          <span className="flex-1 bg-[#d5dae0]" />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
          <Row dot="#e5372b" label="In dense smoke" value={counts.inSmoke} strong />
          <Row dot="#f59e0b" label="Queuing" value={counts.queuing} />
          <Row dot="#1f2530" label="Moving" value={counts.moving} />
          <Row dot="#d5dae0" ring label="Not yet moving" value={counts.notStarted} />
          {counts.inPlace ? <Row dot="#0f766e" label="Protected in place" value={counts.inPlace} /> : null}
        </div>
      </div>
      <div className="h-px bg-inset" />
      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] text-ink-2">Conditions</div>
        {hazard?.shaking ? <div className="font-medium text-warn-ink">Shaking in progress</div> : null}
        {hazard?.damaged.length ? <div><span className="text-danger-ink">No passage:</span> <span className="num">{hazard.damaged.join(", ")}</span></div> : null}
        {smokeFloors.length ? (
          <div className="leading-[1.5]">Smoke has reached {smokeFloors.map((f, i) => <span key={f.id}>{i ? (i === smokeFloors.length - 1 ? " and " : ", ") : ""}<span className="num">{Math.round(f.c * 100)}%</span> of {f.id}</span>)}.</div>
        ) : hazard?.fireOrigin ? <div className="text-ink-2">No smoke spread yet.</div> : null}
        <div className="text-ink-2">{c95 !== null ? <>95% out at <span className="num">{fmtTime(c95)}</span></> : <>95% not out yet</>}</div>
      </div>
      <div className="h-px bg-inset" />
      <div>
        <div className="mb-1.5 flex justify-between text-[12px] text-ink-2"><span>Exits</span><span>out · last 30 s</span></div>
        {exits.map((e) => (
          <div key={e.id} className="flex h-[26px] items-center gap-2" data-testid="exit-row">
            <span className="h-[3px] w-2.5 shrink-0 rounded-sm" style={{ background: hazard?.damaged.includes(e.id) ? "#d92d20" : elementColor(e.id) }} />
            <span className="num w-11 shrink-0">{e.id}</span>
            <span className="min-w-0 flex-1 truncate text-ink-3" title={e.label}>{e.label}</span>
            <span className="num w-8 text-right">{e.out}</span>
            <span className="num w-[52px] text-right text-ink-2">{e.flow.toFixed(2)}/s</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={onStats} className="h-8 rounded-lg border border-line-strong bg-panel text-[12px] font-medium hover:bg-hover" data-testid="open-stats">All run statistics</button>
    </aside>
  );
}

function Row({ dot, label, value, strong, ring }: { dot: string; label: string; value: number; strong?: boolean; ring?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Dot color={dot} ring={ring} size={7} />
      <span className="text-ink-2">{label}</span>
      <span className={cx("num ml-auto", strong && value > 0 ? "font-medium text-danger-ink" : "")}>{value}</span>
    </div>
  );
}
