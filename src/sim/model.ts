import { pointInPolygon } from "../shared/geom.ts";
import { M_PER_FT } from "../shared/units.ts";
import { withCorridorSections } from "../twin/augment.ts";
import { DIAG, DIRS, LINK_BLOCKED, LINK_FREE, OUTSIDE, cellAt, rasterizeTwin, type TwinRaster } from "../twin/raster.ts";
import type { Floor, Twin } from "../twin/schema.ts";

export const CELL_M = 0.4;
export const CELL_FT = CELL_M / M_PER_FT;
const NB = [...DIRS, ...DIAG] as const;

export interface FloorModel {
  id: string;
  index: number;
  elevationFt: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  n: number;
  walkable: Uint8Array;
  space: Int16Array;
  nbr: Int32Array;
  nbrPortal: Int32Array;
  exitPortal: Int32Array;
  headFlight: Int32Array;
  zone: Int16Array;
  lockable: Uint8Array;
  cx: Float32Array;
  cy: Float32Array;
  winArea5: Float32Array;
  winArea3: Float32Array;
}

export interface PortalModel {
  id: string;
  floor: number;
  kind: "door" | "opening" | "corridor_section";
  widthM: number;
  isExit: boolean;
  accessible: boolean;
  exitId: string | null;
  spaces: [string, string];
  cells: number[];
}

export interface FlightModel {
  stairId: string;
  from: number;
  to: number;
  lengthM: number;
  widthM: number;
  landingCells: Int32Array;
  next: number;
}

export interface ElementModel {
  id: string;
  label: string;
  kind: "exit" | "stair";
  floor: number;
  portal: number;
  flight: number;
  stairId: string | null;
  exitId: string | null;
  cells: Int32Array;
  spaces: Set<number>;
}

export interface MountModel {
  id: string;
  floor: number;
  cell: number;
  x: number;
  y: number;
  facing: [number, number];
  visibleSpaces: Set<number>;
  staticTarget: number;
  zone: number;
}

export interface Model {
  twin: Twin;
  raster: TwinRaster;
  floors: FloorModel[];
  portals: PortalModel[];
  portalOffset: number[];
  flights: FlightModel[];
  elements: ElementModel[];
  elementIndex: Map<string, number>;
  elementsByFloor: number[][];
  zones: Twin["zones"];
  zoneIndex: Map<string, number>;
  mounts: MountModel[];
  spaceFloor: Map<string, number>;
  spaceInfo: { id: string; floor: number; kind: string; use: string; occupiable: boolean; lockable: boolean; name: string; areaSqft: number }[][];
}

function windowArea(walkable: Uint8Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && walkable[yy * w + xx]) c++;
    }
    out[y * w + x] = c * CELL_M * CELL_M;
  }
  return out;
}

export function buildModel(input: Twin): Model {
  const twin = withCorridorSections(input);
  const raster = rasterizeTwin(twin, CELL_FT);
  const portals: PortalModel[] = [];
  const portalOffset: number[] = [];
  twin.floors.forEach((f, fi) => {
    portalOffset.push(portals.length);
    f.portals.forEach((p, pi) => {
      const exit = twin.exits.find((e) => e.kind === "exterior" && e.portal === p.id && e.floor === f.id);
      portals.push({
        id: p.id, floor: fi, kind: p.kind, widthM: (p.clearWidthIn * 0.0254),
        isExit: p.connects.includes(OUTSIDE), accessible: p.accessible, exitId: exit?.id ?? null, spaces: p.connects,
        cells: raster.floors[fi]!.portalCells[pi] ?? [],
      });
    });
  });
  const flights: FlightModel[] = raster.flights.map((fl) => {
    const st = twin.stairs.find((s) => s.id === fl.stair)!;
    return { stairId: fl.stair, from: fl.from, to: fl.to, lengthM: fl.travelFt * M_PER_FT, widthM: st.clearWidthIn * 0.0254, landingCells: Int32Array.from(fl.landingCells), next: -1 };
  });
  flights.forEach((f) => (f.next = flights.findIndex((g) => g.stairId === f.stairId && g.from === f.to)));
  const zoneIndex = new Map(twin.zones.map((z, i) => [z.id, i]));
  const floors: FloorModel[] = raster.floors.map((fr, fi) => {
    const floor = twin.floors[fi] as Floor;
    const n = fr.w * fr.h;
    const nbr = new Int32Array(n * 8).fill(-1);
    const nbrPortal = new Int32Array(n * 8).fill(-1);
    const off = portalOffset[fi] as number;
    for (let i = 0; i < n; i++) {
      if (!fr.walkable[i]) continue;
      const x = i % fr.w, y = Math.floor(i / fr.w);
      for (let d = 0; d < 4; d++) {
        const l = fr.link[i * 4 + d] as number;
        if (l === LINK_BLOCKED) continue;
        const [dx, dy] = NB[d] as readonly [number, number];
        nbr[i * 8 + d] = (y + dy) * fr.w + x + dx;
        if (l !== LINK_FREE) nbrPortal[i * 8 + d] = off + l;
      }
      for (let d = 4; d < 8; d++) {
        const [dx, dy] = NB[d] as readonly [number, number];
        const dA = DIRS.findIndex(([a, b]) => a === dx && b === 0), dB = DIRS.findIndex(([a, b]) => a === 0 && b === dy);
        if (fr.link[i * 4 + dA] !== LINK_FREE || fr.link[i * 4 + dB] !== LINK_FREE) continue;
        const j = (y + dy) * fr.w + x + dx;
        const jA = y * fr.w + x + dx, jB = (y + dy) * fr.w + x;
        if (fr.link[jA * 4 + dB] !== LINK_FREE || fr.link[jB * 4 + dA] !== LINK_FREE) continue;
        if (fr.walkable[j] && fr.space[j] === fr.space[i]) nbr[i * 8 + d] = j;
      }
    }
    const exitPortal = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) if ((fr.exitPortal[i] as number) >= 0) exitPortal[i] = off + (fr.exitPortal[i] as number);
    const zone = new Int16Array(n).fill(-1);
    const lockable = new Uint8Array(n);
    const cx = new Float32Array(n), cy = new Float32Array(n);
    const floorZones = twin.zones.map((z, zi) => ({ z, zi })).filter(({ z }) => z.floor === floor.id);
    for (let i = 0; i < n; i++) {
      const px = fr.ox + ((i % fr.w) + 0.5) * fr.cellFt, py = fr.oy + (Math.floor(i / fr.w) + 0.5) * fr.cellFt;
      cx[i] = px; cy[i] = py;
      if (!fr.walkable[i]) continue;
      zone[i] = floorZones.find(({ z }) => px >= z.xRangeFt[0] && px < z.xRangeFt[1])?.zi ?? -1;
      const s = floor.spaces[fr.space[i] as number];
      if (s?.lockable) lockable[i] = 1;
    }
    return {
      id: floor.id, index: fi, elevationFt: floor.elevationFt, w: fr.w, h: fr.h, ox: fr.ox, oy: fr.oy, n,
      walkable: fr.walkable, space: fr.space, nbr, nbrPortal, exitPortal, headFlight: fr.headFlight, zone, lockable, cx, cy,
      winArea5: windowArea(fr.walkable, fr.w, fr.h, 2), winArea3: windowArea(fr.walkable, fr.w, fr.h, 1),
    };
  });
  const elements: ElementModel[] = [];
  for (const e of twin.exits.filter((x) => x.kind === "exterior")) {
    const gp = portals.findIndex((p) => p.id === e.portal && twin.floors[p.floor]!.id === e.floor);
    const fi = portals[gp]!.floor;
    const cells = Int32Array.from(portals[gp]!.cells.filter((c) => floors[fi]!.exitPortal[c] === gp));
    elements.push({ id: e.id, label: e.name, kind: "exit", floor: fi, portal: gp, flight: -1, stairId: null, exitId: e.id, cells, spaces: new Set([...cells].map((c) => floors[fi]!.space[c] as number)) });
  }
  flights.forEach((fl, k) => {
    const fm = floors[fl.from]!;
    const cells: number[] = [];
    for (let i = 0; i < fm.n; i++) if (fm.headFlight[i] === k) cells.push(i);
    const st = twin.stairs.find((s) => s.id === fl.stairId)!;
    elements.push({ id: `${fl.stairId}@${fm.id}`, label: st.name, kind: "stair", floor: fl.from, portal: -1, flight: k, stairId: fl.stairId, exitId: twin.exits.find((e) => e.stair === fl.stairId && e.floor === fm.id)?.id ?? null, cells: Int32Array.from(cells), spaces: new Set(cells.map((c) => fm.space[c] as number)) });
  });
  if (elements.length > 32) throw new Error(`model supports at most 32 egress elements, got ${elements.length}`);
  const elementIndex = new Map<string, number>();
  elements.forEach((e, i) => {
    elementIndex.set(e.id, i);
    if (e.exitId) elementIndex.set(e.exitId, i);
  });
  const elementsByFloor = floors.map((f) => elements.flatMap((e, i) => (e.floor === f.index ? [i] : [])));
  const resolveTarget = (target: string, fi: number): number => {
    const direct = elementIndex.get(target);
    if (direct !== undefined && elements[direct]!.floor === fi) return direct;
    return elementIndex.get(`${target}@${floors[fi]!.id}`) ?? direct ?? -1;
  };
  const openingNeighbours = (fi: number, si: number): Set<number> => {
    const floor = twin.floors[fi]!;
    const sid = floor.spaces[si]!.id;
    const out = new Set([si]);
    for (const p of floor.portals) if (p.kind === "opening" && p.connects.includes(sid)) {
      const other = p.connects[0] === sid ? p.connects[1] : p.connects[0];
      const oi = floor.spaces.findIndex((s) => s.id === other);
      if (oi >= 0) out.add(oi);
    }
    return out;
  };
  const mounts: MountModel[] = twin.signMounts.map((m) => {
    const fi = floors.findIndex((f) => f.id === m.floor);
    const fr = raster.floors[fi]!;
    const cell = cellAt(fr, m.at[0], m.at[1]);
    const si = twin.floors[fi]!.spaces.findIndex((s) => s.id === m.space);
    const z = twin.zones.findIndex((zz) => zz.floor === m.floor && m.at[0] >= zz.xRangeFt[0] && m.at[0] < zz.xRangeFt[1]);
    return { id: m.id, floor: fi, cell, x: m.at[0], y: m.at[1], facing: m.facing, visibleSpaces: openingNeighbours(fi, si), staticTarget: resolveTarget(m.staticDefaultToward, fi), zone: z };
  });
  const spaceFloor = new Map<string, number>();
  const spaceInfo = twin.floors.map((f, fi) => f.spaces.map((s) => {
    spaceFloor.set(s.id, fi);
    let cells = 0;
    const fm = floors[fi]!;
    for (let i = 0; i < fm.n; i++) if (fm.space[i] === f.spaces.indexOf(s) && fm.walkable[i]) cells++;
    return { id: s.id, floor: fi, kind: s.kind, use: s.use, occupiable: s.occupiable, lockable: s.lockable, name: s.name, areaSqft: cells * CELL_FT * CELL_FT };
  }));
  void pointInPolygon;
  return { twin, raster, floors, portals, portalOffset, flights, elements, elementIndex, elementsByFloor, zones: twin.zones, zoneIndex, mounts, spaceFloor, spaceInfo };
}

export function resolveElement(m: Model, target: string, floor: number): number {
  const direct = m.elementIndex.get(target);
  if (direct !== undefined && m.elements[direct]!.floor === floor) return direct;
  const viaStair = m.elementIndex.get(`${target}@${m.floors[floor]!.id}`);
  if (viaStair !== undefined) return viaStair;
  if (direct !== undefined) {
    const st = m.elements[direct]!.stairId;
    if (st) return m.elementIndex.get(`${st}@${m.floors[floor]!.id}`) ?? -1;
  }
  return -1;
}
