import type { Params } from "../shared/params.ts";
import { distanceField } from "../sim/fields.ts";
import { HazardState } from "../sim/hazards.ts";
import type { Model } from "../sim/model.ts";
import type { HazardSpec, Protocol, RoutePolicy, ZoneInstruction } from "../sim/types.ts";

export interface RouteView {
  hz: HazardState;
  fields: Float32Array[];
  open: boolean[];
}

export function routeView(m: Model, hazard: HazardSpec, hp: Params, atSec = 0, closed: string[] = []): RouteView {
  const hz = new HazardState(m, hazard, hp);
  hz.update(atSec);
  const closedSet = new Set(closed);
  const open = m.elements.map((e, ei) => !hz.damagedElements.has(ei) && !closedSet.has(e.id) && !(e.exitId && closedSet.has(e.exitId)) && !(e.stairId && closedSet.has(e.stairId)) && !(e.portal >= 0 && hz.closedPortal[e.portal]) && !(e.flight >= 0 && hz.closedFlight[e.flight]));
  const costs = m.floors.map((f, fi) => hz.routeCost(fi, new Float32Array(f.n)));
  const fields = m.elements.map((e, ei) => distanceField(m.floors[e.floor]!, open[ei] ? e.cells : [], new Float32Array(m.floors[e.floor]!.n), { extraCost: costs[e.floor], blocked: hz.blocked[e.floor], closedPortal: hz.closedPortal }));
  return { hz, fields, open };
}

export function zoneCells(m: Model, zi: number): { floor: number; cells: number[] } {
  const z = m.zones[zi]!;
  const fi = m.floors.findIndex((f) => f.id === z.floor);
  const fm = m.floors[fi]!;
  const cells: number[] = [];
  for (let i = 0; i < fm.n; i++) if (fm.walkable[i] && fm.zone[i] === zi) cells.push(i);
  return { floor: fi, cells };
}

export function bestElementForZone(m: Model, rv: RouteView, zi: number, exclude: Set<number> = new Set()): { element: number; meanM: number } | null {
  const { floor, cells } = zoneCells(m, zi);
  let best: { element: number; meanM: number } | null = null;
  for (const ei of m.elementsByFloor[floor]!) {
    if (!rv.open[ei] || exclude.has(ei)) continue;
    let s = 0, k = 0;
    for (const c of cells) { const d = rv.fields[ei]![c]!; if (d < Infinity) { s += d; k++; } }
    if (k < cells.length * 0.5) continue;
    const mean = s / Math.max(1, k);
    if (!best || mean < best.meanM) best = { element: ei, meanM: mean };
  }
  return best;
}

export function hazardZone(m: Model, h: HazardSpec): number {
  if (!h.floor || !h.at) return -1;
  return m.zones.findIndex((z) => z.floor === h.floor && h.at![0] >= z.xRangeFt[0] && h.at![0] < z.xRangeFt[1]);
}

const PHASE_DELAY_SEC = 60;
export const HOLD_SEC = 45;

export function protocolPolicy(m: Model, protocol: Protocol, hazard: HazardSpec, hp: Params, opts: { atSec?: number; closed?: string[]; avoidHazardZone?: boolean } = {}): RoutePolicy {
  const rv = routeView(m, hazard, hp, opts.atSec ?? 0, opts.closed ?? []);
  const hzZone = hazardZone(m, hazard);
  const hzFloor = hazard.floor ? m.floors.findIndex((f) => f.id === hazard.floor) : -1;
  const exclude = new Set<number>();
  if (opts.avoidHazardZone && hzZone >= 0) {
    const zr = m.zones[hzZone]!;
    m.elements.forEach((e, ei) => {
      if (m.floors[e.floor]!.id !== zr.floor) return;
      const fm = m.floors[e.floor]!;
      const x = e.cells.length ? fm.cx[e.cells[0]!]! : -1e9;
      if (x >= zr.xRangeFt[0] && x < zr.xRangeFt[1]) exclude.add(ei);
    });
  }
  const route = (zi: number) => {
    const b = bestElementForZone(m, rv, zi, exclude) ?? bestElementForZone(m, rv, zi);
    return b ? m.elements[b.element]!.id : null;
  };
  const zones: ZoneInstruction[] = m.zones.map((z, zi) => {
    const fi = m.floors.findIndex((f) => f.id === z.floor);
    switch (protocol) {
      case "EVACUATE":
      case "INFLOW_CONTROL":
        return { zone: z.id, instruction: "EVACUATE_VIA", via: route(zi), delaySec: 0 };
      case "PHASED_EVACUATION": {
        const order = hzFloor >= 0 ? (fi === hzFloor ? 0 : fi === hzFloor + 1 ? 1 : 2 + Math.abs(fi - hzFloor)) : m.floors.length - 1 - fi;
        return { zone: z.id, instruction: "EVACUATE_VIA", via: route(zi), delaySec: order * PHASE_DELAY_SEC };
      }
      case "HOLD_THEN_EVACUATE":
        return { zone: z.id, instruction: "EVACUATE_VIA", via: route(zi), delaySec: HOLD_SEC + (hazard.kind === "quake" ? hp.get("quake.shakeSec") : 0) };
      case "LOCKDOWN_SHELTER":
        return { zone: z.id, instruction: "LOCKDOWN", via: null, delaySec: 0 };
      case "HORIZONTAL_EVACUATION": {
        if (zi !== hzZone && !(hzZone < 0 && z.id.endsWith("C"))) return { zone: z.id, instruction: "MOVE_TO_COMPARTMENT", via: z.id, delaySec: 0 };
        const same = m.zones.map((zz, k) => ({ zz, k })).filter(({ zz, k }) => zz.floor === z.floor && k !== zi);
        const far = same.sort((a, b) => Math.abs(b.zz.xRangeFt[0] - z.xRangeFt[0]) - Math.abs(a.zz.xRangeFt[0] - z.xRangeFt[0]) || a.k - b.k);
        const adj = far.length ? far[far.length - 1]! : null;
        return { zone: z.id, instruction: "MOVE_TO_COMPARTMENT", via: adj ? adj.zz.id : z.id, delaySec: 0 };
      }
    }
  });
  return { zones, closedRoutes: [...(opts.closed ?? [])], inflowClosed: protocol === "INFLOW_CONTROL" || protocol === "LOCKDOWN_SHELTER" ? m.elements.filter((e) => e.kind === "exit").map((e) => e.id) : [] };
}
