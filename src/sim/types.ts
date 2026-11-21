import type { FloorId, Pt } from "../twin/schema.ts";

export const PROTOCOLS = ["EVACUATE", "PHASED_EVACUATION", "HOLD_THEN_EVACUATE", "LOCKDOWN_SHELTER", "HORIZONTAL_EVACUATION", "INFLOW_CONTROL"] as const;
export type Protocol = (typeof PROTOCOLS)[number];
export const HAZARD_KINDS = ["none", "fire", "crush", "quake", "threat", "medical"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];
export const PROFILES = ["college", "school", "mall", "hospital"] as const;
export type ProfileId = (typeof PROFILES)[number];

export interface HazardSpec {
  kind: HazardKind;
  floor?: FloorId;
  at?: Pt;
  startSec?: number;
  damaged?: string[];
  path?: Pt[];
  surgeExit?: string;
  overrides?: Record<string, number>;
}

export const ZONE_INSTRUCTIONS = ["EVACUATE_VIA", "HOLD", "LOCKDOWN", "MOVE_TO_COMPARTMENT"] as const;
export type ZoneInstructionKind = (typeof ZONE_INSTRUCTIONS)[number];
export interface ZoneInstruction {
  zone: string;
  instruction: ZoneInstructionKind;
  via: string | null;
  delaySec: number;
}
export interface RoutePolicy {
  zones: ZoneInstruction[];
  closedRoutes: string[];
  inflowClosed: string[];
}

export const ARROW_DIRS = ["LEFT", "RIGHT", "AHEAD", "BACK", "DOWN_LEFT", "DOWN_RIGHT"] as const;
export type ArrowDir = (typeof ARROW_DIRS)[number];
export interface Arrow {
  dir: ArrowDir;
  toward: string;
  label: string;
}
export type SignState =
  | { kind: "ARROW"; arrow: Arrow }
  | { kind: "X_ALT"; blocked: string; alt: Arrow }
  | { kind: "HOLD"; label: string }
  | { kind: "LOCKDOWN"; label: string }
  | { kind: "STATIC_DEFAULT"; arrow: Arrow };

export type Occupancy = "uniform" | "classes_full" | "after_hours" | `event_in:${string}`;

export interface Edit {
  kind: "widen_corridor" | "widen_stair" | "widen_exit" | "add_exit" | "add_stair" | "evac_chairs" | "refuge" | "accessible_exit" | "strategy";
  target: string;
  amount?: number;
  protocol?: Protocol;
}

export interface Scenario {
  id: string;
  profile: ProfileId;
  hazard: HazardSpec;
  behaviour: Record<string, number>;
  loadFactor: number;
  occupancy: Occupancy;
  protocol: Protocol;
  routePolicy?: RoutePolicy;
  signs?: Record<string, SignState>;
  dynamicMounts?: string[];
  zoneCounts?: Record<string, number>;
  edits?: Edit[];
  seed: number;
  maxSec: number;
}
