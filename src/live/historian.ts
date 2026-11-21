import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { EventLog } from "../log/eventlog.ts";
import { repoPath } from "../shared/paths.ts";
import type { HistorianReport, Outcome } from "../server/contract.ts";
import type { RunMetrics } from "../sim/world.ts";
import type { Scenario } from "../sim/types.ts";

export function historianReport(log: EventLog, truth: RunMetrics, truthBadness: number, truthScenario: Scenario, id: string, write = false): HistorianReport {
  const verdict = log.query({ type: "verifier.verdict" }).filter((r) => log.query({ type: "gate.published" }).some((p) => p.refs.includes(r.id))).at(-1);
  const predicted = verdict ? (verdict.payload as { predicted: Outcome }).predicted : null;
  const worst = verdict ? (verdict.payload as { worstCase: Outcome }).worstCase : null;
  const simulated: Outcome = {
    clearance95Sec: truth.clearance95Sec, remainingAtTarget: truth.remainingAtTarget, densityDangerPS: truth.densityDangerPS, smokeExposurePS: truth.smokeExposurePS,
    gridlock: truth.gridlock, badness: truthBadness, ref: `truth:${id}`,
  };
  const differences: string[] = [];
  if (predicted) {
    const f = (v: number | null) => (v === null ? "not reached" : `${v} s`);
    differences.push(`clearance (95%): verifier ${f(predicted.clearance95Sec)}, simulated ground truth ${f(simulated.clearance95Sec)}`);
    differences.push(`people not out at the clearance target: verifier ${predicted.remainingAtTarget}, ground truth ${simulated.remainingAtTarget}`);
    differences.push(`badness: verifier ${predicted.badness}, ground truth ${simulated.badness}`);
    if (predicted.gridlock !== simulated.gridlock) differences.push(`gridlock: verifier ${predicted.gridlock}, ground truth ${simulated.gridlock}`);
  } else differences.push("no published decision to compare against");
  const newBreaking: string[] = [];
  if (worst && simulated.badness > worst.badness) newBreaking.push(`${truthScenario.id}: ground truth (badness ${simulated.badness}) was worse than the verifier's worst case (${worst.badness})`);
  let playbookUpdated = false;
  if (write) {
    mkdirSync(repoPath("data", "library"), { recursive: true });
    const lib = repoPath("data", "library", "breaking-scenarios.json");
    if (newBreaking.length) {
      const cur = existsSync(lib) ? (JSON.parse(readFileSync(lib, "utf8")) as unknown[]) : [];
      cur.push({ id: truthScenario.id, scenario: truthScenario, note: newBreaking[0], from: id });
      writeFileSync(lib, `${JSON.stringify(cur, null, 1)}\n`);
      log.append({ tick: -1, actor: "historian", type: "library.scenario_added", payload: { id: truthScenario.id } });
    }
    const pbPath = repoPath("data", "playbook", "rinker.playbook.json");
    const pub = log.query({ type: "gate.published" }).at(-1);
    if (pub && existsSync(pbPath)) {
      const book = JSON.parse(readFileSync(pbPath, "utf8")) as { id: string; observed?: unknown[] }[];
      const decisionId = (pub.payload as { decisionId: string }).decisionId;
      const prop = log.query({ type: "planner.proposed" }).find((r) => (r.payload as { decisionId: string }).decisionId === decisionId);
      const match = (prop?.payload as { playbookMatch?: string | null } | undefined)?.playbookMatch;
      const entry = book.find((b) => b.id === match);
      if (entry) {
        entry.observed = [...(entry.observed ?? []), { session: id, simulated }];
        writeFileSync(pbPath, `${JSON.stringify(book, null, 1)}\n`);
        log.append({ tick: -1, actor: "historian", type: "playbook.updated", payload: { entry: entry.id, session: id } });
        playbookUpdated = true;
      }
    }
  }
  const personaDecisions = log.query({ type: "persona.decision" }).length;
  differences.push(personaDecisions ? `${personaDecisions} persona decisions logged; run \`npm run distill\` to fold them into the distilled policy` : "distilled persona policy unchanged: this session logged no new persona decisions");
  return { id, predicted, simulated, differences, newBreakingScenarios: newBreaking, playbookUpdated, policyUpdated: false };
}
