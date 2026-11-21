export const ALLOWED_HOSTS = new Set(["api.anthropic.com", "api.typesafe.ai"]);

export function assertAllowedHost(url: string): void {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(host)) throw new Error(`egress to ${host} is not on the allow-list`);
}

export class DeadlineError extends Error {
  constructor(ms: number) {
    super(`deadline of ${ms} ms exceeded`);
    this.name = "DeadlineError";
  }
}

export function withDeadline<T>(p: Promise<T>, ms: number, ctrl?: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ctrl?.abort(); reject(new DeadlineError(ms)); }, ms);
    }),
  ]);
}

export class Semaphore {
  #free: number;
  readonly #queue: (() => void)[] = [];
  constructor(n: number) { this.#free = n; }
  async run<T>(f: () => Promise<T>): Promise<T> {
    if (this.#free > 0) this.#free--;
    else await new Promise<void>((r) => this.#queue.push(r));
    try { return await f(); } finally {
      const next = this.#queue.shift();
      if (next) next(); else this.#free++;
    }
  }
}

export type LlmOutcome = "ok" | "error" | "timeout" | "offline" | "invalid" | "no_key";

export interface LlmCallRecord {
  provider: "anthropic" | "typesafe";
  role: "persona" | "planner" | "liaison" | "parser";
  model: string;
  input: unknown;
  output: unknown;
  outcome: LlmOutcome;
  latencyMs: number;
  error?: string;
}

export type LlmCallSink = (r: LlmCallRecord) => void;

export class LlmUnavailable extends Error {
  readonly outcome: LlmOutcome;
  constructor(outcome: LlmOutcome, msg: string) {
    super(msg);
    this.name = "LlmUnavailable";
    this.outcome = outcome;
  }
}
