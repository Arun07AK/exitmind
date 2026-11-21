import { buildModel, type Model } from "../sim/model.ts";
import type { SimEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import { GEOMETRY_EDITS, applyEdits, type ExitCandidate } from "../twin/edit.ts";
import { protocolPolicy } from "./protocols.ts";

const models = new Map<string, Model>();
let candidates: readonly ExitCandidate[] = [];
export function setExitCandidates(c: readonly ExitCandidate[]): void { candidates = c; }
export function exitCandidates(): readonly ExitCandidate[] { return candidates; }

export function modelFor(env: SimEnv, sc: Pick<Scenario, "edits">): Model {
  const geo = (sc.edits ?? []).filter((e) => GEOMETRY_EDITS.has(e.kind));
  if (!geo.length) return env.model;
  const key = JSON.stringify(geo);
  let m = models.get(key);
  if (!m) {
    m = buildModel(applyEdits(env.twin, geo, candidates));
    if (models.size > 64) models.clear();
    models.set(key, m);
  }
  return m;
}

export function prepareScenario(env: SimEnv, sc: Scenario): { scenario: Scenario; model: Model } {
  const model = modelFor(env, sc);
  const strategy = (sc.edits ?? []).filter((e) => e.kind === "strategy").at(-1);
  const protocol = strategy?.protocol ?? sc.protocol;
  const routePolicy = sc.routePolicy ?? (protocol === "EVACUATE" ? undefined : protocolPolicy(model, protocol, sc.hazard, env.hazardParams));
  return { scenario: { ...sc, protocol, ...(routePolicy ? { routePolicy } : {}) }, model };
}
