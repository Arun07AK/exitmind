import type { Params } from "../shared/params.ts";
import { Rng } from "../shared/rng.ts";
import type { Model } from "../sim/model.ts";
import type { HazardKind, HazardSpec, Occupancy, ProfileId, Protocol, Scenario } from "../sim/types.ts";

export interface ContinuousDim { key: string; kind: "behaviour" | "load" | "hazard"; lo: number; hi: number; def: number; label: string }
export interface CategoricalDim { key: string; options: string[]; def: string; label: string }
export interface Space { hazard: HazardKind; profile: ProfileId; cont: ContinuousDim[]; cat: CategoricalDim[] }
export interface Point { u: number[]; c: number[] }

export const HAZARD_PROTOCOL: Record<HazardKind, Protocol> = { none: "EVACUATE", fire: "EVACUATE", crush: "INFLOW_CONTROL", quake: "HOLD_THEN_EVACUATE", threat: "LOCKDOWN_SHELTER", medical: "INFLOW_CONTROL" };

export function protocolFor(hazard: HazardKind, profile: ProfileId, defaults: Record<ProfileId, Protocol>): Protocol {
  if (hazard === "fire" && profile === "hospital") return defaults.hospital;
  return HAZARD_PROTOCOL[hazard];
}

function zoneSites(m: Model): { id: string; floor: string; at: [number, number] }[] {
  return m.zones.map((z, zi) => {
    const fm = m.floors.find((f) => f.id === z.floor)!;
    const spaces = m.spaceInfo[fm.index]!;
    let best = -1, area = -1;
    spaces.forEach((s, si) => {
      if (!s.occupiable || s.kind !== "room") return;
      let k = 0;
      for (let i = 0; i < fm.n; i++) if (fm.space[i] === si && fm.zone[i] === zi) k++;
      if (k > area) { area = k; best = si; }
    });
    let sx = 0, sy = 0, k = 0;
    for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && (best >= 0 ? fm.space[i] === best && fm.zone[i] === zi : fm.zone[i] === zi)) { sx += fm.cx[i]!; sy += fm.cy[i]!; k++; }
    return { id: z.id, floor: z.floor, at: [Math.round((sx / Math.max(1, k)) * 10) / 10, Math.round((sy / Math.max(1, k)) * 10) / 10] as [number, number] };
  });
}

export function largestAssembly(m: Model): string | null {
  let best: string | null = null, area = 0;
  for (const f of m.spaceInfo) for (const s of f) if (s.occupiable && (s.use === "assembly" || s.kind === "lobby") && s.areaSqft > area) { area = s.areaSqft; best = s.id; }
  return best;
}

export function buildSpace(m: Model, p: Params, hazard: HazardKind, profile: ProfileId): Space {
  const cont: ContinuousDim[] = [];
  const add = (key: string, label: string) => { const e = p.entry(key); cont.push({ key, kind: "behaviour", lo: e.min, hi: e.max, def: e.value, label }); };
  add(`profile.${profile}.familiarShare`, "share who know the building");
  add(`premove.medianSec.${profile}`, "pre-movement delay (median)");
  add("sign.compliance.base", "sign compliance");
  add("herding.betaSec", "herding pull");
  add("stress.gain.hazard", "stress from hazard cues");
  add(`profile.${profile}.share.wheelchair`, "wheelchair users");
  add(`profile.${profile}.groupFraction`, "share moving in groups");
  cont.push({ key: "loadFactor", kind: "load", lo: 0.8, hi: hazard === "crush" ? 2 : 1.3, def: 1, label: "load relative to the printed occupant load" });
  if (hazard === "fire") cont.push({ key: "fire.smokeFrontSpeed", kind: "hazard", lo: 0.1, hi: 0.5, def: 0.25, label: "smoke spread speed" });
  const cat: CategoricalDim[] = [];
  const sites = zoneSites(m);
  if (hazard === "fire" || hazard === "threat" || hazard === "medical") cat.push({ key: "origin", options: sites.map((s) => s.id), def: sites[Math.floor(sites.length / 2)]!.id, label: "hazard origin zone" });
  const stairs = [...new Set(m.elements.filter((e) => e.stairId).map((e) => e.stairId!))].sort();
  const exits = m.elements.filter((e) => e.kind === "exit").map((e) => e.id);
  if (hazard === "quake") cat.push({ key: "damaged", options: ["none", ...stairs, ...exits], def: "none", label: "damaged stair or exit" });
  const asm = largestAssembly(m);
  cat.push({ key: "occupancy", options: ["uniform", "classes_full", ...(asm ? [`event_in:${asm}`] : [])], def: "uniform", label: "where people are" });
  return { hazard, profile, cont, cat };
}

export function defaultPoint(s: Space): Point {
  return { u: s.cont.map((d) => (d.def - d.lo) / (d.hi - d.lo || 1)), c: s.cat.map((d) => Math.max(0, d.options.indexOf(d.def))) };
}

export function toScenario(m: Model, s: Space, pt: Point, seed: number, id: string, protocol: Protocol, maxSec: number): Scenario {
  const behaviour: Record<string, number> = {};
  const overrides: Record<string, number> = {};
  let loadFactor = 1;
  s.cont.forEach((d, i) => {
    const v = Math.round((d.lo + (d.hi - d.lo) * Math.min(1, Math.max(0, pt.u[i]!))) * 1000) / 1000;
    if (d.kind === "behaviour") behaviour[d.key] = v; else if (d.kind === "load") loadFactor = v; else overrides[d.key] = v;
  });
  const cat = (key: string) => { const i = s.cat.findIndex((d) => d.key === key); return i >= 0 ? s.cat[i]!.options[pt.c[i]!]! : null; };
  const sites = zoneSites(m);
  let hazard: HazardSpec = { kind: s.hazard };
  const origin = cat("origin");
  if (origin) {
    const site = sites.find((x) => x.id === origin)!;
    hazard = { kind: s.hazard, floor: site.floor as HazardSpec["floor"], at: site.at };
    if (s.hazard === "threat") hazard.path = [site.at, [site.at[0] + 40, site.at[1]], [site.at[0] + 40, site.at[1] + 30]];
  }
  if (s.hazard === "quake") { const d = cat("damaged"); hazard = { kind: "quake", damaged: d && d !== "none" ? [d] : [] }; }
  if (Object.keys(overrides).length) hazard.overrides = overrides;
  return { id, profile: s.profile, hazard, behaviour, loadFactor, occupancy: (cat("occupancy") ?? "uniform") as Occupancy, protocol, seed, maxSec };
}

export function describePoint(s: Space, pt: Point): string[] {
  return [
    ...s.cont.map((d, i) => `${d.label}: ${(d.lo + (d.hi - d.lo) * pt.u[i]!).toFixed(d.hi > 10 ? 0 : 3)} (default ${d.def}, range ${d.lo}-${d.hi})`),
    ...s.cat.map((d, i) => `${d.label}: ${d.options[pt.c[i]!]} (default ${d.def})`),
  ];
}

export function samplePoint(s: Space, mean: number[], sd: number[], probs: number[][], rng: Rng): Point {
  return {
    u: s.cont.map((_, i) => { for (let k = 0; k < 20; k++) { const v = rng.normal(mean[i]!, sd[i]!); if (v >= 0 && v <= 1) return v; } return Math.min(1, Math.max(0, mean[i]!)); }),
    c: s.cat.map((_, i) => rng.weightedIndex(probs[i]!)),
  };
}
