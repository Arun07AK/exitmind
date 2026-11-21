import { pointInPolygon } from "../shared/geom.ts";
import type { Model } from "../sim/model.ts";
import type { Edit } from "../sim/types.ts";
import type { Exit, FloorId, GeometryPatch, Portal, Pt, Space, SourceRef, Stair, Twin } from "../twin/schema.ts";
import type { Diagnosis, Hotspot } from "./diagnose.ts";

export type ModKind = "new_exit" | "external_stair" | "connecting_passage" | "remove_partition" | "second_door" | "ramp" | "widen_door" | "widen_stair" | "widen_corridor";
export interface Shape { floor: string; kind: "construct" | "remove" | "modify"; polygon?: Pt[]; segment?: [Pt, Pt]; label: string }
export interface Quantities { doorsAdded?: number; wallOpeningM2?: number; partitionRemovedM?: number; newFloorM2?: number; stairFlights?: number; rampM?: number; widenedIn?: number; roomsCrossed?: number }
export interface Modification {
  id: string;
  kind: ModKind;
  title: string;
  why: string;
  hotspot: string | null;
  source: "generator" | "opus";
  edit: Edit;
  quantities: Quantities;
  structural: "none" | "partition" | "structural";
  needsEngineer: boolean;
  accessibility: -1 | 0 | 1;
  regulations: string[];
  viz: Shape[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const len = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a: Pt, b: Pt, t: number): Pt => [r1(a[0] + (b[0] - a[0]) * t), r1(a[1] + (b[1] - a[1]) * t)];
const edges = (poly: Pt[]) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as [Pt, Pt]);
function segPointDist(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t };
}
const centroid = (poly: Pt[]): Pt => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
const ROOM_COST: Record<string, number> = { corridor: 1, lobby: 1, service: 2.5, room: 5, stair: Infinity, elevator: Infinity, exterior: Infinity };
const USE_COST: Record<string, number> = { storage: 1.5, circulation: 1, service: 2.5, office: 4, assembly: 5, classroom: 6, lab: 6, retail: 4, ward: Infinity, restroom: Infinity };
const spaceCost = (s: Space) => Math.max(ROOM_COST[s.kind] ?? 5, s.kind === "corridor" || s.kind === "lobby" ? 1 : USE_COST[s.use] ?? 5);
const ASSUMED = (note: string): SourceRef => ({ sheet: "OSM", basis: "assumed", note: `EXITMIND proposal: ${note}` });
const src = (twin: Twin, note: string): SourceRef => ({ sheet: twin.floors[0]?.spaces[0]?.src.sheet ?? "OSM", basis: "assumed", note: `EXITMIND proposal: ${note}` });

/** Walls on the drawing's structural grid (Rinker grid lines) or the outer wall count as structural; other partitions do not. */
export function structuralKind(twin: Twin, a: Pt, b: Pt, onOutline: boolean): "partition" | "structural" {
  if (onOutline) return "structural";
  const gx = Object.values(twin.frame.gridX), gy = Object.values(twin.frame.gridY);
  const vertical = Math.abs(a[0] - b[0]) < 0.8, horizontal = Math.abs(a[1] - b[1]) < 0.8;
  if (vertical && gx.some((x) => Math.abs(x - a[0]) < 1.2)) return "structural";
  if (horizontal && gy.some((y) => Math.abs(y - a[1]) < 1.2)) return "structural";
  return "partition";
}

/** Shared wall segments between two spaces on one floor (colinear edges overlapping by at least minFt). */
export function sharedWalls(A: Space, B: Space, minFt = 3.5): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (const [a, b] of edges(A.polygon)) for (const [c, d] of edges(B.polygon)) {
    if (segPointDist(c, a, b).d > 0.8 || segPointDist(d, a, b).d > 0.8) {
      if (segPointDist(a, c, d).d > 0.8 || segPointDist(b, c, d).d > 0.8) continue;
    }
    const L = len(a, b) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uy, td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uy;
    const t0 = Math.max(0, Math.min(tc, td)), t1 = Math.min(L, Math.max(tc, td));
    if (t1 - t0 >= minFt) out.push([lerp(a, b, t0 / L), lerp(a, b, t1 / L)]);
  }
  return out;
}

function outlineEdgesOf(twin: Twin, floor: FloorId, s: Space): [Pt, Pt][] {
  const f = twin.floors.find((x) => x.id === floor)!;
  const out: [Pt, Pt][] = [];
  for (const [a, b] of edges(s.polygon)) for (const [c, d] of edges(f.outline)) {
    if (segPointDist(a, c, d).d < 1 && segPointDist(b, c, d).d < 1 && len(a, b) >= 6) { out.push([a, b]); break; }
  }
  return out;
}

function doorOn(seg: [Pt, Pt], at: number, widthFt: number): [Pt, Pt] {
  const L = len(seg[0], seg[1]), h = Math.min(widthFt / 2, L / 2 - 0.5) / L;
  return [lerp(seg[0], seg[1], at - h), lerp(seg[0], seg[1], at + h)];
}

/** Best position on a wall segment: nearest the target point, at least 2.5 ft from grid lines and wall ends. */
function bestOn(twin: Twin, seg: [Pt, Pt], target: Pt, widthFt: number): number | null {
  const L = len(seg[0], seg[1]);
  if (L < widthFt + 2) return null;
  const gx = Object.values(twin.frame.gridX), gy = Object.values(twin.frame.gridY);
  let best: number | null = null, bd = Infinity;
  for (let k = 0; k <= 40; k++) {
    const t = (widthFt / 2 + 1 + ((L - widthFt - 2) * k) / 40) / L;
    const p = lerp(seg[0], seg[1], t);
    if (gx.some((x) => Math.abs(x - p[0]) < widthFt / 2 + 1.5 && Math.abs(seg[0][0] - seg[1][0]) > 0.8) || gy.some((y) => Math.abs(y - p[1]) < widthFt / 2 + 1.5 && Math.abs(seg[0][1] - seg[1][1]) > 0.8)) continue;
    const d = len(p, target);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

export interface GenContext { twin: Twin; model: Model; diagnosis: Diagnosis }

let counter = 0;
const mid = (k: string) => `M${++counter}-${k}`;

export function genNewExits(g: GenContext, h: Hotspot): Modification[] {
  const { twin } = g;
  const f1 = twin.floors[0]!;
  if (h.floor !== f1.id && twin.floors.length > 1) return [];
  const target = h.centroid;
  const existing = twin.exits.filter((e) => e.floor === f1.id && e.kind === "exterior").map((e) => { const p = f1.portals.find((x) => x.id === e.portal)!; return centroid([p.a, p.b]); });
  const cands: { s: Space; seg: [Pt, Pt]; t: number; d: number }[] = [];
  for (const s of f1.spaces) {
    if (!["room", "corridor", "lobby", "stair"].includes(s.kind)) continue;
    for (const seg of outlineEdgesOf(twin, f1.id, s)) {
      const t = bestOn(twin, seg, target, 6);
      if (t === null) continue;
      const p = lerp(seg[0], seg[1], t);
      if (existing.some((e) => len(e, p) < 30)) continue;
      cands.push({ s, seg, t, d: len(p, target) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  return cands.slice(0, 3).map((c) => {
    const id = mid("exit");
    const [a, b] = doorOn(c.seg, c.t, 6);
    const pid = `X-${id}`;
    const portal: Portal = { id: pid, floor: f1.id, kind: "door", a, b, clearWidthIn: 68, connects: [c.s.id, "OUTSIDE"], accessible: true, src: src(twin, "new exterior door pair (2 x 34 in leaves)") };
    const exit: Exit = { id: `EX-${id}`, name: `New exit from ${c.s.name}`, floor: f1.id, kind: "exterior", portal: pid, src: portal.src };
    return {
      id, kind: "new_exit", title: c.s.kind === "stair" ? `Direct exit to outside from ${c.s.name} ${c.s.id} (68 in door pair at the foot of the stair)` : `New exterior exit (68 in door pair) from ${c.s.name} ${c.s.id}`, hotspot: h.id, source: "generator",
      why: `Gives the people queuing at ${h.element?.name ?? h.id} a second way out ${r1(c.d)} ft from the queue, instead of waiting for a door that passes at most ${h.capacityPps ?? "?"} people/s.`,
      edit: { kind: "geometry", target: id, patch: { addPortals: [portal], addExits: [exit] } },
      quantities: { doorsAdded: 1, wallOpeningM2: r1(1.73 * 2.1) }, structural: "structural", needsEngineer: true, accessibility: 1,
      regulations: ["Opening in an exterior wall: lintel/header and wall bracing need a structural engineer.", "New exit must open in the direction of travel, have panic hardware where the room serves 50+ people, and lead to a public way (NFPA 101 7.2.1; verify against the adopted code).", "Keeps at least 30 ft from existing exits (remoteness)."],
      viz: [{ floor: f1.id, kind: "construct", segment: [a, b], label: "new exit door" }],
    };
  });
}

export function genExternalStair(g: GenContext, h: Hotspot): Modification[] {
  const { twin } = g;
  if (twin.floors.length < 2 || h.floor === twin.floors[0]!.id) return [];
  const upper = twin.floors.filter((f) => f.id !== twin.floors[0]!.id);
  const fh = twin.floors.find((f) => f.id === h.floor)!;
  const cands: { s: Space; seg: [Pt, Pt]; t: number; d: number }[] = [];
  for (const s of fh.spaces) {
    if (!["corridor", "lobby", "room"].includes(s.kind)) continue;
    for (const seg of outlineEdgesOf(twin, fh.id, s)) {
      const t = bestOn(twin, seg, h.centroid, 16);
      if (t === null) continue;
      const p = lerp(seg[0], seg[1], t);
      const ok = twin.floors.every((f) => edges(f.outline).some(([c, d]) => segPointDist(p, c, d).d < 1.5));
      if (ok) cands.push({ s, seg, t, d: len(p, h.centroid) * (s.kind === "room" ? 1.5 : 1) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const clear = (cc: (typeof cands)[number]) => {
    const L0 = len(cc.seg[0], cc.seg[1]), ux0 = (cc.seg[1][0] - cc.seg[0][0]) / L0, uy0 = (cc.seg[1][1] - cc.seg[0][1]) / L0;
    const ctr = lerp(cc.seg[0], cc.seg[1], cc.t), ins = centroid(fh.outline);
    let nx0 = -uy0, ny0 = ux0;
    if ((ins[0] - ctr[0]) * nx0 + (ins[1] - ctr[1]) * ny0 > 0) { nx0 = -nx0; ny0 = -ny0; }
    for (let a = -7.5; a <= 7.5; a += 1.5) for (let o = 0.6; o <= 9.6; o += 1.5) {
      const p: Pt = [ctr[0] + ux0 * a + nx0 * o, ctr[1] + uy0 * a + ny0 * o];
      if (twin.floors.some((f) => f.spaces.some((sp) => pointInPolygon(p[0], p[1], sp.polygon)) || pointInPolygon(p[0], p[1], f.outline))) return false;
    }
    return true;
  };
  const c = cands.find(clear);
  if (!c) return [];
  const id = mid("xstair");
  const L = len(c.seg[0], c.seg[1]), ux = (c.seg[1][0] - c.seg[0][0]) / L, uy = (c.seg[1][1] - c.seg[0][1]) / L;
  const centre = lerp(c.seg[0], c.seg[1], c.t);
  const inside = centroid(fh.outline);
  let nx = -uy, ny = ux;
  if ((inside[0] - centre[0]) * nx + (inside[1] - centre[1]) * ny > 0) { nx = -nx; ny = -ny; }
  const P = (along: number, out: number): Pt => [r1(centre[0] + ux * along + nx * out), r1(centre[1] + uy * along + ny * out)];
  const hosts = twin.floors.map((f) => {
    const host = f.spaces.filter((sp) => sp.kind !== "stair" && sp.kind !== "elevator").map((sp) => ({ sp, segs: outlineEdgesOf(twin, f.id, sp).filter(([a, b]) => segPointDist(centre, a, b).d < 1.5) })).find((x) => x.segs.length);
    if (!host) return null;
    const [a, b] = host.segs[0]!;
    const q = segPointDist(centre, a, b), qp: Pt = [a[0] + (b[0] - a[0]) * q.t, a[1] + (b[1] - a[1]) * q.t];
    return { f, space: host.sp, off: (qp[0] - centre[0]) * nx + (qp[1] - centre[1]) * ny };
  });
  if (hosts.some((x) => !x)) return [];
  const offMax = Math.max(...hosts.map((x) => x!.off));
  const foot = [P(-8, offMax), P(8, offMax), P(8, offMax + 10), P(-8, offMax + 10)];
  const head = [P(-7.5, offMax + 1), P(-4, offMax + 1), P(-4, offMax + 5), P(-7.5, offMax + 5)], landing = [P(-7.5, offMax + 5.5), P(-4, offMax + 5.5), P(-4, offMax + 9.5), P(-7.5, offMax + 9.5)];
  const spaces: Space[] = [], portals: Portal[] = [], exits: Exit[] = [];
  const stairSpaces: Partial<Record<FloorId, string>> = {};
  for (const hh of hosts) {
    const { f, space, off } = hh!;
    const sid = `S-${id}-${f.id}`;
    stairSpaces[f.id] = sid;
    spaces.push({ id: sid, name: `New external stair (${f.id})`, floor: f.id, kind: "stair", use: "circulation", polygon: [P(-8, off), P(8, off), P(8, offMax + 10), P(-8, offMax + 10)], occupiable: false, lockable: false, src: src(twin, "external stair footprint 16 x 10 ft") });
    const pid = `D-${id}-${f.id}`;
    portals.push({ id: pid, floor: f.id, kind: "door", a: P(-2, off), b: P(2, off), clearWidthIn: 44, connects: [space.id, sid], accessible: false, src: src(twin, "fire-rated door to the new stair") });
    if (f.id !== twin.floors[0]!.id) exits.push({ id: `EX-${id}-${f.id}`, name: `New external stair (${f.id})`, floor: f.id, kind: "stair", portal: pid, stair: `ST-${id}`, src: src(twin, "stair exit") });
  }
  const f1 = twin.floors[0]!;
  const xp = `X-${id}`;
  portals.push({ id: xp, floor: f1.id, kind: "door", a: P(2.5, offMax + 10), b: P(6.5, offMax + 10), clearWidthIn: 44, connects: [stairSpaces[f1.id]!, "OUTSIDE"], accessible: true, src: src(twin, "stair discharge to outside") });
  exits.push({ id: `EX-${id}`, name: "New external stair, ground discharge", floor: f1.id, kind: "exterior", portal: xp, src: src(twin, "stair discharge") });
  const order = [...twin.floors].reverse();
  const flights = order.slice(0, -1).map((f, i) => ({ from: f.id, to: order[i + 1]!.id, travelFt: 30, head, landing }));
  const stair: Stair = { id: `ST-${id}`, name: "New external stair", enclosed: false, countsAsCodeExit: true, clearWidthIn: 48, riserIn: 7, treadIn: 11, spaces: stairSpaces, flights, src: src(twin, "48 in external stair, 7 in risers, 11 in treads") };
  return [{
    id, kind: "external_stair", title: `External stair (48 in) on the ${fh.id} façade outside ${c.s.name} ${c.s.id}`, hotspot: h.id, source: "generator",
    why: `People on ${upper.map((f) => f.id).join("/")} queue at ${h.element?.name ?? h.id}; a stair on the outside wall ${r1(c.d)} ft from the queue adds a separate route to the ground without passing the busy stairs.`,
    edit: { kind: "geometry", target: id, patch: { addSpaces: spaces, addPortals: portals, addExits: exits, addStairs: [stair] } },
    quantities: { stairFlights: flights.length, newFloorM2: r1(16 * 10 * 0.0929 * twin.floors.length), doorsAdded: twin.floors.length + 1, wallOpeningM2: r1(1.12 * 2.1 * twin.floors.length) },
    structural: "structural", needsEngineer: true, accessibility: 0,
    regulations: ["New structure with foundations and openings in the exterior wall on every floor: needs a structural engineer and a building permit.", "Exit stair: 48 in clear width (0.3 in per person), handrails both sides, risers at most 7 in, treads at least 11 in (NFPA 101 7.2.2; verify against the adopted code).", "An exterior exit stair needs weather protection and separation from openings in the wall beside it, or must be enclosed."],
    viz: [{ floor: f1.id, kind: "construct", polygon: foot, label: "new external stair" }, ...portals.map((p) => ({ floor: p.floor, kind: "construct" as const, segment: [p.a, p.b] as [Pt, Pt], label: "new door" }))],
  }];
}

export function genPassage(g: GenContext, h: Hotspot): Modification[] {
  const { twin } = g;
  const f = twin.floors.find((x) => x.id === h.floor)!;
  if (f.spaces.length < 3 || !h.spare.length) return [];
  const byId = new Map(f.spaces.map((s) => [s.id, s]));
  const portalPairs = new Set(f.portals.map((p) => [...p.connects].sort().join("|")));
  const startSpace = f.spaces.find((s) => pointInPolygon(h.centroid[0], h.centroid[1], s.polygon))
    ?? f.spaces.filter((s) => s.kind !== "stair").map((s) => ({ s, d: len(centroid(s.polygon), h.centroid) })).sort((a, b) => a.d - b.d)[0]?.s;
  const out: Modification[] = [];
  for (const spare of h.spare.slice(0, 2)) {
    const ex = twin.exits.find((e) => e.id === spare.exit && e.floor === f.id);
    const goal = ex ? f.portals.find((p) => p.id === ex.portal)?.connects.find((x) => x !== "OUTSIDE") : undefined;
    if (!startSpace || !goal || goal === startSpace.id) continue;
    const dist = new Map<string, number>([[startSpace.id, 0]]), prev = new Map<string, string>();
    const open = [startSpace.id];
    while (open.length) {
      open.sort((a, b) => dist.get(a)! - dist.get(b)!);
      const u = open.shift()!;
      if (u === goal) break;
      for (const v of f.spaces) {
        if (v.id === u) continue;
        const c = spaceCost(v);
        if (!Number.isFinite(c)) continue;
        const sw = sharedWalls(byId.get(u)!, v);
        if (!sw.length) continue;
        const door = f.portals.find((q) => [q.connects[0], q.connects[1]].sort().join("|") === [u, v.id].sort().join("|"));
        const via = door ? centroid([door.a, door.b]) : centroid(sw.sort((x, y) => len(y[0], y[1]) - len(x[0], x[1]))[0]!);
        const step = len(centroid(byId.get(u)!.polygon), via) + len(via, centroid(v.polygon)) * (v.kind === "corridor" || v.kind === "lobby" ? 1 : c / 2);
        const nd = dist.get(u)! + step + (door ? 0 : 12);
        if (nd < (dist.get(v.id) ?? Infinity)) { dist.set(v.id, nd); prev.set(v.id, u); if (!open.includes(v.id)) open.push(v.id); }
      }
    }
    if (!prev.has(goal)) continue;
    const path: string[] = [goal];
    while (path[0] !== startSpace.id) path.unshift(prev.get(path[0]!)!);
    const portals: Portal[] = [], viz: Shape[] = [], crossed: Space[] = [];
    let structural: "partition" | "structural" = "partition";
    const id = mid("passage");
    for (let i = 0; i + 1 < path.length; i++) {
      const A = byId.get(path[i]!)!, B = byId.get(path[i + 1]!)!;
      if (i > 0 && !["corridor", "lobby"].includes(A.kind)) crossed.push(A);
      if (portalPairs.has([A.id, B.id].sort().join("|"))) continue;
      const seg = sharedWalls(A, B).sort((x, y) => len(y[0], y[1]) - len(x[0], x[1]))[0]!;
      const [a, b] = doorOn(seg, 0.5, 4);
      if (structuralKind(twin, seg[0], seg[1], false) === "structural") structural = "structural";
      portals.push({ id: `D-${id}-${i}`, floor: f.id, kind: "door", a, b, clearWidthIn: 44, connects: [A.id, B.id], accessible: true, src: src(twin, "new 44 in opening for a connecting passage") });
      viz.push({ floor: f.id, kind: "construct", segment: [a, b], label: `new opening ${A.id} to ${B.id}` });
    }
    if (!portals.length) continue;
    for (const s of crossed) viz.push({ floor: f.id, kind: "modify", polygon: s.polygon, label: `${s.name} becomes a through-route` });
    out.push({
      id, kind: "connecting_passage", title: `Connecting passage from ${startSpace.name} to ${spare.name} (${portals.length} new opening${portals.length > 1 ? "s" : ""}${crossed.length ? `, through ${crossed.map((s) => s.name).join(", ")}` : ""})`,
      hotspot: h.id, source: "generator",
      why: `Links the queue at ${h.element?.name ?? h.id} to ${spare.name}, which carries ${(spare.usedShare * 100).toFixed(0)}% of people for ${(spare.capacityShare * 100).toFixed(0)}% of exit capacity, ${spare.distFt} ft away.`,
      edit: { kind: "geometry", target: id, patch: { addPortals: portals } },
      quantities: { doorsAdded: portals.length, wallOpeningM2: r1(portals.length * 1.12 * 2.1), roomsCrossed: crossed.length },
      structural, needsEngineer: structural === "structural", accessibility: 0,
      regulations: [
        ...(crossed.length ? [`Rooms used as a route (${crossed.map((s) => s.id).join(", ")}) must keep a 44 in clear path free of furniture and must not be lockable from inside; exit access through a room is limited by the code (NFPA 101 7.5.2; verify).`] : []),
        structural === "structural" ? "At least one opening is on a structural grid line: needs a structural engineer." : "Openings in non-structural partitions (assumed); confirm with the structural drawings.",
        "Fire-rated walls keep their rating: openings in them need rated door assemblies.",
      ],
      viz,
    });
  }
  return out;
}

export function genPartition(g: GenContext, h: Hotspot): Modification[] {
  const { twin } = g;
  if (h.element?.kind !== "door") return [];
  const f = twin.floors.find((x) => x.id === h.floor)!;
  const p = f.portals.find((x) => x.id === h.element!.id);
  if (!p) return [];
  const [A, B] = p.connects.map((id) => f.spaces.find((s) => s.id === id));
  const out: Modification[] = [];
  const widen: Portal = { ...p };
  const L = len(p.a, p.b) || 1, ux = (p.b[0] - p.a[0]) / L, uy = (p.b[1] - p.a[1]) / L, add = 1.5;
  const a: Pt = [r1(p.a[0] - ux * add), r1(p.a[1] - uy * add)], b: Pt = [r1(p.b[0] + ux * add), r1(p.b[1] + uy * add)];
  const id1 = mid("widen");
  out.push({
    id: id1, kind: "widen_door", title: `Widen door ${p.id} from ${p.clearWidthIn} in to ${p.clearWidthIn + 36} in (double door)`, hotspot: h.id, source: "generator",
    why: `${h.element.name} is the constriction for ${(h.share * 100).toFixed(0)}% of all waiting; a double door roughly doubles what it can pass.`,
    edit: { kind: "geometry", target: id1, patch: { updatePortals: [{ id: p.id, a, b, clearWidthIn: p.clearWidthIn + 36 }] } },
    quantities: { widenedIn: 36, wallOpeningM2: r1(0.91 * 2.1) }, structural: structuralKind(twin, p.a, p.b, false), needsEngineer: structuralKind(twin, p.a, p.b, false) === "structural", accessibility: 0,
    regulations: ["Wider opening needs a new header; rated walls need a rated double-door assembly."], viz: [{ floor: f.id, kind: "modify", segment: [a, b], label: "widened door" }],
  });
  if (A && B) {
    const seg = sharedWalls(A, B).sort((x, y) => len(y[0], y[1]) - len(x[0], x[1]))[0];
    const kind = seg ? structuralKind(twin, seg[0], seg[1], false) : "structural";
    if (seg && kind === "partition" && len(seg[0], seg[1]) >= 8 && A.kind !== "stair" && B.kind !== "stair") {
      const id2 = mid("partition");
      const span = len(seg[0], seg[1]);
      out.push({
        id: id2, kind: "remove_partition", title: `Remove the partition between ${A.name} and ${B.name} (${r1(span)} ft opening)`, hotspot: h.id, source: "generator",
        why: `Replaces the single door at ${p.id} with an opening the full length of the wall, so the two spaces drain together.`,
        edit: { kind: "geometry", target: id2, patch: { removePortals: [p.id], addPortals: [{ id: `O-${id2}`, floor: f.id, kind: "opening", a: seg[0], b: seg[1], clearWidthIn: Math.round(span * 12), connects: [A.id, B.id], accessible: true, src: ASSUMED("partition removed") }] } },
        quantities: { partitionRemovedM: r1(span * 0.3048) }, structural: "partition", needsEngineer: false, accessibility: 0,
        regulations: ["Assumed non-structural partition (not on the structural grid): confirm with the structural drawings before removing.", "If the wall is a fire or smoke barrier, removing it changes the compartmentation and needs a fire engineer."],
        viz: [{ floor: f.id, kind: "remove", segment: seg, label: "partition removed" }],
      });
    }
  }
  return out;
}

export function genStairWiden(g: GenContext, h: Hotspot): Modification[] {
  if (h.element?.kind !== "stair") return [];
  const st = g.twin.stairs.find((s) => s.id === h.element!.id);
  if (!st) return [];
  const id = mid("stair");
  return [{
    id, kind: "widen_stair", title: `Widen ${st.name} from ${st.clearWidthIn} in to ${st.clearWidthIn + 12} in`, hotspot: h.id, source: "generator",
    why: `The stair head is the constriction (${(h.share * 100).toFixed(0)}% of waiting); stair flow scales with effective width.`,
    edit: { kind: "widen_stair", target: st.id, amount: 12 },
    quantities: { widenedIn: 12, stairFlights: st.flights.length }, structural: "structural", needsEngineer: true, accessibility: 0,
    regulations: ["Rebuilding a stair flight in an existing core: major structural work, needs a structural engineer.", "Stair width at 0.3 in per person (printed code basis)."],
    viz: [{ floor: h.floor, kind: "modify", polygon: [[h.bbox[0], h.bbox[1]], [h.bbox[2], h.bbox[1]], [h.bbox[2], h.bbox[3]], [h.bbox[0], h.bbox[3]]], label: "widened stair" }],
  }];
}

export function genExitWiden(g: GenContext, h: Hotspot): Modification[] {
  if (h.element?.kind !== "exit") return [];
  const e = g.twin.exits.find((x) => x.id === h.element!.id);
  if (!e) return [];
  const f = g.twin.floors.find((x) => x.id === e.floor)!;
  const p = f.portals.find((x) => x.id === e.portal)!;
  const id = mid("exitwide");
  const L = len(p.a, p.b) || 1, ux = (p.b[0] - p.a[0]) / L, uy = (p.b[1] - p.a[1]) / L;
  const a: Pt = [r1(p.a[0] - ux * 1.5), r1(p.a[1] - uy * 1.5)], b: Pt = [r1(p.b[0] + ux * 1.5), r1(p.b[1] + uy * 1.5)];
  const out: Modification[] = [{
    id, kind: "widen_door", title: `Widen ${e.name} from ${p.clearWidthIn} in to ${p.clearWidthIn + 36} in`, hotspot: h.id, source: "generator",
    why: `${e.name} is saturated for ${h.saturatedSec} s and carries more people than its share of exit width.`,
    edit: { kind: "geometry", target: id, patch: { updatePortals: [{ id: p.id, a, b, clearWidthIn: p.clearWidthIn + 36 }] } },
    quantities: { widenedIn: 36, wallOpeningM2: r1(0.91 * 2.1) }, structural: "structural", needsEngineer: true, accessibility: 0,
    regulations: ["Widening an opening in an exterior wall: new lintel, needs a structural engineer."], viz: [{ floor: f.id, kind: "modify", segment: [a, b], label: "widened exit" }],
  }];
  if (!p.accessible) {
    const idr = mid("ramp");
    const rise = 21, run = (rise * 12) / 12 / 1, ramp = r1(run + 5);
    const n: Pt = [-(b[1] - a[1]) / (len(a, b) || 1), (b[0] - a[0]) / (len(a, b) || 1)];
    const c0 = centroid([a, b]);
    const poly: Pt[] = [[r1(c0[0] - 2.5), r1(c0[1])], [r1(c0[0] + 2.5), r1(c0[1])], [r1(c0[0] + 2.5 + n[0] * ramp), r1(c0[1] + n[1] * ramp)], [r1(c0[0] - 2.5 + n[0] * ramp), r1(c0[1] + n[1] * ramp)]];
    out.push({
      id: idr, kind: "ramp", title: `Step-free ramp at ${e.name} (about ${ramp} ft at 1:12)`, hotspot: h.id, source: "generator",
      why: `${e.name} has exterior steps, so wheelchair users cannot use it; a ramp makes it an accessible exit.`,
      edit: { kind: "accessible_exit", target: e.id },
      quantities: { rampM: r1(ramp * 0.3048), newFloorM2: r1(ramp * 5 * 0.0929) }, structural: "none", needsEngineer: false, accessibility: 1,
      regulations: [`Assumed rise ${rise} in (three 7 in steps): at 1:12 that is a ${r1(run)} ft run plus a 5 ft landing (ADA Standards 405.2 and 405.7; verify the real rise on site).`, "Handrails both sides and edge protection on the ramp."],
      viz: [{ floor: f.id, kind: "construct", polygon: poly, label: "new ramp" }],
    });
  }
  return out;
}

/** Uploaded plans and outdoor venues: one floor space with walls as barriers; new exits go on the outline. */
export function genVenueExits(g: GenContext, h: Hotspot): Modification[] {
  const { twin } = g;
  if (!twin.venue) return [];
  const f = twin.floors[0]!;
  const existing = f.portals.filter((p) => p.connects.includes("OUTSIDE")).map((p) => centroid([p.a, p.b]));
  const cands = edges(f.outline).map((seg) => ({ seg, t: bestOn(twin, seg, h.centroid, 6) })).filter((c) => c.t !== null)
    .map((c) => ({ ...c, p: lerp(c.seg[0], c.seg[1], c.t!) })).filter((c) => !existing.some((e) => len(e, c.p) < 30)).sort((a, b) => len(a.p, h.centroid) - len(b.p, h.centroid));
  return cands.slice(0, 2).map((c) => {
    const id = mid("gate");
    const [a, b] = doorOn(c.seg, c.t!, twin.venue!.kind === "outdoor" ? 12 : 6);
    const pid = `X-${id}`;
    const space = f.spaces[0]!.id;
    const portal: Portal = { id: pid, floor: f.id, kind: "door", a, b, clearWidthIn: Math.round(len(a, b) * 12), connects: [space, "OUTSIDE"], accessible: true, src: src(twin, "new exit") };
    return {
      id, kind: "new_exit", title: `New ${twin.venue!.kind === "outdoor" ? "gate" : "exit"} (${Math.round(len(a, b))} ft) ${r1(len(c.p, h.centroid))} ft from the queue`, hotspot: h.id, source: "generator",
      why: `People queue at ${h.element?.name ?? h.id}; an opening in the nearest stretch of perimeter splits that crowd.`,
      edit: { kind: "geometry", target: id, patch: { addPortals: [portal], addExits: [{ id: `EX-${id}`, name: `New exit ${id}`, floor: f.id, kind: "exterior", portal: pid, src: portal.src }] } },
      quantities: { doorsAdded: 1, wallOpeningM2: twin.venue!.kind === "outdoor" ? 0 : r1(len(a, b) * 0.3048 * 2.1) },
      structural: twin.venue!.kind === "outdoor" ? "none" : "structural", needsEngineer: twin.venue!.kind !== "outdoor", accessibility: 1,
      regulations: twin.venue!.kind === "outdoor" ? ["Temporary event perimeter: a new gate needs stewarding and a clear route beyond it to a public way."] : ["Opening in an outside wall: needs a structural engineer.", "Exit must lead to a public way and open in the direction of travel."],
      viz: [{ floor: f.id, kind: "construct", segment: [a, b], label: "new exit" }],
    };
  });
}

export function generate(g: GenContext, opts: { hotspots?: number } = {}): Modification[] {
  counter = 0;
  const out: Modification[] = [];
  const top = g.diagnosis.hotspots.slice(0, opts.hotspots ?? 4);
  for (const f of g.twin.floors.slice(1)) { const h = g.diagnosis.hotspots.find((x) => x.floor === f.id); if (h && !top.includes(h)) top.push(h); }
  for (const h of top) {
    if (g.twin.venue) { out.push(...genVenueExits(g, h), ...genExitWiden(g, h)); continue; }
    out.push(...genNewExits(g, h), ...genExternalStair(g, h), ...genPassage(g, h), ...genPartition(g, h), ...genStairWiden(g, h), ...genExitWiden(g, h));
  }
  const seen = new Set<string>();
  const key = (m: Modification) => m.kind === "new_exit" ? `${m.kind}|${m.title}` : `${m.kind}|${m.viz.map((v) => `${v.floor}:${(v.segment ?? v.polygon ?? []).map((p) => `${Math.round(p[0] / 3)},${Math.round(p[1] / 3)}`).join(";")}`).join("|")}`;
  return out.filter((m) => { const k = key(m); if (seen.has(k)) return false; seen.add(k); return true; });
}
