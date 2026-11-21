import { Dialog, Popover, ToggleGroup, Tooltip } from "radix-ui";
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(" ");

export function Card({ title, children, className, actions, testId }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; testId?: string }) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel", className)} data-testid={testId}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Tone = "default" | "primary" | "danger" | "warn" | "ghost" | "ok";
const TONES: Record<Tone, string> = {
  default: "bg-panel hover:bg-hover text-ink border-line-strong",
  primary: "bg-ink hover:bg-[#2a2f37] text-white border-ink",
  danger: "bg-danger-strong hover:bg-[#b42318] text-white border-danger-strong",
  warn: "bg-warn-bg hover:bg-[#ffefcc] text-warn-ink border-warn-line",
  ok: "bg-safe-ink hover:bg-[#166534] text-white border-safe-ink",
  ghost: "bg-transparent hover:bg-inset text-ink-2 border-transparent",
};

export function Button({ tone = "default", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type="button" {...rest} className={cx("inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40", TONES[tone], className)} />;
}

export function IconButton({ label, className, children, pressed, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; pressed?: boolean }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label={label} aria-pressed={pressed} {...rest} className={cx("grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-inset hover:text-ink disabled:opacity-40", pressed && "bg-inset text-ink", className)}>
        {children}
      </button>
    </Tip>
  );
}

const BADGE: Record<string, string> = {
  slate: "bg-panel text-ink-2 border-line-strong",
  green: "bg-safe-bg text-safe-ink border-safe-line",
  red: "bg-danger-bg text-danger-ink border-danger-line",
  amber: "bg-warn-bg text-warn-ink border-warn-line",
  sky: "bg-[#eef3ff] text-[#1d4ed8] border-[#c7d5fb]",
  violet: "bg-[#f3eeff] text-[#6d28d9] border-[#dccdfd]",
};

export function Badge({ color = "slate", children, className, testId, ...data }: { color?: keyof typeof BADGE | string; children: ReactNode; className?: string; testId?: string } & Record<`data-${string}`, string>) {
  return (
    <span {...data} data-testid={testId} className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap", BADGE[color] ?? BADGE.slate, className)}>
      {children}
    </span>
  );
}

export type Evidence = "validated" | "no_effect" | "worse" | "untestable" | "model" | "demo" | "connected";
const EVIDENCE: Record<Evidence, { label: string; cls: string }> = {
  validated: { label: "Validated", cls: "border-safe-line bg-safe-bg text-safe-ink" },
  no_effect: { label: "Tested · no effect", cls: "border-line-strong bg-panel text-ink-2" },
  worse: { label: "Tested · worse", cls: "border-danger-line bg-danger-bg text-danger-ink" },
  untestable: { label: "Not testable yet", cls: "border-dashed border-line-strong bg-panel text-ink-2" },
  model: { label: "Simulation · model results", cls: "border-line-strong bg-panel text-ink-2" },
  demo: { label: "Demo feed", cls: "border-warn-line bg-warn-bg text-warn-ink" },
  connected: { label: "Connected", cls: "border-safe-line bg-panel text-safe-ink" },
};

export function EvidenceChip({ kind, label, className }: { kind: Evidence; label?: string; className?: string }) {
  const e = EVIDENCE[kind];
  return <span className={cx("inline-flex h-[22px] items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap", e.cls, className)} data-evidence={kind}>{label ?? e.label}</span>;
}

export function HazardTag({ kind, className }: { kind: string; className?: string }) {
  const labels: Record<string, string> = { fire: "Fire", quake: "Earthquake", crush: "Crowd crush", threat: "Threat", medical: "Medical", none: "Drill" };
  const hot = kind === "fire" || kind === "threat" || kind === "crush";
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold uppercase tracking-[0.06em]", hot ? "border-danger-line bg-danger-bg text-danger-ink" : kind === "none" ? "border-line-strong bg-panel text-ink-2" : "border-warn-line bg-warn-bg text-warn-ink", className)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", hot ? "bg-danger" : kind === "none" ? "bg-ink-3" : "bg-warn")} />
      {labels[kind] ?? kind}
    </span>
  );
}

/** Segmented control: one value from a few options (Radix ToggleGroup, arrow-key navigation). */
export function Segmented<T extends string>({ value, onChange, options, label, tone = "light", size = "md", className, testId }: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: ReactNode; title?: string; testId?: string }[]; label: string; tone?: "light" | "ink"; size?: "sm" | "md"; className?: string; testId?: string }) {
  return (
    <ToggleGroup.Root type="single" value={value} onValueChange={(v) => { if (v) onChange(v as T); }} aria-label={label} data-testid={testId} className={cx("inline-flex gap-0.5 rounded-[10px] p-[3px]", tone === "ink" ? "bg-inset" : "bg-[#e3e6ea]", className)}>
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} title={o.title} data-testid={o.testId} className={cx(
          "inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap text-ink-2 transition-colors hover:text-ink",
          size === "sm" ? "h-7 min-w-9 px-2 text-[12px]" : "h-[30px] px-3 text-[13px]",
          tone === "ink" ? "data-[state=on]:bg-ink data-[state=on]:text-white" : "data-[state=on]:bg-panel data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgba(16,24,40,0.1)]",
        )}>
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="anim-fade z-50 max-w-64 rounded-md bg-ink px-2 py-1 text-[12px] text-white shadow-lg">{label}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Pop({ trigger, children, align = "end", className }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={8} className={cx("anim-pop z-50 rounded-xl border border-line bg-panel p-3 shadow-[0_12px_32px_rgba(16,24,40,0.14)]", className)}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Side sheet for on-demand detail (scenario editor, run statistics). */
export function Sheet({ open, onOpenChange, title, description, children, width = 440, testId }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; width?: number; testId?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[rgba(20,23,28,0.18)]" />
        <Dialog.Content data-testid={testId} className="anim-sheet fixed top-0 right-0 bottom-0 z-50 flex max-w-full flex-col border-l border-line bg-panel shadow-[0_0_48px_rgba(16,24,40,0.16)]" style={{ width }}>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[12px] text-ink-3">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-inset"><X size={16} /></button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          data-testid={`tab-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cx("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium", t.id === value ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx("num mr-1 inline-block rounded border px-1 text-[10px]", active ? "border-ink bg-ink text-white" : "border-line-strong bg-panel text-ink-2 hover:border-ink-3")} data-testid="ref-chip">
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong bg-panel p-4 text-[13px] text-ink-2">{children}</div>;
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("border-b border-line px-2 py-1.5 text-left text-[12px] font-medium text-ink-3", className)}>{children}</th>;
}

export function Td({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return <td title={title} className={cx("border-b border-line/70 px-2 py-1.5 align-top text-[13px]", className)}>{children}</td>;
}

export function Dot({ color, ring, size = 8 }: { color: string; ring?: boolean; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color, boxShadow: ring ? "inset 0 0 0 1px #b4bbc6" : undefined }} />;
}
