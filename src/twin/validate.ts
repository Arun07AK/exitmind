import { bbox, isSimplePolygon, pointInPolygon } from "../shared/geom.ts";
import { OUTSIDE, rasterizeTwin, type TwinRaster } from "./raster.ts";
import { SHEET_IDS, type Twin, type TwinSource } from "./schema.ts";

export interface TwinReport {
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
}

const sheetSet: ReadonlySet<string> = new Set([...SHEET_IDS, "OSM", "UPLOAD"]);

export function reachableCells(raster: TwinRaster): Uint8Array[] {
  const reached = raster.floors.map((f) => new Uint8Array(f.w * f.h));
  const queue: [number, number][] = [];
  raster.floors.forEach((f, fi) => {
    for (let i = 0; i < f.w * f.h; i++) if (f.exitPortal[i] >= 0) { (reached[fi] as Uint8Array)[i] = 1; queue.push([fi, i]); }
  });
  const flightHeads = raster.flights.map((fl) => {
    const f = raster.floors[fl.from];
    const cells: number[] = [];
    if (f) for (let i = 0; i < f.w * f.h; i++) if (f.headFlight[i] === raster.flights.indexOf(fl)) cells.push(i);
    return cells;
  });
  const landingToFlights = new Map<string, number[]>();
  raster.flights.forEach((fl, k) => fl.landingCells.forEach((c) => {
    const key = `${fl.to}:${c}`;
    landingToFlights.set(key, [...(landingToFlights.get(key) ?? []), k]);
  }));
  while (queue.length) {
    const [fi, i] = queue.pop() as [number, number];
    const f = raster.floors[fi];
    if (!f) continue;
    const r = reached[fi] as Uint8Array;
    const cx = i % f.w, cy = Math.floor(i / f.w);
    for (let d = 0; d < 4; d++) {
      if ((f.link[i * 4 + d] as number) < -1) continue;
      const j = (cy + [0, 1, 0, -1][d]!) * f.w + cx + [1, 0, -1, 0][d]!;
      if (!r[j]) { r[j] = 1; queue.push([fi, j]); }
    }
    for (const k of landingToFlights.get(`${fi}:${i}`) ?? []) {
      const fl = raster.flights[k]!;
      const up = reached[fl.from] as Uint8Array;
      for (const c of flightHeads[k] ?? []) if (!up[c]) { up[c] = 1; queue.push([fl.from, c]); }
    }
  }
  return reached;
}

export function validateTwin(twin: Twin | TwinSource, cellFt = 0.4 / 0.3048): TwinReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkSrc = (what: string, s: { sheet: string } | undefined) => {
    if (!s || !sheetSet.has(s.sheet)) errors.push(`${what}: missing or invalid source sheet`);
  };
  const allSpaceIds = new Set<string>();
  for (const f of twin.floors) {
    if (!isSimplePolygon(f.outline)) errors.push(`${f.id}: outline is not a simple polygon`);
    for (const s of f.spaces) {
      if (allSpaceIds.has(s.id)) errors.push(`duplicate space id ${s.id}`);
      allSpaceIds.add(s.id);
      if (s.floor !== f.id) errors.push(`${s.id}: floor ${s.floor} listed under ${f.id}`);
      if (!isSimplePolygon(s.polygon)) errors.push(`${s.id}: polygon is not simple`);
      checkSrc(s.id, s.src);
    }
    const ids = new Set(f.spaces.map((s) => s.id));
    const portalIds = new Set<string>();
    for (const p of f.portals) {
      if (portalIds.has(p.id)) errors.push(`duplicate portal id ${p.id}`);
      portalIds.add(p.id);
      for (const c of p.connects) if (c !== OUTSIDE && !ids.has(c)) errors.push(`${p.id}: connects unknown space ${c} on ${f.id}`);
      if (!(p.clearWidthIn > 0)) errors.push(`${p.id}: clear width must be positive`);
      if (p.kind === "corridor_section" && p.connects[0] !== p.connects[1]) errors.push(`${p.id}: corridor_section must connect a space to itself`);
      checkSrc(p.id, p.src);
    }
    const step = 0.5;
    const [x0, y0, x1, y1] = bbox(f.spaces.flatMap((s) => s.polygon));
    const overlaps = new Map<string, number>();
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        const hit = f.spaces.filter((s) => pointInPolygon(x, y, s.polygon)).map((s) => s.id);
        if (hit.length > 1) { const k = hit.sort().join(" & "); overlaps.set(k, (overlaps.get(k) ?? 0) + 1); }
      }
    }
    for (const [k, n] of overlaps) (n * step * step > 1 ? errors : warnings).push(`${f.id}: ${k} overlap ${(n * step * step).toFixed(1)} sq ft`);
  }
  const raster = rasterizeTwin(twin, cellFt);
  raster.floors.forEach((fr, fi) => {
    const floor = twin.floors[fi]!;
    floor.portals.forEach((p, pi) => {
      if ((fr.portalCells[pi] ?? []).length === 0) errors.push(`${p.id}: no cell crossing found (not on a shared boundary of ${p.connects.join(" / ")}?)`);
    });
  });
  for (const st of twin.stairs) {
    checkSrc(st.id, st.src);
    for (const [fl, sid] of Object.entries(st.spaces)) if (!twin.floors.find((f) => f.id === fl)?.spaces.some((s) => s.id === sid)) errors.push(`${st.id}: stair space ${sid} not on ${fl}`);
    st.flights.forEach((f, k) => {
      const flight = raster.flights.find((x) => x.stair === st.id && x.index === k)!;
      const fr = raster.floors[flight.from]!;
      let heads = 0;
      for (let i = 0; i < fr.w * fr.h; i++) if (fr.headFlight[i] === raster.flights.indexOf(flight)) heads++;
      if (heads === 0) errors.push(`${st.id} flight ${f.from}->${f.to}: head region covers no walkable cell`);
      if (flight.landingCells.length === 0) errors.push(`${st.id} flight ${f.from}->${f.to}: landing region covers no walkable cell`);
    });
  }
  for (const e of twin.exits) {
    checkSrc(e.id, e.src);
    const f = twin.floors.find((x) => x.id === e.floor);
    const p = f?.portals.find((x) => x.id === e.portal);
    if (!p) { errors.push(`${e.id}: portal ${e.portal} not found on ${e.floor}`); continue; }
    if (e.kind === "exterior" && !p.connects.includes(OUTSIDE)) errors.push(`${e.id}: exterior exit portal must connect to OUTSIDE`);
    if (e.kind === "stair") {
      const st = twin.stairs.find((s) => s.id === e.stair);
      if (!st || !p.connects.includes(st.spaces[e.floor] ?? "")) errors.push(`${e.id}: stair exit portal must open into the stair space`);
    }
  }
  const targets = new Set([...twin.exits.map((e) => e.id), ...twin.stairs.map((s) => s.id)]);
  for (const m of twin.signMounts) {
    checkSrc(m.id, m.src);
    const s = twin.floors.find((f) => f.id === m.floor)?.spaces.find((x) => x.id === m.space);
    if (!s) errors.push(`${m.id}: space ${m.space} not found`);
    else if (!pointInPolygon(m.at[0], m.at[1], s.polygon)) errors.push(`${m.id}: mount point is outside space ${m.space}`);
    if (!targets.has(m.staticDefaultToward)) errors.push(`${m.id}: static default target ${m.staticDefaultToward} is not an exit or stair`);
  }
  const reached = reachableCells(raster);
  let walkableCells = 0;
  raster.floors.forEach((fr, fi) => {
    const floor = twin.floors[fi]!;
    const r = reached[fi]!;
    floor.spaces.forEach((s, si) => {
      let cells = 0, ok = 0;
      for (let i = 0; i < fr.w * fr.h; i++) if (fr.space[i] === si && fr.walkable[i]) { cells++; if (r[i]) ok++; }
      walkableCells += cells;
      if (s.kind !== "elevator" && s.kind !== "exterior" && cells === 0) warnings.push(`${s.id}: no walkable cell at simulation resolution`);
      if (s.occupiable && cells > 0 && ok === 0) errors.push(`${s.id}: cannot reach any exit`);
      else if (cells > 0 && ok < cells && s.kind !== "service") warnings.push(`${s.id}: ${cells - ok} of ${cells} cells cannot reach an exit`);
    });
  });
  return {
    errors,
    warnings,
    stats: {
      floors: twin.floors.length,
      spaces: twin.floors.reduce((a, f) => a + f.spaces.length, 0),
      portals: twin.floors.reduce((a, f) => a + f.portals.length, 0),
      stairs: twin.stairs.length,
      exits: twin.exits.length,
      signMounts: twin.signMounts.length,
      walkableCells,
    },
  };
}
