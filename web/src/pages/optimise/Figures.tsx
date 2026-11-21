import type { RecommendAggregate, RecommendResult } from "../../../../src/server/contract.ts";
import { cx } from "../../components/ui.tsx";
import { changedExit, fmt1, fmtClock, fmtNum, fmtPct, signed, type Rec } from "./model.ts";

const Arrow = () => <span aria-hidden="true" className="text-idle"> → </span>;

export function FigureRow({ result, rec }: { result: RecommendResult; rec: Rec }) {
  const o = result.original, v = rec.variant!;
  const target = fmtClock(result.targetSec);
  const exit = changedExit(result, rec);
  const s0 = o.exitShares.find((x) => x.id === exit), s1 = v.exitShares.find((x) => x.id === exit);
  const gainTone = rec.status === "validated" ? "text-safe-ink" : rec.status === "worse" ? "text-danger-ink" : "text-ink-2";
  const r95 = (a: RecommendAggregate) => `${a.reached95.seeds} of ${a.reached95.of}`;
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line min-[640px]:grid-cols-3" data-testid="figures">
      <div className="bg-panel p-4">
        <div className="text-[12px] text-ink-2">Out by the <span className="num">{target}</span> target</div>
        <div className="num mt-2 text-[22px]" data-testid="fig-out"><span className="text-ink-4">{fmt1(o.outByTarget.mean)}</span><Arrow />{fmt1(v.outByTarget.mean)}</div>
        {rec.gain ? (
          <div className={cx("num mt-1 text-[13px] font-medium", gainTone)} data-testid="fig-gain">
            {signed(rec.gain.mean, 1)} people, mean of {rec.gain.perSeed.length} seeds <span className="font-normal text-ink-3">· SE {fmtNum(rec.gain.se, 1)}</span>
          </div>
        ) : null}
      </div>
      <div className="bg-panel p-4">
        <div className="text-[12px] text-ink-2">95% of occupants out</div>
        <div className="num mt-2 text-[22px]" data-testid="fig-95"><span className="text-ink-4">{r95(o)}</span><Arrow />{r95(v)}</div>
        <div className="num mt-1 text-[13px] text-ink-2">
          {v.reached95.minSec !== null && v.reached95.maxSec !== null
            ? v.reached95.seeds < v.reached95.of
              ? `${fmtClock(v.reached95.minSec)} to ${fmtClock(v.reached95.maxSec)} in the ${v.reached95.seeds} seeds that reach it`
              : `${fmtClock(v.reached95.minSec)} to ${fmtClock(v.reached95.maxSec)} with the change`
            : "not reached in any seed"}
          <span className="text-ink-3"> · {v.reached95.byTarget} of {v.reached95.of} by {target}</span>
        </div>
      </div>
      <div className="bg-panel p-4">
        <div className="text-[12px] text-ink-2">Exit use at <span className="num">{exit ?? "the changed exit"}</span></div>
        <div className="num mt-2 text-[22px]" data-testid="fig-share">{s0 && s1 ? <><span className="text-ink-4">{fmtPct(s0.share)}</span><Arrow />{fmtPct(s1.share)}</> : "—"}</div>
        <div className="mt-1 text-[13px] text-ink-2">share of all exterior exit use{s0 && s1 && s0.clearWidthIn !== s1.clearWidthIn ? <span className="num text-ink-3"> · {fmtNum(s0.clearWidthIn)} → {fmtNum(s1.clearWidthIn)} in</span> : null}</div>
      </div>
    </div>
  );
}

function niceAxis(max: number): number[] {
  const step = [5, 10, 25, 50, 100, 250, 500, 1000, 2500].find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/** Spread dots that would overlap into lanes above and below the axis line. */
function lanes(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const offsets = [0, -7, 7, -14, 14];
  const placed: { x: number; lane: number }[] = [];
  const out = new Array<number>(xs.length).fill(0);
  for (const [x, i] of order) {
    const lane = offsets.findIndex((_, k) => !placed.some((p) => p.lane === k && Math.abs(p.x - x) < 2.2));
    const k = lane < 0 ? placed.length % offsets.length : lane;
    placed.push({ x, lane: k });
    out[i] = offsets[k]!;
  }
  return out;
}

export function DotPlot({ result, rec }: { result: RecommendResult; rec: Rec }) {
  const v = rec.variant!;
  const rows = [
    { label: "Original", per: result.original.perSeed, mean: result.original.remainingAtTarget.mean, dot: "bg-ink-4", text: "text-ink-2", tick: "bg-ink-4" },
    { label: "With change", per: v.perSeed, mean: v.remainingAtTarget.mean, dot: "bg-ink", text: "text-ink", tick: "bg-ink" },
  ];
  const ticks = niceAxis(Math.max(1, ...rows.flatMap((r) => r.per.map((p) => p.remainingAtTarget))));
  const top = ticks.at(-1)!;
  const pos = (n: number) => (n / top) * 100;
  return (
    <section className="rounded-xl border border-line bg-panel p-4" aria-label="People still inside at the target, per seed" data-testid="dotplot">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-medium">People still inside at <span className="num">{fmtClock(result.targetSec)}</span></span>
        <span className="text-[12px] text-ink-3">each dot is one seed · tick is the mean</span>
      </div>
      <div className="mt-3.5 flex flex-col gap-3.5">
        {rows.map((r) => {
          const xs = r.per.map((p) => pos(p.remainingAtTarget));
          const ys = lanes(xs);
          return (
            <div key={r.label} className="grid grid-cols-[76px_minmax(0,1fr)_48px] items-center gap-3 min-[640px]:grid-cols-[110px_minmax(0,1fr)_64px]">
              <span className={cx("text-[12px]", r.text)}>{r.label}</span>
              <div className="relative h-[34px] border-b border-line">
                <span className={cx("absolute top-0 h-[34px] w-0.5 -translate-x-px opacity-50", r.tick)} style={{ left: `${pos(r.mean)}%` }} />
                {r.per.map((p, i) => (
                  <span key={p.seed} title={`seed ${p.seed}: ${p.remainingAtTarget} still inside`} className={cx("absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full shadow-[0_0_0_2px_#fff]", r.dot)} style={{ left: `${xs[i]}%`, top: 12 + ys[i]! }} data-seed={p.seed} />
                ))}
              </div>
              <span className={cx("num text-right", r.text)}>{fmt1(r.mean)}</span>
            </div>
          );
        })}
        <div className="num grid grid-cols-[76px_minmax(0,1fr)_48px] gap-3 text-[11px] text-ink-3 min-[640px]:grid-cols-[110px_minmax(0,1fr)_64px]">
          <span />
          <div className="relative h-3.5">
            {ticks.map((t) => <span key={t} className={cx("absolute", t === 0 ? "left-0" : t === top ? "right-0" : "-translate-x-1/2")} style={t === 0 || t === top ? undefined : { left: `${pos(t)}%` }}>{fmtNum(t)}</span>)}
          </div>
          <span className="text-right">mean</span>
        </div>
      </div>
    </section>
  );
}

export function VariantTable({ result, recs, selected, onSelect }: { result: RecommendResult; recs: Rec[]; selected: string; onSelect: (id: string) => void }) {
  const target = fmtClock(result.targetSec);
  const cells = (a: RecommendAggregate) => [fmt1(a.outByTarget.mean), `${fmtNum(a.remainingAtTarget.min)}–${fmtNum(a.remainingAtTarget.max)}`, `${a.reached95.seeds} of ${a.reached95.of}`, fmtNum(a.densityDangerPS)];
  const rows = [{ id: "", name: "Original layout", vals: cells(result.original) }, ...recs.map((r) => ({ id: r.id, name: `${r.letter} · ${r.label}`, vals: r.variant ? cells(r.variant) : ["not tested", "—", "—", "—"] }))];
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel" data-testid="variant-table">
      <table className="w-full min-w-[620px] border-collapse text-[12px]">
        <caption className="border-b border-line px-3.5 py-3 text-left text-[13px] font-medium">All changes, same scenario and seeds</caption>
        <thead>
          <tr className="text-left text-ink-3">
            <th scope="col" className="px-3.5 py-2 font-medium">Layout</th>
            <th scope="col" className="px-3.5 py-2 text-right font-medium">Out by <span className="num">{target}</span></th>
            <th scope="col" className="px-3.5 py-2 text-right font-medium">Still inside, range</th>
            <th scope="col" className="px-3.5 py-2 text-right font-medium">95% out</th>
            <th scope="col" className="px-3.5 py-2 text-right font-medium">Person-s at dangerous density, all floors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = r.id === selected;
            return (
              <tr key={r.id || "original"} className={cx("border-t border-inset", on && "bg-hover")}>
                <th scope="row" className={cx("px-3.5 py-2 text-left", on ? "font-medium text-ink" : "font-normal text-ink-2")}>
                  {r.id ? <button type="button" onClick={() => onSelect(r.id)} className="text-left hover:text-ink hover:underline">{r.name}</button> : r.name}
                </th>
                {r.vals.map((v, i) => <td key={i} className={cx("num px-3.5 py-2 text-right", i === 0 ? "text-ink" : "text-ink-2")}>{v}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
