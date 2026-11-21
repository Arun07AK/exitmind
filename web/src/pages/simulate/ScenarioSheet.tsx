import { useEffect, useState } from "react";
import { HAZARD_KINDS, PROFILES, PROTOCOLS } from "../../../../src/sim/types.ts";
import type { HazardKind, Nl2ParamsResult, ProfileId, Protocol, Scenario } from "../../../../src/server/contract.ts";
import { postJSON } from "../../api.ts";
import { Button, cx, EvidenceChip, HazardTag, Segmented, Sheet } from "../../components/ui.tsx";
import { useGeometry } from "../../geometry.ts";
import { loadPresets, OCCUPANCY_LABEL, PROTOCOL_LABEL, useScenario, type CrowdMode, type Preset } from "../../sim/scenario.ts";
import type { PlanPoint } from "../../views/Plan2D.tsx";
import { ScenarioGenerator } from "./ScenarioGenerator.tsx";

const NEEDS_ORIGIN: HazardKind[] = ["fire", "threat", "medical"];
const HAZARD_LABEL: Record<string, string> = { none: "Drill (no hazard)", fire: "Fire", crush: "Crowd crush", quake: "Earthquake", threat: "Threat", medical: "Medical" };

export interface CustomForm {
  hazard: HazardKind; at: PlanPoint | null; damaged: string[]; surgeExit: string; protocol: Protocol; profile: ProfileId; occupancy: string; loadFactor: number; seed: number; maxSec: number; mode: CrowdMode;
  behaviour: Nl2ParamsResult["behaviour"]; source: Nl2ParamsResult["source"] | null;
}

export const DEFAULT_FORM: CustomForm = { hazard: "fire", at: null, damaged: [], surgeExit: "", protocol: "EVACUATE", profile: "college", occupancy: "uniform", loadFactor: 1, seed: 1, maxSec: 900, mode: "rule", behaviour: {}, source: null };

const field = "h-9 w-full rounded-lg border border-line-strong bg-panel px-2.5 text-[13px] text-ink";
const lbl = "flex flex-col gap-1 text-[12px] text-ink-2";

export function ScenarioSheet({ open, onOpenChange, form, setForm, onPickOrigin }: { open: boolean; onOpenChange: (o: boolean) => void; form: CustomForm; setForm: (f: CustomForm) => void; onPickOrigin: () => void }) {
  const { geo } = useGeometry();
  const { run, busy, error, scenario: current } = useScenario();
  const [tab, setTab] = useState<"presets" | "custom">("presets");
  const [list, setList] = useState<Preset[]>([]);
  const [text, setText] = useState("");
  const [nl, setNl] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  useEffect(() => { void loadPresets().then(setList); }, []);
  const set = <K extends keyof CustomForm>(k: K, v: CustomForm[K]) => setForm({ ...form, [k]: v });
  const exits = geo?.twin.exits.filter((e) => e.kind === "exterior") ?? [];
  const damageOptions = [...(geo?.twin.stairs.map((s) => ({ id: s.id, label: s.name })) ?? []), ...exits.map((e) => ({ id: e.id, label: e.name }))];
  const spaces = geo?.twin.floors.flatMap((f) => f.spaces.filter((s) => s.occupiable).map((s) => ({ id: s.id, label: `${f.id} ${s.name}` }))) ?? [];
  const origin = NEEDS_ORIGIN.includes(form.hazard);

  const translate = async () => {
    if (!text.trim()) return;
    setNl({ busy: true, error: null });
    try {
      const r = await postJSON<Nl2ParamsResult>("/api/nl2params", { text });
      setForm({ ...form, profile: r.profile, occupancy: r.occupancy, loadFactor: r.loadFactor, behaviour: r.behaviour, source: r.source });
      setNl({ busy: false, error: null });
    } catch (e) {
      setNl({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const runCustom = () => {
    const hz: Scenario["hazard"] = { kind: form.hazard, startSec: 0 };
    if (origin && form.at) Object.assign(hz, { floor: form.at.floor, at: [form.at.x, form.at.y] });
    if (form.hazard === "quake") hz.damaged = form.damaged;
    if (form.hazard === "crush" && form.surgeExit) hz.surgeExit = form.surgeExit;
    const scenario: Scenario = {
      id: `ui-${form.hazard}-${form.profile}-s${form.seed}`, profile: form.profile, hazard: hz,
      behaviour: Object.fromEntries(Object.entries(form.behaviour).map(([k, v]) => [k, v.value])),
      loadFactor: form.loadFactor, occupancy: form.occupancy as Scenario["occupancy"], protocol: form.protocol, seed: form.seed, maxSec: form.maxSec,
    };
    void run(scenario, `Custom ${HAZARD_LABEL[form.hazard]?.toLowerCase()}`, form.mode).then(() => onOpenChange(false));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Scenario" description="Pick a ready-made scenario from the design results or build your own." width={460} testId="scenario-sheet">
      <ScenarioGenerator onStarted={() => onOpenChange(false)} />
      <Segmented label="Scenario source" value={tab} onChange={setTab} options={[{ value: "presets", label: "From design results" }, { value: "custom", label: "Custom" }]} className="mb-4 w-full [&>*]:flex-1" />
      {tab === "presets" ? (
        <div className="flex flex-col gap-2" role="list">
          {list.length === 0 ? <p className="text-ink-3">No design results found. Run the design pipelines (see the README) or build a custom scenario.</p> : null}
          {list.map((p) => {
            const on = current?.id === p.scenario.id;
            return (
              <button key={p.id} type="button" role="listitem" disabled={busy} onClick={() => void run(p.scenario, p.label, "rule").then(() => onOpenChange(false))} data-testid={`preset-${p.id}`}
                className={cx("flex flex-col items-start gap-1.5 rounded-[10px] border p-3 text-left hover:bg-hover disabled:opacity-50", on ? "border-ink shadow-[0_0_0_1px_#14171c]" : "border-line")}>
                <div className="flex w-full items-center gap-2"><HazardTag kind={p.scenario.hazard.kind} /><span className="font-medium">{p.label}</span>{on ? <span className="ml-auto text-[11px] text-ink-3">running</span> : null}</div>
                <div className="text-[12px] text-ink-2">{p.description ?? ""}{p.description ? " · " : ""}{p.scenario.profile} · {OCCUPANCY_LABEL(p.scenario.occupancy)} · {PROTOCOL_LABEL(p.scenario.protocol)} · seed <span className="num">{p.scenario.seed}</span></div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <label className={lbl} htmlFor="nl">Describe the occupants in plain language</label>
            <div className="flex gap-2">
              <input id="nl" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void translate(); }} placeholder="e.g. fest night, packed, most people don't know the building" className={field} data-testid="nl-input" />
              <Button tone="default" onClick={() => void translate()} disabled={nl.busy || !text.trim()} data-testid="nl-submit">{nl.busy ? "Reading" : "Apply"}</Button>
            </div>
            {nl.error ? <p className="text-[12px] text-danger-ink">{nl.error}</p> : null}
            {form.source ? <div className="flex items-center gap-2 text-[12px] text-ink-3"><EvidenceChip kind="model" label={`Parameters from ${form.source === "llm" ? "the language model" : "the keyword lexicon"}`} />bounded by the parameter ranges</div> : null}
          </section>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Hazard
              <select value={form.hazard} onChange={(e) => setForm({ ...form, hazard: e.target.value as HazardKind, at: null })} className={field} data-testid="sim-hazard">
                {HAZARD_KINDS.map((h) => <option key={h} value={h}>{HAZARD_LABEL[h] ?? h}</option>)}
              </select>
            </label>
            <label className={lbl}>Response plan
              <select value={form.protocol} onChange={(e) => set("protocol", e.target.value as Protocol)} className={field}>
                {PROTOCOLS.map((p) => <option key={p} value={p}>{PROTOCOL_LABEL(p)}</option>)}
              </select>
            </label>
          </div>
          {origin ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-line p-3" data-testid="sim-origin">
              <div className="min-w-0 flex-1 text-[12px]"><div className="text-ink-2">Origin</div><div className="num mt-0.5">{form.at ? `${form.at.floor} (${form.at.x}, ${form.at.y}) ft` : "not placed"}</div></div>
              <Button onClick={onPickOrigin} data-testid="pick-origin">{form.at ? "Move" : "Place on plan"}</Button>
            </div>
          ) : null}
          {form.hazard === "quake" ? (
            <fieldset className="rounded-[10px] border border-line p-3 text-[12px]">
              <legend className="px-1 text-ink-2">Damaged stairs and exits</legend>
              {damageOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={form.damaged.includes(o.id)} onChange={(e) => set("damaged", e.target.checked ? [...form.damaged, o.id] : form.damaged.filter((d) => d !== o.id))} />
                  <span className="num">{o.id}</span><span className="text-ink-3">{o.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {form.hazard === "crush" ? (
            <label className={lbl}>Surge towards exit
              <select value={form.surgeExit} onChange={(e) => set("surgeExit", e.target.value)} className={field}>
                <option value="">model default</option>
                {exits.map((e) => <option key={e.id} value={e.id}>{e.id} {e.name}</option>)}
              </select>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Occupant profile
              <select value={form.profile} onChange={(e) => set("profile", e.target.value as ProfileId)} className={field} data-testid="profile">
                {PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className={lbl}>Load vs printed occupant load
              <input type="number" min={0.1} max={3} step={0.05} value={form.loadFactor} onChange={(e) => set("loadFactor", Math.min(3, Math.max(0.1, Number(e.target.value) || 0.1)))} className={cx(field, "num")} />
            </label>
            <label className={cx(lbl, "col-span-2")}>Where people are
              <div className="flex gap-2">
                <select value={form.occupancy.startsWith("event_in:") ? "event_in" : form.occupancy} onChange={(e) => set("occupancy", e.target.value === "event_in" ? `event_in:${spaces[0]?.id ?? ""}` : e.target.value)} className={field}>
                  <option value="uniform">Spread through the building</option>
                  <option value="classes_full">Classes in session</option>
                  <option value="after_hours">After hours</option>
                  <option value="event_in">Event in one room</option>
                </select>
                {form.occupancy.startsWith("event_in:") ? (
                  <select value={form.occupancy.slice(9)} onChange={(e) => set("occupancy", `event_in:${e.target.value}`)} className={field}>
                    {spaces.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                ) : null}
              </div>
            </label>
            <label className={lbl}>Seed
              <input type="number" min={0} step={1} value={form.seed} onChange={(e) => set("seed", Math.max(0, Math.round(Number(e.target.value) || 0)))} className={cx(field, "num")} />
            </label>
            <label className={lbl}>Simulated duration (s)
              <input type="number" min={60} max={3600} step={30} value={form.maxSec} onChange={(e) => set("maxSec", Math.min(3600, Math.max(60, Number(e.target.value) || 60)))} className={cx(field, "num")} />
            </label>
            <label className={cx(lbl, "col-span-2")}>Crowd decisions
              <select value={form.mode} onChange={(e) => set("mode", e.target.value as CrowdMode)} className={field}>
                <option value="rule">Rule-based (fast, deterministic)</option>
                <option value="distilled">Distilled persona policy</option>
                <option value="showcase">Showcase: 12 live LLM personas (slow, needs a key)</option>
              </select>
            </label>
          </div>
          {Object.keys(form.behaviour).length ? (
            <details className="rounded-[10px] border border-line p-3">
              <summary className="cursor-pointer text-[12px] font-medium">Behaviour values ({Object.keys(form.behaviour).length})</summary>
              <div className="mt-2 flex flex-col gap-2">
                {Object.entries(form.behaviour).map(([k, b]) => (
                  <label key={k} className="flex flex-col gap-1 text-[12px]" data-testid="behaviour-param">
                    <span className="flex justify-between gap-2"><span className="num truncate" title={k}>{k}</span><span className="num">{b.value}</span></span>
                    <input type="range" min={b.min} max={b.max} step={(b.max - b.min) / 100 || 0.01} value={b.value} onChange={(e) => set("behaviour", { ...form.behaviour, [k]: { ...b, value: Number(e.target.value) } })} />
                    <span className="text-ink-3">{b.why}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <Button tone="primary" className="h-10" disabled={busy || (origin && !form.at)} onClick={runCustom} data-testid="sim-run">{busy ? "Starting" : origin && !form.at ? "Place the origin first" : "Run simulation"}</Button>
        </div>
      )}
      {error ? <p className="mt-3 text-[12px] text-danger-ink">{error}</p> : null}
    </Sheet>
  );
}
