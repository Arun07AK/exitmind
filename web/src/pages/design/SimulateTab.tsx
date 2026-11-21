import { HAZARD_KINDS, PROTOCOLS } from "../../../../src/sim/types.ts";
import type { HazardKind, Protocol } from "../../../../src/server/contract.ts";
import { Metric } from "../../components/Metric.tsx";
import { BadnessFormula } from "../../components/Outcome.tsx";
import { Sparkline } from "../../components/Sparkline.tsx";
import { Badge, Button, Card, Td, Th } from "../../components/ui.tsx";
import { useGeometry } from "../../geometry.ts";
import { useStore } from "../../store.ts";
import { FrameStatus, SyncedViews } from "../../views/SyncedViews.tsx";
import type { SimForm } from "./types.ts";

const NEEDS_ORIGIN: HazardKind[] = ["fire", "threat", "medical"];
export const needsOrigin = (h: HazardKind) => NEEDS_ORIGIN.includes(h);

function PersonaFeed() {
  const personas = useStore((s) => s.personas);
  return (
    <Card title="Live persona decisions" testId="persona-feed">
      <p className="mb-2 text-[11px] font-medium text-amber-300">modelled behaviour, not validated against real evacuations</p>
      {personas.length ? (
        <ul className="max-h-80 space-y-1 overflow-auto text-xs">
          {[...personas].reverse().map((p, i) => (
            <li key={`${p.tick}-${p.agent}-${i}`} className="rounded border border-slate-800 p-1.5">
              <div className="flex justify-between text-slate-400"><span>agent #{p.agent} · {p.point.replace(/_/g, " ").toLowerCase()}</span><span className="font-mono">tick {p.tick}</span></div>
              <div className="text-slate-200">{p.chosen}</div>
              <div className="text-[10px] text-slate-500">{p.persona.age}, {p.persona.role}, {p.persona.mobility}, {p.persona.familiar ? "familiar" : "unfamiliar"}, {p.persona.stress} · source: {p.source}{p.note ? ` · ${p.note}` : ""}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">Persona decisions appear here during showcase runs.</p>
      )}
    </Card>
  );
}

function RunFigures() {
  const frame = useStore((s) => s.frameB);
  const summary = useStore((s) => s.summary);
  const series = useStore((s) => s.series);
  const channel = useStore((s) => s.channel);
  const fsrc = frame ? `frame tick ${frame.tick}, ${channel}` : "";
  const ssrc = summary ? `run summary, ${summary.channel}` : "";
  const m = summary?.metrics;
  return (
    <div className="space-y-3">
      <Card title="Run">
        <Sparkline xs={series.map((p) => p.t)} ys={series.map((p) => p.protected)} label="protected over time" source={`frames on ${channel ?? "no channel"}`} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Metric label="protected" value={frame?.metrics.protected} source={fsrc} digits={0} />
          <Metric label="remaining" value={frame?.metrics.remaining} source={fsrc} digits={0} />
          <Metric label="95% clearance" value={frame?.metrics.clearance95Sec} source={fsrc} unit="s" hint="not reached yet" />
          <Metric label="simulated time" value={frame?.metrics.endSec} source={fsrc} unit="s" />
        </div>
      </Card>
      {m ? (
        <Card title="Summary" testId="run-summary">
          <div className="flex flex-wrap gap-2">
            <Metric label="occupants" value={m.occupants} source={ssrc} digits={0} />
            <Metric label="protected" value={m.protected} source={ssrc} digits={0} />
            <Metric label="sheltered" value={m.sheltered} source={ssrc} digits={0} />
            <Metric label="in refuge" value={m.inRefuge} source={ssrc} digits={0} />
            <Metric label="remaining" value={m.remaining} source={ssrc} digits={0} />
            <Metric label="remaining at target" value={m.remainingAtTarget} source={ssrc} digits={0} />
            <Metric label="95% clearance" value={m.clearance95Sec} source={ssrc} unit="s" hint="not reached" />
            <Metric label="full clearance" value={m.clearanceAllSec} source={ssrc} unit="s" hint="not reached" />
            <Metric label="danger density" value={m.densityDangerPS} source={ssrc} unit="p·s" />
            <Metric label="smoke exposure" value={m.smokeExposurePS} source={ssrc} unit="p·s" />
            <Metric label="threat exposure" value={m.threatExposurePS} source={ssrc} unit="p·s" />
            <Metric label="crush time" value={m.crushSec} source={ssrc} unit="s" />
            <Metric label="mean pre-movement" value={m.meanPremoveSec} source={ssrc} unit="s" />
            <Metric label="badness" value={summary.badness} source={ssrc} />
          </div>
          <div className="mt-1 text-xs">gridlock: {m.gridlock ? <Badge color="red">yes at {m.gridlockAtSec ?? "?"} s</Badge> : <Badge color="green">no</Badge>}</div>
          <BadnessFormula />
          <table className="mt-3 w-full border-collapse">
            <thead><tr><Th>egress element</Th><Th>people used it</Th></tr></thead>
            <tbody>
              {Object.entries(m.exitUsage).map(([k, v]) => <tr key={k}><Td className="font-mono text-xs">{k}</Td><Td className="font-mono">{v}</Td></tr>)}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

export function SimulateTab({ form, setForm, onRun, busy, error }: { form: SimForm; setForm: (f: SimForm) => void; onRun: () => void; busy: boolean; error: string | null }) {
  const { geo } = useGeometry();
  const origin = needsOrigin(form.hazard);
  const exits = geo?.twin.exits.filter((e) => e.kind === "exterior") ?? [];
  const damageOptions = [...(geo?.twin.stairs.map((s) => ({ id: s.id, label: s.name })) ?? []), ...exits.map((e) => ({ id: e.id, label: e.name }))];
  const set = <K extends keyof SimForm>(k: K, v: SimForm[K]) => setForm({ ...form, [k]: v });
  return (
    <div className="grid gap-3 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Card title="Scenario" testId="sim-form">
        <div className="space-y-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">hazard</span>
            <select value={form.hazard} onChange={(e) => setForm({ ...form, hazard: e.target.value as HazardKind, at: null })} className="rounded bg-slate-800 px-2 py-1" data-testid="sim-hazard">
              {HAZARD_KINDS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          {origin ? (
            <div className="rounded border border-slate-800 p-2 text-xs" data-testid="sim-origin">
              <div className="text-slate-400">origin: pick a floor tab, then click on the plan</div>
              <div className="mt-1 font-mono text-slate-200">{form.at ? `${form.at.floor} (${form.at.x}, ${form.at.y}) ft` : "not placed"}</div>
            </div>
          ) : null}
          {form.hazard === "quake" ? (
            <fieldset className="rounded border border-slate-800 p-2 text-xs">
              <legend className="px-1 text-[11px] text-slate-400">damaged stairs and exits</legend>
              {damageOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={form.damaged.includes(o.id)} onChange={(e) => set("damaged", e.target.checked ? [...form.damaged, o.id] : form.damaged.filter((d) => d !== o.id))} />
                  <span className="font-mono">{o.id}</span><span className="text-slate-400">{o.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {form.hazard === "crush" ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">surge towards exit</span>
              <select value={form.surgeExit} onChange={(e) => set("surgeExit", e.target.value)} className="rounded bg-slate-800 px-2 py-1">
                <option value="">model default</option>
                {exits.map((e) => <option key={e.id} value={e.id}>{e.id} {e.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">protocol</span>
            <select value={form.protocol} onChange={(e) => set("protocol", e.target.value as Protocol)} className="rounded bg-slate-800 px-2 py-1">
              {PROTOCOLS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ").toLowerCase()}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">seed</span>
              <input type="number" min={0} step={1} value={form.seed} onChange={(e) => set("seed", Math.max(0, Math.round(Number(e.target.value) || 0)))} className="rounded bg-slate-800 px-2 py-1 font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">mode</span>
              <select value={form.mode} onChange={(e) => set("mode", e.target.value as SimForm["mode"])} className="rounded bg-slate-800 px-2 py-1">
                <option value="rule">rule</option>
                <option value="distilled">distilled</option>
                <option value="showcase">showcase</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">playback speed</span>
              <select value={form.speed} onChange={(e) => set("speed", Number(e.target.value))} className="rounded bg-slate-800 px-2 py-1">
                {[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s}x</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">max sim seconds</span>
              <input type="number" min={10} max={3600} step={10} value={form.maxSec} onChange={(e) => set("maxSec", Math.min(3600, Math.max(10, Number(e.target.value) || 10)))} className="rounded bg-slate-800 px-2 py-1 font-mono" />
            </label>
          </div>
          <Button tone="primary" className="w-full" disabled={busy || (origin && !form.at)} onClick={onRun} data-testid="sim-run">
            {busy ? "Starting" : origin && !form.at ? "Place the origin on the plan" : "Run simulation"}
          </Button>
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>
      </Card>
      <div className="min-w-0 space-y-3">
        <FrameStatus />
        <SyncedViews className="h-[30rem]" onPlanClick={origin ? (p) => set("at", p) : undefined} marker={origin ? form.at : null} />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <RunFigures />
          <PersonaFeed />
        </div>
      </div>
    </div>
  );
}
