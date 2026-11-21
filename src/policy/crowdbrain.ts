import { z } from "zod";
import type { ClaudeLike } from "../llm/claude.ts";
import { Semaphore } from "../llm/guard.ts";
import { stopwatch } from "../log/clock.ts";
import type { Rng } from "../shared/rng.ts";
import { personaState } from "./personas.ts";
import { signature, type Decision, type DecisionContext, type DecisionPolicy } from "./types.ts";

const SYSTEM = [
  "You are the crowd brain of a design-time evacuation simulation. You decide how a group of similar people react at one moment.",
  "Everyone in the group shares the same profile and situation. Give a probability (0-100, summing to about 100) for each listed option, reflecting how people like this actually behave: familiarity, the gate they came in through, what others do, stress, staff duties.",
  "Example: at a college fest, staff who know the venue often use a side exit, while first-time visitors usually head back to the entrance they came in through. Answer only with the probabilities and one short reason.",
].join(" ");

export interface CrowdBrainStats { calls: number; groups: number; cacheHits: number; fallbacks: number }

export class CrowdBrainPolicy implements DecisionPolicy {
  readonly name = "llm:haiku";
  readonly delayed = true;
  readonly stats: CrowdBrainStats = { calls: 0, groups: 0, cacheHits: 0, fallbacks: 0 };
  readonly #claude: ClaudeLike;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #maxCalls: number;
  readonly #refreshTicks: number;
  readonly #sem: Semaphore;
  readonly #cache = new Map<string, Promise<{ dist: Record<string, number>; reason: string; ms: number } | null>>();
  constructor(claude: ClaudeLike, model: string, o: { timeoutMs: number; maxCalls: number; refreshTicks: number; maxInFlight: number }) {
    this.#claude = claude; this.#model = model; this.#timeoutMs = o.timeoutMs; this.#maxCalls = o.maxCalls; this.#refreshTicks = o.refreshTicks; this.#sem = new Semaphore(o.maxInFlight);
  }

  groupKey(ctx: DecisionContext): string {
    const p = ctx.persona;
    const opts = [...new Set(ctx.options.map(signature))].sort().join(",");
    return [ctx.key, p.role, p.mobility === "unimpaired" ? "-" : "M", Math.floor(ctx.tick / this.#refreshTicks), opts].join("|");
  }

  #ask(ctx: DecisionContext): Promise<{ dist: Record<string, number>; reason: string; ms: number } | null> {
    const ids = ctx.options.map((o) => o.id);
    const elapsed = stopwatch();
    this.stats.calls++;
    return this.#sem.run(() => this.#claude.json({
      role: "persona", model: this.#model, system: SYSTEM, maxTokens: 600, timeoutMs: this.#timeoutMs, effort: "low",
      user: JSON.stringify({ ...personaState(ctx), options: ctx.options.map((o) => ({ id: o.id, option: o.desc })) }),
      schema: { type: "object", additionalProperties: false, required: ["probabilities", "reason"], properties: { probabilities: { type: "object", additionalProperties: false, required: ids, properties: Object.fromEntries(ids.map((id) => [id, { type: "number" }])) }, reason: { type: "string" } } },
      parse: z.object({ probabilities: z.record(z.string(), z.number().min(0)), reason: z.string() }),
    })).then((r) => {
      const dist: Record<string, number> = {};
      let total = 0;
      for (const o of ctx.options) { const v = r.probabilities[o.id] ?? 0; const sig = signature(o); dist[sig] = (dist[sig] ?? 0) + v; total += v; }
      if (total <= 0) return null;
      for (const k of Object.keys(dist)) dist[k] = dist[k]! / total;
      return { dist, reason: r.reason.slice(0, 160), ms: elapsed() };
    }, () => null);
  }

  decide(ctx: DecisionContext, rng: Rng): Promise<Decision> {
    const key = this.groupKey(ctx);
    let p = this.#cache.get(key);
    if (p) this.stats.cacheHits++;
    else if (this.stats.calls >= this.#maxCalls) { this.stats.fallbacks++; return Promise.reject(new Error("crowd brain call budget used")); }
    else { p = this.#ask(ctx); this.#cache.set(key, p); this.stats.groups++; }
    const u = rng.next();
    return p.then((res) => {
      if (!res) throw new Error("crowd brain unavailable");
      const sigs = Object.keys(res.dist).sort();
      let acc = 0, pick = sigs.at(-1)!;
      for (const s of sigs) { acc += res.dist[s]!; if (u < acc) { pick = s; break; } }
      const opt = ctx.options.find((o) => signature(o) === pick) ?? ctx.options[0]!;
      return { optionId: opt.id, source: "llm:haiku" as const, probs: res.dist, latencyMs: res.ms, note: `group decision: ${res.reason}` };
    });
  }
}
