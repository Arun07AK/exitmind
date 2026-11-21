import { ChevronRight, ExternalLink, Info } from "lucide-react";
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
const STATUS_ORDER: CodeCheckItem["status"][] = ["does_not_pass_on_paper", "passes_on_paper", "info"];

function Val({ v, unit }: { v: Sourced | null; unit: string }) {
  if (!v) return <span className="text-ink-4">{"—"}</span>;
  return (
    <span title={`source: ${v.source}`} className="block">
      <span className="num text-ink">{formatNumber(v.value)}</span> <span className="num text-[11px] text-ink-3">{unit}</span>
      <span className="mt-0.5 block truncate text-[11px] text-ink-4">source: {v.source}</span>
    </span>
  );
}

function groupName(g: string): string {
  const s = g.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Counts({ items }: { items: CodeCheckItem[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {STATUS_ORDER.map((st) => {
        const n = items.filter((i) => i.status === st).length;
        return n ? <Badge key={st} color={STATUS[st].color}><span className="num">{n}</span> {STATUS[st].text}</Badge> : null;
      })}
    </span>
  );
}

function CheckTable({ items }: { items: CodeCheckItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] table-fixed border-collapse">
        <colgroup><col /><col className="w-[17%]" /><col className="w-[17%]" /><col className="w-[9%]" /><col className="w-[15%]" /><col className="w-[7%]" /></colgroup>
        <thead>
          <tr><Th className="pl-0">Check</Th><Th>Required</Th><Th>Provided</Th><Th className="text-right!">Printed</Th><Th>Status</Th><Th>Sheet</Th></tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} data-testid="codecheck-row" data-status={it.status} className={it.status === "does_not_pass_on_paper" ? "bg-danger-bg/40" : undefined}>
              <Td className="pl-0">
                <div className="text-ink">{it.label}</div>
                {it.note ? <div className="mt-0.5 text-[12px] leading-snug text-ink-2">{it.note}</div> : null}
                <div className="mt-0.5 text-[12px] leading-snug text-ink-3"><span className="text-ink-4">method:</span> {it.method}</div>
              </Td>
              <Td><Val v={it.required} unit={it.unit} /></Td>
              <Td><Val v={it.provided} unit={it.unit} /></Td>
              <Td className="num text-right">{it.printed ?? <span className="text-ink-4">{"—"}</span>}</Td>
              <Td><Badge color={STATUS[it.status].color}>{STATUS[it.status].text}</Badge></Td>
              <Td className="num text-[12px] text-ink-2">{it.sheet}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeCheckTab() {
  const { data, error } = useApi<CodeCheckResult>("/api/codecheck");
  const { geo } = useGeometry();
  const groups = data ? [...new Set(data.items.map((i) => i.group))] : [];
  const failing = data ? data.items.filter((i) => i.status === "does_not_pass_on_paper") : [];
  return (
    <div className="@container">
      <div className="grid gap-4 @6xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card title={geo ? `Twin: ${geo.twin.name}` : "Twin"} className="self-start">
          <div className="h-[28rem] overflow-hidden rounded-lg border border-line bg-stage"><Plan2D /></div>
          {geo ? (
            <div className="mt-3 space-y-3">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                <dt className="text-ink-3">Twin</dt><dd className="num truncate text-ink">{geo.twin.id}</dd>
                <dt className="text-ink-3">Hash</dt><dd className="num text-ink">{geo.twin.hash.slice(0, 12)}</dd>
                <dt className="text-ink-3">Contents</dt>
                <dd className="text-ink-2"><span className="num text-ink">{geo.twin.floors.length}</span> floors · <span className="num text-ink">{geo.twin.exits.length}</span> exits · <span className="num text-ink">{geo.twin.stairs.length}</span> stairs · <span className="num text-ink">{geo.twin.signMounts.length}</span> sign mounts</dd>
              </dl>
              {geo.twin.sheets.length ? (
                <div>
                  <div className="mb-1 text-[12px] text-ink-3">Drawing sheets</div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                    {geo.twin.sheets.map((s) => (
                      <li key={s.id}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink-3">
                          <span className="num">{s.id}</span> {s.title}<ExternalLink size={11} aria-hidden="true" className="text-ink-4" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
        <Card title="Code check" testId="codecheck" actions={data ? <Counts items={data.items} /> : null}>
          {error ? <Empty>Code check unavailable: {error.message}</Empty> : !data ? <Empty>Loading /api/codecheck</Empty> : (
            <div className="space-y-4">
              <p className="flex gap-2 rounded-lg border border-line bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink-2" data-testid="codecheck-disclaimer">
                <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-3" />
                <span>{data.disclaimer}</span>
              </p>
              <div className="text-[12px] text-ink-3">Basis: <span className="text-ink-2">{data.basis}</span></div>
              {failing.length ? (
                <div className="rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2.5">
                  <div className="text-[13px] font-semibold text-danger-ink">Does not pass on paper</div>
                  <ul className="mt-1.5 space-y-1.5 text-[13px]">
                    {failing.map((it) => (
                      <li key={it.id}>
                        <span className="text-ink">{it.label}</span>
                        <span className="text-ink-2">{" — "}required <span className="num">{it.required ? `${formatNumber(it.required.value)} ${it.unit}` : "—"}</span>, provided <span className="num">{it.provided ? `${formatNumber(it.provided.value)} ${it.unit}` : "—"}</span></span>
                        {it.note ? <div className="text-[12px] text-ink-2">{it.note}</div> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="divide-y divide-line border-y border-line">
                {groups.map((g) => {
                  const items = data.items.filter((i) => i.group === g);
                  return (
                    <details key={g} className="group" open={items.some((i) => i.status === "does_not_pass_on_paper")}>
                      <summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 hover:bg-hover [&::-webkit-details-marker]:hidden">
                        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
                        <span className="text-[13px] font-semibold text-ink">{groupName(g)}</span>
                        <span className="ml-auto"><Counts items={items} /></span>
                      </summary>
                      <div className="pb-3"><CheckTable items={items} /></div>
                    </details>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
