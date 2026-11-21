import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventLog, GENESIS_HASH, recordHash, type EventRecord } from "../../src/log/eventlog.ts";

const fixedClock = () => "2026-11-21T00:00:00.000Z";
const tmpLog = () => join(mkdtempSync(join(tmpdir(), "exitmind-log-")), "events.jsonl");
const start = (log: EventLog) => log.append({ tick: -1, actor: "orchestrator", type: "session.started", payload: { sessionId: "s1", mode: "test", seed: 1 } });

describe("EventLog: append and hash chain", () => {
  it("assigns sequential ids and chains every hash to the previous one", () => {
    const log = new EventLog({ wallClock: fixedClock });
    const a = start(log);
    const b = log.append({ tick: 0, actor: "sentinel", type: "sentinel.estimate", payload: { confidence: 0.8 }, refs: [a.id] });
    expect([a.id, b.id]).toEqual(["E000001", "E000002"]);
    expect(a.prev).toBe(GENESIS_HASH);
    expect(b.prev).toBe(a.hash);
    expect(recordHash(a.hash, b)).toBe(b.hash);
    expect(log.verifyChain()).toEqual({ ok: true, count: 2, head: b.hash });
  });

  it("excludes the wall clock from the hash", () => {
    const one = new EventLog({ wallClock: () => "2026-01-01T00:00:00.000Z" });
    const two = new EventLog({ wallClock: () => "2027-06-30T12:00:00.000Z" });
    expect(start(one).hash).toBe(start(two).hash);
  });

  it("hashes the same payload identically whatever its key order", () => {
    const one = new EventLog();
    const two = new EventLog();
    const p1 = one.append({ tick: 3, actor: "sim", type: "world.checkpoint", payload: { b: 2, a: [1, { y: 1, x: 2 }] } });
    const p2 = two.append({ tick: 3, actor: "sim", type: "world.checkpoint", payload: { a: [1, { x: 2, y: 1 }], b: 2 } });
    expect(p1.hash).toBe(p2.hash);
  });

  it("rejects unknown actors, types, bad ticks, dangling refs and non-JSON payloads", () => {
    const log = new EventLog();
    start(log);
    const bad = (input: unknown) => () => log.append(input as Parameters<EventLog["append"]>[0]);
    expect(bad({ tick: 0, actor: "intruder", type: "sensor.batch", payload: {} })).toThrow(/unknown actor/);
    expect(bad({ tick: 0, actor: "sim", type: "sign.set_directly", payload: {} })).toThrow(/unknown event type/);
    expect(bad({ tick: 1.5, actor: "sim", type: "sensor.batch", payload: {} })).toThrow(/tick/);
    expect(bad({ tick: -2, actor: "sim", type: "sensor.batch", payload: {} })).toThrow(/tick/);
    expect(bad({ tick: 0, actor: "sim", type: "sensor.batch", payload: {}, refs: ["E000099"] })).toThrow(/does not exist/);
    expect(bad({ tick: 0, actor: "sim", type: "sensor.batch", payload: { v: Number.NaN } })).toThrow(/non-finite/);
    expect(log.size).toBe(1);
  });

  it("validates payloads that have a schema", () => {
    const log = new EventLog();
    expect(() => log.append({ tick: -1, actor: "orchestrator", type: "session.started", payload: { sessionId: "s", mode: "test" } })).toThrow();
    expect(() =>
      log.append({ tick: -1, actor: "orchestrator", type: "session.started", payload: { sessionId: "s", mode: "test", seed: 1, extra: true } }),
    ).toThrow();
    expect(log.size).toBe(0);
  });
});

describe("EventLog: append-only", () => {
  it("exposes no way to update or delete records", () => {
    const methods = Object.getOwnPropertyNames(EventLog.prototype);
    for (const forbidden of ["update", "delete", "remove", "set", "clear", "splice", "pop", "truncate", "replace"]) {
      expect(methods).not.toContain(forbidden);
    }
  });

  it("freezes stored records and is not affected by later caller mutation", () => {
    const log = new EventLog();
    const payload = { counts: { Z1N: 10 } };
    const r = log.append({ tick: 0, actor: "sentinel", type: "sentinel.estimate", payload });
    payload.counts.Z1N = 999;
    expect((log.get(r.id)?.payload as typeof payload).counts.Z1N).toBe(10);
    expect(() => {
      (r as { tick: number }).tick = 5;
    }).toThrow(TypeError);
    expect(() => {
      ((r.payload as typeof payload).counts as Record<string, number>).Z1N = 1;
    }).toThrow(TypeError);
    const copy = log.records() as EventRecord[];
    copy.pop();
    expect(log.size).toBe(1);
  });
});

describe("EventLog: subscribers (the shared blackboard)", () => {
  it("delivers matching types in append order, including appends made by handlers", () => {
    const log = new EventLog();
    const seen: string[] = [];
    log.subscribe(["sentinel.estimate"], (r) => {
      seen.push(`planner saw ${r.id}`);
      log.append({ tick: r.tick, actor: "planner", type: "planner.proposed", payload: {}, refs: [r.id] });
    });
    log.subscribe("*", (r) => seen.push(`audit ${r.id} ${r.type}`));
    log.append({ tick: 0, actor: "sentinel", type: "sentinel.estimate", payload: {} });
    expect(seen).toEqual(["planner saw E000001", "audit E000001 sentinel.estimate", "audit E000002 planner.proposed"]);
  });

  it("stops delivery after unsubscribe", () => {
    const log = new EventLog();
    let n = 0;
    const off = log.subscribe("*", () => n++);
    log.append({ tick: 0, actor: "sim", type: "sensor.batch", payload: {} });
    off();
    log.append({ tick: 1, actor: "sim", type: "sensor.batch", payload: {} });
    expect(n).toBe(1);
  });

  it("keeps the record and the other subscribers when a handler throws", () => {
    const log = new EventLog();
    let other = 0;
    log.subscribe("*", () => {
      throw new Error("handler failed");
    });
    log.subscribe("*", () => other++);
    expect(() => log.append({ tick: 0, actor: "sim", type: "sensor.batch", payload: {} })).toThrow("handler failed");
    expect(log.size).toBe(1);
    expect(other).toBe(1);
  });

  it("filters queries by type, actor, tick range and ref", () => {
    const log = new EventLog();
    const a = start(log);
    log.append({ tick: 4, actor: "sentinel", type: "sentinel.estimate", payload: {}, refs: [a.id] });
    log.append({ tick: 8, actor: "planner", type: "planner.proposed", payload: {} });
    expect(log.query({ type: "sentinel.estimate" }).map((r) => r.id)).toEqual(["E000002"]);
    expect(log.query({ type: ["sentinel.estimate", "planner.proposed"], fromTick: 5 }).map((r) => r.id)).toEqual(["E000003"]);
    expect(log.query({ actor: "orchestrator" }).map((r) => r.id)).toEqual(["E000001"]);
    expect(log.query({ ref: a.id }).map((r) => r.id)).toEqual(["E000002"]);
  });
});

describe("EventLog: JSONL persistence and tamper evidence", () => {
  const writeThree = (path: string) => {
    const log = new EventLog({ path, wallClock: fixedClock });
    const a = start(log);
    log.append({ tick: 0, actor: "sentinel", type: "sentinel.estimate", payload: { confidence: 0.7 }, refs: [a.id] });
    log.append({ tick: 1, actor: "planner", type: "planner.proposed", payload: { protocol: "EVACUATE" } });
    return log;
  };

  it("reopens a file with identical records and keeps appending to the same chain", () => {
    const path = tmpLog();
    const original = writeThree(path);
    const reopened = new EventLog({ path, wallClock: fixedClock });
    expect(reopened.records()).toEqual(original.records());
    expect(reopened.head).toBe(original.head);
    reopened.append({ tick: 2, actor: "verifier", type: "verifier.verdict", payload: { verdict: "PASS" } });
    expect(EventLog.verifyFile(path)).toMatchObject({ ok: true, count: 4 });
  });

  it("detects an edited payload", () => {
    const path = tmpLog();
    writeThree(path);
    const lines = readFileSync(path, "utf8").split("\n");
    lines[1] = (lines[1] as string).replace('"confidence":0.7', '"confidence":0.99');
    writeFileSync(path, lines.join("\n"));
    expect(EventLog.verifyFile(path)).toEqual({ ok: false, seq: 2, reason: "hash does not match record content" });
    expect(() => new EventLog({ path })).toThrow(/chain broken at seq 2/);
  });

  it("detects a deleted record", () => {
    const path = tmpLog();
    writeThree(path);
    const lines = readFileSync(path, "utf8").split("\n");
    lines.splice(1, 1);
    writeFileSync(path, lines.join("\n"));
    expect(EventLog.verifyFile(path)).toMatchObject({ ok: false, seq: 2 });
  });
});
