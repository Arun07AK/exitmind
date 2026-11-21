import { Sparkles } from "lucide-react";
import { PROFILES } from "../../../../src/sim/types.ts";
import type { ProfileId } from "../../../../src/server/contract.ts";
import { Badge, Card } from "../../components/ui.tsx";
import { useGeometry } from "../../geometry.ts";
import { clamp, type DesignParams } from "./types.ts";

const FIELD = "h-8 rounded-lg border border-line-strong bg-panel px-2 text-[13px] text-ink transition-colors hover:border-ink-4 focus:border-ink-3";
const LABEL = "text-[12px] text-ink-3";

export function ParamsPanel({ params, onChange }: { params: DesignParams; onChange: (p: DesignParams) => void }) {
  const { geo } = useGeometry();
  const spaces = geo?.twin.floors.flatMap((f) => f.spaces.filter((s) => s.occupiable).map((s) => ({ id: s.id, label: `${f.id} ${s.name}` }))) ?? [];
  const occKind = params.occupancy.startsWith("event_in:") ? "event_in" : params.occupancy;
  const entries = Object.entries(params.behaviour);
  return (
    <Card title="Parameters" actions={params.source ? <Badge><Sparkles size={12} aria-hidden="true" className="text-ink-3" />from {params.source}</Badge> : null} testId="params-panel">
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Profile</span>
          <select value={params.profile} onChange={(e) => onChange({ ...params, profile: e.target.value as ProfileId })} className={FIELD} data-testid="profile">
            {PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Load factor <span className="num text-ink-4">(0.1 to 3)</span></span>
          <input type="number" min={0.1} max={3} step={0.05} value={params.loadFactor} onChange={(e) => onChange({ ...params, loadFactor: clamp(Number(e.target.value) || 0.1, 0.1, 3) })} className={`${FIELD} num`} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className={LABEL}>Occupancy</span>
          <div className="flex gap-2">
            <select value={occKind} onChange={(e) => onChange({ ...params, occupancy: e.target.value === "event_in" ? `event_in:${spaces[0]?.id ?? ""}` : e.target.value })} className={`${FIELD} min-w-0 flex-1`}>
              <option value="uniform">uniform</option>
              <option value="classes_full">classes full</option>
              <option value="after_hours">after hours</option>
              <option value="event_in">event in a room</option>
            </select>
            {occKind === "event_in" ? (
              <select value={params.occupancy.slice(9)} onChange={(e) => onChange({ ...params, occupancy: `event_in:${e.target.value}` })} className={`${FIELD} min-w-0 flex-1`}>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            ) : null}
          </div>
        </label>
      </div>
      {entries.length ? (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-1 text-[13px] font-semibold text-ink">Behaviour values</div>
          <div className="divide-y divide-line">
            {entries.map(([key, b]) => {
              const step = (b.max - b.min) / 100 || 0.01;
              const set = (v: number) => onChange({ ...params, behaviour: { ...params.behaviour, [key]: { ...b, value: clamp(v, b.min, b.max) } } });
              return (
                <div key={key} className="py-2.5" data-testid="behaviour-param">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num truncate text-[12px] text-ink" title={key}>{key}</span>
                    <input type="number" step={step} min={b.min} max={b.max} value={b.value} onChange={(e) => set(Number(e.target.value))} aria-label={`${key} value`} className={`${FIELD} num h-7! w-24 text-right text-[12px]!`} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="num w-10 shrink-0 text-[11px] text-ink-4">{b.min}</span>
                    <input type="range" min={b.min} max={b.max} step={step} value={b.value} onChange={(e) => set(Number(e.target.value))} aria-label={`${key} slider`} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-ink" />
                    <span className="num w-10 shrink-0 text-right text-[11px] text-ink-4">{b.max}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-ink-3">why: {b.why}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-3">Describe the crowd above to fill bounded behaviour values. Without them the simulator uses the defaults in <span className="num text-ink-2">config/behaviour.params.json</span>.</p>
      )}
      {params.personaMix ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className={LABEL}>Persona mix</span>
          {Object.entries(params.personaMix).map(([k, v]) => <Badge key={k}>{k} <span className="num">{Math.round(v * 100)}%</span></Badge>)}
        </div>
      ) : null}
    </Card>
  );
}
