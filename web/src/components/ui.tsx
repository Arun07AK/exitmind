import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(" ");

export function Card({ title, children, className, actions, testId }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; testId?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-800 bg-slate-900/60", className)} data-testid={testId}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
          {actions}
        </header>
      ) : null}
      <div className="p-3">{children}</div>
    </section>
  );
}

type Tone = "default" | "primary" | "danger" | "warn" | "ghost" | "ok";
const TONES: Record<Tone, string> = {
  default: "bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700",
  primary: "bg-sky-600 hover:bg-sky-500 text-white border-sky-500",
  danger: "bg-red-700 hover:bg-red-600 text-white border-red-600",
  warn: "bg-amber-600 hover:bg-amber-500 text-black border-amber-500",
  ok: "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500",
  ghost: "bg-transparent hover:bg-slate-800 text-slate-300 border-slate-700",
};

export function Button({ tone = "default", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type="button" {...rest} className={cx("rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40", TONES[tone], className)} />;
}

const BADGE: Record<string, string> = {
  slate: "bg-slate-800 text-slate-300 border-slate-700",
  green: "bg-emerald-900/60 text-emerald-300 border-emerald-700",
  red: "bg-red-900/60 text-red-300 border-red-700",
  amber: "bg-amber-900/60 text-amber-300 border-amber-700",
  sky: "bg-sky-900/60 text-sky-300 border-sky-700",
  violet: "bg-violet-900/60 text-violet-300 border-violet-700",
};

export function Badge({ color = "slate", children, className, testId, ...data }: { color?: keyof typeof BADGE | string; children: ReactNode; className?: string; testId?: string } & Record<`data-${string}`, string>) {
  return (
    <span {...data} data-testid={testId} className={cx("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium", BADGE[color] ?? BADGE.slate, className)}>
      {children}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-800" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          data-testid={`tab-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cx("-mb-px border-b-2 px-3 py-2 text-sm", t.id === value ? "border-sky-400 text-sky-300" : "border-transparent text-slate-400 hover:text-slate-200")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx("mr-1 inline-block rounded border px-1 font-mono text-[10px]", active ? "border-sky-400 bg-sky-900/60 text-sky-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500")} data-testid="ref-chip">
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-700 p-4 text-sm text-slate-400">{children}</div>;
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("border-b border-slate-800 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400", className)}>{children}</th>;
}

export function Td({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return <td title={title} className={cx("border-b border-slate-800/60 px-2 py-1 align-top text-sm", className)}>{children}</td>;
}
