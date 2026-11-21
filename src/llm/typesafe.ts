import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { env, isOffline } from "../shared/env.ts";
import { DeadlineError, LlmUnavailable, assertAllowedHost, withDeadline, type LlmCallSink } from "./guard.ts";

export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface TypeSafeLike {
  available(): boolean;
  choose(req: { model: string; state: Record<string, unknown>; instructions: string; criteria: Record<string, string>; timeoutMs: number }): Promise<ChoiceAnswer>;
}

export class TypeSafeAdapter implements TypeSafeLike {
  readonly #client: TypeSafeClient | null;
  readonly #sink: LlmCallSink | undefined;
  constructor(opts: { apiKey?: string; sink?: LlmCallSink } = {}) {
    const key = opts.apiKey ?? env("TYPESAFE_API_KEY");
    this.#sink = opts.sink;
    if (key && !isOffline()) {
      assertAllowedHost("https://api.typesafe.ai");
      this.#client = new TypeSafeClient({ apiKey: key, retry: { maxRetries: 1 } });
    } else this.#client = null;
  }

  available(): boolean { return this.#client !== null; }

  async choose(req: { model: string; state: Record<string, unknown>; instructions: string; criteria: Record<string, string>; timeoutMs: number }): Promise<ChoiceAnswer> {
    const started = performance.now();
    const input = { state: req.state, instructions: req.instructions, criteria: req.criteria };
    const rec = (outcome: "ok" | "error" | "timeout" | "offline" | "no_key" | "invalid", output: unknown, error?: string) =>
      this.#sink?.({ provider: "typesafe", role: "persona", model: req.model, input, output, outcome, latencyMs: Math.round(performance.now() - started), ...(error ? { error } : {}) });
    if (!this.#client) {
      const outcome = isOffline() ? "offline" : "no_key";
      rec(outcome, null);
      throw new LlmUnavailable(outcome, `TypeSafe unavailable (${outcome})`);
    }
    const ctrl = new AbortController();
    try {
      const res = await withDeadline(this.#client.systemOne({
        state: req.state as never,
        questions: { action: choice(req.instructions, req.criteria) },
        model: req.model,
      }, { timeout: req.timeoutMs, signal: ctrl.signal }), req.timeoutMs, ctrl);
      const a = res.answers.action;
      const out: ChoiceAnswer = { choice: a.choice, probabilities: { ...a.probabilities } as Record<string, number>, confidence: a.confidence };
      rec("ok", out);
      return out;
    } catch (e) {
      const timeout = e instanceof DeadlineError;
      rec(timeout ? "timeout" : "error", null, String(e));
      throw new LlmUnavailable(timeout ? "timeout" : "error", String(e));
    }
  }
}
