import { parentPort, workerData } from "node:worker_threads";
import { Rng } from "../../../src/shared/rng.ts";

const r = Rng.stream(workerData.seed as number, workerData.name as string);
const out: number[] = [];
for (let i = 0; i < 1000; i++) out.push(r.nextU32());
parentPort?.postMessage(out);
