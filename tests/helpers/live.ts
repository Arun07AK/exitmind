import { InlineEvaluator } from "../../src/design/pool.ts";
import { LiveSession, type DemoConfig } from "../../src/live/session.ts";
import { loadEnv } from "../../src/sim/run.ts";
import { miniBuilding } from "../../src/twin/synthetic.ts";
import type { ClaudeLike } from "../../src/llm/claude.ts";
import { StubClaude } from "./stubs.ts";

export const MINI_CFG: DemoConfig = { profile: "college", occupancy: "uniform", seed: 77, speed: 1, fire: { floor: "F2", at: [30, 10] }, quake: { damaged: ["ST-B"] }, replanCooldownSec: 20 };
const env = loadEnv(miniBuilding());

export function miniSession(o: { claude?: ClaudeLike; approvalWindowSec?: number; failMode?: "block_with_override" | "warn" } = {}): LiveSession {
  return new LiveSession({ simEnv: env, evaluator: new InlineEvaluator(env), claude: o.claude ?? new StubClaude("down"), cfg: MINI_CFG, sessionId: "T1", wallClock: () => "2026-01-01T00:00:00.000Z", ...(o.approvalWindowSec ? { approvalWindowSec: o.approvalWindowSec } : {}), ...(o.failMode ? { failMode: o.failMode } : {}) });
}

export async function stepUntil(s: LiveSession, pred: () => boolean, maxTicks = 4000): Promise<boolean> {
  for (let k = 0; k < maxTicks; k++) {
    if (pred()) return true;
    s.step();
    if (k % 4 === 0) await new Promise((r) => setImmediate(r));
  }
  return pred();
}
