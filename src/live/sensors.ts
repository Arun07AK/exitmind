import { Rng } from "../shared/rng.ts";
import { ST } from "../sim/constants.ts";
import type { Model } from "../sim/model.ts";
import type { World } from "../sim/world.ts";
import type { SensorHealth } from "../server/contract.ts";

export interface SensorDef {
  id: string;
  kind: SensorHealth["kind"];
  zone: string;
  target?: string;
}
export type Fault = "silent" | "corrupt";
export interface Reading {
  id: string;
  value: number | null;
}
export interface SensorBatch {
  tick: number;
  readings: Reading[];
}

export function sensorDefs(m: Model): SensorDef[] {
  const defs: SensorDef[] = [{ id: "PANEL", kind: "panel", zone: "building" }, { id: "SEI-1", kind: "seismic", zone: "building" }];
  for (const z of m.zones) defs.push({ id: `SMK-${z.id}`, kind: "smoke", zone: z.id }, { id: `DEN-${z.id}`, kind: "density", zone: z.id });
  for (const e of m.elements) {
    const fm = m.floors[e.floor]!;
    const c = e.cells[0] ?? 0;
    const zi = fm.zone[c]!;
    defs.push({ id: `DC-${e.id}`, kind: "door_count", zone: zi >= 0 ? m.zones[zi]!.id : "building", target: e.id });
  }
  return defs;
}

export class SensorFeed {
  readonly defs: SensorDef[];
  readonly faults = new Map<string, Fault>();
  readonly #rng: Rng;
  readonly #m: Model;
  #panelAlarm = false;
  readonly #zoneCells: number[][];
  constructor(m: Model, seed: number) {
    this.#m = m;
    this.defs = sensorDefs(m);
    this.#rng = Rng.stream(seed, "sensors");
    this.#zoneCells = m.zones.map((_, zi) => {
      const z = m.zones[zi]!, fm = m.floors.find((f) => f.id === z.floor)!;
      const out: number[] = [];
      for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.zone[i] === zi) out.push(i);
      return out;
    });
  }

  get panelAlarm(): boolean { return this.#panelAlarm; }

  read(w: World): SensorBatch {
    const m = this.#m, rng = this.#rng;
    const zoneSmoke = m.zones.map((z, zi) => {
      const fi = m.floors.findIndex((f) => f.id === z.floor);
      let mx = 0;
      for (const c of this.#zoneCells[zi]!) mx = Math.max(mx, w.hz.smoke[fi]![c]!);
      return mx;
    });
    const zoneCount = m.zones.map(() => 0);
    for (let a = 0; a < w.n; a++) {
      const s = w.state[a];
      if (s === ST.PROTECTED || s === ST.ON_STAIR) continue;
      const zi = m.floors[w.floor[a]!]!.zone[w.cell[a]!]!;
      if (zi >= 0) zoneCount[zi]!++;
    }
    if (zoneSmoke.some((v) => v > 0.15)) this.#panelAlarm = true;
    const readings: Reading[] = this.defs.map((d) => {
      let v: number;
      switch (d.kind) {
        case "panel": v = this.#panelAlarm ? 1 : 0; break;
        case "seismic": v = Math.max(0, (w.hz.shaking ? 1 : 0) + rng.normal(0, 0.03)); break;
        case "smoke": v = Math.min(1, Math.max(0, zoneSmoke[m.zoneIndex.get(d.zone)!]! + rng.normal(0, 0.01))); break;
        case "density": v = Math.max(0, Math.round(zoneCount[m.zoneIndex.get(d.zone)!]! + rng.normal(0, 0.8))); break;
        case "door_count": {
          const ei = m.elementIndex.get(d.target!)!;
          const e = m.elements[ei]!;
          v = e.portal >= 0 ? w.metrics.crossings[e.portal]! : w.metrics.flightEntries[e.flight]!;
          if (w.hz.damagedElements.has(ei)) v = -1;
          break;
        }
      }
      const f = this.faults.get(d.id);
      if (f === "silent") return { id: d.id, value: null };
      if (f === "corrupt") return { id: d.id, value: d.kind === "smoke" ? 7.5 : d.kind === "density" ? -40 : d.kind === "seismic" ? 99 : d.kind === "panel" ? 3 : -999 };
      return { id: d.id, value: Math.round(v * 1000) / 1000 };
    });
    return { tick: w.tick, readings };
  }
}
