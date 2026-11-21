import type { Nl2ParamsResult, ProfileId, Protocol, HazardKind } from "../../../../src/server/contract.ts";
import type { PlanPoint } from "../../views/Plan2D.tsx";

export interface DesignParams {
  profile: ProfileId;
  occupancy: string;
  loadFactor: number;
  behaviour: Nl2ParamsResult["behaviour"];
  personaMix: Record<string, number> | null;
  source: Nl2ParamsResult["source"] | null;
}

export interface SimForm {
  hazard: HazardKind;
  at: PlanPoint | null;
  damaged: string[];
  surgeExit: string;
  protocol: Protocol;
  seed: number;
  mode: "rule" | "distilled" | "showcase";
  speed: number;
  maxSec: number;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
