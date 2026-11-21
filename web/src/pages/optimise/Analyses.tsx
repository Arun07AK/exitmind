import { useState } from "react";
import type { ScenarioRef } from "../../../../src/server/contract.ts";
import { Tabs } from "../../components/ui.tsx";
import { navigate } from "../../router.ts";
import { useScenario } from "../../sim/scenario.ts";
import { CodeCheckTab } from "../design/CodeCheckTab.tsx";
import { AdversaryTab, BottlenecksTab, OptimiserTab, PlaybookTab, RatingTab } from "../design/ResultTabs.tsx";

const TABS = [
  { id: "bottlenecks", label: "Bottlenecks" },
  { id: "adversary", label: "Stress test" },
  { id: "optimiser", label: "Optimiser log" },
  { id: "rating", label: "Crash-test rating" },
  { id: "playbook", label: "Playbook" },
  { id: "codecheck", label: "Code check" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function Analyses() {
  const [tab, setTab] = useState<TabId>("bottlenecks");
  const busy = useScenario((s) => s.busy);
  const error = useScenario((s) => s.error);
  const onReplay = async (ref: ScenarioRef) => {
    await useScenario.getState().run(ref.scenario, ref.label);
    if (!useScenario.getState().error) navigate("/");
  };
  const replay = (ref: ScenarioRef) => { void onReplay(ref); };
  return (
    <section aria-labelledby="analyses-h" className="flex flex-col gap-3" data-testid="analyses">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="analyses-h" className="m-0 text-[15px] font-semibold">Analyses</h2>
        <span className="text-[12px] text-ink-3">the detailed design results these recommendations draw on; Replay opens a run in Simulate</span>
        {busy ? <span className="text-[12px] text-ink-2">Starting the run</span> : error ? <span className="text-[12px] text-danger-ink">{error}</span> : null}
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="min-w-0 overflow-x-auto" data-testid="analyses-body">
        {tab === "bottlenecks" ? <BottlenecksTab onReplay={replay} />
          : tab === "adversary" ? <AdversaryTab onReplay={replay} />
          : tab === "optimiser" ? <OptimiserTab />
          : tab === "rating" ? <RatingTab onReplay={replay} />
          : tab === "playbook" ? <PlaybookTab />
          : <CodeCheckTab />}
      </div>
    </section>
  );
}
