import { z } from "zod";
import { finalizeTwin } from "../twin/build.ts";
import type { Pt, SignMount, SourceRef, Twin, TwinSource } from "../twin/schema.ts";

const P = z.tuple([z.number(), z.number()]);
const Seg = z.object({ a: P, b: P });
export const DraftSchema = z.object({
  outline: z.array(P).min(3).max(400),
  walls: z.array(Seg).max(2000),
  doors: z.array(Seg).max(600),
  exits: z.array(Seg.extend({ name: z.string().max(80), main: z.boolean() })).max(60),
  obstacles: z.array(z.object({ name: z.string().max(80), polygon: z.array(P).min(3).max(100) })).max(200),
  labels: z.array(z.object({ name: z.string().max(80), at: P, kind: z.enum(["room", "corridor", "hall", "stage", "service", "stair", "other"]) })).max(400),
  stage: z.array(P).min(3).max(40).nullable(),
  scale: z.object({ ftPerPx: z.number().positive().nullable(), evidence: z.string().max(300) }),
  edited: z.boolean().optional(),
});
export type PlanDraft = z.infer<typeof DraftSchema>;

const pt = { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } };
const seg = { type: "object", additionalProperties: false, required: ["a", "b"], properties: { a: pt, b: pt } };
export const DRAFT_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["outline", "walls", "doors", "exits", "obstacles", "labels", "stage", "scale", "notes"],
  properties: {
    outline: { type: "array", items: pt },
    walls: { type: "array", items: seg },
    doors: { type: "array", items: seg },
    exits: { type: "array", items: { type: "object", additionalProperties: false, required: ["a", "b", "name", "main"], properties: { a: pt, b: pt, name: { type: "string" }, main: { type: "boolean" } } } },
    obstacles: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "polygon"], properties: { name: { type: "string" }, polygon: { type: "array", items: pt } } } },
    labels: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "at", "kind"], properties: { name: { type: "string" }, at: pt, kind: { type: "string", enum: ["room", "corridor", "hall", "stage", "service", "stair", "other"] } } } },
    stage: { anyOf: [{ type: "array", items: pt }, { type: "null" }] },
    scale: { type: "object", additionalProperties: false, required: ["ftPerPx", "evidence"], properties: { ftPerPx: { anyOf: [{ type: "number" }, { type: "null" }] }, evidence: { type: "string" } } },
    notes: { type: "array", items: { type: "string" } },
  },
};

/** The tracer's output uses {x, y} points (the API's structured output cannot fix an array length); convert them to [x, y]. */
export function fromXY(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromXY);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && typeof o.x === "number" && typeof o.y === "number") return [o.x, o.y];
    return Object.fromEntries(keys.map((k) => [k, fromXY(o[k])]));
  }
  return v;
}

export const WALL_FT = 2;
const r1 = (v: number) => Math.round(v * 10) / 10;
const len = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function project(p: Pt, a: Pt, b: Pt): { t: number; d: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  const q: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { t, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

/** Split a wall where openings (doors, exits) lie along it, so the openings become gaps. */
export function cutWall(a: Pt, b: Pt, openings: { a: Pt; b: Pt }[], tolFt: number): [Pt, Pt][] {
  const L = len(a, b);
  if (L < 0.5) return [];
  const cuts: [number, number][] = [];
  for (const o of openings) {
    const pa = project(o.a, a, b), pb = project(o.b, a, b);
    if (pa.d > tolFt || pb.d > tolFt) continue;
    const [t0, t1] = [Math.min(pa.t, pb.t), Math.max(pa.t, pb.t)];
    if (t1 < 0 || t0 > 1) continue;
    cuts.push([Math.max(0, t0), Math.min(1, t1)]);
  }
  cuts.sort((x, y) => x[0] - y[0]);
  const out: [Pt, Pt][] = [];
  let t = 0;
  const at = (u: number): Pt => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  for (const [c0, c1] of cuts) { if (c0 > t && (c0 - t) * L > 0.75) out.push([at(t), at(c0)]); t = Math.max(t, c1); }
  if ((1 - t) * L > 0.75) out.push([at(t), at(1)]);
  return out;
}

export function wallPolygon(a: Pt, b: Pt, thick = WALL_FT): Pt[] {
  const L = len(a, b) || 1, nx = (-(b[1] - a[1]) / L) * (thick / 2), ny = ((b[0] - a[0]) / L) * (thick / 2);
  return [[r1(a[0] + nx), r1(a[1] + ny)], [r1(b[0] + nx), r1(b[1] + ny)], [r1(b[0] - nx), r1(b[1] - ny)], [r1(a[0] - nx), r1(a[1] - ny)]];
}

function snapToOutline(e: { a: Pt; b: Pt }, outline: Pt[]): { a: Pt; b: Pt; edge: number } {
  const mid: Pt = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  let best = { edge: 0, t: 0, d: Infinity };
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    const pr = project(mid, p, q);
    const t = Math.max(0, Math.min(1, pr.t));
    const c: Pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const d = len(mid, c);
    if (d < best.d) best = { edge: i, t, d };
  });
  const a = outline[best.edge]!, b = outline[(best.edge + 1) % outline.length]!, L = len(a, b) || 1;
  const half = Math.max(1.5, len(e.a, e.b) / 2) / L;
  const t0 = Math.max(0, best.t - half), t1 = Math.min(1, best.t + half);
  const at = (u: number): Pt => [r1(a[0] + (b[0] - a[0]) * u), r1(a[1] + (b[1] - a[1]) * u)];
  return { a: at(t0), b: at(t1), edge: best.edge };
}

export interface PlanMeta { id: string; name: string; width: number; height: number; source: string; createdAt: string }

export function draftToTwin(d: PlanDraft, meta: PlanMeta): Twin {
  const k = d.scale.ftPerPx;
  if (!k) throw new Error("set the plan scale first");
  const cx = d.outline.reduce((s, p) => s + p[0], 0) / d.outline.length, cy = d.outline.reduce((s, p) => s + p[1], 0) / d.outline.length;
  const F = (p: readonly number[]): Pt => [r1((p[0]! - cx) * k), r1((p[1]! - cy) * k)];
  const basis = d.edited ? "user-edited" : "ai-traced";
  const src = (note: string): SourceRef => ({ sheet: "UPLOAD", basis, note: `${meta.name}: ${note}` });
  const outline = d.outline.map(F);
  const exits = d.exits.map((e) => ({ ...snapToOutline({ a: F(e.a), b: F(e.b) }, outline), name: e.name, main: e.main }));
  const openings = [...d.doors.map((o) => ({ a: F(o.a), b: F(o.b) })), ...exits];
  const walls = d.walls.flatMap((w) => cutWall(F(w.a), F(w.b), openings, 2.5)).map(([a, b]) => wallPolygon(a, b));
  const voids = [...walls, ...d.obstacles.map((o) => o.polygon.map(F)), ...(d.stage ? [d.stage.map(F)] : [])];
  const portals = exits.map((e, i) => ({ id: `X-E${i + 1}`, floor: "F1" as const, kind: "door" as const, a: e.a, b: e.b, clearWidthIn: Math.max(24, Math.round(len(e.a, e.b) * 12)), connects: ["FLOOR", "OUTSIDE"] as [string, string], accessible: true, src: src(`exit "${e.name}" traced on the plan`) }));
  const cen = (pts: Pt[]): Pt => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const oc = cen(outline);
  const signMounts: SignMount[] = exits.map((e, i) => {
    const m = cen([e.a, e.b]), L = len(m, oc) || 1;
    return { id: `SM-E${i + 1}`, floor: "F1", at: [r1(m[0] + ((oc[0] - m[0]) / L) * 6), r1(m[1] + ((oc[1] - m[1]) / L) * 6)], facing: [Math.sign(oc[0] - m[0]) || 1, 0], space: "FLOOR", staticDefaultToward: `EX-E${i + 1}`, src: src("sign mount 6 ft inside the exit (assumption)") };
  });
  const area = Math.abs(outline.reduce((s, p, i) => { const q = outline[(i + 1) % outline.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const xs = outline.map((p) => p[0]), minX = Math.min(...xs), third = (Math.max(...xs) - minX) / 3;
  const twinSrc: TwinSource = {
    id: `plan-${meta.id}`, name: meta.name,
    frame: { gridX: {}, gridY: {}, north: "-y" },
    floors: [{ id: "F1", name: `${meta.name} (traced plan)`, elevationFt: 0, outline, voids, spaces: [{ id: "FLOOR", name: meta.name, floor: "F1", kind: "room", use: "assembly", polygon: outline, occupiable: true, lockable: false, src: src("outline traced on the plan") }], portals }],
    stairs: [],
    exits: exits.map((e, i) => ({ id: `EX-E${i + 1}`, name: `${e.main ? "Main" : "Exit"}: ${e.name}`, floor: "F1" as const, kind: "exterior" as const, portal: `X-E${i + 1}`, src: portals[i]!.src })),
    signMounts,
    codeBasis: {
      occupantLoadSqftPerPerson: 15, egressInPerPerson: { corridorsDoors: 0.2, stairs: 0.3 }, minDoorClearIn: 32, minCorridorIn: 44, minCorridorSmallLoadIn: 36, minExits: 2,
      travelDistanceFt: { nfpa101: 200, sbc: 250 }, commonPathFt: 100, deadEndFt: 20, twoDoorRoomLoad: 50, twoDoorTravelFt: 75, grossAreaSqft: { F1: Math.round(area), F2: 0, F3: 0 },
      src: { sheet: "UPLOAD", basis: "assumed", note: "uploaded plan: no code summary was read from it; placeholder values" },
    },
    sheets: [],
    zoneBands: [{ suffix: "W", name: "west third", x: [-1e5, minX + third] }, { suffix: "C", name: "centre third", x: [minX + third, minX + 2 * third] }, { suffix: "E", name: "east third", x: [minX + 2 * third, 1e5] }],
    venue: {
      kind: "plan", label: meta.name, origin: { lat: 0, lon: 0 },
      attribution: `Plan uploaded by the user (${meta.source}); traced by Claude Opus 5.5${d.edited ? " and corrected by the user" : ""}`,
      osmWays: [], stage: d.stage ? d.stage.map(F) : null,
      mainGates: exits.flatMap((e, i) => (e.main ? [`EX-E${i + 1}`] : [])), staffGates: [],
      assumptions: [
        `Scale: ${k.toFixed(4)} ft per pixel (${d.scale.evidence}).`,
        `Walls are modelled as ${WALL_FT} ft thick barriers; doors are gaps in them. Interior door widths are as traced.`,
        "The traced floor is treated as one level; stairs to other floors are not modelled for uploaded plans.",
        d.edited ? "The traced draft was corrected by the user in the editor." : "The draft is as traced by Claude Opus 5.5 and has not been checked by a person; open it in the editor before relying on results.",
      ],
    },
  };
  if (!twinSrc.venue!.mainGates.length && exits.length) twinSrc.venue!.mainGates = ["EX-E1"];
  return finalizeTwin(twinSrc);
}

/**
 * Areas the draft seals off (no traced door): for each one, propose a 3 ft door through the nearest traced wall
 * that separates it from the part of the floor that reaches an exit. Returns doors in image pixels.
 */
export function suggestDoors(d: PlanDraft, meta: PlanMeta, model: import("../sim/model.ts").Model): { a: Pt; b: Pt }[] {
  const k = d.scale.ftPerPx;
  if (!k || !d.exits.length) return [];
  const cx = d.outline.reduce((s, p) => s + p[0], 0) / d.outline.length, cy = d.outline.reduce((s, p) => s + p[1], 0) / d.outline.length;
  const F = (p: readonly number[]): Pt => [(p[0]! - cx) * k, (p[1]! - cy) * k];
  const B = (p: Pt): Pt => [r1(p[0] / k + cx), r1(p[1] / k + cy)];
  const fm = model.floors[0]!;
  const reached = new Uint8Array(fm.n), q: number[] = [];
  for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.exitPortal[i] >= 0) { reached[i] = 1; q.push(i); }
  for (let h = 0; h < q.length; h++) for (let dir = 0; dir < 8; dir++) { const j = fm.nbr[q[h]! * 8 + dir]!; if (j >= 0 && !reached[j]) { reached[j] = 1; q.push(j); } }
  const comp = new Int32Array(fm.n).fill(-1), comps: number[][] = [];
  for (let i = 0; i < fm.n; i++) {
    if (!fm.walkable[i] || reached[i] || comp[i]! >= 0) continue;
    const c: number[] = [i]; comp[i] = comps.length;
    for (let h = 0; h < c.length; h++) for (let dir = 0; dir < 8; dir++) { const j = fm.nbr[c[h]! * 8 + dir]!; if (j >= 0 && comp[j]! < 0 && !reached[j]) { comp[j] = comps.length; c.push(j); } }
    comps.push(c);
  }
  const walls = d.walls.map((w) => [F(w.a), F(w.b)] as [Pt, Pt]);
  const out: { a: Pt; b: Pt }[] = [];
  for (const c of comps) {
    if (c.length < 6) continue;
    let best: { u: number; v: number; dd: number } | null = null;
    const R = Math.ceil(8 / 1.3123);
    for (const u of c) {
      const ux = u % fm.w, uy = (u - ux) / fm.w;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = ux + dx, y = uy + dy;
        if (x < 0 || y < 0 || x >= fm.w || y >= fm.h) continue;
        const v = y * fm.w + x;
        if (!reached[v]) continue;
        const dd = dx * dx + dy * dy;
        if (!best || dd < best.dd) best = { u, v, dd };
      }
    }
    if (!best || !walls.length) continue;
    const m: Pt = [(fm.cx[best.u]! + fm.cx[best.v]!) / 2, (fm.cy[best.u]! + fm.cy[best.v]!) / 2];
    let wb = walls[0]!, wd = Infinity, wt = 0;
    for (const w of walls) { const p = project(m, w[0], w[1]); const t = Math.max(0, Math.min(1, p.t)); const q2: Pt = [w[0][0] + (w[1][0] - w[0][0]) * t, w[0][1] + (w[1][1] - w[0][1]) * t]; const dist = len(m, q2); if (dist < wd) { wd = dist; wb = w; wt = t; } }
    const L = len(wb[0], wb[1]) || 1, ux = (wb[1][0] - wb[0][0]) / L, uy = (wb[1][1] - wb[0][1]) / L;
    const c0: Pt = [wb[0][0] + (wb[1][0] - wb[0][0]) * wt, wb[0][1] + (wb[1][1] - wb[0][1]) * wt];
    out.push({ a: B([c0[0] - ux * 1.75, c0[1] - uy * 1.75]), b: B([c0[0] + ux * 1.75, c0[1] + uy * 1.75]) });
  }
  return out;
}
