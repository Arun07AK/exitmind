import { z } from "zod";
import type { Twin } from "../twin/schema.ts";

export const EVENT_TYPES = ["concert", "fest", "lecture", "exam", "sports", "conference", "exhibition", "other"] as const;
export const EMERGENCIES = ["none", "fire", "crush", "quake", "threat", "medical"] as const;
export const REQUIRED = ["crowd_size", "age_groups", "event_type"] as const;
export type Required = (typeof REQUIRED)[number];

const share = z.number().min(0).max(1);
export const SpecSchema = z.object({
  eventType: z.enum(EVENT_TYPES).nullable(),
  eventLabel: z.string().max(120),
  venue: z.string().max(80).nullable(),
  crowdSize: z.number().int().nullable(),
  ages: z.object({ child: share, young_adult: share, adult: share, older_adult: share }).nullable(),
  ageText: z.string().max(80).nullable(),
  roles: z.object({ student: share, visitor: share, staff: share }).nullable(),
  familiarity: z.object({ student: share, visitor: share, staff: share }).nullable(),
  mobility: z.object({ slow: share, crutches: share, wheelchair: share }).nullable(),
  emergency: z.enum(EMERGENCIES).nullable(),
  emergencyWhere: z.string().max(40).nullable(),
  blockedExits: z.array(z.string().max(40)),
  compliance: z.enum(["low", "normal", "high"]).nullable(),
  urgency: z.enum(["low", "normal", "high"]).nullable(),
  conditions: z.array(z.string().max(160)),
});
export type Spec = z.infer<typeof SpecSchema>;

export const AgentReplySchema = z.object({
  status: z.enum(["needs_info", "ready"]),
  missing: z.array(z.enum(REQUIRED)),
  questions: z.array(z.string().max(300)),
  assumptions: z.array(z.string().max(300)),
  summary: z.string().max(600),
  spec: SpecSchema,
});
export type AgentReply = z.infer<typeof AgentReplySchema>;

const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: "null" }] });
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const shareObj = (keys: string[]) => obj(Object.fromEntries(keys.map((k) => [k, { type: "number" }])));

export const agentJsonSchema = (venueIds: readonly string[]) => obj({
  status: { type: "string", enum: ["needs_info", "ready"] },
  missing: { type: "array", items: { type: "string", enum: [...REQUIRED] } },
  questions: { type: "array", items: { type: "string" } },
  assumptions: { type: "array", items: { type: "string" } },
  summary: { type: "string" },
  spec: obj({
    eventType: nullable({ type: "string", enum: [...EVENT_TYPES] }),
    eventLabel: { type: "string" },
    venue: nullable({ type: "string", enum: [...venueIds] }),
    crowdSize: nullable({ type: "integer" }),
    ages: nullable(shareObj(["child", "young_adult", "adult", "older_adult"])),
    ageText: nullable({ type: "string" }),
    roles: nullable(shareObj(["student", "visitor", "staff"])),
    familiarity: nullable(shareObj(["student", "visitor", "staff"])),
    mobility: nullable(shareObj(["slow", "crutches", "wheelchair"])),
    emergency: nullable({ type: "string", enum: [...EMERGENCIES] }),
    emergencyWhere: nullable({ type: "string" }),
    blockedExits: { type: "array", items: { type: "string" } },
    compliance: nullable({ type: "string", enum: ["low", "normal", "high"] }),
    urgency: nullable({ type: "string", enum: ["low", "normal", "high"] }),
    conditions: { type: "array", items: { type: "string" } },
  }),
});

export function missingRequired(s: Spec): Required[] {
  const out: Required[] = [];
  if (!s.crowdSize || s.crowdSize < 1) out.push("crowd_size");
  if (!s.ages || Object.values(s.ages).reduce((a, b) => a + b, 0) <= 0) out.push("age_groups");
  if (!s.eventType) out.push("event_type");
  return out;
}

export const QUESTION: Record<Required, string> = {
  crowd_size: "How many people are at the event (roughly)?",
  age_groups: "What ages are they (for example 18-21, or mostly adults with some children)?",
  event_type: "What kind of event is it (concert, fest, lecture, exam, sports, conference, exhibition)?",
};

export interface VenueInfo { id: string; label: string; kind: string; exits: { id: string; name: string }[]; zones: { id: string; name: string }[]; capacityHint: string; stage: string | null; assumptions: string[] }

export function venueInfo(id: string, twin: Twin): VenueInfo {
  return {
    id, label: twin.venue?.label ?? twin.name, kind: twin.venue ? "outdoor event ground" : "three-storey teaching building",
    exits: twin.exits.filter((e) => e.kind === "exterior").map((e) => ({ id: e.id, name: e.name })),
    zones: twin.zones.map((z) => ({ id: z.id, name: z.name })),
    capacityHint: twin.venue ? `${Math.round(twin.codeBasis.grossAreaSqft.F1 * 0.0929)} m2 open ground; up to 8,000 people can be simulated` : "printed occupant load 462 (154 / 157 / 151 per floor)",
    stage: (() => {
      const st = twin.venue?.stage;
      if (!st) return null;
      const x = st.reduce((a, p) => a + p[0], 0) / st.length;
      const z = twin.zones.find((zz) => x >= zz.xRangeFt[0] && x < zz.xRangeFt[1]);
      return `stage at the middle of the north edge, facing south, in zone ${z?.id ?? "?"} (${z?.name ?? ""}); the crowd faces it`;
    })(),
    assumptions: twin.venue?.assumptions ?? [],
  };
}
