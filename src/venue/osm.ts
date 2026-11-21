import { finalizeTwin } from "../twin/build.ts";
import type { Floor, Portal, Pt, SignMount, SourceRef, Twin, TwinSource } from "../twin/schema.ts";

export interface OsmElement { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }
export interface OsmExtract { osm3s?: { timestamp_osm_base?: string; copyright?: string }; elements: OsmElement[] }

export const FETE_WAY = 396666360;
export const ATTRIBUTION = "Venue outline and surrounding paths © OpenStreetMap contributors, available under the Open Database License (ODbL), openstreetmap.org/copyright";

const FT_PER_M = 1 / 0.3048;

export function projector(lat0: number, lon0: number) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320 * FT_PER_M, ky = 110540 * FT_PER_M;
  return (p: { lat: number; lon: number }): Pt => [Math.round((p.lon - lon0) * kx * 10) / 10, Math.round(-(p.lat - lat0) * ky * 10) / 10];
}

function nearestOnSegment(p: Pt, a: Pt, b: Pt): { q: Pt; d: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  const q: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), t };
}

function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]], s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

export interface GateCandidate { at: Pt; edge: number; ways: string[]; kinds: string[] }

export function gateCandidates(outline: Pt[], ways: { id: string; kind: string; pts: Pt[] }[], touchFt = 60, mergeFt = 90): GateCandidate[] {
  const raw: { at: Pt; edge: number; way: string; kind: string }[] = [];
  const edges = outline.map((p, i) => [p, outline[(i + 1) % outline.length]!] as [Pt, Pt]);
  for (const w of ways) {
    for (let k = 0; k + 1 < w.pts.length; k++) for (const [ei, [a, b]] of edges.entries()) {
      const x = segIntersect(w.pts[k]!, w.pts[k + 1]!, a, b);
      if (x) raw.push({ at: x, edge: ei, way: w.id, kind: w.kind });
    }
    for (const end of [w.pts[0]!, w.pts[w.pts.length - 1]!]) {
      let best: { q: Pt; d: number; ei: number } | null = null;
      for (const [ei, [a, b]] of edges.entries()) { const n = nearestOnSegment(end, a, b); if (!best || n.d < best.d) best = { q: n.q, d: n.d, ei }; }
      if (best && best.d <= touchFt) raw.push({ at: best.q, edge: best.ei, way: w.id, kind: w.kind });
    }
  }
  const out: GateCandidate[] = [];
  for (const r of raw) {
    const g = out.find((o) => Math.hypot(o.at[0] - r.at[0], o.at[1] - r.at[1]) < mergeFt);
    if (g) { if (!g.ways.includes(r.way)) { g.ways.push(r.way); g.kinds.push(r.kind); } }
    else out.push({ at: r.at, edge: r.edge, ways: [r.way], kinds: [r.kind] });
  }
  return out;
}

function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

export function buildFeteTwin(osm: OsmExtract): Twin {
  const fete = osm.elements.find((e) => e.id === FETE_WAY && e.geometry);
  if (!fete?.geometry) throw new Error(`OSM way ${FETE_WAY} (Fete Area) not in the extract`);
  const g = fete.geometry;
  const lat0 = g.slice(0, -1).reduce((a, p) => a + p.lat, 0) / (g.length - 1), lon0 = g.slice(0, -1).reduce((a, p) => a + p.lon, 0) / (g.length - 1);
  const P = projector(lat0, lon0);
  let outline = g.map(P);
  if (outline.length > 1 && outline[0]![0] === outline.at(-1)![0] && outline[0]![1] === outline.at(-1)![1]) outline = outline.slice(0, -1);
  const osmSrc = (note: string, id = String(FETE_WAY)): SourceRef => ({ sheet: "OSM", basis: "scaled", osm: `way/${id}`, note });
  const assumed = (note: string): SourceRef => ({ sheet: "OSM", basis: "assumed", note });
  const paths = osm.elements.filter((e) => e.geometry && e.tags?.highway && ["service", "footway", "path", "pedestrian", "living_street", "residential", "unclassified"].includes(e.tags.highway))
    .map((e) => ({ id: String(e.id), kind: e.tags!.highway!, pts: e.geometry!.map(P) }));
  const cands = gateCandidates(outline, paths);
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const [minX, maxX, minY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys)];
  const northEdge = outline.map((p, i) => [p, outline[(i + 1) % outline.length]!] as [Pt, Pt]).filter(([a, b]) => a[1] < minY + 60 && b[1] < minY + 60).sort((u, v) => Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]) - Math.hypot(u[1][0] - u[0][0], u[1][1] - u[0][1]))[0]!;
  const mid: Pt = [(northEdge[0][0] + northEdge[1][0]) / 2, (northEdge[0][1] + northEdge[1][1]) / 2];
  const stage: Pt[] = [[mid[0] - 45, mid[1] + 18], [mid[0] + 45, mid[1] + 18], [mid[0] + 45, mid[1] + 58], [mid[0] - 45, mid[1] + 58]];
  const sc = centroid(stage);
  const scored = cands.map((c) => ({ c, dStage: Math.hypot(c.at[0] - sc[0], c.at[1] - sc[1]), service: c.kinds.includes("service") }));
  const staff = [...scored].sort((a, b) => a.dStage - b.dStage)[0]!;
  const others = scored.filter((x) => x !== staff).sort((a, b) => b.dStage - a.dStage);
  const main = others.filter((x) => x.service).slice(0, 2);
  const mains = main.length ? main : others.slice(0, 1);
  const gates = scored.map((x, i) => {
    const [a, b] = [outline[x.c.edge]!, outline[(x.c.edge + 1) % outline.length]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const isMain = mains.includes(x), isStaff = x === staff;
    const widthFt = isMain ? 20 : 12;
    const side = Math.abs(ux) > Math.abs(uy) ? (x.c.at[1] < 0 ? "north" : "south") : x.c.at[0] < 0 ? "west" : "east";
    return { id: `G${i + 1}`, name: `${isMain ? "Main" : isStaff ? "Backstage" : "Side"} gate (${side}, where ${x.c.kinds.join("/")} way ${x.c.ways.join(", ")} meets the ground)`, at: x.c.at, a: [x.c.at[0] - (ux * widthFt) / 2, x.c.at[1] - (uy * widthFt) / 2] as Pt, b: [x.c.at[0] + (ux * widthFt) / 2, x.c.at[1] + (uy * widthFt) / 2] as Pt, widthFt, isMain, isStaff, ways: x.c.ways, side };
  });
  const portals: Portal[] = gates.map((gt) => ({ id: `X-${gt.id}`, floor: "F1", kind: "door", a: gt.a, b: gt.b, clearWidthIn: gt.widthFt * 12, connects: ["FETE", "OUTSIDE"], accessible: true, src: { ...osmSrc(`gate position where OSM way ${gt.ways.join(", ")} meets the Fete Area boundary; width ${gt.widthFt} ft is an assumption`, gt.ways[0]), basis: "assumed" } }));
  const inward = (p: Pt, d: number): Pt => { const c = centroid(outline); const L = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1; return [Math.round((p[0] + ((c[0] - p[0]) / L) * d) * 10) / 10, Math.round((p[1] + ((c[1] - p[1]) / L) * d) * 10) / 10]; };
  const signMounts: SignMount[] = gates.map((gt) => {
    const at = inward(gt.at, 25), c = centroid(outline);
    return { id: `SM-${gt.id}`, floor: "F1", at, facing: [Math.sign(c[0] - at[0]) || 1, 0], space: "FETE", staticDefaultToward: `EX-${gt.id}`, src: assumed("sign mount placed 25 ft inside the gate (assumption)") };
  });
  const c0 = centroid(outline);
  const nearestGate = (p: Pt) => gates.reduce((best, gt) => (Math.hypot(gt.at[0] - p[0], gt.at[1] - p[1]) < Math.hypot(best.at[0] - p[0], best.at[1] - p[1]) ? gt : best));
  for (const [k, p] of ([[c0[0] - 120, c0[1] + 40], [c0[0] + 120, c0[1] + 40]] as Pt[]).entries()) signMounts.push({ id: `SM-C${k + 1}`, floor: "F1", at: p, facing: [k === 0 ? -1 : 1, 0], space: "FETE", staticDefaultToward: `EX-${nearestGate(p).id}`, src: assumed("free-standing sign in the crowd area (assumption)") });
  const area = Math.abs(outline.reduce((s, p, i) => { const q = outline[(i + 1) % outline.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const floor: Floor = {
    id: "F1", name: "Fete Area (ground level)", elevationFt: 0, outline, voids: [stage],
    spaces: [{ id: "FETE", name: "Fete Area", floor: "F1", kind: "room", use: "assembly", polygon: outline, occupiable: true, lockable: false, src: osmSrc("OSM leisure=pitch name=Fete Area") }],
    portals,
  };
  const third = (maxX - minX) / 3;
  const src: TwinSource = {
    id: "thapar-fete", name: "Fete Area, Thapar Institute of Engineering & Technology, Patiala (from OpenStreetMap)",
    frame: { gridX: {}, gridY: {}, north: "-y" },
    floors: [floor], stairs: [],
    exits: gates.map((gt) => ({ id: `EX-${gt.id}`, name: gt.name, floor: "F1", kind: "exterior", portal: `X-${gt.id}`, src: portals.find((p) => p.id === `X-${gt.id}`)!.src })),
    signMounts,
    codeBasis: {
      occupantLoadSqftPerPerson: 5, egressInPerPerson: { corridorsDoors: 0.2, stairs: 0.3 }, minDoorClearIn: 32, minCorridorIn: 44, minCorridorSmallLoadIn: 36, minExits: 2,
      travelDistanceFt: { nfpa101: 200, sbc: 250 }, commonPathFt: 100, deadEndFt: 20, twoDoorRoomLoad: 50, twoDoorTravelFt: 75, grossAreaSqft: { F1: Math.round(area), F2: 0, F3: 0 },
      src: assumed("outdoor event ground: no code summary exists for it; these values are placeholders and the code check is not run for this venue"),
    },
    sheets: [],
    zoneBands: [
      { suffix: "W", name: "west third", x: [-1e5, minX + third] },
      { suffix: "C", name: "centre third", x: [minX + third, minX + 2 * third] },
      { suffix: "E", name: "east third", x: [minX + 2 * third, 1e5] },
    ],
    venue: {
      kind: "outdoor", label: "Saturnalia concert ground (Fete Area), TIET Patiala",
      origin: { lat: Math.round(lat0 * 1e7) / 1e7, lon: Math.round(lon0 * 1e7) / 1e7 }, attribution: ATTRIBUTION,
      osmWays: [String(FETE_WAY), ...new Set(gates.flatMap((gt) => gt.ways))],
      stage, mainGates: gates.filter((gt) => gt.isMain).map((gt) => `EX-${gt.id}`), staffGates: gates.filter((gt) => gt.isStaff).map((gt) => `EX-${gt.id}`),
      assumptions: [
        `Outline is the OSM "Fete Area" polygon (way ${FETE_WAY}, ${Math.round(area)} sq ft); the event perimeter is assumed to follow it.`,
        "Stage position is not in OSM: a 90 ft x 40 ft stage is assumed at the middle of the north edge, facing south.",
        `Gates are placed where OSM paths and service roads meet the boundary (${gates.length} gates); their widths (20 ft main, 12 ft others) are assumptions.`,
        `Main gates (where attendees entered): ${gates.filter((gt) => gt.isMain).map((gt) => gt.id).join(", ")}; the gate nearest the stage (${staff ? gates.find((gt) => gt.isStaff)?.id : "-"}) is assumed to be the backstage/staff gate.`,
        "Ground is treated as flat and open, with no fixed seating, barriers or stalls inside the perimeter.",
      ],
    },
  };
  return finalizeTwin(src);
}
