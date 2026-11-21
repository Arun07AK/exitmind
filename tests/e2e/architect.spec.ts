import { expect, test } from "@playwright/test";

test("architectural changes: ranked alternatives, change plan in 2D and 3D, quantified gain", async ({ page, request }) => {
  test.setTimeout(120_000);
  const r = await request.get("/api/architect/report?venue=rinker-hall");
  expect(r.ok()).toBe(true);
  await page.goto("/optimise");
  await expect(page.getByTestId("architect")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("arch-numbers")).toContainText("Safe capacity", { timeout: 30_000 });
  await expect(page.getByTestId("arch-numbers")).toContainText("people");
  const rows = page.getByTestId("arch-alt");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(3);
  await rows.nth(1).click();
  await expect(page.getByTestId("arch-selected")).toContainText("what to build");
  await expect(page.getByTestId("arch-plan")).toBeVisible();
  await expect(page.getByTestId("arch-3d")).toBeVisible();
  await page.getByRole("radio", { name: "Difference" }).click();
  await expect(page.getByTestId("arch-diagnosis")).toContainText("queues behind");
  await expect(page.getByTestId("arch-method")).toContainText("Concepts for professional review");
  await page.getByTestId("optimise-mode").getByRole("radio", { name: "Quick recommendations" }).click();
  await expect(page.getByTestId("architect")).toHaveCount(0);
});
