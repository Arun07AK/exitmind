import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId("plan-canvas").boundingBox())!;
  const at = (p: [number, number]) => [box.x + p[0] * box.width, box.y + p[1] * box.height] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at(to), { steps: 6 });
  await page.mouse.up();
}

test("upload a plan, draw it, set the scale, save it, and run a scenario on it", async ({ page, request }) => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), "exitmind-e2e-"));
  const file = join(dir, "community-hall.png");
  execFileSync("python3", ["-c", "from PIL import Image, ImageDraw\nim=Image.new('RGB',(1200,800),'white')\nd=ImageDraw.Draw(im)\nd.rectangle([120,80,1080,720],outline='black',width=6)\nim.save(__import__('sys').argv[1])", file]);
  await page.goto("/plans");
  await page.getByTestId("plan-file").setInputFiles(file);
  await expect(page.getByTestId("plan-blank")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("plan-blank").click();
  await expect(page.getByTestId("plan-outline")).toBeVisible();
  await page.getByRole("radio", { name: "Exit" }).click();
  await drag(page, [0.1, 0.4], [0.1, 0.52]);
  await drag(page, [0.9, 0.45], [0.9, 0.57]);
  await expect(page.getByTestId("plan-exit")).toHaveCount(2);
  await page.getByRole("radio", { name: "Scale" }).click();
  const box = (await page.getByTestId("plan-canvas").boundingBox())!;
  await page.mouse.click(box.x + 0.1 * box.width, box.y + 0.5 * box.height);
  await page.mouse.click(box.x + 0.9 * box.width, box.y + 0.5 * box.height);
  await page.getByTestId("plan-scale-length").fill("30");
  await page.getByTestId("plan-scale-apply").click();
  await expect(page.getByTestId("plan-scale")).toContainText("ft per pixel");
  await expect(page.getByTestId("plan-checks")).not.toHaveAttribute("data-status", "error", { timeout: 15_000 });
  await expect(page.getByTestId("plan-checks")).not.toHaveAttribute("data-status", "", { timeout: 15_000 });
  await page.getByTestId("plan-name").fill("Community hall");
  await page.getByTestId("plan-save").click();
  await expect(page.getByTestId("plan-saved")).toBeVisible({ timeout: 15_000 });
  const venues = await (await request.get("/api/venues")).json() as { id: string; label: string }[];
  const v = venues.find((x) => x.label === "Community hall");
  expect(v?.id).toMatch(/^plan-/);

  await page.goto("/");
  await page.getByTestId("edit-scenario").first().click();
  await expect(page.getByTestId("preferred-venue")).toContainText("Community hall");
  await page.getByTestId("scenario-input").fill("Fire during a lecture with 200 people aged 30-50");
  const before = new URL(page.url()).searchParams.get("channel") ?? "";
  await page.getByTestId("scenario-send").click();
  await expect(page.getByTestId("scenario-reply")).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.getByTestId("scenario-run").click();
  await expect.poll(async () => {
    const ch = new URL(page.url()).searchParams.get("channel") ?? "";
    if (!ch || ch === before) return "";
    return ((await (await request.get(`/api/sim/runs/${encodeURIComponent(ch)}`)).json()) as { venue: string }).venue;
  }, { timeout: 30_000 }).toBe(v!.id);
  await expect.poll(async () => Number(await page.getByTestId("building3d").getAttribute("data-tick") ?? 0), { timeout: 60_000 }).toBeGreaterThan(20);
});
