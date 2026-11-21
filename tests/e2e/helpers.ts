import type { APIRequestContext, Page } from "@playwright/test";
import type { GridInfo, LiveState } from "../../src/server/contract.ts";

export async function grid(request: APIRequestContext): Promise<GridInfo> {
  const res = await request.get("/api/grid");
  if (!res.ok()) throw new Error(`/api/grid: ${res.status()}`);
  return (await res.json()) as GridInfo;
}

export async function liveState(request: APIRequestContext): Promise<LiveState> {
  const res = await request.get("/api/live/state");
  if (!res.ok()) throw new Error(`/api/live/state: ${res.status()}`);
  return (await res.json()) as LiveState;
}

export async function control(request: APIRequestContext, action: string, sensor?: string): Promise<void> {
  const res = await request.post("/api/live/control", { data: sensor ? { action, sensor } : { action } });
  if (!res.ok()) throw new Error(`control ${action}: ${res.status()} ${await res.text()}`);
}

interface Attr { getAttribute(name: string): string | null }
interface Doc { querySelector(sel: string): Attr | null }

export interface ViewSample { planTick: string; planHash: string; viewTick: string; viewHash: string }

export function sampleViews(page: Page): Promise<ViewSample> {
  return page.evaluate(() => {
    const d = (globalThis as unknown as { document: Doc }).document;
    const a = d.querySelector('[data-testid="plan2d-canvas"]'), b = d.querySelector('[data-testid="building3d"]');
    return {
      planTick: a?.getAttribute("data-tick") ?? "",
      planHash: a?.getAttribute("data-state-hash") ?? "",
      viewTick: b?.getAttribute("data-tick") ?? "",
      viewHash: b?.getAttribute("data-state-hash") ?? "",
    };
  });
}
