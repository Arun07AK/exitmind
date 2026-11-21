import { useEffect, useState } from "react";
import type { RecommendResult, Scenario, SimRunRequest } from "../../../../src/server/contract.ts";
import { postJSON } from "../../api.ts";
import { Sheet } from "../../components/ui.tsx";
import type { Geometry } from "../../geometry.ts";
import { getRun, sampleRun, subscribeChannel, useStore } from "../../store.ts";
import Plan2D from "../../views/Plan2D.tsx";
import { Transport } from "../simulate/Transport.tsx";
import { changeMarks, fmtNum, focusFor, type Rec } from "./model.ts";

function Inside({ channel }: { channel: string }) {
  useStore((s) => Math.floor(s.t * 2));
  useStore((s) => s.runVersion);
  const run = getRun(channel);
  const smp = sampleRun(run, useStore.getState().t);
  if (!smp) return <span className="text-ink-3">waiting for frames</span>;
  return <span><span className="num text-ink">{fmtNum(smp.a.metrics.remaining)}</span> still inside · <span className="num">{fmtNum(smp.a.metrics.protected)}</span> out</span>;
}

export function CompareSheet({ open, onOpenChange, geo, result, rec }: { open: boolean; onOpenChange: (o: boolean) => void; geo: Geometry; result: RecommendResult; rec: Rec }) {
  const [chs, setChs] = useState<{ orig: string; variant: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seed = result.seeds[0]!;
  const base = result.scenario.scenario;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let unsub: (() => void) | null = null;
    const prev = useStore.getState().channel;
    setChs(null); setError(null);
    const start = (edits: NonNullable<Scenario["edits"]>) => postJSON<{ channel: string }>("/api/sim/run", { scenario: { ...base, seed, edits }, mode: result.policy, speed: 0 } satisfies SimRunRequest);
    Promise.all([start([...(base.edits ?? [])]), start([...(base.edits ?? []), ...rec.edits])]).then(([o, v]) => {
      if (!alive) return;
      unsub = subscribeChannel(v.channel);
      useStore.getState().setChannel(o.channel, { autoplay: true });
      setChs({ orig: o.channel, variant: v.channel });
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => {
      alive = false;
      unsub?.();
      if (useStore.getState().channel !== prev) useStore.getState().setChannel(prev, { autoplay: false });
    };
  }, [open, rec.id, result, base, seed]);

  const spot = focusFor(geo, result, rec);
  const mark = changeMarks(geo, rec, result.original)[0];
  const focus = { x: spot.x, y: spot.y, zoom: 2 };
  const panes = chs ? [
    { key: "orig", title: "Original", sub: mark?.before ?? "as built", channel: chs.orig },
    { key: "variant", title: "With change", sub: rec.whatChanges, channel: chs.variant },
  ] : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} width={4000} title={`Original and ${rec.letter} side by side`} description={`${rec.label} · ${result.scenario.label} · seed ${seed} · ${result.policy} crowd · one shared playhead`} testId="compare-sheet">
      <div className="flex h-full min-h-[520px] flex-col gap-3">
        {error ? <div className="rounded-lg border border-danger-line bg-danger-bg px-3 py-2 text-[13px] text-danger-ink">Could not start the runs: {error}</div> : null}
        {!chs && !error ? <div className="grid flex-1 place-items-center text-ink-3">Starting both runs</div> : null}
        {chs ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 min-[900px]:grid-cols-2">
            {panes.map((p) => (
              <div key={p.key} className="flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel" data-testid={`compare-${p.key}`}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line px-3.5 py-2">
                  <span className="font-medium">{p.title}</span>
                  <span className="num min-w-0 truncate text-[12px] text-ink-3">{p.sub}</span>
                  <span className="ml-auto text-[12px] text-ink-2"><Inside channel={p.channel} /></span>
                </div>
                <div className="relative min-h-0 flex-1 bg-stage">
                  <Plan2D channel={p.channel} floor={spot.floor} focus={focus} showInspector={false} testId={`compare-canvas-${p.key}`} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <Transport maxSec={base.maxSec} targetSec={result.targetSec} className="sticky bottom-0 z-10 -mx-5 -mb-4 min-h-16 flex-none flex-wrap gap-y-1 py-2" />
      </div>
    </Sheet>
  );
}
