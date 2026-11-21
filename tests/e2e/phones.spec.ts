import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { control, grid, liveState } from "./helpers.ts";

test("three phones register; one offline falls back to the static sign; reconnect restores the server state", async ({ browser, request }) => {
  await control(request, "reset");
  const g = await grid(request);
  const byFloor = [...new Set(g.mounts.map((m) => m.floor))].flatMap((f) => g.mounts.filter((m) => m.floor === f).slice(0, 1));
  const mounts = [...byFloor, ...g.mounts.filter((m) => !byFloor.includes(m))].slice(0, 3).map((m) => m.id);
  expect(new Set(mounts).size).toBe(3);

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (const id of mounts) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/sign?mount=${encodeURIComponent(id)}`);
    contexts.push(ctx);
    pages.push(page);
  }
  for (const p of pages) await expect(p.getByTestId("sign")).toHaveAttribute("data-connection", "online", { timeout: 20_000 });

  await expect
    .poll(async () => {
      const st = await liveState(request);
      return mounts.every((id) => {
        const s = st.signs.find((x) => x.mount === id);
        return !!s && (s.phones >= 1 || s.online);
      });
    }, { timeout: 20_000, message: "all three phones registered with the server" })
    .toBe(true);

  await contexts[0]!.setOffline(true);
  const sign0 = pages[0]!.getByTestId("sign");
  await expect(sign0).toHaveAttribute("data-sign-kind", "STATIC_DEFAULT", { timeout: 10_000 });
  await expect(sign0).toHaveAttribute("data-connection", "offline", { timeout: 10_000 });
  await expect(pages[0]!.getByTestId("sign-offline-note")).toBeVisible();
  for (const p of pages.slice(1)) await expect(p.getByTestId("sign")).toHaveAttribute("data-connection", "online");

  await contexts[0]!.setOffline(false);
  await expect
    .poll(async () => {
      const st = await liveState(request);
      const server = st.signs.find((x) => x.mount === mounts[0]);
      const kind = await sign0.getAttribute("data-sign-kind");
      const conn = await sign0.getAttribute("data-connection");
      const ref = (await sign0.getAttribute("data-approved-ref")) ?? "";
      return conn === "online" && !!server && kind === server.state.kind && ref === (server.approvedRef ?? "");
    }, { timeout: 30_000, message: "phone shows the server state again after reconnecting" })
    .toBe(true);
  await expect(pages[0]!.getByTestId("sign-offline-note")).toBeHidden();

  for (const c of contexts) await c.close();
});
