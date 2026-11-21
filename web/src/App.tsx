import { Tooltip } from "radix-ui";
import { Info } from "lucide-react";
import { lazy, Suspense, type MouseEvent } from "react";
import { useApi } from "./api.ts";
import { cx, EvidenceChip, Pop } from "./components/ui.tsx";
import { navigate, routeOf, usePath, type Route } from "./router.ts";
const PlanEditor = lazy(() => import("./pages/PlanEditor.tsx"));
import { useStore } from "./store.ts";

const Simulate = lazy(() => import("./pages/Simulate.tsx"));
const Optimise = lazy(() => import("./pages/Optimise.tsx"));
const Live = lazy(() => import("./pages/Live.tsx"));
const Report = lazy(() => import("./pages/Report.tsx"));

interface Meta { offline: boolean; personaBackend: string; anthropicKey?: boolean; twinHash?: string; libraries: string[] }

const MODES: { route: Route; path: string; label: string }[] = [
  { route: "simulate", path: "/", label: "Simulate" },
  { route: "optimise", path: "/optimise", label: "Optimise" },
  { route: "live", path: "/live", label: "Live" },
];

export default function App() {
  const path = usePath();
  const route = routeOf(path);
  const status = useStore((s) => s.status);
  const liveActive = useStore((s) => !!s.live && s.live.incident !== "NORMAL" && s.live.incident !== "ALL_CLEAR");
  const meta = useApi<Meta>("/api/meta");
  const go = (p: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(p);
  };
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-full flex-col bg-page text-ink">
        <header className="z-20 flex min-h-[52px] flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2 md:py-0">
          <div className="flex min-w-0 items-center gap-3">
            <a href="/" onClick={go("/")} className="num text-[13px] font-semibold tracking-[0.2em] text-ink no-underline">EXITMIND</a>
            <span aria-hidden="true" className="h-[18px] w-px bg-line" />
            <span className="truncate text-[13px] text-ink">Rinker Hall <span className="text-ink-3">· University of Florida</span></span>
          </div>
          <nav aria-label="Mode" className="order-last mx-auto flex gap-0.5 rounded-[10px] bg-inset p-[3px] md:order-none">
            {MODES.map((m) => (
              <a key={m.route} href={m.path} onClick={go(m.path)} aria-current={route === m.route ? "page" : undefined} data-testid={`nav-${m.route}`}
                className={cx("inline-flex h-[30px] items-center gap-1.5 rounded-[7px] px-[18px] text-[13px] font-medium no-underline transition-colors", route === m.route ? "bg-ink text-white" : "text-ink-2 hover:text-ink")}>
                {m.route === "live" && liveActive ? <span className="h-[7px] w-[7px] rounded-full bg-danger-strong" aria-label="incident active" /> : null}
                {m.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            {route === "live" ? <EvidenceChip kind="demo" label="Demo feed" /> : <EvidenceChip kind="model" />}
            <Pop trigger={<button type="button" aria-label="About this model" className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel text-ink-2 hover:bg-hover"><Info size={16} /></button>}>
              <div className="w-72 space-y-2 text-[12px] text-ink-2">
                <div className="text-[13px] font-semibold text-ink">About these results</div>
                <p>Results come from EXITMIND's crowd model under stated assumptions. Behaviour parameters are not yet checked against published sources. Decision support for professional safety review, not certification.</p>
                <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
                  <dt className="text-ink-3">Connection</dt><dd data-testid="ws-status" className={status === "open" ? "text-safe-ink" : "text-warn-ink"}>{status}</dd>
                  <dt className="text-ink-3">Mode</dt><dd>{meta.data ? (meta.data.offline ? "offline (no LLM calls)" : "online") : "…"}</dd>
                  <dt className="text-ink-3">Persona backend</dt><dd>{meta.data?.personaBackend ?? "…"}</dd>
                  <dt className="text-ink-3">Twin</dt><dd className="num truncate">{meta.data?.twinHash?.slice(0, 12) ?? "…"}</dd>
                </dl>
              </div>
            </Pop>
            <span className={cx("h-2 w-2 rounded-full", status === "open" ? "bg-safe" : "bg-warn")} title={`socket ${status}`} />
          </div>
        </header>
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="grid h-full place-items-center text-ink-3">Loading</div>}>
            {route === "live" ? <Live /> : route === "report" ? <Report /> : route === "optimise" ? <Optimise /> : route === "plans" ? <Suspense fallback={null}><PlanEditor /></Suspense> : <Simulate />}
          </Suspense>
        </main>
      </div>
    </Tooltip.Provider>
  );
}
