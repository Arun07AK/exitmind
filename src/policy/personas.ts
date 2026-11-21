import { z } from "zod";
import type { Rng } from "../shared/rng.ts";
import type { ClaudeLike } from "../llm/claude.ts";
import { Semaphore } from "../llm/guard.ts";
import { stopwatch } from "../log/clock.ts";
import type { TypeSafeLike } from "../llm/typesafe.ts";
import type { Decision, DecisionContext, DecisionPolicy } from "./types.ts";

export const PERSONA_LABEL = "modelled behaviour, not validated against real evacuations";

const SYSTEM = [
  "You model how one occupant of a building might act during an evacuation in a design-time simulation.",
  "This is modelled behaviour for safety design review, not a prediction about real people.",
  "Choose exactly one of the listed options, as this person would, given their persona and what they can perceive.",
  "People are not perfectly rational: familiarity, stress, groups and what others do all matter.",
  "Answer with the option id and a reason of at most 20 words.",
].join(" ");

export function personaState(ctx: DecisionContext): Record<string, unknown> {
  const p = ctx.persona, s = ctx.situation;
  return {
    person: { age: p.age.replace("_", " "), role: p.role, mobility: p.mobility.replace("_", " "), knowsBuilding: p.familiar, stress: p.stress, withGroup: p.inGroup },
    moment: ctx.point.toLowerCase().replaceAll("_", " "),
    perceives: {
      alarm: s.hazard !== "none", smokeNearby: s.smokeVisible, groundShaking: s.shaking, threatInSight: s.threatVisible,
      crowdAround: s.crowd, lastInstruction: s.instruction, groupMemberMissing: s.groupMissing,
    },
  };
}

function shuffledOptions(ctx: DecisionContext, rng: Rng) {
  return rng.shuffled(ctx.options);
}

export class HaikuPersona implements DecisionPolicy {
  readonly name = "llm:haiku";
  readonly #claude: ClaudeLike;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #sem: Semaphore;
  calls = 0;
  constructor(claude: ClaudeLike, model: string, timeoutMs: number, maxInFlight: number) {
    this.#claude = claude; this.#model = model; this.#timeoutMs = timeoutMs; this.#sem = new Semaphore(maxInFlight);
  }

  decide(ctx: DecisionContext, rng: Rng): Promise<Decision> {
    const opts = shuffledOptions(ctx, rng);
    const ids = opts.map((o) => o.id).sort();
    const schema = {
      type: "object",
      properties: { optionId: { type: "string", enum: ids }, reason: { type: "string" } },
      required: ["optionId", "reason"],
      additionalProperties: false,
    };
    const user = JSON.stringify({ ...personaState(ctx), options: opts.map((o) => ({ id: o.id, option: o.desc })) });
    const elapsed = stopwatch();
    this.calls++;
    return this.#sem.run(() => this.#claude.json({
      role: "persona", model: this.#model, system: SYSTEM, user, schema,
      parse: z.object({ optionId: z.string(), reason: z.string() }), maxTokens: 500, timeoutMs: this.#timeoutMs, effort: "low",
    })).then((r) => ({ optionId: r.optionId, source: "llm:haiku" as const, latencyMs: elapsed(), note: r.reason.slice(0, 160) }));
  }
}

export class JevPersona implements DecisionPolicy {
  readonly name = "llm:jev";
  readonly #ts: TypeSafeLike;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #sem: Semaphore;
  calls = 0;
  constructor(ts: TypeSafeLike, model: string, timeoutMs: number, maxInFlight: number) {
    this.#ts = ts; this.#model = model; this.#timeoutMs = timeoutMs; this.#sem = new Semaphore(maxInFlight);
  }

  decide(ctx: DecisionContext, rng: Rng): Promise<Decision> {
    const opts = shuffledOptions(ctx, rng);
    const criteria = Object.fromEntries(opts.map((o) => [o.id, o.desc]));
    const elapsed = stopwatch();
    this.calls++;
    const u = rng.next();
    return this.#sem.run(() => this.#ts.choose({
      model: this.#model, state: personaState(ctx), timeoutMs: this.#timeoutMs, criteria,
      instructions: "Which option will this person most likely take at this moment? This models behaviour for a design-time evacuation simulation.",
    })).then((a) => {
      const keys = Object.keys(a.probabilities).sort();
      let acc = 0, pick = a.choice;
      const total = keys.reduce((s, k) => s + (a.probabilities[k] ?? 0), 0);
      for (const k of keys) { acc += (a.probabilities[k] ?? 0) / (total || 1); if (u < acc) { pick = k; break; } }
      return { optionId: pick, source: "llm:jev" as const, probs: a.probabilities, confidence: a.confidence, latencyMs: elapsed() };
    });
  }
}
