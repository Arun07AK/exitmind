import { readFileSync } from "node:fs";
import { canonicalJSON, sha256Hex } from "../shared/hash.ts";
import { repoPath } from "../shared/paths.ts";
import type { Twin, TwinSource, Zone } from "./schema.ts";

export const ZONE_BANDS: readonly { suffix: string; name: string; x: [number, number] }[] = [
  { suffix: "N", name: "north (grids A-E)", x: [-1000, 80] },
  { suffix: "C", name: "central (grids E-H)", x: [80, 140] },
  { suffix: "S", name: "south (grids H-M)", x: [140, 1000] },
];

export function zonesFor(src: TwinSource): Zone[] {
  return src.floors.flatMap((f) => ZONE_BANDS.map((b) => ({ id: `Z${f.id.slice(1)}${b.suffix}`, floor: f.id, name: `${f.name} ${b.name}`, xRangeFt: b.x })));
}

export function zoneOf(twin: Pick<Twin, "zones">, floor: string, x: number): string {
  return (twin.zones.find((z) => z.floor === floor && x >= z.xRangeFt[0] && x < z.xRangeFt[1]) ?? twin.zones[0]!).id;
}

export function finalizeTwin(src: TwinSource): Twin {
  const body = { ...src, zones: zonesFor(src) };
  return { ...body, hash: sha256Hex(canonicalJSON(body)) };
}

export function loadTwin(path = repoPath("data", "twin", "rinker.twin.json")): Twin {
  return JSON.parse(readFileSync(path, "utf8")) as Twin;
}
