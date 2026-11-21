import { existsSync, readFileSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";
import type { AdversaryResult, RatingResult, Scenario, ScenarioPreset } from "./contract.ts";

const read = <T>(name: string): T | null => {
  const p = repoPath("data", "design", `${name}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeScenario(sc: Scenario): string {
  const h = sc.hazard;
  const where = h.floor ? ` on ${h.floor}${h.at ? ` at (${h.at.join(", ")}) ft` : ""}` : "";
  const damaged = h.damaged?.length ? `, damaged: ${h.damaged.join(", ")}` : "";
  return `${h.kind}${where}${damaged}; ${sc.profile} crowd, occupancy ${sc.occupancy}, load ×${sc.loadFactor}, protocol ${sc.protocol}, seed ${sc.seed}`;
}

export function scenarioPresets(): ScenarioPreset[] {
  const out: ScenarioPreset[] = [];
  for (const [hz, file] of [["fire", "adversary"], ["quake", "adversary-quake"]] as const) {
    const a = read<AdversaryResult>(file);
    if (!a) continue;
    const w = a.worst.scenario.scenario, b = a.baseline.scenario.scenario;
    out.push({ id: `${hz}-worst`, label: `${cap(hz)}: adversary worst case`, hazard: w.hazard.kind, description: `${describeScenario(w)}. Worst case found by the adversary search (data/design/${file}.json, worst.scenario).`, scenario: w });
    out.push({ id: `${hz}-baseline`, label: `${cap(hz)}: ${a.baseline.scenario.label}`, hazard: b.hazard.kind, description: `${describeScenario(b)}. Baseline of the adversary search (data/design/${file}.json, baseline.scenario).`, scenario: b });
  }
  for (const c of read<RatingResult>("rating")?.cells.filter((x) => x.profile === "college") ?? []) {
    const s = c.breaking[0];
    if (!s) continue;
    out.push({ id: s.id, label: `${cap(c.hazard)}: first breaking scenario of the rating`, hazard: c.hazard, description: `${describeScenario(s.scenario)}. Recorded by the rating run (data/design/rating.json): ${s.label}.`, scenario: s.scenario });
  }
  return out;
}
