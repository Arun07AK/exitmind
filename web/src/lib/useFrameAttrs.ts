import { useEffect, useRef } from "react";
import type { FrameMsg } from "../../../src/server/contract.ts";
import { useStore } from "../store.ts";

export function applyFrameAttrs(el: Element | null, f: FrameMsg | null): void {
  if (!el) return;
  el.setAttribute("data-tick", f ? String(f.tick) : "");
  el.setAttribute("data-state-hash", f?.hash ?? "");
}

export function useFrameAttrs<T extends Element>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    applyFrameAttrs(ref.current, useStore.getState().frameB);
    return useStore.subscribe((s, p) => {
      if (s.frameB !== p.frameB) applyFrameAttrs(ref.current, s.frameB);
    });
  }, []);
  return ref;
}
