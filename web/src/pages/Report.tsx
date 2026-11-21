import type { HistorianReport } from "../../../src/server/contract.ts";
import { isNotFound, useApi } from "../api.ts";
import { OutcomeTable } from "../components/Outcome.tsx";
import { Badge, Button, Card, Empty } from "../components/ui.tsx";

export default function Report() {
  const { data, error, reload, loading } = useApi<HistorianReport | null>("/api/live/report");
  const none = (error && isNotFound(error)) || (!error && !loading && data === null);
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3" data-testid="report-page">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Post-incident report</h1>
        <Button tone="ghost" onClick={reload}>Refresh</Button>
      </div>
      {none ? <Empty>No report yet. The historian writes one when the operator presses All clear on the live console.</Empty> : null}
      {error && !isNotFound(error) ? <Empty>Could not load /api/live/report: {error.message}</Empty> : null}
      {data ? (
        <>
          <div className="text-xs text-slate-500">report {data.id}</div>
          <Card title="Verifier forecast vs simulated outcome">
            <OutcomeTable columns={[{ title: "verifier forecast", outcome: data.predicted }, { title: "simulated (ground truth)", outcome: data.simulated }]} />
            <p className="mt-2 text-xs text-slate-500">The model shows these outcomes under the stated assumptions; the ground truth here is the simulated building, not the real one.</p>
          </Card>
          <Card title="Differences">
            {data.differences.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{data.differences.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p className="text-sm text-slate-400">No differences recorded.</p>}
          </Card>
          <Card title="New breaking scenarios">
            {data.newBreakingScenarios.length ? <ul className="list-disc space-y-1 pl-5 font-mono text-sm">{data.newBreakingScenarios.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="text-sm text-slate-400">None added to the library.</p>}
          </Card>
          <Card title="Learning">
            <div className="flex gap-3 text-sm">
              <span>playbook updated: <Badge color={data.playbookUpdated ? "green" : "slate"}>{data.playbookUpdated ? "yes" : "no"}</Badge></span>
              <span>distilled policy updated: <Badge color={data.policyUpdated ? "green" : "slate"}>{data.policyUpdated ? "yes" : "no"}</Badge></span>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
