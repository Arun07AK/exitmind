import { ChevronRight, ExternalLink, PhoneOff } from "lucide-react";
import { useState } from "react";
import type { DecisionCard, LiveState, SignInfo } from "../../../../src/server/contract.ts";
import { SIGN_COLORS } from "../../lib/colors.ts";
import { Chip, cx } from "../ui.tsx";
import { signShort } from "./format.ts";

export function BriefPanel({ live, onRef, active }: { live: LiveState; onRef: (id: string) => void; active: string | null }) {
  const b = live.brief;
  return (
    <section aria-labelledby="brief-h" className="rounded-xl border border-line bg-panel p-4" data-testid="brief">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2 id="brief-h" className="m-0 text-[14px] font-semibold">Responder brief</h2>
        <span className="text-[12px] text-ink-3">{b ? `${b.source === "llm" ? "drafted by the liaison agent" : "drafted from the template"}, every line linked to a log record` : "drafted once a plan is approved"}</span>
      </div>
      {b ? (
        <>
          <p className="mt-0 mb-2 text-[12px] font-medium text-ink-2" data-testid="brief-notice">{b.notice}</p>
          <ul className="mt-0 mb-2.5 list-disc space-y-0.5 pl-4.5 leading-relaxed text-ink marker:text-ink-4">
            {b.lines.map((l, i) => (
              <li key={i} data-testid="brief-line">
                {l.text} <span className="whitespace-nowrap">{l.refs.map((r) => <Chip key={r} active={active === r} onClick={() => onRef(r)}>{r}</Chip>)}</span>
              </li>
            ))}
          </ul>
          <div className="num mb-2 text-[11px] text-ink-3">{b.id} · tick {b.createdTick} · {b.source}</div>
        </>
      ) : null}
      <div className="flex items-start gap-2 rounded-lg bg-hover px-3 py-2.5 text-[12px] leading-normal text-ink-2" data-testid="no-contact">
        <PhoneOff size={14} className="mt-0.5 flex-none" aria-hidden="true" />
        <span>A human calls 112. EXITMIND never contacts anyone. Counts are sensor observations with their sources, not casualty estimates.</span>
      </div>
    </section>
  );
}

function StateChip({ s, pending }: { s: SignInfo["state"]; pending?: boolean }) {
  const hold = s.kind === "HOLD";
  return (
    <span className={cx("num inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold whitespace-nowrap", pending ? "border border-warn-line bg-panel text-warn-ink" : s.kind === "STATIC_DEFAULT" ? "border border-line-strong bg-panel text-safe-ink" : hold ? "text-ink" : "text-white")}
      style={pending || s.kind === "STATIC_DEFAULT" ? undefined : { background: SIGN_COLORS[s.kind] }}>
      {signShort(s)}{s.kind === "STATIC_DEFAULT" ? " · static" : ""}
    </span>
  );
}

function SignRow({ s, preview }: { s: SignInfo; preview: DecisionCard["signPreview"][number] | undefined }) {
  const [big, setBig] = useState(false);
  const qr = `/api/signs/qr?mount=${encodeURIComponent(s.mount)}`;
  return (
    <li className="flex items-center gap-2.5 border-t border-[#f1f2f4] py-2 first:border-t-0" data-testid={`sign-row-${s.mount}`} data-online={String(s.online)} data-phones={s.phones}>
      <button type="button" onClick={() => setBig((x) => !x)} className="flex-none rounded border border-line bg-white p-0.5" title={big ? "Smaller QR code" : "Larger QR code"} aria-label={`QR code for ${s.mount}`}>
        <img src={qr} alt={`QR code for ${s.mount}`} loading="lazy" className={big ? "h-40 w-40" : "h-10 w-10"} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          <span className="num font-medium text-ink">{s.mount}</span>
          <span className="text-ink-3">{s.floor}</span>
          <span className={cx("inline-flex items-center gap-1", s.online ? "text-safe-ink" : "text-ink-3")}><span className={cx("h-1.5 w-1.5 rounded-full", s.online ? "bg-safe" : "bg-idle")} />{s.online ? "online" : "offline"}</span>
          <span className="num text-ink-3">{s.phones} phone{s.phones === 1 ? "" : "s"}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          <StateChip s={s.state} />
          {preview ? (
            <span className="inline-flex items-center gap-1 text-warn-ink" data-testid="sign-preview" data-mount={preview.mount} data-kind={preview.state.kind}>
              <ChevronRight size={12} aria-hidden="true" />pending<StateChip s={preview.state} pending />
            </span>
          ) : null}
          {s.approvedRef ? <span className="num text-ink-3">approved {s.approvedRef}</span> : <span className="text-ink-3">no approved plan</span>}
        </div>
      </div>
      <a href={`/sign?mount=${encodeURIComponent(s.mount)}`} target="_blank" rel="noreferrer" className="inline-flex flex-none items-center gap-1 text-[12px] text-ink-2 hover:text-ink" title={s.url}>open<ExternalLink size={12} aria-hidden="true" /></a>
    </li>
  );
}

export function SignsPanel({ live }: { live: LiveState }) {
  const signs = [...live.signs].sort((a, b) => Number(b.online) - Number(a.online) || a.mount.localeCompare(b.mount));
  const c = live.current;
  const preview = c && (c.status === "pending" || c.status === "verifying") ? new Map(c.signPreview.map((p) => [p.mount, p])) : null;
  const online = signs.filter((s) => s.online).length;
  const phones = signs.reduce((n, s) => n + s.phones, 0);
  return (
    <details className="group rounded-xl border border-line bg-panel" data-testid="sign-list">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="self-center text-ink-3 transition-transform group-open:rotate-90" aria-hidden="true" />
        <h2 className="m-0 text-[14px] font-semibold">Signs and phones</h2>
        <span className="num text-[12px] text-ink-2">{online} of {signs.length} online · {phones} phone{phones === 1 ? "" : "s"}</span>
        <span className="ml-auto text-[12px] text-ink-3">QR codes to open a sign on a phone</span>
      </summary>
      <ul className="m-0 list-none border-t border-line px-4 py-1">
        {signs.map((s) => <SignRow key={s.mount} s={s} preview={preview?.get(s.mount)} />)}
      </ul>
    </details>
  );
}
