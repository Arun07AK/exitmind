import type { HazardFrame } from "../../../src/server/contract.ts";

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64ToFloat32(s: string): Float32Array {
  const b = b64ToBytes(s);
  return new Float32Array(b.buffer, 0, b.byteLength >> 2);
}

export interface DecodedHazard {
  smoke: Uint8Array[];
  threat: Uint8Array[];
  blocked: Uint8Array[];
}

const hazardCache = new WeakMap<HazardFrame, DecodedHazard>();

export function decodeHazard(h: HazardFrame): DecodedHazard {
  let d = hazardCache.get(h);
  if (!d) {
    d = { smoke: h.smoke.map(b64ToBytes), threat: h.threat.map(b64ToBytes), blocked: h.blocked.map(b64ToBytes) };
    hazardCache.set(h, d);
  }
  return d;
}
