import { describe, expect, it } from "vitest";
import { Channels } from "../../src/server/channels.ts";
import type { FrameMsg, ServerMsg } from "../../src/server/contract.ts";
import { FrameEncoder, gridInfo } from "../../src/server/frames.ts";
import { loadEnv, makeWorld } from "../../src/sim/run.ts";
import type { Scenario } from "../../src/sim/types.ts";

const scenario: Scenario = { id: "frames-test", profile: "college", hazard: { kind: "quake", damaged: [], startSec: 0 }, behaviour: {}, loadFactor: 1, occupancy: "uniform", protocol: "HOLD_THEN_EVACUATE", seed: 4, maxSec: 240 };

describe("frame contract for the redesigned views", () => {
  const env = loadEnv();
  const grid = gridInfo({ m: env.model });

  it("frames carry targets, cumulative exit use matching the summary, and queues", () => {
    const w = makeWorld(env, scenario);
    const enc = new FrameEncoder("sim:test");
    const frames: FrameMsg[] = [];
    while (!w.done) {
      w.step();
      if (w.tick % 4 === 0 || w.done) frames.push(enc.encode(w));
    }
    const last = frames.at(-1)!;
    const sum = w.summary();
    expect(last.exits).toHaveLength(grid.elements.length);
    grid.elements.forEach((e, k) => expect(last.exits[k], e.id).toBe(sum.exitUsage[e.id] ?? 0));
    for (const f of frames) {
      expect(f.target).toHaveLength(f.n);
      for (const t of f.target) expect(t >= -1 && t < grid.elements.length).toBe(true);
    }
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]!, b = frames[i]!;
      for (let k = 0; k < b.exits.length; k++) expect(b.exits[k]!).toBeGreaterThanOrEqual(a.exits[k]!);
      for (const [p, v] of Object.entries(a.queues)) expect(b.queues[p] ?? 0).toBeGreaterThanOrEqual(v);
    }
    expect(grid.portals.length).toBeGreaterThan(0);
    for (const p of grid.portals) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it("a late subscriber to a simulation channel receives the whole run", () => {
    const ch = new Channels();
    const sent: ServerMsg[] = [];
    const sock = { readyState: 1, send: (d: string) => sent.push(JSON.parse(d) as ServerMsg), on: () => undefined } as unknown as Parameters<Channels["subscribe"]>[0];
    const w = makeWorld(env, { ...scenario, maxSec: 30 });
    const enc = new FrameEncoder("sim:late");
    let n = 0;
    while (!w.done) { w.step(); if (w.tick % 4 === 0) { ch.publish("sim:late", enc.encode(w)); n++; } }
    ch.attach(sock);
    ch.subscribe(sock, "sim:late");
    expect(sent.filter((m) => m.type === "frame")).toHaveLength(n);
  });
});
