import { z } from "zod";
import { ARROW_DIRS, HAZARD_KINDS, PROFILES, PROTOCOLS, ZONE_INSTRUCTIONS, type Scenario } from "./types.ts";

const Pt = z.tuple([z.number(), z.number()]);
const Arrow = z.strictObject({ dir: z.enum(ARROW_DIRS), toward: z.string(), label: z.string().max(40) });
export const SignStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ARROW"), arrow: Arrow }),
  z.strictObject({ kind: z.literal("X_ALT"), blocked: z.string(), alt: Arrow }),
  z.strictObject({ kind: z.literal("HOLD"), label: z.string().max(60) }),
  z.strictObject({ kind: z.literal("LOCKDOWN"), label: z.string().max(60) }),
  z.strictObject({ kind: z.literal("STATIC_DEFAULT"), arrow: Arrow }),
]);
export const RoutePolicySchema = z.strictObject({
  zones: z.array(z.strictObject({ zone: z.string(), instruction: z.enum(ZONE_INSTRUCTIONS), via: z.string().nullable(), delaySec: z.number().min(0).max(1800) })),
  closedRoutes: z.array(z.string()),
  inflowClosed: z.array(z.string()),
});
export const ScenarioSchema = z.strictObject({
  id: z.string().min(1).max(120),
  profile: z.enum(PROFILES),
  hazard: z.strictObject({
    kind: z.enum(HAZARD_KINDS),
    floor: z.enum(["F1", "F2", "F3"]).optional(),
    at: Pt.optional(),
    startSec: z.number().min(-600).max(600).optional(),
    damaged: z.array(z.string()).optional(),
    path: z.array(Pt).optional(),
    surgeExit: z.string().optional(),
    overrides: z.record(z.string(), z.number()).optional(),
  }),
  behaviour: z.record(z.string(), z.number()),
  loadFactor: z.number().min(0.1).max(3),
  occupancy: z.union([z.enum(["uniform", "classes_full", "after_hours"]), z.string().regex(/^event_in:.+$/)]),
  protocol: z.enum(PROTOCOLS),
  routePolicy: RoutePolicySchema.optional(),
  signs: z.record(z.string(), SignStateSchema).optional(),
  dynamicMounts: z.array(z.string()).optional(),
  zoneCounts: z.record(z.string(), z.number().int().min(0).max(2000)).optional(),
  edits: z.array(z.strictObject({
    kind: z.enum(["widen_corridor", "widen_stair", "widen_exit", "add_exit", "add_stair", "evac_chairs", "refuge", "accessible_exit", "strategy"]),
    target: z.string(), amount: z.number().optional(), protocol: z.enum(PROTOCOLS).optional(),
  })).optional(),
  seed: z.number().int().min(0).max(2 ** 31),
  maxSec: z.number().min(10).max(3600),
});

export function parseScenario(x: unknown): Scenario {
  return ScenarioSchema.parse(x) as Scenario;
}
