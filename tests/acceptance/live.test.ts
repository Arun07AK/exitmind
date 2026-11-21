import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EventLog } from "../../src/log/eventlog.ts";
import { publish } from "../../src/live/gate.ts";
import { briefTraceable } from "../../src/live/liaison.ts";
import { replayTruth } from "../../src/live/session.ts";
import { routeView } from "../../src/design/protocols.ts";
import { loadEnv, stateHash } from "../../src/sim/run.ts";
import { miniBuilding } from "../../src/twin/synthetic.ts";
import { MINI_CFG, miniSession, stepUntil } from "../helpers/live.ts";
import { StubClaude } from "../helpers/stubs.ts";

const env = loadEnv(miniBuilding());
const pending = (s: ReturnType<typeof miniSession>) => () => s.current?.status === "pending";

describe("live mode on the mini test building (offline: LLMs stubbed down, so fallbacks are exercised)", () => {
  it("fire: detect, confirm, plan (playbook/default fallback), verify, human approve, gate publish; signs follow", async () => {
    const s = miniSession();
    s.control({ action: "start_fire" });
    expect(await stepUntil(s, pending(s))).toBe(true);
    const c = s.current!;
    expect(c.protocol).toBe("EVACUATE");
    expect(c.verdict?.verdict).toBe("PASS");
    expect(s.incident).toBe("CONFIRMED");
    expect(s.log.query({ type: "planner.fallback" }).length).toBeGreaterThan(0);
    expect(s.decide(c.id, "approve").ok).toBe(true);
    const pub = s.log.query({ type: "gate.published" });
    expect(pub).toHaveLength(1);
    const types = pub[0]!.refs.map((id) => s.log.get(id)!.type);
    expect(types).toEqual(expect.arrayContaining(["planner.proposed", "verifier.verdict", "human.approved"]));
    await stepUntil(s, () => s.incident === "RESPONDING", 200);
    expect(s.incident).toBe("RESPONDING");
    const signs = s.signInfo();
    expect(signs.some((x) => x.approvedRef === pub[0]!.id)).toBe(true);
  });

  it("earthquake leads to a different protocol (HOLD_THEN_EVACUATE) that avoids the damaged stair", async () => {
    const s = miniSession();
    s.control({ action: "start_quake" });
    expect(await stepUntil(s, pending(s))).toBe(true);
    expect(s.current!.protocol).toBe("HOLD_THEN_EVACUATE");
    expect(s.current!.policy.closedRoutes).toContain("ST-B");
    expect(s.current!.policy.zones.every((z) => z.via !== "ST-B@F2")).toBe(true);
    expect(s.current!.verdict).not.toBeNull();
  });

  it("a deliberately bad plan is shown with a FAIL verdict and its predicted gridlock, and is blocked without an override reason", async () => {
    const s = miniSession();
    s.control({ action: "start_fire" });
    await stepUntil(s, pending(s));
    s.decide(s.current!.id, "approve");
    s.control({ action: "inject_bad_plan" });
    expect(await stepUntil(s, () => s.current?.injected === true && s.current.status === "pending")).toBe(true);
    const bad = s.current!;
    expect(bad.verdict!.verdict).toBe("FAIL");
    expect(bad.verdict!.predicted.gridlock).toBe(true);
    expect(bad.verdict!.reasons.join(" ")).toMatch(/gridlock/);
    const r = s.decide(bad.id, "approve");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/override reason/);
    expect(s.log.query({ type: "gate.published" })).toHaveLength(1);
  });

  it("gate: publishing with any key missing fails and is logged", () => {
    const log = new EventLog();
    const m = env.model;
    const rv = routeView(m, { kind: "none" }, env.hazardParams);
    const policy = { zones: m.zones.map((z) => ({ zone: z.id, instruction: "EVACUATE_VIA" as const, via: z.floor === "F1" ? "EX-W" : "ST-A", delaySec: 0 })), closedRoutes: [], inflowClosed: [] };
    expect(() => publish(log, 0, "D1", "block_with_override", m, rv)).toThrow(/agent decision/);
    const p = log.append({ tick: 0, actor: "planner", type: "planner.proposed", payload: { decisionId: "D1", protocol: "EVACUATE", policy } });
    expect(() => publish(log, 0, "D1", "block_with_override", m, rv)).toThrow(/verifier verdict/);
    const v = log.append({ tick: 0, actor: "verifier", type: "verifier.verdict", payload: { decisionId: "D1", verdict: "PASS" }, refs: [p.id] });
    expect(() => publish(log, 0, "D1", "block_with_override", m, rv)).toThrow(/human approval/);
    log.append({ tick: 0, actor: "human", type: "human.approved", payload: { decisionId: "D1" }, refs: [v.id, p.id] });
    expect(publish(log, 0, "D1", "block_with_override", m, rv).type).toBe("gate.published");
    expect(log.query({ type: "gate.rejected" })).toHaveLength(3);
  });

  it("gate: the sign hub cannot create plans; only gate.ts writes gate.published", () => {
    const src = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
    expect(src("live/signs.ts")).not.toMatch(/gate\.published"\s*,\s*payload|type:\s*"gate\.published"/);
    expect(src("live/signs.ts")).not.toMatch(/from "\.\/(planner|verifier|session)\.ts"/);
    for (const f of ["live/session.ts", "live/planner.ts", "live/verifier.ts", "server/live.ts", "live/signs.ts"]) expect(src(f)).not.toMatch(/type:\s*"gate\.published"/);
    expect(src("live/gate.ts")).toMatch(/type:\s*"gate\.published"/);
  });

  it("sensor failure: silencing or corrupting a sensor lowers confidence, shows the reason, and holds signs", async () => {
    for (const mode of ["silent", "corrupt"] as const) {
      const s = miniSession();
      s.control({ action: "start_fire" });
      await stepUntil(s, pending(s));
      const before = s.estimate!.confidence;
      s.decide(s.current!.id, "approve");
      const published = s.log.query({ type: "gate.published" }).at(-1)!.id;
      s.control({ action: "fail_sensor", sensor: "PANEL", mode });
      s.control({ action: "fail_sensor", sensor: `SMK-${s.estimate!.zone}`, mode });
      await stepUntil(s, () => (s.estimate?.confidence ?? 1) < before, 40);
      expect(s.estimate!.confidence).toBeLessThan(before);
      expect(s.estimate!.reasons.join(" ")).toMatch(new RegExp(mode));
      expect(s.estimate!.sensors.filter((x) => x.status === mode).length).toBe(2);
      if (s.estimate!.confidence < env.runtime.live.publishConfidence) expect(s.holdReason).toMatch(/hold/);
      expect(s.signInfo().filter((x) => x.approvedRef).every((x) => x.approvedRef === published)).toBe(true);
    }
  });

  it("human timeout: with no approval in the window, signs stay at the static default", async () => {
    const s = miniSession({ approvalWindowSec: 5 });
    s.control({ action: "start_fire" });
    await stepUntil(s, pending(s));
    expect(await stepUntil(s, () => s.current?.status === "timeout", 200)).toBe(true);
    expect(s.log.query({ type: "approval.timeout" }).length).toBe(1);
    expect(s.log.query({ type: "gate.published" })).toHaveLength(0);
    expect(s.signInfo().every((x) => x.state.kind === "STATIC_DEFAULT" && x.approvedRef === null)).toBe(true);
  });

  it("LLM failure: planner and liaison fall back (playbook/default and templates) and the session keeps running", async () => {
    const s = miniSession({ claude: new StubClaude("down") });
    s.control({ action: "start_fire" });
    await stepUntil(s, pending(s));
    expect(s.current!.rationaleSource).not.toBe("llm");
    s.decide(s.current!.id, "approve");
    await stepUntil(s, () => s.brief !== null, 400);
    expect(s.brief!.source).toBe("template");
    const t = s.tick;
    await stepUntil(s, () => false, 80);
    expect(s.tick).toBe(t + 80);
  });

  it("responder brief: every line resolves to log record ids, and counts match the sentinel record", async () => {
    const s = miniSession();
    s.control({ action: "start_fire" });
    await stepUntil(s, pending(s));
    s.decide(s.current!.id, "approve");
    await stepUntil(s, () => s.brief !== null, 400);
    const b = s.brief!;
    expect(b.lines.length).toBeGreaterThan(2);
    expect(briefTraceable(b, s.log)).toBe(true);
    expect(b.notice).toMatch(/A human calls 112; EXITMIND never contacts anyone/);
    for (const l of b.lines.filter((x) => x.text.startsWith("People observed"))) {
      const est = s.log.get(l.refs[0]!)!.payload as { countsByZone: Record<string, { value: number }> };
      const n = Number(l.text.match(/: (\d+) \(/)![1]);
      expect(Object.values(est.countsByZone).map((c) => c.value)).toContain(n);
    }
  });

  it("replays a live session from its log to the identical ground-truth state", async () => {
    const s = miniSession();
    s.control({ action: "start_fire" });
    await stepUntil(s, pending(s));
    s.decide(s.current!.id, "approve");
    await stepUntil(s, () => false, 300);
    const hash = stateHash(s.truth);
    const r = replayTruth(env, s.log.records(), MINI_CFG, s.id, s.tick);
    expect(r.hash).toBe(hash);
  });
});
