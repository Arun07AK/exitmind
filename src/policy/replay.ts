import type { EventLog, EventRecord } from "../log/eventlog.ts";
import { signature, type Decision, type DecisionContext, type DecisionPolicy } from "./types.ts";

export interface PersonaDecisionRecord {
  agent: number;
  tick: number;
  point: DecisionContext["point"];
  key: string;
  persona: DecisionContext["persona"];
  situation: DecisionContext["situation"];
  options: { id: string; action: DecisionContext["options"][number]["action"]; roles: DecisionContext["options"][number]["roles"]; desc: string }[];
  optionId: string;
  chosen: string;
  source: Decision["source"];
  note?: string;
  probs?: Record<string, number>;
  confidence?: number;
  latencyMs?: number;
}

export function decisionRecord(ctx: DecisionContext, d: Decision): PersonaDecisionRecord {
  const chosen = ctx.options.find((o) => o.id === d.optionId);
  return {
    agent: ctx.agent, tick: ctx.tick, point: ctx.point, key: ctx.key, persona: ctx.persona, situation: ctx.situation,
    options: ctx.options.map((o) => ({ id: o.id, action: o.action, roles: o.roles, desc: o.desc })),
    optionId: d.optionId, chosen: chosen ? signature(chosen) : "", source: d.source,
    ...(d.note ? { note: d.note } : {}), ...(d.probs ? { probs: d.probs } : {}),
    ...(d.confidence !== undefined ? { confidence: d.confidence } : {}), ...(d.latencyMs !== undefined ? { latencyMs: d.latencyMs } : {}),
  };
}

export const recordKey = (agent: number, tick: number, point: string): string => `${agent}:${tick}:${point}`;

export function personaRecords(log: EventLog | readonly EventRecord[]): PersonaDecisionRecord[] {
  const recs = Array.isArray(log) ? log : (log as EventLog).records();
  return recs.filter((r) => r.type === "persona.decision").map((r) => r.payload as PersonaDecisionRecord);
}

export class ReplayPolicy implements DecisionPolicy {
  readonly name = "replay";
  readonly delayed = true;
  readonly #byKey: Map<string, PersonaDecisionRecord>;
  misses = 0;
  constructor(records: readonly PersonaDecisionRecord[]) {
    this.#byKey = new Map(records.map((r) => [recordKey(r.agent, r.tick, r.point), r]));
  }
  decide(ctx: DecisionContext): Decision {
    const r = this.#byKey.get(recordKey(ctx.agent, ctx.tick, ctx.point));
    if (!r) { this.misses++; return { optionId: "", source: "replay", note: "decision missing from log" }; }
    return { optionId: r.optionId, source: "replay", note: `replayed ${r.source}` };
  }
}
