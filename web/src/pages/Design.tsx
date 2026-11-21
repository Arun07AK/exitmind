import { useEffect, useState } from "react";
import type { Nl2ParamsResult, Scenario, ScenarioRef, SimRunRequest } from "../../../src/server/contract.ts";
import { postJSON } from "../api.ts";
import { Button, Tabs } from "../components/ui.tsx";
import { useStore } from "../store.ts";
import { CodeCheckTab } from "./design/CodeCheckTab.tsx";
import { ParamsPanel } from "./design/ParamsPanel.tsx";
import { AdversaryTab, BottlenecksTab, OptimiserTab, PlaybookTab, RatingTab } from "./design/ResultTabs.tsx";
import { needsOrigin, SimulateTab } from "./design/SimulateTab.tsx";
import type { DesignParams, SimForm } from "./design/types.ts";

const TABS = [
  { id: "twin", label: "Twin & code check" },
  { id: "simulate", label: "Simulate" },
  { id: "bottlenecks", label: "Bottlenecks" },
  { id: "adversary", label: "Adversary" },
  { id: "optimiser", label: "Optimiser" },
  { id: "rating", label: "Rating" },
  { id: "playbook", label: "Playbook" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function Design() {
  const [initialChannel] = useState(() => new URLSearchParams(location.search).get("channel"));
  const [tab, setTab] = useState<TabId>(initialChannel ? "simulate" : "twin");
  const [text, setText] = useState("");
  const [nlBusy, setNlBusy] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [params, setParams] = useState<DesignParams>({ profile: "college", occupancy: "uniform", loadFactor: 1, behaviour: {}, personaMix: null, source: null });
  const [form, setForm] = useState<SimForm>({ hazard: "fire", at: null, damaged: [], surgeExit: "", protocol: "EVACUATE", seed: 1, mode: "rule", speed: 4, maxSec: 900 });
  const [channel, setChannel] = useState<string | null>(initialChannel);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const storeSetChannel = useStore((s) => s.setChannel);

  useEffect(() => {
    storeSetChannel(channel);
  }, [channel, storeSetChannel]);
  useEffect(() => () => storeSetChannel(null), [storeSetChannel]);

  const translate = async () => {
    if (!text.trim()) return;
    setNlBusy(true);
    setNlError(null);
    try {
      const r = await postJSON<Nl2ParamsResult>("/api/nl2params", { text });
      setParams({ profile: r.profile, occupancy: r.occupancy, loadFactor: r.loadFactor, behaviour: r.behaviour, personaMix: r.personaMix, source: r.source });
    } catch (e) {
      setNlError(e instanceof Error ? e.message : String(e));
    } finally {
      setNlBusy(false);
    }
  };

  const run = async (scenario: Scenario, mode: SimRunRequest["mode"], speed: number) => {
    setRunBusy(true);
    setRunError(null);
    try {
      const r = await postJSON<{ channel: string }>("/api/sim/run", { scenario, mode, speed } satisfies SimRunRequest);
      setChannel(r.channel);
      setTab("simulate");
      const u = new URL(location.href);
      u.searchParams.set("channel", r.channel);
      history.replaceState(null, "", u);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  };

  const runForm = () => {
    const hz: Scenario["hazard"] = { kind: form.hazard, startSec: 0 };
    if (needsOrigin(form.hazard) && form.at) Object.assign(hz, { floor: form.at.floor, at: [form.at.x, form.at.y] });
    if (form.hazard === "quake") hz.damaged = form.damaged;
    if (form.hazard === "crush" && form.surgeExit) hz.surgeExit = form.surgeExit;
    const scenario: Scenario = {
      id: `ui-${form.hazard}-${params.profile}-s${form.seed}`,
      profile: params.profile,
      hazard: hz,
      behaviour: Object.fromEntries(Object.entries(params.behaviour).map(([k, v]) => [k, v.value])),
      loadFactor: params.loadFactor,
      occupancy: params.occupancy as Scenario["occupancy"],
      protocol: form.protocol,
      seed: form.seed,
      maxSec: form.maxSec,
    };
    void run(scenario, form.mode, form.speed);
  };

  const replay = (ref: ScenarioRef) => void run(ref.scenario, "rule", form.speed);

  return (
    <div className="mx-auto max-w-[1800px] space-y-3 p-3" data-testid="design-page">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="nl">Describe the occupants in plain language</label>
            <div className="mt-2 flex gap-2">
              <input
                id="nl"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void translate(); }}
                placeholder="e.g. fest night, packed, most people don't know the building"
                className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
                data-testid="nl-input"
              />
              <Button tone="primary" onClick={() => void translate()} disabled={nlBusy || !text.trim()} data-testid="nl-submit">{nlBusy ? "Reading" : "Set parameters"}</Button>
            </div>
            {nlError ? <p className="mt-1 text-xs text-red-400">{nlError}</p> : null}
          </div>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          {runError && tab !== "simulate" ? <p className="text-xs text-red-400">Replay failed: {runError}</p> : null}
          <div>
            {tab === "twin" ? <CodeCheckTab /> : null}
            {tab === "simulate" ? <SimulateTab form={form} setForm={setForm} onRun={runForm} busy={runBusy} error={runError} /> : null}
            {tab === "bottlenecks" ? <BottlenecksTab onReplay={replay} /> : null}
            {tab === "adversary" ? <AdversaryTab onReplay={replay} /> : null}
            {tab === "optimiser" ? <OptimiserTab /> : null}
            {tab === "rating" ? <RatingTab onReplay={replay} /> : null}
            {tab === "playbook" ? <PlaybookTab /> : null}
          </div>
        </div>
        <aside className="space-y-3">
          <ParamsPanel params={params} onChange={setParams} />
        </aside>
      </div>
    </div>
  );
}
