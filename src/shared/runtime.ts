import { readFileSync } from "node:fs";
import { z } from "zod";
import { repoPath } from "./paths.ts";

const PositiveInt = z.number().int().positive();

export const RuntimeConfig = z.strictObject({
  sim: z.strictObject({ dtSec: z.number().positive(), cellM: z.number().positive(), checkpointEveryTicks: PositiveInt }),
  showcase: z
    .strictObject({ livePersonas: PositiveInt, maxInFlight: PositiveInt, thinkingTicksMin: PositiveInt, thinkingTicksMax: PositiveInt })
    .refine((s) => s.thinkingTicksMin <= s.thinkingTicksMax, "thinkingTicksMin must be <= thinkingTicksMax"),
  persona: z.strictObject({ deadlineMs: PositiveInt, jevTimeoutMs: PositiveInt }),
  gate: z.strictObject({ failMode: z.enum(["block_with_override", "warn"]) }),
  approval: z.strictObject({ windowSec: z.number().positive() }),
  design: z.strictObject({
    clearanceTargetSec: z.number().positive(),
    capSec: z.number().positive(),
    badness: z.strictObject({ w1: z.number().nonnegative(), w2: z.number().nonnegative(), w3: z.number().nonnegative() }),
    bulkRuns: PositiveInt,
    adversary: z.strictObject({ population: PositiveInt, generations: PositiveInt, seeds: PositiveInt }),
    rating: z.strictObject({ scenarios: PositiveInt }),
    workers: PositiveInt,
  }),
  live: z.strictObject({ sensorHz: z.number().positive(), confirmConfidence: z.number().min(0).max(1), publishConfidence: z.number().min(0).max(1), verifierHorizonSec: z.number().positive() }),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

export function loadRuntime(path = repoPath("config", "runtime.json")): RuntimeConfig {
  return RuntimeConfig.parse(JSON.parse(readFileSync(path, "utf8")));
}
