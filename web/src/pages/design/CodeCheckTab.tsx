import type { CodeCheckItem, CodeCheckResult, Sourced } from "../../../../src/server/contract.ts";
import { useApi } from "../../api.ts";
import { formatNumber } from "../../components/Metric.tsx";
import { Badge, Card, Empty, Td, Th } from "../../components/ui.tsx";
import { useGeometry } from "../../geometry.ts";
import Plan2D from "../../views/Plan2D.tsx";

const STATUS: Record<CodeCheckItem["status"], { text: string; color: string }> = {
  passes_on_paper: { text: "passes on paper", color: "green" },
  does_not_pass_on_paper: { text: "does not pass on paper", color: "red" },
  info: { text: "info", color: "slate" },
};

function Val({ v, unit }: { v: Sourced | null; unit: string }) {
  if (!v) return <span className="text-slate-500">{"\u2014"}</span>;
  return (
    <span title={`source: ${v.source}`} className="font-mono">
      {formatNumber(v.value)} <span className="text-[10px] text-slate-500">{unit}</span>
      <div className="max-w-[14rem] truncate text-[10px] text-slate-500">source: {v.source}</div>
    </span>
  );
}

export function CodeCheckTab() {
  const { data, error } = useApi<CodeCheckResult>("/api/codecheck");
  const { geo } = useGeometry();
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Card title={geo ? `Twin: ${geo.twin.name}` : "Twin"} className="flex flex-col">
        <div className="h-[28rem]"><Plan2D /></div>
        {geo ? (
          <div className="mt-2 text-xs text-slate-400">
            <div>twin {geo.twin.id} · hash <span className="font-mono">{geo.twin.hash.slice(0, 12)}</span> · {geo.twin.floors.length} floors · {geo.twin.exits.length} exits · {geo.twin.stairs.length} stairs · {geo.twin.signMounts.length} sign mounts</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {geo.twin.sheets.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{s.id} {s.title}</a>)}
            </div>
          </div>
        ) : null}
      </Card>
      <Card title="Code check" testId="codecheck">
        {error ? <Empty>Code check unavailable: {error.message}</Empty> : !data ? <Empty>Loading /api/codecheck</Empty> : (
          <>
            <div className="mb-2 text-xs text-slate-400">basis: {data.basis}</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr><Th>check</Th><Th>required</Th><Th>provided</Th><Th>printed</Th><Th>status</Th><Th>method</Th><Th>sheet</Th></tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id} data-testid="codecheck-row" data-status={it.status}>
                      <Td><div className="text-slate-200">{it.label}</div><div className="text-[10px] text-slate-500">{it.group.replace(/_/g, " ")}{it.note ? ` · ${it.note}` : ""}</div></Td>
                      <Td><Val v={it.required} unit={it.unit} /></Td>
                      <Td><Val v={it.provided} unit={it.unit} /></Td>
                      <Td className="font-mono">{it.printed ?? "\u2014"}</Td>
                      <Td><Badge color={STATUS[it.status].color}>{STATUS[it.status].text}</Badge></Td>
                      <Td className="max-w-[18rem] text-xs text-slate-400">{it.method}</Td>
                      <Td className="font-mono text-xs">{it.sheet}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-200" data-testid="codecheck-disclaimer">{data.disclaimer}</p>
          </>
        )}
      </Card>
    </div>
  );
}
