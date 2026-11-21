import { readFileSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";
import type { RouteView } from "../design/protocols.ts";
import { distanceField } from "../sim/fields.ts";
import { resolveElement, type Model } from "../sim/model.ts";
import type { Arrow, ArrowDir, RoutePolicy, SignState } from "../sim/types.ts";

export interface Templates {
  sign: Record<"exit" | "exitStair" | "safeArea" | "hold" | "stay" | "lockdown", string>;
  announcement: Record<string, string>;
}
let cached: Templates | null = null;
export function templates(): Templates {
  return (cached ??= JSON.parse(readFileSync(repoPath("config", "templates.json"), "utf8")) as Templates);
}

export class SignCompileError extends Error {}

function descentVector(m: Model, field: Float32Array, floor: number, cell: number): [number, number] | null {
  const fm = m.floors[floor]!;
  if (cell < 0 || !(field[cell]! < Infinity)) return null;
  let c = cell;
  for (let k = 0; k < 10; k++) {
    let best = -1, bv = field[c]!;
    for (let d = 0; d < 8; d++) {
      const j = fm.nbr[c * 8 + d]!;
      if (j >= 0 && field[j]! < bv) { bv = field[j]!; best = j; }
    }
    if (best < 0) break;
    c = best;
  }
  return c === cell ? [0, -1] : [fm.cx[c]! - fm.cx[cell]!, fm.cy[c]! - fm.cy[cell]!];
}

export function arrowDir(v: [number, number], facing: [number, number], down: boolean): ArrowDir {
  const fl = Math.hypot(facing[0], facing[1]) || 1;
  const F: [number, number] = [-facing[0] / fl, -facing[1] / fl];
  const R: [number, number] = [-F[1], F[0]];
  const f = v[0] * F[0] + v[1] * F[1], r = v[0] * R[0] + v[1] * R[1];
  if (Math.abs(f) >= Math.abs(r)) return f >= 0 ? "AHEAD" : "BACK";
  if (down) return r > 0 ? "DOWN_RIGHT" : "DOWN_LEFT";
  return r > 0 ? "RIGHT" : "LEFT";
}

export interface CompileInput {
  policy: RoutePolicy;
  rv: RouteView;
  elapsedSec: number;
}

export function compileSigns(m: Model, { policy, rv, elapsedSec }: CompileInput): Record<string, SignState> {
  const T = templates().sign;
  const out: Record<string, SignState> = {};
  const closed = new Set(policy.closedRoutes);
  const isClosed = (ei: number) => {
    const e = m.elements[ei]!;
    return !rv.open[ei] || closed.has(e.id) || (e.exitId !== null && closed.has(e.exitId)) || (e.stairId !== null && closed.has(e.stairId));
  };
  const compFields = new Map<string, Float32Array>();
  for (const mt of m.mounts) {
    const zone = mt.zone >= 0 ? m.zones[mt.zone]! : null;
    const zi = zone ? policy.zones.find((z) => z.zone === zone.id) : undefined;
    if (!zi) continue;
    const arrowTo = (ei: number): Arrow => {
      const e = m.elements[ei]!;
      const v = descentVector(m, rv.fields[ei]!, mt.floor, mt.cell);
      if (!v) throw new SignCompileError(`${mt.id}: no reachable route to ${e.id}`);
      return { dir: arrowDir(v, mt.facing, e.kind === "stair"), toward: e.id, label: e.kind === "stair" ? T.exitStair : T.exit };
    };
    if (zi.instruction === "LOCKDOWN") { out[mt.id] = { kind: "LOCKDOWN", label: T.lockdown }; continue; }
    if (zi.instruction === "HOLD" || (zi.instruction === "EVACUATE_VIA" && zi.delaySec > elapsedSec)) { out[mt.id] = { kind: "HOLD", label: T.hold }; continue; }
    if (zi.instruction === "MOVE_TO_COMPARTMENT") {
      if (!zi.via || zi.via === zone!.id) { out[mt.id] = { kind: "HOLD", label: T.stay }; continue; }
      const czi = m.zoneIndex.get(zi.via);
      if (czi === undefined) throw new SignCompileError(`${mt.id}: unknown compartment ${zi.via}`);
      let f = compFields.get(zi.via);
      if (!f) {
        const fm = m.floors[mt.floor]!;
        const src: number[] = [];
        for (let i = 0; i < fm.n; i++) if (fm.zone[i] === czi && fm.walkable[i]) src.push(i);
        f = distanceField(fm, src, new Float32Array(fm.n), { blocked: rv.hz.blocked[mt.floor], closedPortal: rv.hz.closedPortal });
        compFields.set(zi.via, f);
      }
      const v = descentVector(m, f, mt.floor, mt.cell);
      if (!v) throw new SignCompileError(`${mt.id}: no reachable route to ${zi.via}`);
      out[mt.id] = { kind: "ARROW", arrow: { dir: arrowDir(v, mt.facing, false), toward: zi.via, label: T.safeArea } };
      continue;
    }
    const via = zi.via ? resolveElement(m, zi.via, mt.floor) : -1;
    if (via < 0 || isClosed(via)) throw new SignCompileError(`${mt.id}: route ${zi.via ?? "none"} is closed or not on ${m.floors[mt.floor]!.id}`);
    const alt = arrowTo(via);
    if (mt.staticTarget >= 0 && mt.staticTarget !== via && isClosed(mt.staticTarget)) out[mt.id] = { kind: "X_ALT", blocked: m.elements[mt.staticTarget]!.id, alt };
    else out[mt.id] = { kind: "ARROW", arrow: alt };
  }
  return out;
}

export function staticDefault(m: Model, mountId: string): SignState {
  const mt = m.mounts.find((x) => x.id === mountId)!;
  const e = mt.staticTarget >= 0 ? m.elements[mt.staticTarget]! : null;
  return { kind: "STATIC_DEFAULT", arrow: { dir: "AHEAD", toward: e?.id ?? "EXIT", label: e?.kind === "stair" ? templates().sign.exitStair : templates().sign.exit } };
}

export function validateSignSafety(states: Record<string, SignState>, m: Model, rv: RouteView): string[] {
  const problems: string[] = [];
  for (const [mount, s] of Object.entries(states)) {
    if (s.kind !== "X_ALT") continue;
    const mt = m.mounts.find((x) => x.id === mount)!;
    const alt = resolveElement(m, s.alt.toward, mt.floor);
    const reachable = alt >= 0 && rv.open[alt] && mt.cell >= 0 && rv.fields[alt]![mt.cell]! < Infinity;
    if (!reachable) problems.push(`${mount}: X on ${s.blocked} without a reachable alternative`);
    if (s.alt.toward === s.blocked) problems.push(`${mount}: alternative equals the blocked route`);
  }
  return problems;
}
