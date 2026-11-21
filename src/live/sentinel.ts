import type { Model } from "../sim/model.ts";
import type { HazardKind } from "../sim/types.ts";
import type { Estimate, SensorHealth, Sourced } from "../server/contract.ts";
import type { SensorBatch, SensorDef } from "./sensors.ts";

export const SMOKE_THRESHOLD = 0.1;

export function sensorHealth(defs: SensorDef[], batch: SensorBatch, m: Model): SensorHealth[] {
  return defs.map((d, i) => {
    const v = batch.readings[i]!.value;
    let status: SensorHealth["status"] = "ok";
    if (v === null) status = "silent";
    else if (d.kind === "smoke" && (v < 0 || v > 1)) status = "corrupt";
    else if (d.kind === "density") {
      const z = m.zones[m.zoneIndex.get(d.zone) ?? -1];
      if (v < 0 || (z && v > 5000)) status = "corrupt";
    } else if (d.kind === "seismic" && (v < 0 || v > 5)) status = "corrupt";
    else if (d.kind === "panel" && v !== 0 && v !== 1) status = "corrupt";
    else if (d.kind === "door_count" && v < -1) status = "corrupt";
    return { id: d.id, kind: d.kind, zone: d.zone, status };
  });
}

export interface SentinelMemory { quakeTick: number | null }

export function fuse(defs: SensorDef[], batch: SensorBatch, batchRef: string, m: Model, id: string, mem: SentinelMemory = { quakeTick: null }): Estimate {
  const health = sensorHealth(defs, batch, m);
  const ok = (i: number) => health[i]!.status === "ok";
  const val = (sid: string) => {
    const i = defs.findIndex((d) => d.id === sid);
    return i >= 0 && ok(i) ? batch.readings[i]!.value : null;
  };
  const reasons: string[] = [];
  const panel = val("PANEL");
  const seismic = val("SEI-1");
  const smoky = defs.map((d, i) => ({ d, i })).filter(({ d, i }) => d.kind === "smoke" && ok(i) && batch.readings[i]!.value! > SMOKE_THRESHOLD).sort((a, b) => batch.readings[b.i]!.value! - batch.readings[a.i]!.value! || (a.d.id < b.d.id ? -1 : 1));
  const damaged = defs.map((d, i) => ({ d, i })).filter(({ d, i }) => d.kind === "door_count" && ok(i) && batch.readings[i]!.value === -1).map(({ d }) => d.target!);
  let hazard: HazardKind = "none", zone: string | null = null, conf = 0;
  const shakingNow = seismic !== null && seismic > 0.5;
  if (shakingNow && mem.quakeTick === null) mem.quakeTick = batch.tick;
  if (shakingNow || mem.quakeTick !== null || damaged.length) {
    hazard = "quake";
    conf = (shakingNow || mem.quakeTick !== null ? 0.6 : 0) + (damaged.length ? 0.35 : 0);
    if (shakingNow) reasons.push(`seismic sensor SEI-1 reads ${seismic!.toFixed(2)}`);
    else if (mem.quakeTick !== null) reasons.push(`seismic event recorded by SEI-1 at t=${(mem.quakeTick * 0.25).toFixed(0)} s (shaking has stopped)`);
    if (damaged.length) reasons.push(`no-passage signal from ${damaged.join(", ")} (damage reported)`);
  } else if (smoky.length || panel === 1) {
    hazard = "fire";
    zone = smoky.length ? smoky[0]!.d.zone : null;
    conf = Math.min(0.6, 0.3 * smoky.length) + (panel === 1 ? 0.4 : 0);
    if (smoky.length) reasons.push(`smoke above ${SMOKE_THRESHOLD} at ${smoky.map(({ d, i }) => `${d.id} (${batch.readings[i]!.value!.toFixed(2)})`).join(", ")}`);
    if (panel === 1) reasons.push("fire alarm panel in alarm (panel stays in charge; EXITMIND only observes it)");
  } else {
    reasons.push("no hazard signal from healthy sensors");
    conf = 0.95;
  }
  const bad = health.filter((h) => h.status !== "ok");
  if (bad.length) {
    const relevant = bad.filter((h) => h.kind === "panel" || h.kind === "seismic" || (zone !== null && h.zone === zone) || h.kind === "smoke");
    const penalty = 0.2 * relevant.length + 0.05 * (bad.length - relevant.length);
    conf -= penalty;
    reasons.push(`${bad.map((h) => `${h.id} ${h.status}`).join(", ")}: excluded from fusion, confidence reduced by ${penalty.toFixed(2)}`);
  }
  const countsByZone: Record<string, Sourced> = {};
  defs.forEach((d, i) => {
    if (d.kind !== "density") return;
    if (ok(i)) countsByZone[d.zone] = { value: batch.readings[i]!.value!, source: `${d.id} in ${batchRef}` };
  });
  return { id, hazard, zone, confidence: Math.round(Math.max(0, Math.min(1, conf)) * 100) / 100, reasons, sensors: health, countsByZone };
}

export function damagedFromEstimate(e: Estimate): string[] {
  const ids = e.reasons.flatMap((r) => (r.startsWith("no-passage signal from ") ? r.slice(23, r.indexOf(" (damage")).split(", ") : []));
  return [...new Set(ids.map((id) => id.replace(/@F\d$/, "")))].sort();
}
