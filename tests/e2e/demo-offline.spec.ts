import { expect, test } from "@playwright/test";
import type { DecisionCard, LiveState } from "../../src/server/contract.ts";
import { control, liveState } from "./helpers.ts";

const findCard = (st: LiveState, id: string): DecisionCard | undefined => [st.current, ...st.history].find((c) => c?.id === id) ?? undefined;

test("offline demo: fire, approve, phone shows the approved state; earthquake picks a different protocol", async ({ page, browser, request }) => {
  test.setTimeout(300_000);
  const meta = (await (await request.get("/api/meta")).json()) as { offline: boolean };
  expect(meta.offline).toBe(true);
  await control(request, "reset");

  await page.goto("/live");
  await expect(page.getByTestId("incident-state")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ctl-start_fire").click();

  const card = page.getByTestId("decision");
  await expect(card).toHaveAttribute("data-status", "pending", { timeout: 150_000 });
  const fireId = (await card.getAttribute("data-decision-id"))!;
  const fireProtocol = (await card.getAttribute("data-protocol"))!;
  expect(fireId).toBeTruthy();
  await expect(page.getByTestId("verdict")).toHaveText(/PASS|FAIL/);

  const st = await liveState(request);
  const preview = st.current?.signPreview ?? [];
  const mount = (preview.find((s) => s.state.kind !== "STATIC_DEFAULT") ?? preview[0])?.mount ?? st.signs[0]!.mount;
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneCtx.newPage();
  await phone.goto(`/sign?mount=${encodeURIComponent(mount)}`);
  const sign = phone.getByTestId("sign");
  await expect(sign).toHaveAttribute("data-connection", "online", { timeout: 20_000 });

  if (await page.getByTestId("approve").isVisible()) await page.getByTestId("approve").click();
  else {
    await page.getByTestId("override-reason").fill("e2e operator accepts the verifier finding for the demo");
    await page.getByTestId("override").click();
  }
  await expect
    .poll(async () => findCard(await liveState(request), fireId)?.status, { timeout: 30_000, message: "fire decision approved" })
    .toMatch(/approved|overridden/);

  await expect(sign).not.toHaveAttribute("data-sign-kind", "STATIC_DEFAULT", { timeout: 30_000 });
  await expect(sign).toHaveAttribute("data-sign-kind", /^(ARROW|X_ALT|HOLD|LOCKDOWN)$/);
  await expect(sign).toHaveAttribute("data-approved-ref", /.+/, { timeout: 30_000 });

  await control(request, "reset");
  await page.reload();
  await expect(page.getByTestId("incident-state")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ctl-start_quake").click();
  let quakeProtocol = "";
  await expect
    .poll(async () => {
      const s = await liveState(request);
      if (s.current && s.current.id !== fireId) quakeProtocol = s.current.protocol;
      return quakeProtocol;
    }, { timeout: 150_000, message: "a new decision for the earthquake" })
    .not.toBe("");
  expect(quakeProtocol).not.toBe(fireProtocol);
  await expect(page.getByTestId("decision")).not.toHaveAttribute("data-decision-id", fireId, { timeout: 20_000 });

  await phoneCtx.close();
});
