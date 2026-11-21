import { PROFILES } from "../../../../src/sim/types.ts";
import type { ProfileId } from "../../../../src/server/contract.ts";
import { Badge, Card } from "../../components/ui.tsx";
import { useGeometry } from "../../geometry.ts";
import { clamp, type DesignParams } from "./types.ts";

export function ParamsPanel({ params, onChange }: { params: DesignParams; onChange: (p: DesignParams) => void }) {
  const { geo } = useGeometry();
  const spaces = geo?.twin.floors.flatMap((f) => f.spaces.filter((s) => s.occupiable).map((s) => ({ id: s.id, label: `${f.id} ${s.name}` }))) ?? [];
  const occKind = params.occupancy.startsWith("event_in:") ? "event_in" : params.occupancy;
  const entries = Object.entries(params.behaviour);
  return (
    <Card title="Parameters" actions={params.source ? <Badge color={params.source === "llm" ? "violet" : "sky"}>from {params.source}</Badge> : null} testId="params-panel">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-slate-400">profile</span>
          <select value={params.profile} onChange={(e) => onChange({ ...params, profile: e.target.value as ProfileId })} className="rounded bg-slate-800 px-2 py-1" data-testid="profile">
            {PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-slate-400">load factor (0.1 to 3)</span>
          <input type="number" min={0.1} max={3} step={0.05} value={params.loadFactor} onChange={(e) => onChange({ ...params, loadFactor: clamp(Number(e.target.value) || 0.1, 0.1, 3) })} className="rounded bg-slate-800 px-2 py-1 font-mono" />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[11px] text-slate-400">occupancy</span>
          <div className="flex gap-2">
            <select value={occKind} onChange={(e) => onChange({ ...params, occupancy: e.target.value === "event_in" ? `event_in:${spaces[0]?.id ?? ""}` : e.target.value })} className="flex-1 rounded bg-slate-800 px-2 py-1">
              <option value="uniform">uniform</option>
              <option value="classes_full">classes full</option>
              <option value="after_hours">after hours</option>
              <option value="event_in">event in a room</option>
            </select>
            {occKind === "event_in" ? (
              <select value={params.occupancy.slice(9)} onChange={(e) => onChange({ ...params, occupancy: `event_in:${e.target.value}` })} className="flex-1 rounded bg-slate-800 px-2 py-1">
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            ) : null}
          </div>
        </label>
      </div>
      {entries.length ? (
        <div className="mt-3 space-y-2">
          {entries.map(([key, b]) => (
            <div key={key} className="rounded border border-slate-800 p-2" data-testid="behaviour-param">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-slate-200" title={key}>{key}</span>
                <input
                  type="number"
                  step={(b.max - b.min) / 100 || 0.01}
                  min={b.min}
                  max={b.max}
                  value={b.value}
                  onChange={(e) => onChange({ ...params, behaviour: { ...params.behaviour, [key]: { ...b, value: clamp(Number(e.target.value), b.min, b.max) } } })}
                  className="w-24 rounded bg-slate-800 px-1 py-0.5 text-right font-mono text-xs"
                />
              </div>
              <input
                type="range"
                min={b.min}
                max={b.max}
                step={(b.max - b.min) / 100 || 0.01}
                value={b.value}
                onChange={(e) => onChange({ ...params, behaviour: { ...params.behaviour, [key]: { ...b, value: clamp(Number(e.target.value), b.min, b.max) } } })}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>{b.min}</span>
                <span className="px-2 text-center text-slate-400">why: {b.why}</span>
                <span>{b.max}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Describe the crowd above to fill bounded behaviour values. Without them the simulator uses the defaults in config/behaviour.params.json.</p>
      )}
      {params.personaMix ? (
        <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-400">
          persona mix:
          {Object.entries(params.personaMix).map(([k, v]) => <Badge key={k}>{k} {Math.round(v * 100)}%</Badge>)}
        </div>
      ) : null}
    </Card>
  );
}
