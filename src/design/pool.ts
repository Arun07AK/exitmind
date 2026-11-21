import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { loadEnv, type SimEnv } from "../sim/run.ts";
import type { Twin } from "../twin/schema.ts";
import type { ExitCandidate } from "../twin/edit.ts";
import { evaluate, type EvalResult, type EvalTask } from "./evaluate.ts";
import { exitCandidates, setExitCandidates } from "./prepare.ts";

export interface Evaluator {
  run(task: EvalTask): Promise<EvalResult>;
  map(tasks: EvalTask[]): Promise<EvalResult[]>;
  close(): Promise<void>;
  readonly size: number;
}

export class InlineEvaluator implements Evaluator {
  readonly size = 0;
  readonly env: SimEnv;
  constructor(env: SimEnv) { this.env = env; }
  async run(task: EvalTask): Promise<EvalResult> { return evaluate(this.env, task); }
  async map(tasks: EvalTask[]): Promise<EvalResult[]> { return tasks.map((t) => evaluate(this.env, t)); }
  async close(): Promise<void> {}
}

export class Pool implements Evaluator {
  readonly size: number;
  readonly #workers: Worker[] = [];
  readonly #idle: Worker[] = [];
  readonly #queue: { id: number; task: EvalTask }[] = [];
  readonly #pending = new Map<number, { resolve: (r: EvalResult) => void; reject: (e: Error) => void }>();
  #next = 0;

  constructor(opts: { size?: number; twin?: Twin; candidates?: readonly ExitCandidate[]; mode?: "rule" | "distilled" } = {}) {
    this.size = Math.max(1, opts.size ?? Math.max(1, availableParallelism() - 2));
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: { twin: opts.twin, candidates: opts.candidates ?? exitCandidates(), mode: opts.mode ?? "rule" } });
      w.on("message", (msg: { id: number; ok: boolean; result?: EvalResult; error?: string }) => {
        const p = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (msg.ok) p?.resolve(msg.result!); else p?.reject(new Error(msg.error));
        this.#dispatch(w);
      });
      w.on("error", (e) => { for (const p of this.#pending.values()) p.reject(e); this.#pending.clear(); });
      this.#workers.push(w);
      this.#idle.push(w);
    }
  }

  #dispatch(w: Worker): void {
    const job = this.#queue.shift();
    if (job) w.postMessage(job);
    else this.#idle.push(w);
  }

  run(task: EvalTask): Promise<EvalResult> {
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const w = this.#idle.pop();
      if (w) w.postMessage({ id, task });
      else this.#queue.push({ id, task });
    });
  }

  map(tasks: EvalTask[]): Promise<EvalResult[]> { return Promise.all(tasks.map((t) => this.run(t))); }

  async close(): Promise<void> { await Promise.all(this.#workers.map((w) => w.terminate())); }
}

export function makeEvaluator(opts: { workers?: number; twin?: Twin; mode?: "rule" | "distilled" } = {}): Evaluator {
  if (opts.workers === 0) return new InlineEvaluator(loadEnv(opts.twin));
  return new Pool({ ...(opts.workers ? { size: opts.workers } : {}), ...(opts.twin ? { twin: opts.twin } : {}), ...(opts.mode ? { mode: opts.mode } : {}) });
}
void setExitCandidates;
