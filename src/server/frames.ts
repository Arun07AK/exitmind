import { stateHash } from "../sim/run.ts";
import type { World } from "../sim/world.ts";
import type { FrameMsg, GridInfo, HazardFrame } from "./contract.ts";

const b64 = (a: ArrayLike<number>): string => Buffer.from(Uint8Array.from(a as ArrayLike<number>)).toString("base64");

export function gridInfo(w: Pick<World, "m">): GridInfo {
  const m = w.m;
  return {
    twinHash: m.twin.hash,
    cellM: 0.4,
    floors: m.floors.map((f) => ({ id: f.id, name: m.twin.floors[f.index]!.name, elevationFt: f.elevationFt, ox: f.ox, oy: f.oy, w: f.w, h: f.h, cellFt: m.raster.cellFt, walkable: b64(f.walkable) })),
    elements: m.elements.map((e) => {
      const fm = m.floors[e.floor]!;
      let x = 0, y = 0;
      for (const c of e.cells) { x += fm.cx[c]!; y += fm.cy[c]!; }
      const k = Math.max(1, e.cells.length);
      return { id: e.id, label: e.label, kind: e.kind, floor: fm.id, x: x / k, y: y / k };
    }),
    mounts: m.mounts.map((mt) => ({ id: mt.id, floor: m.floors[mt.floor]!.id, x: mt.x, y: mt.y, facing: mt.facing, staticTarget: mt.staticTarget >= 0 ? m.elements[mt.staticTarget]!.id : null })),
  };
}

export function hazardFrame(w: World): HazardFrame {
  const hz = w.hz, m = w.m;
  const o = hz.spec.floor && hz.spec.at ? { floor: hz.spec.floor, x: hz.spec.at[0], y: hz.spec.at[1] } : null;
  return {
    version: hz.version,
    smoke: hz.smoke.map((s) => b64(Array.from(s, (v) => Math.round(v * 255)))),
    threat: hz.threat.map((t) => b64(t)),
    blocked: hz.blocked.map((t) => b64(t)),
    damaged: [...hz.damagedElements].map((e) => m.elements[e]!.id),
    shaking: hz.shaking,
    threatPos: hz.threatPos ? { floor: m.floors[hz.threatPos.floor]!.id, x: hz.threatPos.x, y: hz.threatPos.y } : null,
    fireOrigin: hz.spec.kind === "fire" ? o : null,
  };
}

export class FrameEncoder {
  #lastHazard = -1;
  #lastShaking = false;
  readonly channel: string;
  constructor(channel: string) { this.channel = channel; }

  encode(w: World): FrameMsg {
    const n = w.n;
    const x = new Array<number>(n), y = new Array<number>(n), z = new Array<number>(n);
    for (let a = 0; a < n; a++) {
      const [px, py, pz] = w.agentPosition(a);
      x[a] = Math.round(px * 10); y[a] = Math.round(py * 10); z[a] = Math.round(pz * 10);
    }
    const sum = w.summary();
    const msg: FrameMsg = {
      type: "frame", channel: this.channel, tick: w.tick, t: Math.round(w.tSec * 100) / 100, hash: stateHash(w), n, x, y, z,
      floor: Array.from(w.floor), state: Array.from(w.state), stress: Array.from(w.stress, (s) => Math.round(s * 100)), policy: Array.from(w.policyKind),
      signs: w.m.mounts.map((mt, k) => ({ mount: mt.id, state: w.signs[k] ?? null, dynamic: !!w.signDynamic[k] })),
      metrics: { protected: sum.protected + sum.sheltered + sum.inRefuge, remaining: sum.remaining, clearance95Sec: sum.clearance95Sec, endSec: sum.endSec },
      done: w.done,
    };
    if (w.hz.version !== this.#lastHazard || w.hz.shaking !== this.#lastShaking) {
      this.#lastHazard = w.hz.version; this.#lastShaking = w.hz.shaking;
      msg.hazard = hazardFrame(w);
    }
    return msg;
  }
}
