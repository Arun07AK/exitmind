import type { MouseEvent } from "react";
import { useApi } from "./api.ts";
import { Badge, cx } from "./components/ui.tsx";
import Design from "./pages/Design.tsx";
import Live from "./pages/Live.tsx";
import Report from "./pages/Report.tsx";
import { navigate, routeOf, usePath, type Route } from "./router.ts";
import { useStore } from "./store.ts";

interface Meta { offline: boolean; personaBackend: string; libraries: string[] }

const LINKS: { route: Route; path: string; label: string }[] = [
  { route: "design", path: "/", label: "Design" },
  { route: "live", path: "/live", label: "Live console" },
  { route: "report", path: "/report", label: "Report" },
];

export default function App() {
  const path = usePath();
  const route = routeOf(path);
  const status = useStore((s) => s.status);
  const meta = useApi<Meta>("/api/meta");
  const go = (p: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(p);
  };
  return (
    <div className="flex h-full flex-col">
      <nav className="flex items-center gap-4 border-b border-slate-800 bg-slate-950 px-4 py-2">
        <span className="font-mono text-sm font-bold tracking-widest text-sky-300">EXITMIND</span>
        <span className="hidden text-xs text-slate-500 md:inline">Rinker Hall, University of Florida</span>
        <div className="flex gap-1">
          {LINKS.map((l) => (
            <a key={l.route} href={l.path} onClick={go(l.path)} data-testid={`nav-${l.route}`} className={cx("rounded px-3 py-1 text-sm", route === l.route ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200")}>
              {l.label}
            </a>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {meta.data ? (
            <>
              {meta.data.offline ? <Badge color="amber">offline mode</Badge> : null}
              <Badge color="slate">personas: {meta.data.personaBackend}</Badge>
            </>
          ) : null}
          <Badge color={status === "open" ? "green" : "amber"} testId="ws-status">socket {status}</Badge>
        </div>
      </nav>
      <main className="min-h-0 flex-1 overflow-auto">
        {route === "live" ? <Live /> : route === "report" ? <Report /> : <Design />}
      </main>
    </div>
  );
}
