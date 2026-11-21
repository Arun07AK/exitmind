import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Params } from "../shared/params.ts";
import { repoPath } from "../shared/paths.ts";
import type { Rng } from "../shared/rng.ts";
import type { Model } from "./model.ts";
import { PROTOCOLS, type ProfileId, type Scenario } from "./types.ts";

export const AGES = ["child", "young_adult", "adult", "older_adult"] as const;
export const ROLES = ["student", "visitor", "staff", "teacher", "nurse", "patient", "shopper"] as const;
export const MOBILITY = ["unimpaired", "slow", "crutches", "wheelchair", "assisted_patient"] as const;
export const STAFF_ROLES = new Set(["staff", "teacher", "nurse"]);

const Mix = z.record(z.string(), z.number().nonnegative());
const Profile = z.strictObject({
  label: z.string(),
  load: z.enum(["printed", "sqftPerPerson"]),
  ages: Mix,
  roles: Mix,
  defaultProtocol: z.enum(PROTOCOLS),
  assistedEvacuation: z.boolean(),
});
export type Profile = z.infer<typeof Profile>;
export type Profiles = Record<ProfileId, Profile>;

export function loadProfiles(path = repoPath("config", "profiles.json")): Profiles {
  return z.record(z.string(), Profile).parse(JSON.parse(readFileSync(path, "utf8"))) as Profiles;
}

export const PRINTED_LOADS: Record<string, number> = { F1: 154, F2: 157, F3: 151 };

export interface Person {
  floor: number;
  cell: number;
  space: number;
  age: number;
  role: number;
  mobility: number;
  familiar: boolean;
  group: number;
  entry: string | null;
}

function pickMix(rng: Rng, mix: Record<string, number>, names: readonly string[]): number {
  const keys = Object.keys(mix);
  const k = keys[rng.weightedIndex(keys.map((key) => mix[key] as number))] as string;
  const i = names.indexOf(k);
  if (i < 0) throw new Error(`unknown category ${k}`);
  return i;
}

function spaceWeight(m: Model, fi: number, si: number, occupancy: Scenario["occupancy"]): number {
  const s = m.spaceInfo[fi]![si]!;
  if (!s.occupiable || s.areaSqft <= 0) return 0;
  if (occupancy.startsWith("event_in:")) return occupancy.slice(9) === s.id ? s.areaSqft * 12 : s.areaSqft * 0.25;
  if (occupancy === "classes_full") return s.areaSqft * (s.use === "classroom" || s.use === "lab" || s.use === "assembly" ? 2.5 : 0.4);
  if (occupancy === "after_hours") return s.areaSqft * (s.use === "office" ? 1 : 0.2);
  return s.kind === "corridor" || s.kind === "lobby" ? s.areaSqft * 0.3 : s.areaSqft;
}

export function floorLoads(m: Model, sc: Scenario, profile: Profile, params: Params): number[] {
  const factor = sc.loadFactor;
  if (sc.zoneCounts) {
    return m.floors.map((f) => Object.entries(sc.zoneCounts!).reduce((a, [z, c]) => a + (m.zones[m.zoneIndex.get(z) ?? -1]?.floor === f.id ? c : 0), 0));
  }
  if (profile.load === "printed") return m.floors.map((f) => Math.round((PRINTED_LOADS[f.id] ?? 0) * factor * (sc.occupancy === "after_hours" ? 0.3 : 1)));
  const sqft = params.get(`profile.${sc.profile}.sqftPerPerson`);
  return m.floors.map((f) => {
    const area = m.spaceInfo[f.index]!.filter((s) => s.occupiable && s.kind !== "corridor" && s.kind !== "lobby").reduce((a, s) => a + s.areaSqft, 0);
    return Math.round((area / sqft) * factor * (sc.occupancy === "after_hours" ? 0.3 : 1));
  });
}

const ROLE_FAMILIAR: Record<string, number> = { staff: 1, teacher: 1, nurse: 1, student: 0.8, visitor: 0.1, patient: 0.5, shopper: 0.3 };

function crowdPopulation(m: Model, sc: Scenario, rng: Rng): Person[] {
  const c = sc.crowd!;
  const venue = m.twin.venue;
  const stage = venue?.stage ?? null;
  const sx = stage ? stage.reduce((a, p) => a + p[0], 0) / stage.length : 0, sy = stage ? stage.reduce((a, p) => a + p[1], 0) / stage.length : 0;
  const keys: { k: number; f: number; c: number }[] = [];
  m.floors.forEach((fm, fi) => {
    for (let i = 0; i < fm.n; i++) {
      if (!fm.walkable[i] || fm.headFlight[i] >= 0 || fm.exitPortal[i] >= 0) continue;
      const si = fm.space[i]!;
      if (si < 0 || !m.spaceInfo[fi]![si]!.occupiable) continue;
      const w = c.placement === "stage_front" && stage && fi === 0 ? Math.exp(-Math.hypot(fm.cx[i]! - sx, fm.cy[i]! - sy) / 90) + 0.03 : 1;
      keys.push({ k: -Math.log(1 - rng.next()) / w, f: fi, c: i });
    }
  });
  keys.sort((a, b) => a.k - b.k || a.f - b.f || a.c - b.c);
  const n = Math.min(c.size, Math.floor(keys.length * 0.6));
  const chosen = keys.slice(0, n).sort((a, b) => a.f - b.f || a.c - b.c);
  const roles = Object.keys(c.roles).length ? c.roles : { student: 1 };
  const ages = Object.keys(c.ages).length ? c.ages : { young_adult: 1 };
  const mob = { slow: c.mobility?.slow ?? 0.02, crutches: c.mobility?.crutches ?? 0.005, wheelchair: c.mobility?.wheelchair ?? 0.005 };
  const mains = venue?.mainGates.length ? venue.mainGates : null, staffG = venue?.staffGates.length ? venue.staffGates : null;
  const people: Person[] = chosen.map(({ f, c: cell }) => {
    const role = pickMix(rng, roles as Record<string, number>, ROLES);
    const rn = ROLES[role] as string;
    const staff = STAFF_ROLES.has(rn);
    const u = rng.next();
    const mobility = staff ? 0 : u < mob.wheelchair ? 3 : u < mob.wheelchair + mob.crutches ? 2 : u < mob.wheelchair + mob.crutches + mob.slow ? 1 : 0;
    const familiar = rng.bool(c.familiar?.[rn as "student"] ?? ROLE_FAMILIAR[rn] ?? 0.5);
    const entry = staff && staffG ? rng.pick(staffG) : mains ? rng.pick(mains) : null;
    return { floor: f, cell, space: m.floors[f]!.space[cell]!, age: pickMix(rng, ages as Record<string, number>, AGES), role, mobility, familiar, group: -1, entry };
  });
  const gf = c.groupFraction ?? 0.45;
  let gid = 0;
  for (let k = 0; k < people.length;) {
    if (!rng.bool(gf)) { k++; continue; }
    const size = Math.min(people.length - k, 2 + rng.int(3));
    if (size < 2) break;
    for (let j = 0; j < size; j++) people[k + j]!.group = gid;
    gid++;
    k += size;
  }
  return people;
}

export function buildPopulation(m: Model, sc: Scenario, profile: Profile, params: Params, rng: Rng): Person[] {
  if (sc.crowd) return crowdPopulation(m, sc, rng);
  const people: Person[] = [];
  const loads = floorLoads(m, sc, profile, params);
  const pk = (k: string) => params.get(`profile.${sc.profile}.${k}`);
  m.floors.forEach((fm, fi) => {
    const load = loads[fi] as number;
    if (load <= 0) return;
    const spaces = m.spaceInfo[fi]!;
    let weights = spaces.map((_, si) => spaceWeight(m, fi, si, sc.occupancy));
    if (sc.zoneCounts) {
      weights = spaces.map(() => 0);
    }
    const cellsBySpace: number[][] = spaces.map(() => []);
    for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.space[i] >= 0 && fm.headFlight[i] < 0 && fm.exitPortal[i] < 0) cellsBySpace[fm.space[i] as number]!.push(i);
    const free = cellsBySpace.map((c) => rng.shuffled(c));
    const used = new Uint8Array(fm.n);
    const place = (si: number): number => {
      const list = free[si]!;
      while (list.length) {
        const c = list.pop() as number;
        if (!used[c]) { used[c] = 1; return c; }
      }
      return -1;
    };
    if (sc.zoneCounts) {
      for (const [z, count] of Object.entries(sc.zoneCounts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const zi = m.zoneIndex.get(z);
        if (zi === undefined || m.zones[zi]!.floor !== fm.id) continue;
        const cand: number[] = [];
        for (let i = 0; i < fm.n; i++) if (fm.zone[i] === zi && fm.walkable[i] && fm.headFlight[i] < 0 && fm.exitPortal[i] < 0 && spaces[fm.space[i] as number]?.occupiable) cand.push(i);
        const order = rng.shuffled(cand);
        for (let k = 0; k < Math.min(count, order.length); k++) {
          const c = order[k] as number;
          used[c] = 1;
          people.push({ floor: fi, cell: c, space: fm.space[c] as number, age: 0, role: 0, mobility: 0, familiar: false, group: -1, entry: null });
        }
      }
      return;
    }
    for (let k = 0; k < load; k++) {
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) break;
      const si = rng.weightedIndex(weights);
      const c = place(si);
      if (c < 0) { weights[si] = 0; k--; continue; }
      people.push({ floor: fi, cell: c, space: si, age: 0, role: 0, mobility: 0, familiar: false, group: -1, entry: null });
    }
  });
  const shares = { slow: pk("share.slow"), crutches: pk("share.crutches"), wheelchair: pk("share.wheelchair"), patient: sc.profile === "hospital" ? pk("share.assistedPatient") : 0 };
  const roleMix = { ...profile.roles };
  for (const p of people) {
    p.role = pickMix(rng, roleMix, ROLES);
    const roleName = ROLES[p.role] as string;
    p.age = pickMix(rng, profile.ages, AGES);
    const u = rng.next();
    p.mobility = roleName === "patient" && rng.bool(shares.patient / Math.max(1e-9, (profile.roles.patient ?? 1)))
      ? 4
      : u < shares.wheelchair ? 3 : u < shares.wheelchair + shares.crutches ? 2 : u < shares.wheelchair + shares.crutches + shares.slow ? 1 : 0;
    if (STAFF_ROLES.has(ROLES[p.role] as string)) p.mobility = 0;
    p.familiar = STAFF_ROLES.has(ROLES[p.role] as string) || rng.bool(pk("familiarShare"));
  }
  const groupFraction = pk("groupFraction");
  const bySpace = new Map<string, number[]>();
  people.forEach((p, i) => {
    const key = `${p.floor}:${p.space}`;
    bySpace.set(key, [...(bySpace.get(key) ?? []), i]);
  });
  let gid = 0;
  for (const key of [...bySpace.keys()].sort()) {
    const members = bySpace.get(key)!.filter((i) => rng.bool(groupFraction));
    for (let k = 0; k + 1 < members.length;) {
      const size = Math.min(members.length - k, 2 + rng.int(3));
      if (size < 2) break;
      for (let j = 0; j < size; j++) people[members[k + j] as number]!.group = gid;
      gid++;
      k += size;
    }
  }
  return people;
}
