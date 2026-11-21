import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { env, isOffline } from "../shared/env.ts";
import { DeadlineError, LlmUnavailable, assertAllowedHost, withDeadline, type LlmCallRecord, type LlmCallSink } from "./guard.ts";

export interface ClaudeJsonRequest<T> {
  role: LlmCallRecord["role"];
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  parse: ZodType<T>;
  maxTokens: number;
  timeoutMs: number;
  effort?: "low" | "medium" | "high";
}

export interface ClaudeLike {
  available(): boolean;
  json<T>(req: ClaudeJsonRequest<T>): Promise<T>;
}

export class ClaudeClient implements ClaudeLike {
  readonly #client: Anthropic | null;
  readonly #sink: LlmCallSink | undefined;
  constructor(opts: { apiKey?: string; sink?: LlmCallSink } = {}) {
    const key = opts.apiKey ?? env("ANTHROPIC_API_KEY");
    this.#sink = opts.sink;
    if (key && !isOffline()) {
      assertAllowedHost("https://api.anthropic.com");
      this.#client = new Anthropic({ apiKey: key, maxRetries: 1 });
    } else this.#client = null;
  }

  available(): boolean { return this.#client !== null; }

  async json<T>(req: ClaudeJsonRequest<T>): Promise<T> {
    const input = { system: req.system, user: req.user };
    const started = performance.now();
    const rec = (outcome: LlmCallRecord["outcome"], output: unknown, error?: string) =>
      this.#sink?.({ provider: "anthropic", role: req.role, model: req.model, input, output, outcome, latencyMs: Math.round(performance.now() - started), ...(error ? { error } : {}) });
    if (!this.#client) {
      const outcome = isOffline() ? "offline" : "no_key";
      rec(outcome, null);
      throw new LlmUnavailable(outcome, `Claude unavailable (${outcome})`);
    }
    const ctrl = new AbortController();
    let text = "";
    try {
      const msg = await withDeadline(this.#client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: req.schema }, ...(req.effort ? { effort: req.effort } : {}) },
      }, { signal: ctrl.signal, timeout: req.timeoutMs }), req.timeoutMs, ctrl);
      for (const b of msg.content) if (b.type === "text") text += b.text;
    } catch (e) {
      const timeout = e instanceof DeadlineError;
      rec(timeout ? "timeout" : "error", null, String(e));
      throw new LlmUnavailable(timeout ? "timeout" : "error", String(e));
    }
    let parsed: T;
    try {
      parsed = req.parse.parse(JSON.parse(text));
    } catch (e) {
      rec("invalid", text, String(e));
      throw new LlmUnavailable("invalid", `unparseable output: ${String(e).slice(0, 200)}`);
    }
    rec("ok", parsed);
    return parsed;
  }
}
