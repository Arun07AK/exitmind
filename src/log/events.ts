import { z } from "zod";

export const ACTORS = [
  "orchestrator", "sentinel", "planner", "verifier", "human", "gate",
  "signs", "liaison", "historian", "persona", "sim", "demo",
] as const;
export type Actor = (typeof ACTORS)[number];

export const EVENT_TYPES = [
  "session.started", "world.checkpoint", "sensor.batch", "sensor.fault", "panel.state", "operator.report",
  "sentinel.estimate", "sentinel.sensor_health", "incident.state",
  "planner.requested", "planner.proposed", "planner.fallback", "llm.call", "verifier.verdict",
  "approval.requested", "human.approved", "human.rejected", "human.override", "approval.timeout",
  "gate.published", "gate.rejected",
  "sign.registered", "sign.online", "sign.offline",
  "liaison.brief", "historian.report",
  "persona.decision", "persona.decision.rejected",
  "playbook.updated", "policy.updated", "library.scenario_added",
  "demo.control", "sign.state_sent",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const PAYLOAD_SCHEMAS: Partial<Record<EventType, z.ZodType>> = {
  "session.started": z.strictObject({
    sessionId: z.string().min(1),
    mode: z.enum(["design", "live", "showcase", "bulk", "replay", "test"]),
    seed: z.number().int(),
  }),
};
