import type { EventLog } from "../log/eventlog.ts";
import { env } from "../shared/env.ts";
import { ClaudeClient, type ClaudeLike } from "../llm/claude.ts";
import type { LlmCallRecord } from "../llm/guard.ts";
import { TypeSafeAdapter, type TypeSafeLike } from "../llm/typesafe.ts";
import { makeWorld, runAsync, stateHash, type SimEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import { POLICY, type RunMetrics, type World } from "../sim/world.ts";
import { DistilledPolicy } from "./distilled.ts";
import { HaikuPersona, JevPersona, PERSONA_LABEL } from "./personas.ts";
import { ReplayPolicy, decisionRecord, type PersonaDecisionRecord } from "./replay.ts";
import type { DecisionPolicy } from "./types.ts";

export type Backend = "haiku" | "jev" | "replay";

export interface ShowcaseOptions {
  backend: Backend;
  livePersonas: number;
  records?: readonly PersonaDecisionRecord[];
  distilled?: DistilledPolicy;
  claude?: ClaudeLike;
  typesafe?: TypeSafeLike;
  log?: EventLog;
  onFrame?: (w: World) => void | Promise<void>;
  onLlmCall?: (r: LlmCallRecord) => void;
}

export interface ShowcaseResult {
  metrics: RunMetrics;
  hash: string;
  records: PersonaDecisionRecord[];
  llmCalls: number;
  fallbacks: number;
  rejected: number;
  label: string;
  personaAgents: number[];
}

export function personaPolicy(backend: Exclude<Backend, "replay">, simEnv: SimEnv, o: Pick<ShowcaseOptions, "claude" | "typesafe" | "onLlmCall"> = {}): HaikuPersona | JevPersona {
  const rt = simEnv.runtime;
  if (backend === "haiku") return new HaikuPersona(o.claude ?? new ClaudeClient(o.onLlmCall ? { sink: o.onLlmCall } : {}), env("PERSONA_HAIKU_MODEL") ?? "claude-haiku-5-5", rt.persona.deadlineMs, rt.showcase.maxInFlight);
  return new JevPersona(o.typesafe ?? new TypeSafeAdapter(o.onLlmCall ? { sink: o.onLlmCall } : {}), env("JEV_MODEL") ?? "jev-1.14.0", rt.persona.jevTimeoutMs, rt.showcase.maxInFlight);
}

export async function runShowcase(simEnv: SimEnv, sc: Scenario, o: ShowcaseOptions): Promise<ShowcaseResult> {
  const records: PersonaDecisionRecord[] = [];
  let llm: DecisionPolicy;
  let calls = () => 0;
  if (o.backend === "replay") llm = new ReplayPolicy(o.records ?? []);
  else {
    const p = personaPolicy(o.backend, simEnv, o);
    llm = p;
    calls = () => p.calls;
  }
  let w!: World;
  let fallbacks = 0, rejected = 0;
  w = makeWorld(simEnv, sc, {
    llm, llmAgents: o.livePersonas,
    ...(o.distilled ? { distilled: o.distilled } : {}),
    hooks: {
      onDecision: (ctx, d) => {
        if (w.policyKind[ctx.agent] !== POLICY.LLM) return;
        if (d.source.startsWith("fallback")) fallbacks++;
        const rec = decisionRecord(ctx, d);
        records.push(rec);
        o.log?.append({ tick: ctx.tick, actor: "persona", type: "persona.decision", payload: { ...rec, label: PERSONA_LABEL } });
      },
      onReject: (ctx, raw, reason) => {
        rejected++;
        o.log?.append({ tick: ctx.tick, actor: "persona", type: "persona.decision.rejected", payload: { agent: ctx.agent, point: ctx.point, raw: JSON.parse(JSON.stringify(raw ?? null)), reason, allowed: ctx.options.map((x) => x.id) } });
      },
    },
  });
  o.log?.append({ tick: 0, actor: "sim", type: "session.started", payload: { sessionId: sc.id, mode: o.backend === "replay" ? "replay" : "showcase", seed: sc.seed } });
  const metrics = await runAsync(w, simEnv.runtime.persona.deadlineMs, o.onFrame);
  const personaAgents: number[] = [];
  for (let a = 0; a < w.n; a++) if (w.policyKind[a] === POLICY.LLM) personaAgents.push(a);
  const hash = stateHash(w);
  o.log?.append({ tick: w.tick, actor: "sim", type: "world.checkpoint", payload: { hash, final: true, scenario: sc, livePersonas: o.livePersonas, backend: o.backend } });
  return { metrics, hash, records, llmCalls: calls(), fallbacks, rejected, label: PERSONA_LABEL, personaAgents };
}
