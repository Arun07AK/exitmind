export const DECISION_POINTS = ["ALARM_NOTICED", "JUNCTION", "SIGN_SEEN", "BLOCKED", "GROUP_MEMBER_MISSING"] as const;
export type DecisionPoint = (typeof DECISION_POINTS)[number];
export const ACTIONS = ["MOVE_TO", "WAIT", "FOLLOW_GROUP", "GO_BACK", "FOLLOW_SIGN", "HELP"] as const;
export type Action = (typeof ACTIONS)[number];
export const ROLE_TAGS = ["NEAREST", "FAMILIAR", "SIGNED", "LEAST_CROWDED", "MAJORITY", "HAZARD_ON_ROUTE", "STAIR", "LEVEL"] as const;
export type RoleTag = (typeof ROLE_TAGS)[number];

export interface OptionNumbers {
  distM: number;
  queueSec: number;
  hazard: number;
  herd: number;
  familiar: boolean;
  signed: boolean;
}

export interface DecisionOption {
  id: string;
  action: Action;
  target: number;
  roles: RoleTag[];
  desc: string;
  num: OptionNumbers;
}

export interface Persona {
  age: string;
  role: string;
  mobility: string;
  familiar: boolean;
  stress: "calm" | "uneasy" | "stressed" | "panicked";
  inGroup: boolean;
}

export interface Situation {
  hazard: string;
  smokeVisible: boolean;
  shaking: boolean;
  threatVisible: boolean;
  crowd: "light" | "busy" | "packed";
  instruction: "none" | "route" | "hold" | "lockdown" | "compartment";
  groupMissing: boolean;
}

export interface DecisionContext {
  agent: number;
  tick: number;
  point: DecisionPoint;
  persona: Persona;
  situation: Situation;
  options: DecisionOption[];
  key: string;
}

export type DecisionSource = "rule" | "distilled" | "llm:haiku" | "llm:jev" | "replay" | "fallback:distilled" | "fallback:rule";

export interface Decision {
  optionId: string;
  source: DecisionSource;
  probs?: Record<string, number>;
  confidence?: number;
  latencyMs?: number;
  note?: string;
}

export interface DecisionPolicy {
  readonly name: string;
  readonly delayed?: boolean;
  decide(ctx: DecisionContext, rng: import("../shared/rng.ts").Rng): Decision | Promise<Decision>;
}

const PRIMARY: readonly RoleTag[] = ["SIGNED", "NEAREST", "FAMILIAR", "MAJORITY", "LEAST_CROWDED"];

/** Coarse, reusable description of an option: its action, its most salient role, and whether the hazard is on the way. */
export function signature(o: Pick<DecisionOption, "action" | "roles">): string {
  if (o.action !== "MOVE_TO" && o.action !== "GO_BACK" && o.action !== "FOLLOW_SIGN") return `${o.action}:`;
  const primary = PRIMARY.find((r) => o.roles.includes(r)) ?? "OTHER";
  return `${o.action}:${primary}${o.roles.includes("HAZARD_ON_ROUTE") ? "+HAZARD" : ""}`;
}

export function situationKey(point: DecisionPoint, p: Persona, s: Situation): string {
  const haz = s.shaking ? "shaking" : s.threatVisible ? "threat" : s.smokeVisible ? "smoke" : s.hazard === "none" ? "none" : "alarm";
  return [point, haz, s.crowd, s.instruction, p.stress === "calm" || p.stress === "uneasy" ? "low" : "high", p.familiar ? "F" : "U"].join("|");
}
