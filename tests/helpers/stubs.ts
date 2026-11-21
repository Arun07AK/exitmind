import type { ClaudeJsonRequest, ClaudeLike } from "../../src/llm/claude.ts";
import { LlmUnavailable } from "../../src/llm/guard.ts";
import type { ChoiceAnswer, TypeSafeLike } from "../../src/llm/typesafe.ts";

type Mode = "sensible" | "invalid-sometimes" | "down" | "slow";

export class StubClaude implements ClaudeLike {
  calls = 0;
  readonly mode: Mode;
  readonly answer?: (user: Record<string, unknown>) => unknown;
  constructor(mode: Mode = "sensible", answer?: (user: Record<string, unknown>) => unknown) { this.mode = mode; if (answer) this.answer = answer; }
  available(): boolean { return this.mode !== "down"; }
  async json<T>(req: ClaudeJsonRequest<T>): Promise<T> {
    this.calls++;
    const n = this.calls;
    await new Promise((r) => setTimeout(r, (n * 7) % 5));
    if (this.mode === "down") throw new LlmUnavailable("error", "stub outage");
    if (this.mode === "slow") await new Promise((r) => setTimeout(r, 5000));
    let user: Record<string, unknown>;
    try { user = JSON.parse(req.user) as Record<string, unknown>; } catch { user = { text: req.user }; }
    if (this.answer) return req.parse.parse(this.answer(user));
    const opts = (user.options ?? []) as { id: string; option: string }[];
    if (this.mode === "invalid-sometimes" && n % 3 === 0) return req.parse.parse({ optionId: n % 2 ? "Z" : "run through the wall", reason: "stub invalid" });
    const pick = opts.find((o) => o.option.includes("way you know")) ?? opts.find((o) => o.option.startsWith("Follow the sign")) ?? [...opts].sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
    return req.parse.parse({ optionId: pick.id, reason: "stub" });
  }
}

export class StubTypeSafe implements TypeSafeLike {
  calls = 0;
  available(): boolean { return true; }
  async choose(req: { criteria: Record<string, string> }): Promise<ChoiceAnswer> {
    this.calls++;
    const ids = Object.keys(req.criteria).sort();
    const probabilities = Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 0.6 : 0.4 / Math.max(1, ids.length - 1)]));
    return { choice: ids[0]!, probabilities, confidence: 0.6 };
  }
}
