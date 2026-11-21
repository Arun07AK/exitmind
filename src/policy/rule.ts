import type { Params } from "../shared/params.ts";
import type { Rng } from "../shared/rng.ts";
import type { Decision, DecisionContext, DecisionOption, DecisionPolicy } from "./types.ts";

export interface RuleAgentInfo {
  speedMps: number;
  stress: number;
  staff: boolean;
  groupFollower: boolean;
}

export class RulePolicy implements DecisionPolicy {
  readonly name = "rule";
  readonly p: Params;
  readonly info: (agent: number) => RuleAgentInfo;
  constructor(p: Params, info: (agent: number) => RuleAgentInfo) {
    this.p = p;
    this.info = info;
  }

  utility(o: DecisionOption, a: RuleAgentInfo, rng: Rng): number {
    const p = this.p;
    const noise = p.get("route.noiseSec") * (1 + (p.get("route.noiseStressGain") - 1) * a.stress);
    return -o.num.distM / Math.max(0.1, a.speedMps)
      - p.get("route.queueBeta") * o.num.queueSec
      + (o.num.familiar ? p.get("familiarity.betaSec") : 0)
      + p.get("herding.betaSec") * o.num.herd
      - p.get("route.hazardBetaSec") * o.num.hazard
      + rng.gumbel(noise);
  }

  complies(a: RuleAgentInfo, rng: Rng): boolean {
    const p = this.p;
    const c = p.get("sign.compliance.base") * (1 - p.get("sign.compliance.stressGamma") * a.stress) + (a.staff ? p.get("sign.compliance.staffBoost") : 0);
    return rng.bool(Math.max(0, Math.min(1, c)));
  }

  decide(ctx: DecisionContext, rng: Rng): Decision {
    const a = this.info(ctx.agent);
    const by = (act: string) => ctx.options.find((o) => o.action === act);
    const sign = by("FOLLOW_SIGN");
    if (sign && (ctx.point === "SIGN_SEEN" || ctx.point === "ALARM_NOTICED") && this.complies(a, rng)) return { optionId: sign.id, source: "rule" };
    const group = by("FOLLOW_GROUP");
    if (group && a.groupFollower && ctx.point !== "BLOCKED") return { optionId: group.id, source: "rule" };
    const wait = by("WAIT");
    if (wait && ctx.point === "GROUP_MEMBER_MISSING" && !ctx.situation.smokeVisible && !ctx.situation.threatVisible) return { optionId: wait.id, source: "rule" };
    const moves = ctx.options.filter((o) => o.action === "MOVE_TO" || o.action === "FOLLOW_SIGN" && o.target >= 0 || o.action === "GO_BACK");
    if (!moves.length) return { optionId: (wait ?? ctx.options[0]!).id, source: "rule" };
    let best = moves[0]!, bu = -Infinity;
    for (const o of moves) {
      const u = this.utility(o, a, rng);
      if (u > bu) { bu = u; best = o; }
    }
    return { optionId: best.id, source: "rule" };
  }
}
