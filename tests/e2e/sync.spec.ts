import { expect, test } from "@playwright/test";
import type { Scenario } from "../../src/server/contract.ts";
import { grid, sampleViews } from "./helpers.ts";

test("2D plan and 3D view show the same tick and state hash during playback", async ({ page, request }) => {
  const g = await grid(request);
  const floor = g.floors.find((f) => f.id === "F2") ?? g.floors[0]!;
  const spot = g.mounts.find((m) => m.floor === floor.id) ?? g.elements.find((e) => e.floor === floor.id);
  expect(spot, "need a point on the fire floor").toBeTruthy();
  const scenario: Scenario = {
    id: "e2e-sync-college-fire",
    profile: "college",
    hazard: { kind: "fire", floor: floor.id as "F1" | "F2" | "F3", at: [spot!.x, spot!.y], startSec: 0 },
    behaviour: {},
    loadFactor: 1,
    occupancy: "uniform",
    protocol: "EVACUATE",
    seed: 7,
    maxSec: 900,
  };
  const res = await request.post("/api/sim/run", { data: { scenario, mode: "rule", speed: 4 } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { channel } = (await res.json()) as { channel: string };

  await page.goto(`/?channel=${encodeURIComponent(channel)}&view=split`);
  await expect(page.getByTestId("synced-views")).toBeVisible();
  await expect(page.getByTestId("plan2d-canvas")).toHaveAttribute("data-tick", /^\d+$/, { timeout: 60_000 });
  await expect(page.getByTestId("building3d")).toHaveAttribute("data-tick", /^\d+$/, { timeout: 60_000 });

  const ticks = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const s = await sampleViews(page);
    expect(s.planTick, `sample ${i}`).toMatch(/^\d+$/);
    expect(s.viewTick, `sample ${i}: tick`).toBe(s.planTick);
    expect(s.viewHash, `sample ${i}: state hash`).toBe(s.planHash);
    expect(s.planHash).toMatch(/^[0-9a-f]{16,}$/);
    ticks.add(s.planTick);
    await page.waitForTimeout(400);
  }
  expect(ticks.size, "playback advanced while sampling").toBeGreaterThan(1);
});

test("switching between 3D and 2D keeps the playhead, tick and state hash", async ({ page, request }) => {
  const g = await grid(request);
  const scenario: Scenario = {
    id: "e2e-switch-college-quake",
    profile: "college",
    hazard: { kind: "quake", damaged: [], startSec: 0 },
    behaviour: {},
    loadFactor: 1,
    occupancy: "uniform",
    protocol: "HOLD_THEN_EVACUATE",
    seed: 3,
    maxSec: 600,
  };
  expect(g.floors.length).toBeGreaterThan(0);
  const res = await request.post("/api/sim/run", { data: { scenario, mode: "rule", speed: 0 } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { channel } = (await res.json()) as { channel: string };
  await page.goto(`/?channel=${encodeURIComponent(channel)}&view=2d`);
  const plan = page.getByTestId("plan2d-canvas");
  await expect(plan).toHaveAttribute("data-tick", /^[1-9]\d*$/, { timeout: 60_000 });
  await page.getByTestId("play").click();
  await page.waitForTimeout(300);
  const clock = await page.getByTestId("clock").textContent();
  const tick = await plan.getAttribute("data-tick");
  const hash = await plan.getAttribute("data-state-hash");
  await page.getByTestId("view-3d").click();
  const view3d = page.getByTestId("building3d");
  await expect(view3d).toHaveAttribute("data-tick", tick!, { timeout: 30_000 });
  await expect(view3d).toHaveAttribute("data-state-hash", hash!);
  await expect(page.getByTestId("clock")).toHaveText(clock!);
  await page.getByTestId("view-2d").click();
  await expect(page.getByTestId("plan2d-canvas")).toHaveAttribute("data-tick", tick!, { timeout: 30_000 });
  await expect(page.getByTestId("clock")).toHaveText(clock!);
});
