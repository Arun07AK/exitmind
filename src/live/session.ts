import { existsSync, readFileSync } from "node:fs";
import { EventLog, type EventRecord } from "../log/eventlog.ts";
import type { ClaudeLike } from "../llm/claude.ts";
import { repoPath } from "../shared/paths.ts";
import { routeView } from "../design/protocols.ts";
import type { Evaluator } from "../design/pool.ts";
import { DistilledPolicy } from "../policy/distilled.ts";
import { badness, makeWorld, stateHash, type SimEnv } from "../sim/run.ts";
import type { HazardSpec, ProfileId, Scenario } from "../sim/types.ts";
import type { World } from "../sim/world.ts";
import type { Brief, DecisionCard, Estimate, HistorianReport, IncidentState, LiveState, LogLine, PlaybookEntry, SignInfo } from "../server/contract.ts";
import { approvedStateFor, GateError, publish, type FailMode } from "./gate.ts";
import { draftBrief } from "./liaison.ts";
import { historianReport } from "./historian.ts";
import { badPlan, plan, type Proposal } from "./planner.ts";
import { SensorFeed, type Fault } from "./sensors.ts";
import { damagedFromEstimate, fuse, type SentinelMemory } from "./sentinel.ts";
import { compileSigns, SignCompileError, staticDefault } from "./signcompiler.ts";
import { SignHub } from "./signs.ts";
import { verify } from "./verifier.ts";

export interface DemoConfig {
  profile: ProfileId;
  occupancy: Scenario["occupancy"];
  seed: number;
  speed: number;
  fire: { floor: "F1" | "F2" | "F3"; at: [number, number] };
  quake: { damaged: string[] };
  replanCooldownSec: number;
}

export function loadDemoConfig(): DemoConfig {
  return JSON.parse(readFileSync(repoPath("config", "demo.json"), "utf8")) as DemoConfig;
}

export function loadPlaybook(): PlaybookEntry[] {
  const p = repoPath("data", "playbook", "rinker.playbook.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as PlaybookEntry[]) : [];
}

export type Control = { action: "start_fire" } | { action: "start_quake" } | { action: "inject_bad_plan" } | { action: "fail_sensor"; sensor: string; mode?: Fault } | { action: "restore_sensors" } | { action: "all_clear" };

export function truthScenario(cfg: DemoConfig, sessionId: string): Scenario {
  return { id: `live-${sessionId}`, profile: cfg.profile, hazard: { kind: "none" }, behaviour: {}, loadFactor: 1, occupancy: cfg.occupancy, protocol: "EVACUATE", seed: cfg.seed, maxSec: 3600 * 4 };
}

export function hazardFor(cfg: DemoConfig, action: "start_fire" | "start_quake"): HazardSpec {
  return action === "start_fire" ? { kind: "fire", floor: cfg.fire.floor, at: cfg.fire.at } : { kind: "quake", damaged: cfg.quake.damaged };
}

/** Apply the inputs the ground-truth world consumes. Shared by the live session and by replay, so both evolve identically. */
export function applyTruthInput(truth: World, r: EventRecord, cfg: DemoConfig, online: Set<string>, published: { rec: EventRecord | null }): void {
  if (r.type === "demo.control") {
    const a = (r.payload as Control).action;
    if (a === "start_fire" || a === "start_quake") truth.startHazard(hazardFor(cfg, a));
  } else if (r.type === "gate.published") {
    published.rec = r;
    truth.applyRoutePolicy((r.payload as { policy: Scenario["routePolicy"] }).policy!);
  } else if (r.type === "sign.online") online.add((r.payload as { mount: string }).mount);
  else if (r.type === "sign.offline") online.delete((r.payload as { mount: string }).mount);
}

export function refreshTruthSigns(truth: World, online: Set<string>, published: EventRecord | null): void {
  truth.m.mounts.forEach((mt, k) => {
    const a = approvedStateFor(truth.m, published, mt.id, truth.tick, truth.dt);
    const dyn = online.has(mt.id) && !!a.state;
    const next = dyn ? a.state! : staticDefault(truth.m, mt.id);
    if (JSON.stringify(truth.signs[k]) !== JSON.stringify(next)) truth.setSign(k, next);
    truth.signDynamic[k] = dyn ? 1 : 0;
  });
}

export function panelAlarm(feed: SensorFeed, truth: World): void {
  if (feed.panelAlarm && truth.alarmTick < 0) truth.soundAlarm();
}

const TRUTH_TYPES = new Set(["demo.control", "gate.published", "sign.online", "sign.offline"]);

export function replayTruth(simEnv: SimEnv, records: readonly EventRecord[], cfg: DemoConfig, sessionId: string, untilTick: number): { hash: string; world: World } {
  const distilled = (() => { try { return DistilledPolicy.load(); } catch { return undefined; } })();
  const truth = makeWorld(simEnv, truthScenario(cfg, sessionId), { ...(distilled ? { distilled, bulkPolicy: "distilled" as const } : {}), idle: true });
  const feed = new SensorFeed(simEnv.model, cfg.seed);
  const online = new Set<string>();
  const pub = { rec: null as EventRecord | null };
  const inputs = records.filter((r) => TRUTH_TYPES.has(r.type));
  let k = 0;
  while (truth.tick < untilTick) {
    while (k < inputs.length && inputs[k]!.tick <= truth.tick) applyTruthInput(truth, inputs[k++]!, cfg, online, pub);
    if (truth.tick % 4 === 0) { feed.read(truth); panelAlarm(feed, truth); refreshTruthSigns(truth, online, pub.rec); }
    truth.step();
  }
  return { hash: stateHash(truth), world: truth };
}

export interface SessionOptions {
  simEnv: SimEnv;
  evaluator: Evaluator;
  claude: ClaudeLike;
  cfg?: DemoConfig;
  logPath?: string;
  sessionId?: string;
  wallClock?: () => string;
  failMode?: FailMode;
  approvalWindowSec?: number;
  lan?: string;
}

export class LiveSession {
  readonly id: string;
  readonly log: EventLog;
  readonly env: SimEnv;
  readonly cfg: DemoConfig;
  readonly truth: World;
  readonly feed: SensorFeed;
  readonly hub: SignHub;
  readonly failMode: FailMode;
  readonly windowSec: number;
  readonly #ev: Evaluator;
  readonly #claude: ClaudeLike;
  readonly #online = new Set<string>();
  readonly #pub = { rec: null as EventRecord | null };
  readonly playbook: PlaybookEntry[];
  incident: IncidentState = "NORMAL";
  estimate: Estimate | null = null;
  estimateRec: EventRecord | null = null;
  cards: DecisionCard[] = [];
  brief: Brief | null = null;
  report: HistorianReport | null = null;
  holdReason: string | null = null;
  hazardStartTick = -1;
  #planning = false;
  #lastPlanTick = -1e9;
  #lastSignature = "";
  #lastEstimateLog = -1e9;
  #seq = 0;
  #briefing = false;
  readonly #memory: SentinelMemory = { quakeTick: null };
  readonly lan: string;
  onUpdate: () => void = () => {};

  constructor(o: SessionOptions) {
    this.env = o.simEnv;
    this.cfg = o.cfg ?? loadDemoConfig();
    this.id = o.sessionId ?? `S${Date.now().toString(36)}`;
    this.log = new EventLog({ ...(o.logPath ? { path: o.logPath } : {}), ...(o.wallClock ? { wallClock: o.wallClock } : {}) });
    this.failMode = o.failMode ?? o.simEnv.runtime.gate.failMode;
    this.windowSec = o.approvalWindowSec ?? o.simEnv.runtime.approval.windowSec;
    this.#ev = o.evaluator;
    this.#claude = o.claude;
    this.lan = o.lan ?? "http://localhost:8080";
    this.playbook = loadPlaybook();
    const distilled = (() => { try { return DistilledPolicy.load(); } catch { return undefined; } })();
    this.truth = makeWorld(this.env, truthScenario(this.cfg, this.id), { ...(distilled ? { distilled, bulkPolicy: "distilled" as const } : {}), idle: true });
    this.feed = new SensorFeed(this.env.model, this.cfg.seed);
    this.hub = new SignHub(this.env.model, this.log);
    this.log.subscribe([...TRUTH_TYPES] as never, (r) => applyTruthInput(this.truth, r, this.cfg, this.#online, this.#pub));
    this.log.append({ tick: 0, actor: "orchestrator", type: "session.started", payload: { sessionId: this.id, mode: "live", seed: this.cfg.seed } });
  }

  get tick(): number { return this.truth.tick; }
  get dt(): number { return this.truth.dt; }

  step(): void {
    const t = this.truth;
    if (t.tick % 4 === 0) {
      this.hub.sweep(t.tick);
      const batch = this.feed.read(t);
      panelAlarm(this.feed, t);
      refreshTruthSigns(t, this.#online, this.#pub.rec);
      if (t.tick % Math.round(1 / (this.env.runtime.live.sensorHz * this.dt)) === 0) this.#sense(batch);
      this.hub.push(t.tick, this.dt);
      this.#checkApproval();
    }
    if (t.tick > 0 && t.tick % this.env.runtime.sim.checkpointEveryTicks === 0) this.log.append({ tick: t.tick, actor: "sim", type: "world.checkpoint", payload: { hash: stateHash(t) } });
    t.step();
  }

  #sense(batch: ReturnType<SensorFeed["read"]>): void {
    const tick = this.tick;
    const anomalous = batch.readings.some((r) => r.value === null || (r.id.startsWith("SMK") && r.value > 0.05)) || this.estimate?.hazard !== "none";
    const batchRec = anomalous || tick % 40 === 0 ? this.log.append({ tick, actor: "sentinel", type: "sensor.batch", payload: batch }) : this.log.query({ type: "sensor.batch" }).at(-1) ?? this.log.append({ tick, actor: "sentinel", type: "sensor.batch", payload: batch });
    const est = fuse(this.feed.defs, batch, batchRec.id, this.env.model, `E${tick}`, this.#memory);
    const sig = `${est.hazard}|${est.zone}|${Math.round(est.confidence * 20)}|${est.sensors.filter((s) => s.status !== "ok").map((s) => s.id + s.status).join(",")}|${damagedFromEstimate(est).join(",")}`;
    const changed = sig !== this.#lastSignature;
    if (changed || tick - this.#lastEstimateLog >= 20) {
      this.estimateRec = this.log.append({ tick, actor: "sentinel", type: "sentinel.estimate", payload: est, refs: [batchRec.id] });
      this.#lastEstimateLog = tick;
      if (est.sensors.some((s) => s.status !== "ok") && changed) this.log.append({ tick, actor: "sentinel", type: "sentinel.sensor_health", payload: { sensors: est.sensors.filter((s) => s.status !== "ok") }, refs: [this.estimateRec.id] });
    }
    this.#lastSignature = sig;
    const prevHazard = this.estimate?.hazard;
    const prevZone = this.estimate?.zone;
    const prevDamaged = this.estimate ? damagedFromEstimate(this.estimate).join(",") : "";
    this.estimate = est;
    const pubConf = this.env.runtime.live.publishConfidence;
    this.holdReason = est.hazard !== "none" && est.confidence < pubConf
      ? `Sentinel confidence ${est.confidence.toFixed(2)} is below ${pubConf}: nothing new is published; signs hold the last approved state or the static default. ${est.reasons.at(-1) ?? ""}`
      : null;
    const next = this.#transition(est);
    if (next !== this.incident) {
      this.log.append({ tick, actor: "orchestrator", type: "incident.state", payload: { from: this.incident, to: next, confidence: est.confidence }, refs: this.estimateRec ? [this.estimateRec.id] : [] });
      this.incident = next;
    }
    const situationChanged = est.hazard !== prevHazard || est.zone !== prevZone || damagedFromEstimate(est).join(",") !== prevDamaged;
    const cooldown = Math.round(this.cfg.replanCooldownSec / this.dt);
    const pending = this.current && (this.current.status === "pending" || this.current.status === "verifying");
    if ((this.incident === "CONFIRMED" || this.incident === "RESPONDING") && !this.#planning && est.confidence >= pubConf) {
      if ((!this.current && !pending) || (situationChanged && tick - this.#lastPlanTick > cooldown) || (this.current?.status === "timeout" && tick - this.#lastPlanTick > cooldown)) void this.#plan(false);
    }
    if (this.incident === "RESPONDING" && tick % 40 === 0) void this.#brief();
    this.onUpdate();
  }

  #transition(e: Estimate): IncidentState {
    const s = this.incident;
    if (s === "ALL_CLEAR") return s;
    const confirm = this.env.runtime.live.confirmConfidence;
    if (e.hazard === "none") return s === "SUSPECTED" ? "NORMAL" : s;
    if (s === "NORMAL" && e.confidence >= 0.3) return e.confidence >= confirm || this.feed.panelAlarm ? "CONFIRMED" : "SUSPECTED";
    if (s === "SUSPECTED" && (e.confidence >= confirm || this.feed.panelAlarm)) return "CONFIRMED";
    if (s === "CONFIRMED" && this.#pub.rec) return "RESPONDING";
    return s;
  }

  get current(): DecisionCard | null { return this.cards.at(-1) ?? null; }

  async #plan(injected: boolean): Promise<void> {
    if (!this.estimate || this.estimate.hazard === "none") return;
    this.#planning = true;
    this.#lastPlanTick = this.tick;
    const est = this.estimate, estRec = this.estimateRec;
    const elapsed = this.hazardStartTick >= 0 ? (this.tick - this.hazardStartTick) * this.dt : 0;
    const decisionId = `D${++this.#seq}`;
    try {
      this.log.append({ tick: this.tick, actor: "planner", type: "planner.requested", payload: { decisionId, injected }, refs: estRec ? [estRec.id] : [] });
      const prop: Proposal = injected ? badPlan(this.env.model, est, this.env.hazardParams) : await plan({
        claude: this.#claude, model: this.env.model, estimate: est, hp: this.env.hazardParams, elapsedSec: elapsed, profile: this.cfg.profile, profiles: this.env.profiles, playbook: this.playbook, timeoutMs: 8000,
      });
      if (!injected && prop.rationaleSource !== "llm") this.log.append({ tick: this.tick, actor: "planner", type: "planner.fallback", payload: { decisionId, source: prop.rationaleSource, why: prop.rationale.slice(0, 200) } });
      const rv = routeView(this.env.model, { kind: est.hazard === "quake" ? "quake" : "none", damaged: damagedFromEstimate(est) }, this.env.hazardParams, 0, prop.policy.closedRoutes);
      let preview: DecisionCard["signPreview"] = [];
      let compileError: string | null = null;
      try { preview = Object.entries(compileSigns(this.env.model, { policy: prop.policy, rv, elapsedSec: 0 })).map(([mount, state]) => ({ mount, state })); } catch (e) { compileError = e instanceof SignCompileError ? e.message : String(e); }
      const propRec = this.log.append({ tick: this.tick, actor: "planner", type: "planner.proposed", payload: { decisionId, protocol: prop.protocol, policy: prop.policy, rationale: prop.rationale, rationaleSource: prop.rationaleSource, playbookMatch: prop.playbookMatch, alternatives: prop.alternatives, injected, compileError }, refs: estRec ? [estRec.id] : [] });
      for (const c of this.cards) if (c.status === "pending" || c.status === "verifying") c.status = "superseded";
      const card: DecisionCard = { id: decisionId, createdTick: this.tick, protocol: prop.protocol, policy: prop.policy, rationale: prop.rationale + (compileError ? ` [sign plan does not compile: ${compileError}]` : ""), rationaleSource: prop.rationaleSource, playbookMatch: prop.playbookMatch, verdict: null, alternatives: prop.alternatives.map((a) => ({ ...a, predicted: null })), status: "verifying", signPreview: preview, injected };
      this.cards.push(card);
      this.onUpdate();
      const v = await verify(this.#ev, { model: this.env.model, estimate: est, profile: this.cfg.profile, elapsedSinceHazardSec: elapsed, protocol: prop.protocol, policy: prop.policy, seed: this.cfg.seed + this.#seq * 10, runtime: this.env.runtime }, propRec.id);
      const vRec = this.log.append({ tick: this.tick, actor: "verifier", type: "verifier.verdict", payload: { decisionId, ...v }, refs: [propRec.id] });
      card.verdict = { id: vRec.id, verdict: v.verdict, predicted: v.predicted, worstCase: v.worstCase, doNothing: v.doNothing, reasons: v.reasons };
      if (card.status === "verifying") {
        card.status = "pending";
        this.log.append({ tick: this.tick, actor: "orchestrator", type: "approval.requested", payload: { decisionId, deadlineTick: this.tick + Math.round(this.windowSec / this.dt) }, refs: [propRec.id, vRec.id] });
        this.approvalDeadline = this.tick + Math.round(this.windowSec / this.dt);
      }
    } catch (e) {
      this.log.append({ tick: this.tick, actor: "planner", type: "planner.fallback", payload: { decisionId, source: "error", why: String(e).slice(0, 300) } });
    } finally {
      this.#planning = false;
      this.onUpdate();
    }
  }

  approvalDeadline: number | null = null;

  #checkApproval(): void {
    const c = this.current;
    if (!c || c.status !== "pending" || this.approvalDeadline === null || this.tick < this.approvalDeadline) return;
    c.status = "timeout";
    this.log.append({ tick: this.tick, actor: "orchestrator", type: "approval.timeout", payload: { decisionId: c.id, held: this.#pub.rec ? "last approved state" : "static default" } });
    this.approvalDeadline = null;
    this.onUpdate();
  }

  decide(id: string, verdict: "approve" | "reject", reason?: string): { ok: boolean; error?: string } {
    const c = this.cards.find((x) => x.id === id);
    if (!c || c.status !== "pending" || !c.verdict) return { ok: false, error: "no pending decision with that id" };
    const propRec = this.log.query({ type: "planner.proposed" }).find((r) => (r.payload as { decisionId: string }).decisionId === id)!;
    if (verdict === "reject") {
      this.log.append({ tick: this.tick, actor: "human", type: "human.rejected", payload: { decisionId: id, reason: reason ?? "" }, refs: [c.verdict.id] });
      c.status = "rejected";
      this.approvalDeadline = null;
      this.onUpdate();
      return { ok: true };
    }
    if (c.verdict.verdict === "FAIL" && this.failMode === "block_with_override" && !reason?.trim()) return { ok: false, error: "verdict is FAIL: approving needs an override reason (gate.failMode = block_with_override)" };
    if (this.estimate && this.estimate.confidence < this.env.runtime.live.publishConfidence) {
      this.log.append({ tick: this.tick, actor: "gate", type: "gate.rejected", payload: { decisionId: id, reason: this.holdReason ?? "confidence below publish threshold" } });
      return { ok: false, error: this.holdReason ?? "confidence below publish threshold" };
    }
    if (c.verdict.verdict === "FAIL" && reason?.trim()) this.log.append({ tick: this.tick, actor: "human", type: "human.override", payload: { decisionId: id, reason: reason.trim() }, refs: [c.verdict.id] });
    this.log.append({ tick: this.tick, actor: "human", type: "human.approved", payload: { decisionId: id, ...(reason ? { note: reason } : {}) }, refs: [c.verdict.id, propRec.id] });
    try {
      const est = this.estimate!;
      const rv = routeView(this.env.model, { kind: est.hazard === "quake" ? "quake" : "none", damaged: damagedFromEstimate(est) }, this.env.hazardParams, 0, c.policy.closedRoutes);
      publish(this.log, this.tick, id, this.failMode, this.env.model, rv);
      c.status = c.verdict.verdict === "FAIL" ? "overridden" : "approved";
      for (const o of this.cards) if (o !== c && o.status === "approved") o.status = "superseded";
      this.approvalDeadline = null;
      this.hub.push(this.tick, this.dt);
      void this.#brief();
      this.onUpdate();
      return { ok: true };
    } catch (e) {
      c.status = "blocked";
      this.onUpdate();
      return { ok: false, error: e instanceof GateError ? e.message : String(e) };
    }
  }

  async #brief(): Promise<void> {
    if (this.#briefing) return;
    this.#briefing = true;
    try {
      const b = await draftBrief(this.log, this.env.model, this.#claude, this.tick, `B${this.tick}`);
      this.log.append({ tick: this.tick, actor: "liaison", type: "liaison.brief", payload: b, refs: [...new Set(b.lines.flatMap((l) => l.refs))] });
      this.brief = b;
      this.onUpdate();
    } finally { this.#briefing = false; }
  }

  control(c: Control): { ok: boolean; error?: string } {
    if (c.action === "start_fire" || c.action === "start_quake") {
      if (this.hazardStartTick >= 0) return { ok: false, error: "a hazard is already running; reset first" };
      this.hazardStartTick = this.tick;
      this.log.append({ tick: this.tick, actor: "demo", type: "demo.control", payload: c });
    } else if (c.action === "inject_bad_plan") {
      if (!this.estimate || this.estimate.hazard === "none") return { ok: false, error: "start a hazard first" };
      this.log.append({ tick: this.tick, actor: "demo", type: "demo.control", payload: c });
      void this.#plan(true);
    } else if (c.action === "fail_sensor") {
      if (!this.feed.defs.some((d) => d.id === c.sensor)) return { ok: false, error: `unknown sensor ${c.sensor}` };
      this.feed.faults.set(c.sensor, c.mode ?? "silent");
      this.log.append({ tick: this.tick, actor: "demo", type: "sensor.fault", payload: { sensor: c.sensor, mode: c.mode ?? "silent" } });
    } else if (c.action === "restore_sensors") {
      this.feed.faults.clear();
      this.log.append({ tick: this.tick, actor: "demo", type: "sensor.fault", payload: { restored: true } });
    } else if (c.action === "all_clear") {
      this.log.append({ tick: this.tick, actor: "human", type: "incident.state", payload: { from: this.incident, to: "ALL_CLEAR" } });
      this.incident = "ALL_CLEAR";
      const m = this.truth.summary();
      this.report = historianReport(this.log, m, badness(m, this.env.runtime), truthScenario(this.cfg, this.id), this.id, true);
      this.log.append({ tick: this.tick, actor: "historian", type: "historian.report", payload: this.report });
    }
    this.onUpdate();
    return { ok: true };
  }

  signInfo(): SignInfo[] {
    return this.env.model.mounts.map((mt) => {
      const { state, ref } = this.hub.approvedState(mt.id, this.tick, this.dt);
      return { mount: mt.id, floor: this.env.model.floors[mt.floor]!.id, x: mt.x, y: mt.y, online: this.hub.online(mt.id), phones: this.hub.phones(mt.id), state, approvedRef: ref, lastHeartbeatMs: this.hub.lastBeat(mt.id), url: `${this.lan}/sign?mount=${encodeURIComponent(mt.id)}` };
    });
  }

  state(frameChannel: string, offline: boolean): LiveState {
    return {
      sessionId: this.id, running: true, tick: this.tick, t: Math.round(this.tick * this.dt * 100) / 100, incident: this.incident, estimate: this.estimate,
      current: this.current, history: this.cards.slice(0, -1).slice(-8), signs: this.signInfo(), brief: this.brief, approvalDeadlineTick: this.current?.status === "pending" ? this.approvalDeadline : null,
      failMode: this.failMode, holdReason: this.holdReason, frameChannel, offline,
    };
  }

  logLines(since = 0): LogLine[] {
    return this.log.query({ fromSeq: since + 1 }).filter((r) => r.type !== "sensor.batch" && r.type !== "sign.state_sent").slice(-200).map((r) => ({ id: r.id, seq: r.seq, tick: r.tick, actor: r.actor, type: r.type, summary: summarize(r) }));
  }
}

function summarize(r: EventRecord): string {
  const p = r.payload as Record<string, unknown> | null;
  switch (r.type) {
    case "sentinel.estimate": return `${p?.hazard} ${p?.zone ?? ""} confidence ${p?.confidence}`;
    case "planner.proposed": return `${p?.decisionId} ${p?.protocol} (${p?.rationaleSource})${p?.injected ? " INJECTED" : ""}`;
    case "verifier.verdict": return `${p?.decisionId} ${p?.verdict}`;
    case "human.approved": case "human.rejected": case "human.override": return `${p?.decisionId} ${p?.reason ?? p?.note ?? ""}`;
    case "gate.published": return `${p?.decisionId} ${p?.protocol} published to signs`;
    case "gate.rejected": return `${p?.decisionId}: ${p?.reason}`;
    case "incident.state": return `${p?.from} -> ${p?.to}`;
    case "demo.control": return String(p?.action);
    default: return JSON.stringify(p).slice(0, 120);
  }
}
