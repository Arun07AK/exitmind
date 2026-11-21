import { existsSync, readFileSync } from "node:fs";
import type { Evaluator } from "../design/pool.ts";
import { repoPath } from "../shared/paths.ts";
import type { ClaudeLike } from "../llm/claude.ts";
import { prepareScenario } from "../design/prepare.ts";
import type { SimEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import { opusConcepts, type ConceptReport } from "./concepts.ts";
import { diagnose, type Diagnosis } from "./diagnose.ts";
import { generate, type Modification } from "./generate.ts";
import { loadArchitectConfig, search, type SearchReport } from "./search.ts";

export const ARCHITECT_DISCLAIMER = "Concepts for professional review, ranked by simulation of this model under stated assumptions. They are not a design, a structural assessment or a code approval; anything marked as needing an engineer needs one.";

export interface ArchitectReport {
  venue: string;
  createdAt: string;
  scenarios: Scenario[];
  diagnosis: Diagnosis;
  after: { alternative: string; diagnosis: Diagnosis } | null;
  modifications: Modification[];
  concepts: ConceptReport;
  search: SearchReport;
  ablation: { opusBuilt: number; opusInTop3: number; bestSource: string | null };
  disclaimer: string;
}

export function defaultScenarios(env: SimEnv, seeds = [1, 2, 3]): Scenario[] {
  if (env.twin.venue) {
    const crowd = { size: env.twin.venue.kind === "outdoor" ? 3000 : Math.max(50, Math.round(env.twin.codeBasis.grossAreaSqft.F1 / 15)), ages: { young_adult: 0.7, adult: 0.3 }, roles: { student: 0.6, visitor: 0.35, staff: 0.05 }, placement: env.twin.venue.stage ? "stage_front" as const : "uniform" as const };
    return seeds.map((seed) => ({ id: `venue-${seed}`, profile: "college", crowd, hazard: { kind: "none" }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed, maxSec: 900 }));
  }
  const adv = repoPath("data", "design", "adversary-fire.json");
  const worst = env.twin.id === "rinker-hall" && existsSync(adv) ? (JSON.parse(readFileSync(adv, "utf8")) as { worst?: { scenario?: { scenario?: Scenario } } }).worst?.scenario?.scenario : undefined;
  const hard = worst ? [1, 2].map((k) => ({ ...worst, id: `adversary-worst-fire-${k}`, seed: 500 + k, edits: [] })) : [];
  return [...hard, ...seeds.flatMap((seed) => [
    { id: `drill-${seed}`, profile: "college" as const, hazard: { kind: "none" as const }, behaviour: {}, loadFactor: 1.2, occupancy: "classes_full" as const, protocol: "EVACUATE" as const, seed, maxSec: 900 },
    { id: `fire-${seed}`, profile: "college" as const, hazard: { kind: "fire" as const, floor: "F2" as const, at: [55, 20] as [number, number] }, behaviour: {}, loadFactor: 1.2, occupancy: "classes_full" as const, protocol: "EVACUATE" as const, seed: seed + 100, maxSec: 900 },
  ])];
}

export async function architect(env: SimEnv, ev: Evaluator, claude: ClaudeLike, o: { scenarios?: Scenario[]; useOpus?: boolean; log?: (s: string) => void } = {}): Promise<ArchitectReport> {
  const log = o.log ?? (() => {});
  const scenarios = o.scenarios ?? defaultScenarios(env);
  log(`diagnosing ${scenarios.length} runs`);
  const diagnosis = diagnose(env, scenarios);
  const g = { twin: env.twin, model: env.model, diagnosis };
  const rule = generate(g);
  log(`${rule.length} rule-based proposals`);
  const concepts = o.useOpus === false ? { model: "-", interpretation: null, proposed: 0, built: [], rejected: [], note: "Opus disabled for this run (--no-opus)." } : await opusConcepts(diagnosis, g, claude);
  log(`Opus: ${concepts.proposed} concepts, ${concepts.built.length} built, ${concepts.rejected.length} rejected${concepts.note ? ` (${concepts.note})` : ""}`);
  const geoKey = (m: Modification) => `${m.kind}|${m.viz.map((v) => `${v.floor}:${(v.segment ?? v.polygon ?? []).map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(";")}`).join("|")}`;
  const ruleKeys = new Map(rule.map((m) => [geoKey(m), m]));
  const opusOnly: Modification[] = [];
  for (const m of concepts.built) {
    const twin = ruleKeys.get(geoKey(m));
    if (twin) { twin.source = "opus"; twin.why = `${m.why.split(" (")[0]} (also found by the rule-based generators)`; } else opusOnly.push(m);
  }
  const mods = [...opusOnly, ...rule];
  const cfg = loadArchitectConfig();
  const ordered = [...rule.filter((m) => m.source === "opus"), ...opusOnly.slice(0, Math.ceil(cfg.search.maxSingles / 2)), ...rule.filter((m) => m.source !== "opus")].slice(0, cfg.search.maxSingles);
  const report = await search(env, ev, scenarios, ordered, { config: cfg, log });
  const best = report.alternatives.find((a) => a.source === "simulated");
  let after: ArchitectReport["after"] = null;
  if (best) {
    const edits = best.mods.map((id) => mods.find((m) => m.id === id)!.edit);
    const { model } = prepareScenario(env, { ...scenarios[0]!, edits });
    after = { alternative: best.id, diagnosis: diagnose(env, scenarios.map((s) => ({ ...s, edits })), { model }) };
  }
  const top3 = report.alternatives.slice(0, 3);
  const src = (id: string) => mods.find((m) => m.id === id)?.source;
  return {
    venue: env.twin.id, createdAt: new Date().toISOString(), scenarios, diagnosis, after, modifications: mods, concepts, search: report,
    ablation: { opusBuilt: concepts.built.length, opusInTop3: top3.filter((a) => a.mods.some((id) => src(id) === "opus")).length, bestSource: best ? (best.mods.some((id) => src(id) === "opus") ? "includes an Opus concept" : "rule-based only") : null },
    disclaimer: ARCHITECT_DISCLAIMER,
  };
}
