import { parentPort, workerData } from "node:worker_threads";
import { loadEnv } from "../sim/run.ts";
import type { Twin } from "../twin/schema.ts";
import { setExitCandidates } from "./prepare.ts";
import { evaluate, type EvalTask } from "./evaluate.ts";
import type { ExitCandidate } from "../twin/edit.ts";

const data = workerData as { twin?: Twin; candidates?: ExitCandidate[] };
const env = loadEnv(data.twin);
if (data.candidates) setExitCandidates(data.candidates);
parentPort!.on("message", (msg: { id: number; task: EvalTask }) => {
  try {
    parentPort!.postMessage({ id: msg.id, ok: true, result: evaluate(env, msg.task) });
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: String((e as Error).stack ?? e) });
  }
});
