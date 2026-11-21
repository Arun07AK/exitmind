import type { SimEnv } from "../sim/run.ts";
import type { HazardKind, ProfileId, Scenario } from "../sim/types.ts";
import type { Estimate, PlaybookEntry } from "../server/contract.ts";
import { candidates } from "../live/planner.ts";
import { WORST_CASE_BEHAVIOUR } from "../live/verifier.ts";
import { outcome } from "./adversary.ts";
import type { Evaluator } from "./pool.ts";

export interface Situation { hazard: HazardKind; zone: string; blocked: string[]; profile: ProfileId }

export function situations(env: SimEnv, profiles: ProfileId[]): Situation[] {
  const m = env.model;
  const out: Situation[] = [];
  const stairs = [...new Set(m.elements.filter((e) => e.stairId).map((e) => e.stairId!))].sort();
  for (const profile of profiles) {
    for (const z of m.zones) out.push({ hazard: "fire", zone: z.id, blocked: [], profile });
    out.push({ hazard: "quake", zone: "building", blocked: [], profile });
    for (const s of stairs) out.push({ hazard: "quake", zone: "building", blocked: [s], profile });
  }
  return out;
}

function estimateFor(s: Situation): Estimate {
  return { id: "design", hazard: s.hazard, zone: s.hazard === "fire" ? s.zone : null, confidence: 1, reasons: s.blocked.length ? [`no-passage signal from ${s.blocked.join(", ")} (damage reported)`] : [], sensors: [], countsByZone: {} };
}

export async function buildPlaybook(env: SimEnv, ev: Evaluator, profiles: ProfileId[], onEntry?: (e: PlaybookEntry) => void): Promise<PlaybookEntry[]> {
  const book: PlaybookEntry[] = [];
  const seeds = [301, 302, 303];
  for (const sit of situations(env, profiles)) {
    const est = estimateFor(sit);
    const cands = candidates(env.model, est, env.hazardParams, 0, sit.profile, env.profiles);
    const hazard = sit.hazard === "fire" ? (() => { const z = env.model.zones[env.model.zoneIndex.get(sit.zone)!]!; const fm = env.model.floors.find((f) => f.id === z.floor)!; let sx = 0, sy = 0, k = 0; for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.zone[i] === env.model.zoneIndex.get(sit.zone)) { sx += fm.cx[i]!; sy += fm.cy[i]!; k++; } return { kind: "fire" as const, floor: z.floor, at: [sx / k, sy / k] as [number, number] }; })() : { kind: "quake" as const, damaged: sit.blocked };
    const base = (id: string, seed: number, extra: Partial<Scenario>): Scenario => ({ id, profile: sit.profile, hazard, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "EVACUATE", seed, maxSec: env.runtime.design.capSec, ...extra });
    const tasks = [
      ...seeds.map((s) => ({ scenario: base(`pb-nothing-${s}`, s, { routePolicy: { zones: [], closedRoutes: [], inflowClosed: [] } }) })),
      ...cands.flatMap((c) => [...seeds.map((s) => ({ scenario: base(`pb-${c.id}-${s}`, s, { protocol: c.protocol, routePolicy: c.policy }) })), { scenario: base(`pb-${c.id}-worst`, seeds[0]!, { protocol: c.protocol, routePolicy: c.policy, behaviour: WORST_CASE_BEHAVIOUR(sit.profile) }) }]),
    ];
    const res = await ev.map(tasks);
    const nothing = outcome(res.slice(0, 3), "do-nothing");
    const scored = cands.map((c, i) => {
      const r = res.slice(3 + i * 4, 3 + i * 4 + 4);
      const nominal = outcome(r.slice(0, 3), `${c.id}-nominal`), worst = outcome(r.slice(3), `${c.id}-worst`);
      return { c, nominal, worst, score: (nominal.badness + worst.badness) / 2 + (nominal.gridlock || worst.gridlock ? 1e9 : 0) };
    }).sort((a, b) => a.score - b.score);
    const best = scored[0]!;
    const entry: PlaybookEntry = {
      id: `PB-${sit.profile}-${sit.hazard}-${sit.zone}${sit.blocked.length ? `-${sit.blocked.join("+")}` : ""}`,
      situation: { hazard: sit.hazard, zone: sit.zone, blocked: sit.blocked, occupancy: "uniform", profile: sit.profile },
      protocol: best.c.protocol, policy: best.c.policy, verified: { ...best.nominal, ref: `${best.c.id} nominal (3 seeds); worst-case badness ${best.worst.badness}` }, doNothing: nothing,
      rationale: `${best.c.summary}; best of ${scored.length} candidates on 3 nominal seeds plus a low-compliance worst case (badness ${best.nominal.badness} nominal, ${best.worst.badness} worst, do-nothing ${nothing.badness}). Rejected: ${scored.slice(1).map((x) => `${x.c.protocol}${x.c.summary.includes("keeping away") ? " (avoid zone)" : ""} ${Math.round(x.score)}`).join(", ")}.`,
    };
    book.push(entry);
    onEntry?.(entry);
  }
  return book;
}
