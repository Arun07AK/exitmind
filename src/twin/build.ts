import { existsSync, readFileSync, readdirSync } from "node:fs";
import { canonicalJSON, sha256Hex } from "../shared/hash.ts";
import { repoPath } from "../shared/paths.ts";
import type { Twin, TwinSource, Zone } from "./schema.ts";

export const ZONE_BANDS: readonly { suffix: string; name: string; x: [number, number] }[] = [
  { suffix: "N", name: "north (grids A-E)", x: [-1000, 80] },
  { suffix: "C", name: "central (grids E-H)", x: [80, 140] },
  { suffix: "S", name: "south (grids H-M)", x: [140, 1000] },
];

export function zonesFor(src: TwinSource): Zone[] {
  return src.floors.flatMap((f) => (src.zoneBands ?? ZONE_BANDS).map((b) => ({ id: `Z${f.id.slice(1)}${b.suffix}`, floor: f.id, name: `${f.name} ${b.name}`, xRangeFt: b.x })));
}

export function zoneOf(twin: Pick<Twin, "zones">, floor: string, x: number): string {
  return (twin.zones.find((z) => z.floor === floor && x >= z.xRangeFt[0] && x < z.xRangeFt[1]) ?? twin.zones[0]!).id;
}

export function finalizeTwin(src: TwinSource): Twin {
  const body = { ...src, zones: zonesFor(src) };
  return { ...body, hash: sha256Hex(canonicalJSON(body)) };
}

export const VENUES: Readonly<Record<string, string>> = { "rinker-hall": "rinker.twin.json", "thapar-fete": "thapar-fete.twin.json" };
export type VenueId = string;
export const PLAN_PREFIX = "plan-";
export const uploadsDir = (...p: string[]): string => repoPath("data", "uploads", ...p);

/** Built-in venues plus every uploaded plan that has been saved as a twin. */
export function listVenues(): string[] {
  const out = Object.keys(VENUES);
  if (existsSync(uploadsDir())) for (const d of readdirSync(uploadsDir()).sort()) if (existsSync(uploadsDir(d, "twin.json"))) out.push(PLAN_PREFIX + d);
  return out;
}

export function isVenue(id: unknown): id is string {
  return typeof id === "string" && listVenues().includes(id);
}

export function loadVenue(id: VenueId): Twin {
  if (id.startsWith(PLAN_PREFIX)) return loadTwin(uploadsDir(id.slice(PLAN_PREFIX.length), "twin.json"));
  const f = VENUES[id];
  if (!f) throw new Error(`unknown venue ${id}`);
  return loadTwin(repoPath("data", "twin", f));
}

export function loadTwin(path = repoPath("data", "twin", "rinker.twin.json")): Twin {
  return JSON.parse(readFileSync(path, "utf8")) as Twin;
}
