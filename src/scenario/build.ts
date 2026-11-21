import type { Params } from "../shared/params.ts";
import type { Model } from "../sim/model.ts";
import type { CrowdSpec, HazardSpec, Protocol, Scenario } from "../sim/types.ts";
import type { Profiles } from "../sim/population.ts";
import { protocolFor } from "../design/space.ts";
import type { Spec } from "./spec.ts";

const DEFAULT_ROLES: Record<string, { student: number; visitor: number; staff: number }> = {
  concert: { student: 0.65, visitor: 0.3, staff: 0.05 }, fest: { student: 0.6, visitor: 0.35, staff: 0.05 }, lecture: { student: 0.95, visitor: 0, staff: 0.05 },
  exam: { student: 0.95, visitor: 0, staff: 0.05 }, sports: { student: 0.6, visitor: 0.35, staff: 0.05 }, conference: { student: 0.2, visitor: 0.7, staff: 0.1 },
  exhibition: { student: 0.3, visitor: 0.65, staff: 0.05 }, other: { student: 0.5, visitor: 0.45, staff: 0.05 },
};
const LEVEL = { low: 0, normal: 2, high: 4 } as const;

function zoneCentre(m: Model, zoneId: string): { floor: HazardSpec["floor"]; at: [number, number] } | null {
  const zi = m.zoneIndex.get(zoneId);
  if (zi === undefined) return null;
  const z = m.zones[zi]!, fm = m.floors.find((f) => f.id === z.floor)!;
  let sx = 0, sy = 0, k = 0;
  for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.zone[i] === zi) { sx += fm.cx[i]!; sy += fm.cy[i]!; k++; }
  return k ? { floor: z.floor, at: [Math.round((sx / k) * 10) / 10, Math.round((sy / k) * 10) / 10] } : null;
}

export interface Built { scenario: Scenario; assumptions: string[]; crowd: CrowdSpec }

export function buildScenario(spec: Spec, m: Model, params: Params, profiles: Profiles, seed = 1): Built {
  const assumptions: string[] = [];
  const eventType = spec.eventType ?? "other";
  const norm = <T extends Record<string, number>>(o: T): T => { const s = Object.values(o).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round((v / s) * 1000) / 1000])) as T; };
  const roles = spec.roles ? norm(spec.roles) : DEFAULT_ROLES[eventType]!;
  if (!spec.roles) assumptions.push(`Crowd mix for a ${eventType}: ${Math.round(roles.student * 100)}% regulars who know the venue, ${Math.round(roles.visitor * 100)}% first-time visitors, ${Math.round(roles.staff * 100)}% staff and volunteers.`);
  const familiar = spec.familiarity ?? { student: 0.8, visitor: 0.1, staff: 1 };
  if (!spec.familiarity) assumptions.push("Familiarity: 80% of regulars, 10% of first-time visitors and all staff know the other exits.");
  const venue = m.twin.venue;
  const placement = venue?.stage && (eventType === "concert" || eventType === "fest") ? "stage_front" : "uniform";
  if (placement === "stage_front") assumptions.push("Most of the crowd stands in front of the stage, thinning towards the back.");
  if (venue) assumptions.push(`Attendees came in through the main gate${venue.mainGates.length > 1 ? "s" : ""} (${venue.mainGates.join(", ")}); staff through ${venue.staffGates.join(", ") || "any gate"}.`);
  const crowd: CrowdSpec = {
    size: spec.crowdSize!, ages: norm(spec.ages!), roles, familiar,
    ...(spec.mobility ? { mobility: spec.mobility } : {}), groupFraction: eventType === "concert" || eventType === "fest" ? 0.55 : 0.35, placement,
  };
  if (!spec.mobility) assumptions.push("Mobility: 2% walk slowly, 0.5% use crutches, 0.5% use wheelchairs.");
  const kind = spec.emergency ?? "fire";
  let hazard: HazardSpec = { kind };
  const where = spec.emergencyWhere ? zoneCentre(m, spec.emergencyWhere) : null;
  const fallbackZone = m.zones[Math.floor(m.zones.length / 2)]!.id;
  if (kind === "fire" || kind === "threat" || kind === "medical") {
    const loc = where ?? zoneCentre(m, fallbackZone)!;
    if (!where) assumptions.push(`The ${kind === "fire" ? "fire starts" : kind === "threat" ? "threat appears" : "medical emergency happens"} in ${m.zones[m.zoneIndex.get(fallbackZone)!]!.name} (${fallbackZone}).`);
    hazard = { kind, floor: loc.floor, at: loc.at, ...(kind === "threat" ? { path: [loc.at, [loc.at[0] + 60, loc.at[1]], [loc.at[0] + 60, loc.at[1] + 60]] } : {}) };
  } else if (kind === "quake") hazard = { kind, damaged: spec.blockedExits };
  if (!spec.emergency) assumptions.push("No emergency type given: simulating a fire.");
  const defaults = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.defaultProtocol])) as Record<keyof Profiles, Protocol>;
  const profile = "college" as const;
  const protocol = protocolFor(kind, profile, defaults);
  const behaviour: Record<string, number> = {};
  const lerp = (key: string, level: number, invert = false) => { const e = params.entry(key); behaviour[key] = params.clamp(key, Math.round((e.min + ((e.max - e.min) * (invert ? 4 - level : level)) / 4) * 1000) / 1000); };
  if (spec.compliance) lerp("sign.compliance.base", LEVEL[spec.compliance]);
  if (spec.urgency) lerp("premove.medianSec.college", LEVEL[spec.urgency], true);
  for (const c of spec.conditions) assumptions.push(`Condition noted but not modelled directly: ${c}.`);
  const scenario: Scenario = {
    id: `custom-${eventType}-${seed}`, profile, crowd, ...(spec.blockedExits.length && kind !== "quake" ? { blockedExits: spec.blockedExits } : {}),
    hazard, behaviour, loadFactor: 1, occupancy: "uniform", protocol, seed, maxSec: 900,
  };
  return { scenario, assumptions, crowd };
}
