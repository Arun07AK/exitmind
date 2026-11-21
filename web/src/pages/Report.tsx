import { FileText, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { HistorianReport } from "../../../src/server/contract.ts";
import { isNotFound, useApi } from "../api.ts";
import { OutcomeTable } from "../components/Outcome.tsx";
import { Badge, Button, Card, Empty } from "../components/ui.tsx";

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-ink-2">{label}</span>
      <Badge color={on ? "green" : "slate"}>{on ? "yes" : "no"}</Badge>
    </div>
  );
}

function Count({ label, n, children }: { label: string; n: number; children?: ReactNode }) {
  return (
    <div className="bg-panel p-4">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num mt-1.5 text-[22px] leading-7 font-medium text-ink">{n}</div>
      {children}
    </div>
  );
}

export default function Report() {
  const { data, error, reload, loading } = useApi<HistorianReport | null>("/api/live/report");
  const none = (error && isNotFound(error)) || (!error && !loading && data === null);
  return (
    <div className="h-full overflow-auto" data-testid="report-page">
      <div className="mx-auto max-w-[1080px] space-y-4 px-6 pt-6 pb-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] text-ink-3">Live · historian</div>
            <h1 className="mt-1 text-[22px] leading-7 font-medium tracking-[-0.01em] text-ink">Post-incident report</h1>
            {data ? <div className="num mt-1 text-[12px] text-ink-3">report {data.id}</div> : null}
          </div>
          <Button onClick={reload} disabled={loading}><RefreshCw size={14} aria-hidden="true" className={loading ? "animate-spin" : undefined} />Refresh</Button>
        </div>
        {none ? (
          <Empty>
            <div className="flex items-start gap-3">
              <FileText size={18} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
              <div>
                <div className="font-medium text-ink">No report yet</div>
                <p className="mt-0.5 text-ink-2">The historian writes one when the operator presses All clear on the live console.</p>
              </div>
            </div>
          </Empty>
        ) : null}
        {error && !isNotFound(error) ? <Empty>Could not load /api/live/report: {error.message}</Empty> : null}
        {data ? (
          <>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              <Count label="Differences recorded" n={data.differences.length} />
              <Count label="New breaking scenarios" n={data.newBreakingScenarios.length} />
              <div className="bg-panel p-4">
                <div className="text-[12px] text-ink-3">Learning</div>
                <div className="mt-1 text-[13px]">
                  <Flag label="Playbook updated" on={data.playbookUpdated} />
                  <Flag label="Distilled policy updated" on={data.policyUpdated} />
                </div>
              </div>
            </div>
            <Card title="Differences">
              {data.differences.length ? (
                <ol className="space-y-2 text-[13px] leading-relaxed text-ink">
                  {data.differences.map((d, i) => (
                    <li key={i} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2">
                      <span className="num mt-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-inset text-[11px] font-medium text-ink-2">{i + 1}</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-[13px] text-ink-3">No differences recorded.</p>}
            </Card>
            <Card title="Verifier forecast vs simulated outcome">
              <OutcomeTable columns={[{ title: "verifier forecast", outcome: data.predicted }, { title: "simulated (ground truth)", outcome: data.simulated }]} />
              <p className="mt-3 max-w-[760px] text-[12px] leading-relaxed text-ink-3">The model shows these outcomes under the stated assumptions; the ground truth here is the simulated building, not the real one.</p>
            </Card>
            <Card title="New breaking scenarios">
              {data.newBreakingScenarios.length ? (
                <ul className="divide-y divide-line">
                  {data.newBreakingScenarios.map((d) => <li key={d} className="num py-1.5 text-[12px] text-ink first:pt-0 last:pb-0">{d}</li>)}
                </ul>
              ) : <p className="text-[13px] text-ink-3">None added to the library.</p>}
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
