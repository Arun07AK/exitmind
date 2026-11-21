import { expect, test } from "@playwright/test";

test("custom scenario generator: Saturnalia demo preloads, asks for the crowd size, runs on the Fete Area", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("edit-scenario").first().click();
  const gen = page.getByTestId("scenario-generator");
  await expect(gen).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("saturnalia-suggestion")).toContainText("Try the Saturnalia demo");
  await page.getByTestId("try-saturnalia").click();
  await expect(page.getByTestId("scenario-input")).toHaveValue(/Saturnalia concert at Thapar, with students aged 18–21/);
  await page.getByTestId("scenario-send").click();
  const reply = page.getByTestId("scenario-reply");
  await expect(reply).toHaveAttribute("data-status", "needs_info", { timeout: 60_000 });
  await expect(page.getByTestId("scenario-transcript")).toContainText(/how many people/i);
  await page.getByTestId("scenario-input").fill("About 1500 people");
  await page.getByTestId("scenario-send").click();
  await expect(reply).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(page.getByTestId("scenario-assumptions")).toContainText(/Stage position is not in OSM/);
  await expect(reply).toContainText(/OpenStreetMap contributors/);
  const before = new URL(page.url()).searchParams.get("channel") ?? "";
  await page.getByTestId("scenario-run").click();
  type RunInfo = { venue: string; mode: string; scenario: { crowd: { size: number } } };
  let info: RunInfo | null = null;
  await expect.poll(async () => {
    const ch = new URL(page.url()).searchParams.get("channel") ?? "";
    if (!ch || ch === before) return "";
    info = await (await request.get(`/api/sim/runs/${encodeURIComponent(ch)}`)).json() as RunInfo;
    return info.venue;
  }, { timeout: 30_000 }).toBe("thapar-fete");
  info = info!;
  expect(info.mode).toBe("crowd");
  expect(info.scenario.crowd.size).toBe(1500);
  const plan = page.getByTestId("building3d");
  await expect.poll(async () => Number(await plan.getAttribute("data-tick") ?? 0), { timeout: 60_000 }).toBeGreaterThan(40);
});
