import { lazy, Suspense } from "react";
import { cx } from "../components/ui.tsx";
import { useStore } from "../store.ts";
import Plan2D, { type Plan2DProps } from "./Plan2D.tsx";

const Building3D = lazy(() => import("./Building3D.tsx"));

export function FrameStatus() {
  const tick = useStore((s) => s.frameB?.tick);
  const t = useStore((s) => s.frameB?.t);
  const done = useStore((s) => s.frameB?.done);
  const channel = useStore((s) => s.channel);
  const status = useStore((s) => s.status);
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400" data-testid="frame-status">
      <span>socket: <span className={status === "open" ? "text-emerald-400" : "text-amber-400"}>{status}</span></span>
      <span>channel: <span className="font-mono text-slate-300">{channel ?? "none"}</span></span>
      <span>tick: <span className="font-mono text-slate-300">{tick ?? "\u2014"}</span></span>
      <span>t: <span className="font-mono text-slate-300">{t !== undefined ? `${t} s` : "\u2014"}</span></span>
      {done ? <span className="text-emerald-400">run finished</span> : null}
    </div>
  );
}

export function SyncedViews({ className, vertical, ...plan }: Plan2DProps & { vertical?: boolean }) {
  return (
    <div className={cx("grid min-h-0 gap-2", vertical ? "grid-rows-2" : "grid-cols-1 lg:grid-cols-2", className)} data-testid="synced-views">
      <div className="min-h-[18rem] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <Plan2D {...plan} />
      </div>
      <div className="min-h-[18rem] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading 3D view</div>}>
          <Building3D />
        </Suspense>
      </div>
    </div>
  );
}
