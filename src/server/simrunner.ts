import { DistilledPolicy } from "../policy/distilled.ts";
import { PERSONA_LABEL } from "../policy/personas.ts";
import { crowdBrain, personaPolicy } from "../policy/showcase.ts";
import { env } from "../shared/env.ts";
import { badness, BADNESS_FORMULA, makeWorld, type SimEnv } from "../sim/run.ts";
import type { Scenario } from "../sim/types.ts";
import { POLICY, type World } from "../sim/world.ts";
import type { Channels } from "./channels.ts";
import type { SimRunRequest } from "./contract.ts";
import { FrameEncoder } from "./frames.ts";
import { prepareScenario } from "../design/prepare.ts";

let counter = 0;

/** What each simulation channel is running, so a page opened from a link can describe it. Only the most recent runs are kept. */
export const runInfo = new Map<string, { scenario: Scenario; mode: SimRunRequest["mode"]; venue: string }>();

export function loadDistilled(): DistilledPolicy | undefined {
  try { return DistilledPolicy.load(); } catch { return undefined; }
}

export function startSimRun(simEnv: SimEnv, channels: Channels, req: SimRunRequest): { channel: string; world: World } {
  const channel = `sim:${++counter}`;
  runInfo.set(channel, { scenario: req.scenario as Scenario, mode: req.mode, venue: req.venue ?? "rinker-hall" });
  if (runInfo.size > 32) runInfo.delete(runInfo.keys().next().value!);
  const { scenario, model } = prepareScenario(simEnv, req.scenario as Scenario);
  const distilled = loadDistilled();
  const backend = (env("PERSONA_BACKEND") ?? "haiku") as "haiku" | "jev";
  const llm = req.mode === "showcase" ? personaPolicy(backend === "jev" ? "jev" : "haiku", simEnv) : req.mode === "crowd" ? crowdBrain(simEnv) : undefined;
  let w!: World;
  w = makeWorld(simEnv, scenario, {
    model,
    ...(distilled ? { distilled } : {}),
    bulkPolicy: req.mode === "distilled" && distilled ? "distilled" : "rule",
    ...(llm ? { llm, llmAgents: req.mode === "crowd" ? 1_000_000 : simEnv.runtime.showcase.livePersonas } : {}),
    hooks: {
      onDecision: (ctx, d) => {
        if (w.policyKind[ctx.agent] !== POLICY.LLM) return;
        if (req.mode === "crowd" && ctx.agent % 25 !== 0) return;
        const o = ctx.options.find((x) => x.id === d.optionId);
        channels.publish(channel, { type: "persona", channel, tick: ctx.tick, agent: ctx.agent, point: ctx.point, persona: ctx.persona, chosen: o?.desc ?? d.optionId, source: d.source, ...(d.note ? { note: d.note } : {}), label: PERSONA_LABEL });
      },
    },
  });
  const enc = new FrameEncoder(channel);
  const ticksPerFrame = 4;
  const frameMs = req.speed > 0 ? (ticksPerFrame * simEnv.runtime.sim.dtSec * 1000) / req.speed : 0;
  const loop = async () => {
    channels.publish(channel, enc.encode(w));
    while (!w.done) {
      const t0 = Date.now();
      for (let k = 0; k < ticksPerFrame && !w.done; k++) {
        const due = w.dueUnresolved();
        if (due.length) await Promise.race([Promise.allSettled(due.map((q) => q.promise)), new Promise((r) => setTimeout(r, simEnv.runtime.persona.deadlineMs))]);
        w.step();
      }
      channels.publish(channel, enc.encode(w));
      const wait = frameMs - (Date.now() - t0);
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
    const metrics = w.summary();
    channels.publish(channel, { type: "summary", channel, metrics, badness: badness(metrics, simEnv.runtime), badnessFormula: BADNESS_FORMULA }, true);
  };
  void loop();
  return { channel, world: w };
}
