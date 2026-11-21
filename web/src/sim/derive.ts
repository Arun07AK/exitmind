import type { FrameMsg, GridFloor, HazardFrame } from "../../../src/server/contract.ts";
import type { Geometry } from "../geometry.ts";
import { DENSE_SMOKE, PROTECTED } from "../lib/colors.ts";
import { decodeHazard } from "../lib/decode.ts";
import { frameIndexAt, type Run } from "../store.ts";

export function cellOf(gf: GridFloor, x: number, y: number): number {
  const cx = Math.floor((x - gf.ox) / gf.cellFt), cy = Math.floor((y - gf.oy) / gf.cellFt);
  return cx >= 0 && cy >= 0 && cx < gf.w && cy < gf.h ? cy * gf.w + cx : -1;
}

/** smoke level 0..255 at a point (agents stand between cells, so take the max of the 3x3 neighbourhood) */
export function smokeAt(geo: Geometry, hz: HazardFrame | null, fi: number, x: number, y: number): number {
  if (!hz) return 0;
  const sm = decodeHazard(hz).smoke[fi];
  const gf = geo.grid.floors[fi];
  if (!sm || !gf) return 0;
  const c = cellOf(gf, x, y);
  if (c < 0) return 0;
  const cx = c % gf.w, cy = Math.floor(c / gf.w);
  let m = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = cx + dx, yy = cy + dy;
    if (xx >= 0 && yy >= 0 && xx < gf.w && yy < gf.h) m = Math.max(m, sm[yy * gf.w + xx]!);
  }
  return m;
}

export interface Counts {
  occupants: number;
  out: number;
  inPlace: number;
  inside: number;
  inSmoke: number;
  queuing: number;
  moving: number;
  notStarted: number;
  perFloor: { inside: number; inSmoke: number; queuing: number; moving: number; notStarted: number }[];
}

/** Disjoint categories for the status panel: dense smoke takes precedence over the movement state. */
export function countAgents(frame: FrameMsg | null, geo: Geometry | null, hz: HazardFrame | null): Counts | null {
  if (!frame || !geo) return null;
  const nf = geo.grid.floors.length;
  const perFloor = Array.from({ length: nf }, () => ({ inside: 0, inSmoke: 0, queuing: 0, moving: 0, notStarted: 0 }));
  const c: Counts = { occupants: frame.n, out: 0, inPlace: 0, inside: 0, inSmoke: 0, queuing: 0, moving: 0, notStarted: 0, perFloor };
  for (let a = 0; a < frame.n; a++) {
    const st = frame.state[a]!;
    if (st === PROTECTED) { c.out++; continue; }
    if (st === 5 || st === 8) { c.inPlace++; continue; }
    const fi = frame.floor[a]!;
    const pf = perFloor[fi] ?? perFloor[0]!;
    c.inside++; pf.inside++;
    if (smokeAt(geo, hz, fi, frame.x[a]! / 10, frame.y[a]! / 10) >= DENSE_SMOKE) { c.inSmoke++; pf.inSmoke++; }
    else if (st === 4 || st === 6) { c.queuing++; pf.queuing++; }
    else if (st === 1) { c.notStarted++; pf.notStarted++; }
    else { c.moving++; pf.moving++; }
  }
  return c;
}

const coverageCache = new WeakMap<HazardFrame, number[]>();
/** share of walkable cells per floor with smoke at or above 0.3 */
export function smokeCoverage(geo: Geometry, hz: HazardFrame | null): number[] {
  if (!hz) return geo.grid.floors.map(() => 0);
  let v = coverageCache.get(hz);
  if (v) return v;
  const d = decodeHazard(hz);
  v = geo.grid.floors.map((f, fi) => {
    const sm = d.smoke[fi], walk = geo.walk[fi];
    if (!sm || !walk) return 0;
    let n = 0, k = 0;
    for (let i = 0; i < walk.length; i++) if (walk[i]) { n++; if (sm[i]! >= 77) k++; }
    return n ? k / n : 0;
  });
  coverageCache.set(hz, v);
  return v;
}

export interface ExitStat { id: string; index: number; label: string; floor: string; x: number; y: number; out: number; flow: number }

/** Exterior exits with cumulative use at the frame and mean flow over the previous `windowSec`. */
export function exitStats(run: Run | null, frame: FrameMsg | null, geo: Geometry | null, windowSec = 30): ExitStat[] {
  if (!run || !frame || !geo) return [];
  const i = run.frames.indexOf(frame);
  const prev = run.frames[Math.max(0, frameIndexAt(run.frames, frame.t - windowSec))] ?? frame;
  const dt = Math.max(1e-6, frame.t - prev.t);
  const out: ExitStat[] = [];
  geo.grid.elements.forEach((e, k) => {
    if (e.kind !== "exit" || e.id === "ELEVATOR") return;
    const now = frame.exits?.[k] ?? 0, before = prev.exits?.[k] ?? 0;
    out.push({ id: e.id, index: k, label: e.label, floor: e.floor, x: e.x, y: e.y, out: now, flow: i >= 0 && frame !== prev ? (now - before) / dt : 0 });
  });
  return out;
}

/** Mean number of people queuing at each portal over the previous `windowSec` (from cumulative queue person-seconds). */
export function queueRates(run: Run | null, frame: FrameMsg | null, windowSec = 10): Map<string, number> {
  const m = new Map<string, number>();
  if (!run || !frame) return m;
  const prev = run.frames[Math.max(0, frameIndexAt(run.frames, frame.t - windowSec))] ?? frame;
  const dt = frame.t - prev.t;
  if (dt <= 0) return m;
  for (const [k, v] of Object.entries(frame.queues ?? {})) {
    const r = (v - (prev.queues?.[k] ?? 0)) / dt;
    if (r > 0.05) m.set(k, r);
  }
  return m;
}

const seriesCache = new WeakMap<Run, { n: number; pts: [number, number][] }>();
/** people still inside (not out, not protected) over time, for the transport chart */
export function insideSeries(run: Run | null): [number, number][] {
  if (!run) return [];
  const c = seriesCache.get(run);
  if (c && c.n === run.frames.length) return c.pts;
  const pts = run.frames.map((f) => [f.t, f.metrics.remaining] as [number, number]);
  seriesCache.set(run, { n: run.frames.length, pts });
  return pts;
}

export const fmtTime = (s: number): string => {
  const v = Math.max(0, Math.round(s));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};
