import { Rng } from "../shared/rng.ts";
import type { SimEnv } from "../sim/run.ts";
import type { HazardKind, ProfileId, Scenario } from "../sim/types.ts";
import type { BottleneckResult } from "../server/contract.ts";
import type { Evaluator } from "./pool.ts";
import { buildSpace, protocolFor, samplePoint, toScenario } from "./space.ts";

export async function bottlenecks(env: SimEnv, ev: Evaluator, o: { runs: number; hazards?: HazardKind[]; profile?: ProfileId; seed?: number }): Promise<BottleneckResult> {
  const m = env.model, profile = o.profile ?? "college";
  const hazards = o.hazards ?? ["none", "fire", "quake"];
  const rng = Rng.stream(o.seed ?? 7, "bottlenecks");
  const defaults = Object.fromEntries(Object.entries(env.profiles).map(([k, v]) => [k, v.defaultProtocol])) as never;
  const scenarios: Scenario[] = [];
  for (let i = 0; i < o.runs; i++) {
    const hazard = hazards[i % hazards.length]!;
    const space = buildSpace(m, env.params, hazard, profile);
    const pt = samplePoint(space, space.cont.map(() => 0.5), space.cont.map(() => 0.3), space.cat.map((d) => d.options.map(() => 1 / d.options.length)), rng);
    scenarios.push(toScenario(m, space, pt, 100 + i, `bulk-${hazard}-${i}`, protocolFor(hazard, profile, defaults), env.runtime.design.capSec));
  }
  const res = await ev.map(scenarios.map((scenario) => ({ scenario, dangerCells: true })));
  const queue = new Map<string, number>(), worstFor = new Map<string, { v: number; i: number }>();
  const danger = m.floors.map((f) => new Float64Array(f.n));
  const exitUse = new Map<string, number>();
  res.forEach((r, i) => {
    for (const [pid, v] of Object.entries(r.metrics.portalQueuePS)) {
      queue.set(pid, (queue.get(pid) ?? 0) + v);
      if (v > (worstFor.get(pid)?.v ?? -1)) worstFor.set(pid, { v, i });
    }
    for (const [eid, v] of Object.entries(r.metrics.exitUsage)) exitUse.set(eid, (exitUse.get(eid) ?? 0) + v);
    r.dangerCells?.forEach((f, fi) => f.forEach((v, c) => (danger[fi]![c] = danger[fi]![c]! + v)));
  });
  const portalAt = (pid: string) => {
    const p = m.portals.find((x) => x.id === pid)!;
    const fm = m.floors[p.floor]!;
    const c = p.cells[0] ?? 0;
    return { floor: fm.id, x: fm.cx[c]!, y: fm.cy[c]! };
  };
  const hotspots: BottleneckResult["hotspots"] = [...queue.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([pid, v], k) => {
    const w = worstFor.get(pid)!;
    const p = m.portals.find((x) => x.id === pid)!;
    let d = 0;
    for (const c of p.cells) d += danger[p.floor]![c]!;
    const sp = m.twin.floors[p.floor]!.spaces;
    const names = p.spaces.map((s) => sp.find((x) => x.id === s)?.name ?? s).join(" / ");
    return { id: pid, rank: k + 1, kind: p.isExit ? "portal" : p.kind === "corridor_section" ? "area" : "portal", ...portalAt(pid), label: `${p.kind.replace("_", " ")} ${pid} (${names})`, queuePS: Math.round((v / res.length) * 10) / 10, dangerPS: Math.round((d / res.length) * 10) / 10, replay: { id: scenarios[w.i]!.id, label: `worst run for ${pid}`, scenario: scenarios[w.i]! } };
  });
  const capTotal = m.elements.filter((e) => e.kind === "exit").reduce((a, e) => a + m.portals[e.portal]!.widthM, 0);
  const useTotal = [...exitUse.entries()].filter(([id]) => m.elements.find((e) => e.id === id)?.kind === "exit").reduce((a, [, v]) => a + v, 0) || 1;
  const exits: BottleneckResult["exits"] = m.elements.filter((e) => e.kind === "exit").map((e) => {
    const share = (exitUse.get(e.id) ?? 0) / useTotal, capShare = m.portals[e.portal]!.widthM / capTotal;
    return { id: e.id, label: `${e.label} (capacity share ${(capShare * 100).toFixed(0)}%)`, share: Math.round(share * 1000) / 1000, status: share > capShare * 1.5 ? "overloaded" as const : share < capShare * 0.5 ? "under_used" as const : "balanced" as const };
  });
  return {
    runs: res.length, seeds: scenarios.map((s) => s.seed), densityThreshold: env.params.get("density.danger"), hotspots, exits,
    dangerHeat: danger.map((f) => Buffer.from(new Float32Array(Array.from(f, (v) => v / res.length)).buffer).toString("base64")),
  };
}
