import { readFileSync } from "node:fs";
import { z } from "zod";
import { repoPath } from "../shared/paths.ts";
import type { Rng } from "../shared/rng.ts";
import { signature, type Decision, type DecisionContext, type DecisionPolicy } from "./types.ts";

export const DistilledTable = z.strictObject({
  version: z.literal(1),
  source: z.strictObject({ logs: z.array(z.string()), decisions: z.number().int().nonnegative(), backend: z.string(), createdFrom: z.string() }),
  table: z.record(z.string(), z.record(z.string(), z.number().nonnegative())),
});
export type DistilledTable = z.infer<typeof DistilledTable>;

export const optionSetKey = (ctx: Pick<DecisionContext, "options">): string => [...new Set(ctx.options.map(signature))].sort().join(",");

export function backoffKeys(ctx: Pick<DecisionContext, "key" | "options">): string[] {
  const parts = ctx.key.split("|");
  const set = optionSetKey(ctx);
  return [`${ctx.key}#${set}`, ctx.key, parts.slice(0, 3).join("|"), parts.slice(0, 2).join("|"), parts[0]!];
}

export interface LoggedChoice {
  key: string;
  options: { id?: string; action: DecisionContext["options"][number]["action"]; roles: DecisionContext["options"][number]["roles"] }[];
  chosen: string;
}

/** Recompute the chosen signature from a logged record, so logs written with an older signature scheme still distil. */
export function chosenSignature(r: { options: { id: string; action: DecisionContext["options"][number]["action"]; roles: DecisionContext["options"][number]["roles"] }[]; optionId: string; chosen: string }): string {
  const o = r.options.find((x) => x.id === r.optionId);
  return o ? signature(o) : r.chosen;
}

export function distill(choices: LoggedChoice[], meta: DistilledTable["source"]): DistilledTable {
  const table: Record<string, Record<string, number>> = {};
  for (const c of choices) {
    const ctx = { key: c.key, options: c.options as DecisionContext["options"] };
    for (const k of backoffKeys(ctx)) {
      const row = (table[k] ??= {});
      row[c.chosen] = (row[c.chosen] ?? 0) + 1;
    }
  }
  const sorted = Object.fromEntries(Object.keys(table).sort().map((k) => [k, Object.fromEntries(Object.entries(table[k]!).sort(([a], [b]) => (a < b ? -1 : 1)))]));
  return { version: 1, source: meta, table: sorted };
}

export class DistilledPolicy implements DecisionPolicy {
  readonly name = "distilled";
  readonly t: DistilledTable;
  readonly minSupport: number;
  readonly minCoverage = 0.6;
  constructor(t: DistilledTable, minSupport = 5) { this.t = t; this.minSupport = minSupport; }

  static load(path = repoPath("data", "policy", "distilled.policy.json")): DistilledPolicy {
    return new DistilledPolicy(DistilledTable.parse(JSON.parse(readFileSync(path, "utf8"))));
  }

  distribution(ctx: DecisionContext): Map<string, number> | null {
    const avail = new Map<string, string[]>();
    for (const o of ctx.options) { const s = signature(o); avail.set(s, [...(avail.get(s) ?? []), o.id]); }
    const instructed = ctx.options.some((o) => o.action === "FOLLOW_SIGN");
    for (const k of backoffKeys(ctx)) {
      const row = this.t.table[k];
      if (!row) continue;
      if (instructed && !Object.keys(row).some((sig) => sig.startsWith("FOLLOW_SIGN"))) continue;
      let matched = 0, all = 0;
      const dist = new Map<string, number>();
      for (const [sig, n] of Object.entries(row)) {
        all += n;
        const ids = avail.get(sig);
        if (!ids) continue;
        for (const id of ids) dist.set(id, (dist.get(id) ?? 0) + n / ids.length);
        matched += n;
      }
      if (matched < this.minSupport || matched < this.minCoverage * all) continue;
      for (const [id, n] of dist) dist.set(id, n / matched);
      return dist;
    }
    return null;
  }

  decide(ctx: DecisionContext, rng: Rng): Decision {
    const dist = this.distribution(ctx);
    if (!dist) return { optionId: "", source: "distilled", note: "no support in distilled table" };
    const ids = [...dist.keys()].sort();
    const u = rng.next();
    let acc = 0;
    for (const id of ids) { acc += dist.get(id)!; if (u < acc) return { optionId: id, source: "distilled", probs: Object.fromEntries(dist) }; }
    return { optionId: ids[ids.length - 1]!, source: "distilled", probs: Object.fromEntries(dist) };
  }
}

export function tvd(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let s = 0;
  for (const k of keys) s += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0));
  return s / 2;
}
