import * as THREE from "three";
import type { Floor, Pt, Stair, Twin } from "../../../../src/twin/schema.ts";
import { centroid } from "../../geometry.ts";

/** Units are feet. Plan (x, y) maps to world (x, y-up, z = plan y); each floor group sits with its slab top at y = 0. */
export const SLAB_T = 1.1;
export const WALL_H = 3.5;
export const WALL_T = 0.45;
export const EXT_H = 4.1;
export const EXT_T = 0.95;
export const EXPLODE_GAP = 36;
export const GROUND_GAP = 3;
export const STAGE = "#ECEEF1";

export const PALETTE = {
  slabTop: "#F7F8FA",
  slabSide: "#DCE1E7",
  wallSide: "#E3E7EC",
  wallTop: "#B4BCC7",
  extSide: "#D2D7DE",
  extTop: "#414854",
  stair: "#C9CFD7",
  stairDamaged: "#E5372B",
  room: "#FFFFFF",
  corridor: "#EEF0F3",
  lobby: "#F0F2F5",
  service: "#F4F5F7",
  stairFill: "#E3E6EB",
  elevator: "#D7DCE2",
  tread: "#C3CAD3",
  label: "#98A1AD",
};

/** Floor heights relative to the lowest floor, and each floor's rank from the bottom. */
export interface Levels {
  elev: number[];
  base: number[];
  rank: number[];
  sorted: number[];
  order: number[];
}

export function levelsOf(twin: Twin): Levels {
  const elev = twin.floors.map((f) => f.elevationFt);
  const order = elev.map((_, i) => i).sort((a, b) => elev[a]! - elev[b]!);
  const rank = new Array<number>(elev.length);
  order.forEach((fi, r) => (rank[fi] = r));
  const lo = elev.length ? Math.min(...elev) : 0;
  return { elev, base: elev.map((e) => e - lo), rank, sorted: order.map((i) => elev[i]!), order };
}

/** World y of each floor for an explode fraction 0..1. */
export function floorY(lv: Levels, explode: number, out: number[]): number[] {
  for (let i = 0; i < lv.base.length; i++) out[i] = lv.base[i]! + explode * EXPLODE_GAP * lv.rank[i]!;
  return out;
}

/** Map an absolute elevation (ft) to world y, stretching the storeys between exploded floors. */
export function elevToY(lv: Levels, ys: number[], z: number): number {
  const s = lv.sorted, o = lv.order;
  const n = s.length;
  if (!n) return z;
  if (z <= s[0]!) return ys[o[0]!]! + (z - s[0]!);
  for (let k = 0; k + 1 < n; k++) {
    const a = s[k]!, b = s[k + 1]!;
    if (z <= b) {
      const ya = ys[o[k]!]!, yb = ys[o[k + 1]!]!;
      return b > a ? ya + ((z - a) / (b - a)) * (yb - ya) : ya;
    }
  }
  return ys[o[n - 1]!]! + (z - s[n - 1]!);
}

// ---------- slab ----------

function contourOf(floor: Floor): Pt[] {
  if (floor.outline.length >= 3) return floor.outline;
  const pts = floor.spaces.flatMap((s) => s.polygon);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

const signedArea = (P: readonly Pt[]): number => {
  let a = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i]!, q = P[(i + 1) % P.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** Extruded slab (top at y = 0) with the atrium voids cut out; group 0 = top and bottom caps, group 1 = sides. */
export function slabGeometry(floor: Floor): THREE.BufferGeometry {
  const toV = (P: readonly Pt[], ccw: boolean) => {
    const v = P.map((p) => new THREE.Vector2(p[0], p[1]));
    if ((signedArea(P) > 0) !== ccw) v.reverse();
    return v;
  };
  const shape = new THREE.Shape(toV(contourOf(floor), true));
  for (const h of floor.voids) if (h.length >= 3) shape.holes.push(new THREE.Path(toV(h, false)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: SLAB_T, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

// ---------- plan texture (space fills, stair treads, room names) ----------

export interface PlanFrame { x0: number; y0: number; w: number; h: number }

export function planFrame(bounds: [number, number, number, number]): PlanFrame {
  const m = 2;
  return { x0: bounds[0] - m, y0: bounds[1] - m, w: bounds[2] - bounds[0] + 2 * m, h: bounds[3] - bounds[1] + 2 * m };
}

const FILL: Record<string, string> = {
  room: PALETTE.room,
  corridor: PALETTE.corridor,
  lobby: PALETTE.lobby,
  service: PALETTE.service,
  stair: PALETTE.stairFill,
  elevator: PALETTE.elevator,
};

function pip(x: number, y: number, P: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i]!, [xj, yj] = P[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function drawPlan(canvas: HTMLCanvasElement, floor: Floor, fr: PlanFrame, font: string): void {
  const s = canvas.width / fr.w;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PALETTE.slabTop;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, -fr.x0 * s, -fr.y0 * s);
  const path = (P: readonly Pt[]) => {
    ctx.beginPath();
    P.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  };
  for (const sp of floor.spaces) {
    if (sp.kind === "exterior" || sp.polygon.length < 3) continue;
    path(sp.polygon);
    ctx.fillStyle = FILL[sp.kind] ?? PALETTE.room;
    ctx.fill();
    if (sp.kind === "stair" || sp.kind === "elevator") {
      const xs = sp.polygon.map((p) => p[0]), ys = sp.polygon.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      ctx.save();
      path(sp.polygon);
      ctx.clip();
      ctx.strokeStyle = PALETTE.tread;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      if (sp.kind === "elevator") {
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.moveTo(x1, y0); ctx.lineTo(x0, y1);
      } else if (x1 - x0 >= y1 - y0) {
        for (let x = x0 + 0.9; x < x1; x += 0.92) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      } else {
        for (let y = y0 + 0.9; y < y1; y += 0.92) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.fillStyle = PALETTE.label;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const sp of floor.spaces) {
    if ((sp.kind !== "room" && sp.kind !== "lobby") || sp.polygon.length < 3) continue;
    const area = Math.abs(signedArea(sp.polygon));
    if (area < 260) continue;
    const xs = sp.polygon.map((p) => p[0]), ys = sp.polygon.map((p) => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    let [cx, cy] = centroid(sp.polygon);
    if (!pip(cx, cy, sp.polygon)) { cx = (Math.max(...xs) + Math.min(...xs)) / 2; cy = (Math.max(...ys) + Math.min(...ys)) / 2; }
    let size = Math.max(1.05, Math.min(1.7, Math.min(bw, bh) * 0.11));
    ctx.font = `500 ${size}px ${font}`;
    const tw = ctx.measureText(sp.name).width;
    if (tw > bw * 0.86) { size *= (bw * 0.86) / tw; ctx.font = `500 ${size}px ${font}`; }
    if (size < 0.8) continue;
    ctx.fillText(sp.name, cx, cy);
  }
}

// ---------- walls with door openings ----------

interface Seg { s: number; e: number }
type Lines = Map<number, Seg[]>;

const EPS = 0.06;

function addEdge(h: Lines, v: Lines, diag: [Pt, Pt][], a: Pt, b: Pt, ext: number): void {
  if (Math.abs(a[1] - b[1]) < EPS) {
    const c = (a[1] + b[1]) / 2;
    const s = Math.min(a[0], b[0]) - ext, e = Math.max(a[0], b[0]) + ext;
    if (e - s > EPS) (h.get(c) ?? h.set(c, []).get(c)!).push({ s, e });
  } else if (Math.abs(a[0] - b[0]) < EPS) {
    const c = (a[0] + b[0]) / 2;
    const s = Math.min(a[1], b[1]) - ext, e = Math.max(a[1], b[1]) + ext;
    if (e - s > EPS) (v.get(c) ?? v.set(c, []).get(c)!).push({ s, e });
  } else diag.push([a, b]);
}

/** merge line coordinates closer than tol (keeps the first-seen value of each cluster) */
function cluster(lines: Lines, tol: number): Lines {
  const keys = [...lines.keys()].sort((a, b) => a - b);
  const out: Lines = new Map();
  let rep = NaN;
  for (const k of keys) {
    if (!(Math.abs(k - rep) <= tol)) rep = k;
    const arr = out.get(rep) ?? out.set(rep, []).get(rep)!;
    arr.push(...lines.get(k)!);
  }
  return out;
}

function union(segs: Seg[]): Seg[] {
  const s = [...segs].sort((a, b) => a.s - b.s);
  const out: Seg[] = [];
  for (const g of s) {
    const last = out.at(-1);
    if (last && g.s <= last.e + EPS) last.e = Math.max(last.e, g.e);
    else out.push({ ...g });
  }
  return out;
}

function subtract(segs: Seg[], cut: Seg[]): Seg[] {
  let cur = segs;
  for (const c of cut) {
    const next: Seg[] = [];
    for (const g of cur) {
      if (c.e <= g.s || c.s >= g.e) { next.push(g); continue; }
      if (c.s > g.s) next.push({ s: g.s, e: c.s });
      if (c.e < g.e) next.push({ s: c.e, e: g.e });
    }
    cur = next;
  }
  return cur;
}

function cutsNear(lines: Lines, c: number, tol: number): Seg[] {
  const out: Seg[] = [];
  for (const [k, segs] of lines) if (Math.abs(k - c) <= tol) out.push(...segs);
  return out;
}

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  quad(p: number[][], n: number[], c: THREE.Color): void {
    const b = this.pos.length / 3;
    for (const q of p) { this.pos.push(q[0]!, q[1]!, q[2]!); this.nor.push(n[0]!, n[1]!, n[2]!); this.col.push(c.r, c.g, c.b); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** box between plan points a and b (wall centre line), thickness t, from y0 to y1; no bottom face */
  wall(a: Pt, b: Pt, t: number, y0: number, y1: number, side: THREE.Color, top: THREE.Color): void {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) return;
    const ux = dx / L, uz = dz / L, nx = -uz * (t / 2), nz = ux * (t / 2);
    const P = [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]] as const;
    const nl = [-uz, 0, ux], nr = [uz, 0, -ux];
    this.quad([[P[0][0], y1, P[0][1]], [P[1][0], y1, P[1][1]], [P[2][0], y1, P[2][1]], [P[3][0], y1, P[3][1]]], [0, 1, 0], top);
    this.quad([[P[1][0], y0, P[1][1]], [P[1][0], y1, P[1][1]], [P[0][0], y1, P[0][1]], [P[0][0], y0, P[0][1]]], nl, side);
    this.quad([[P[3][0], y0, P[3][1]], [P[3][0], y1, P[3][1]], [P[2][0], y1, P[2][1]], [P[2][0], y0, P[2][1]]], nr, side);
    this.quad([[P[0][0], y0, P[0][1]], [P[0][0], y1, P[0][1]], [P[3][0], y1, P[3][1]], [P[3][0], y0, P[3][1]]], [-ux, 0, -uz], side);
    this.quad([[P[2][0], y0, P[2][1]], [P[2][0], y1, P[2][1]], [P[1][0], y1, P[1][1]], [P[1][0], y0, P[1][1]]], [ux, 0, uz], side);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const C = (hex: string) => new THREE.Color(hex);

/** All walls of one floor merged into one geometry (vertex colours: light sides, dark section-cut tops). Door and opening portals are cut out. */
export function wallGeometry(floor: Floor): THREE.BufferGeometry {
  const eh: Lines = new Map(), ev: Lines = new Map(), ed: [Pt, Pt][] = [];
  const ih: Lines = new Map(), iv: Lines = new Map(), id: [Pt, Pt][] = [];
  const out = contourOf(floor);
  for (let i = 0; i < out.length; i++) addEdge(eh, ev, ed, out[i]!, out[(i + 1) % out.length]!, EXT_T / 2);
  const polys = [...floor.spaces.filter((s) => s.kind !== "exterior").map((s) => s.polygon), ...floor.voids];
  for (const P of polys) for (let i = 0; i < P.length; i++) addEdge(ih, iv, id, P[i]!, P[(i + 1) % P.length]!, WALL_T / 2);
  const oh: Lines = new Map(), ov: Lines = new Map(), od: [Pt, Pt][] = [];
  for (const p of floor.portals) addEdge(oh, ov, od, p.a, p.b, 0);
  const E = { h: cluster(eh, 0.3), v: cluster(ev, 0.3) };
  const I = { h: cluster(ih, 0.3), v: cluster(iv, 0.3) };
  const buf = new Buf();
  const side = C(PALETTE.wallSide), top = C(PALETTE.wallTop), xside = C(PALETTE.extSide), xtop = C(PALETTE.extTop);
  const emit = (horizontal: boolean, c: number, segs: Seg[], t: number, h: number, sc: THREE.Color, tc: THREE.Color) => {
    for (const g of segs) {
      if (g.e - g.s < 0.3) continue;
      if (horizontal) buf.wall([g.s, c], [g.e, c], t, 0, h, sc, tc);
      else buf.wall([c, g.s], [c, g.e], t, 0, h, sc, tc);
    }
  };
  for (const horizontal of [true, false]) {
    const ext = horizontal ? E.h : E.v, int = horizontal ? I.h : I.v, open = horizontal ? oh : ov;
    for (const [c, segs] of ext) emit(horizontal, c, subtract(union(segs), union(cutsNear(open, c, 0.7))), EXT_T, EXT_H, xside, xtop);
    for (const [c, segs] of int) {
      const cut = union([...cutsNear(open, c, 0.6), ...cutsNear(ext, c, 1.0).map((g) => ({ s: g.s, e: g.e }))]);
      emit(horizontal, c, subtract(union(segs), cut), WALL_T, WALL_H, side, top);
    }
  }
  for (const [a, b] of ed) buf.wall(a, b, EXT_T, 0, EXT_H, xside, xtop);
  for (const [a, b] of id) buf.wall(a, b, WALL_T, 0, WALL_H, side, top);
  return buf.geometry();
}

/** Low bar across a portal, straddling the wall line; used for exits. */
export function exitBarGeometry(a: Pt, b: Pt): THREE.BufferGeometry {
  const buf = new Buf();
  const w = new THREE.Color(1, 1, 1);
  buf.wall(a, b, 2.1, 0, 0.75, w, w);
  return buf.geometry();
}

// ---------- stairs ----------

/** One straight run of steps or a flat landing, in plan coordinates, with heights as fractions of the storey (0 = upper floor, 1 = lower floor). */
export interface StairPart { kind: "run" | "landing"; a: Pt; b: Pt; fa: number; fb: number; width: number }
export interface FlightModel { key: string; stair: string; from: number; to: number; elementId: string; parts: StairPart[] }

/** Flights as runs: open stairs go straight from head to landing; enclosed switchbacks double back inside the stair space. */
export function stairFlights(twin: Twin): FlightModel[] {
  const idx = new Map<string, number>(twin.floors.map((f, i) => [f.id, i]));
  const out: FlightModel[] = [];
  for (const st of twin.stairs as Stair[]) {
    const width = Math.max(3, st.clearWidthIn / 12);
    for (const fl of st.flights) {
      const fa = idx.get(fl.from), fb = idx.get(fl.to);
      if (fa === undefined || fb === undefined) continue;
      const h = centroid(fl.head), l = centroid(fl.landing);
      const d = Math.hypot(l[0] - h[0], l[1] - h[1]);
      const parts: StairPart[] = [];
      const spaceId = st.spaces[fl.from];
      const space = twin.floors[fa]!.spaces.find((s) => s.id === spaceId);
      if (d < 9 && space) {
        const ux = (l[0] - h[0]) / (d || 1), uz = (l[1] - h[1]) / (d || 1);
        let ax = -uz, az = ux;
        const [sx, sy] = centroid(space.polygon);
        if ((sx - h[0]) * ax + (sy - h[1]) * az < 0) { ax = -ax; az = -az; }
        let reach = 0;
        for (const p of space.polygon) reach = Math.max(reach, (p[0] - h[0]) * ax + (p[1] - h[1]) * az);
        const run = Math.max(6, Math.min(16, reach - width * 0.75));
        const h2: Pt = [h[0] + ax * run, h[1] + az * run], l2: Pt = [l[0] + ax * run, l[1] + az * run];
        const ex = ax * width * 0.5, ez = az * width * 0.5, wx = ux * width * 0.5, wz = uz * width * 0.5;
        parts.push({ kind: "run", a: h, b: h2, fa: 0, fb: 0.5, width });
        parts.push({ kind: "landing", a: [h2[0] + ex - wx, h2[1] + ez - wz], b: [l2[0] + ex + wx, l2[1] + ez + wz], fa: 0.5, fb: 0.5, width });
        parts.push({ kind: "run", a: l2, b: l, fa: 0.5, fb: 1, width });
      } else parts.push({ kind: "run", a: h, b: l, fa: 0, fb: 1, width });
      out.push({ key: `${st.id}:${fl.from}>${fl.to}`, stair: st.id, from: fa, to: fb, elementId: `${st.id}@${fl.from}`, parts });
    }
  }
  return out;
}

/** Unit staircase: x in [-0.5, 0.5], runs along +z from 0 to 1 while descending from y = 0 to y = -1. */
export function stepGeometry(n = 14): THREE.BufferGeometry {
  const buf = new Buf();
  const c = new THREE.Color(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const z0 = i / n, z1 = (i + 1) / n, top = -i / n, bot = -(i + 1) / n - 0.6 / n;
    buf.wall([0, z0], [0, z1], 1, bot, top, c, c);
  }
  return buf.geometry();
}

export function landingGeometry(): THREE.BufferGeometry {
  const buf = new Buf();
  const c = new THREE.Color(1, 1, 1);
  buf.wall([0, 0], [0, 1], 1, -0.06, 0, c, c);
  return buf.geometry();
}

/** Khronos neutral tone mapping, and its inverse, so a cleared background lands on the stage colour after tone mapping. */
function neutral(c: [number, number, number]): [number, number, number] {
  let [r, g, b] = c;
  const x = Math.min(r, g, b);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= off; g -= off; b -= off;
  const peak = Math.max(r, g, b);
  if (peak < 0.76) return [r, g, b];
  const d = 0.24;
  const np = 1 - (d * d) / (peak + d - 0.76);
  const k = np / peak;
  r *= k; g *= k; b *= k;
  const m = 1 - 1 / (0.15 * (peak - np) + 1);
  return [r + (np - r) * m, g + (np - g) * m, b + (np - b) * m];
}

export function preToneMapped(hex: string): THREE.Color {
  const t = new THREE.Color(hex);
  const want: [number, number, number] = [t.r, t.g, t.b];
  const x: [number, number, number] = [...want];
  for (let it = 0; it < 60; it++) {
    const y = neutral(x);
    for (let i = 0; i < 3; i++) x[i] = Math.max(0, x[i]! + (want[i]! - y[i]!) * 1.5);
  }
  return new THREE.Color(x[0], x[1], x[2]);
}
