import { bbox, pointInPolygon, segmentParam, side } from "../shared/geom.ts";
import type { Floor, FloorId, Stair, Twin } from "./schema.ts";

export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
export const DIAG = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
export const OUTSIDE = "OUTSIDE";
export const LINK_BLOCKED = -2;
export const LINK_FREE = -1;

export interface FloorRaster {
  floor: FloorId;
  cellFt: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  spaceIds: string[];
  space: Int16Array;
  walkable: Uint8Array;
  link: Int32Array;
  exitPortal: Int32Array;
  headFlight: Int32Array;
  portalIds: string[];
  portalCells: number[][];
}

export interface TwinRaster {
  cellFt: number;
  floors: FloorRaster[];
  floorIndex: Record<string, number>;
  portalIndex: Record<string, { floor: number; index: number }>;
  flights: { stair: string; index: number; from: number; to: number; travelFt: number; widthIn: number; landingCells: number[] }[];
}

const NON_WALKABLE = new Set(["elevator", "exterior"]);

export function rasterizeFloor(floor: Floor, stairs: readonly Stair[], allFlights: TwinRaster["flights"], cellFt: number, floorIdx: number): FloorRaster {
  const pts = [...floor.outline, ...floor.spaces.flatMap((s) => s.polygon)];
  const [x0, y0, x1, y1] = bbox(pts);
  const ox = x0 - cellFt, oy = y0 - cellFt;
  const w = Math.ceil((x1 - ox) / cellFt) + 2, h = Math.ceil((y1 - oy) / cellFt) + 2;
  const n = w * h;
  const spaceIds = floor.spaces.map((s) => s.id);
  const space = new Int16Array(n).fill(-1);
  const walkable = new Uint8Array(n);
  const center = (i: number): [number, number] => [ox + ((i % w) + 0.5) * cellFt, oy + (Math.floor(i / w) + 0.5) * cellFt];
  floor.spaces.forEach((s, si) => {
    const [sx0, sy0, sx1, sy1] = bbox(s.polygon);
    for (let cy = Math.max(0, Math.floor((sy0 - oy) / cellFt)); cy <= Math.min(h - 1, Math.ceil((sy1 - oy) / cellFt)); cy++) {
      for (let cx = Math.max(0, Math.floor((sx0 - ox) / cellFt)); cx <= Math.min(w - 1, Math.ceil((sx1 - ox) / cellFt)); cx++) {
        const i = cy * w + cx;
        const [px, py] = center(i);
        if (space[i] === -1 && pointInPolygon(px, py, s.polygon)) space[i] = si;
      }
    }
  });
  for (let i = 0; i < n; i++) {
    const si = space[i] as number;
    if (si < 0) continue;
    const [px, py] = center(i);
    walkable[i] = NON_WALKABLE.has((floor.spaces[si] as Floor["spaces"][number]).kind) || floor.voids.some((v) => pointInPolygon(px, py, v)) ? 0 : 1;
  }
  const portalIds = floor.portals.map((p) => p.id);
  const portalCells: number[][] = floor.portals.map(() => []);
  const link = new Int32Array(n * 4).fill(LINK_BLOCKED);
  const exitPortal = new Int32Array(n).fill(-1);
  const near = cellFt * 0.75;
  for (let i = 0; i < n; i++) {
    if (!walkable[i]) continue;
    const cx = i % w, cy = Math.floor(i / w);
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d] as readonly [number, number];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!walkable[j]) continue;
      const [ax, ay] = center(i), [bx, by] = center(j);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const same = space[i] === space[j];
      let found = same ? LINK_FREE : LINK_BLOCKED;
      floor.portals.forEach((p, pi) => {
        const { t, dist, len } = segmentParam(mx, my, p.a, p.b);
        const slack = len > 0 ? (cellFt * 0.5) / len : 1;
        if (dist > near || t < -slack || t > 1 + slack) return;
        if (same) {
          if (p.kind === "corridor_section" && side(ax, ay, p.a, p.b) !== side(bx, by, p.a, p.b)) found = pi;
        } else {
          const a = spaceIds[space[i] as number], b = spaceIds[space[j] as number];
          if ((p.connects[0] === a && p.connects[1] === b) || (p.connects[0] === b && p.connects[1] === a)) found = pi;
        }
      });
      link[i * 4 + d] = found;
      if (found >= 0) (portalCells[found] as number[]).push(i);
    }
  }
  floor.portals.forEach((p, pi) => {
    const outsideIdx = p.connects.indexOf(OUTSIDE);
    if (outsideIdx < 0) return;
    const inside = spaceIds.indexOf(p.connects[1 - outsideIdx] as string);
    for (let i = 0; i < n; i++) {
      if (!walkable[i] || space[i] !== inside) continue;
      const [px, py] = center(i);
      const { t, dist, len } = segmentParam(px, py, p.a, p.b);
      const slack = len > 0 ? (cellFt * 0.5) / len : 1;
      if (dist <= cellFt * 1.01 && t >= -slack && t <= 1 + slack) {
        exitPortal[i] = pi;
        (portalCells[pi] as number[]).push(i);
      }
    }
  });
  const headFlight = new Int32Array(n).fill(-1);
  for (const st of stairs) {
    st.flights.forEach((f, fi) => {
      const flightIdx = allFlights.findIndex((x) => x.stair === st.id && x.index === fi);
      for (let i = 0; i < n; i++) {
        if (!walkable[i]) continue;
        const [px, py] = center(i);
        if (f.from === floor.id && pointInPolygon(px, py, f.head)) headFlight[i] = flightIdx;
        if (f.to === floor.id && pointInPolygon(px, py, f.landing)) allFlights[flightIdx]?.landingCells.push(i);
      }
    });
  }
  void floorIdx;
  return { floor: floor.id, cellFt, ox, oy, w, h, spaceIds, space, walkable, link, exitPortal, headFlight, portalIds, portalCells };
}

export function rasterizeTwin(twin: Pick<Twin, "floors" | "stairs">, cellFt: number): TwinRaster {
  const floorIndex = Object.fromEntries(twin.floors.map((f, i) => [f.id, i]));
  const flights: TwinRaster["flights"] = twin.stairs.flatMap((st) =>
    st.flights.map((f, index) => ({ stair: st.id, index, from: floorIndex[f.from] as number, to: floorIndex[f.to] as number, travelFt: f.travelFt, widthIn: st.clearWidthIn, landingCells: [] as number[] })),
  );
  const floors = twin.floors.map((f, i) => rasterizeFloor(f, twin.stairs, flights, cellFt, i));
  const portalIndex: TwinRaster["portalIndex"] = {};
  floors.forEach((fr, fi) => fr.portalIds.forEach((id, index) => (portalIndex[id] = { floor: fi, index })));
  return { cellFt, floors, floorIndex, portalIndex, flights };
}

export function cellCenter(fr: FloorRaster, i: number): [number, number] {
  return [fr.ox + ((i % fr.w) + 0.5) * fr.cellFt, fr.oy + (Math.floor(i / fr.w) + 0.5) * fr.cellFt];
}

export function cellAt(fr: FloorRaster, x: number, y: number): number {
  const cx = Math.floor((x - fr.ox) / fr.cellFt), cy = Math.floor((y - fr.oy) / fr.cellFt);
  return cx < 0 || cy < 0 || cx >= fr.w || cy >= fr.h ? -1 : cy * fr.w + cx;
}
