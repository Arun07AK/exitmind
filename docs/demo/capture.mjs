// Real-app footage for the 60-second film. GPU Chromium (60 fps) + CDP screencast (JPEG q92, 1920x1080),
// a drawn cursor with click ripples, and time marks for the edit. Usage: node capture.mjs <outDir> <clip...>
import { chromium } from "@playwright/test";
import fs from "node:fs";
const OUT = process.argv[2], CLIPS = process.argv.slice(3);
const B = "http://localhost:5174";
const browser = await chromium.launch({ channel: "chromium", args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.6 15.2 L18.5 15.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = "position:fixed;left:-50px;top:-50px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));transform:translate(-3px,-2px)";
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;border:3px solid #E2432A;z-index:2147483646;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out;transform:scale(.3);opacity:1`;
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.4)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  });
});
const page = await ctx.newPage();
let mouse = { x: 950, y: 540 };
const wait = (ms) => page.waitForTimeout(ms);
async function glide(x, y, steps = 28) { await page.mouse.move(x, y, { steps }); mouse = { x, y }; }
async function glideTo(loc) { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); await wait(140); }
async function glideClick(loc) { await glideTo(loc); await page.mouse.down(); await wait(60); await page.mouse.up(); await wait(120); }
async function smoothScroll(dy, n = 20) { for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy / n); await wait(28); } }

async function record(name, body) {
  const dir = `${OUT}/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page); const ts = [], marks = [];
  const mark = (m) => { marks.push({ m, t: Date.now() / 1000 }); console.log(name, m, ((Date.now() / 1000) - (ts[0] ?? Date.now() / 1000)).toFixed(1)); };
  cdp.on("Page.screencastFrame", (f) => {
    fs.writeFileSync(`${dir}/f${String(ts.length).padStart(6, "0")}.jpg`, Buffer.from(f.data, "base64"));
    ts.push(f.metadata.timestamp);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  try { await body(mark); } finally {
    await wait(300); await cdp.send("Page.stopScreencast").catch(() => {});
    fs.writeFileSync(`${dir}/frames.json`, JSON.stringify({ ts, marks, end: Date.now() / 1000 }));
    console.log(name, "frames", ts.length, "seconds", ts.length ? (ts.at(-1) - ts[0]).toFixed(1) : 0);
  }
}

const SENTENCE = "Saturnalia concert at Thapar's Fete Area. Students aged 18 to 21. A fire breaks out near the stage and the main gate is blocked.";

if (CLIPS.includes("scenario")) {
  await page.goto(B + "/"); await page.getByTestId("building3d").waitFor({ timeout: 30000 }); await wait(2500);
  await glide(760, 430, 2);
  await record("scenario", async (mark) => {
    mark("start"); await wait(700);
    await glideClick(page.getByTestId("edit-scenario").first());
    await page.getByTestId("scenario-generator").waitFor({ timeout: 30000 }); mark("sheet"); await wait(700);
    const input = page.getByTestId("scenario-input");
    await glideClick(input); await input.fill(""); mark("type");
    await input.pressSequentially(SENTENCE, { delay: 22 }); mark("typed"); await wait(500);
    await glideClick(page.getByTestId("scenario-send")); mark("send1");
    const reply = page.getByTestId("scenario-reply");
    await page.waitForFunction(() => { const r = document.querySelector('[data-testid="scenario-reply"]'); return r && /needs_info|ready/.test(r.getAttribute("data-status") || ""); }, null, { timeout: 90000 });
    mark("reply1:" + await reply.getAttribute("data-status")); await wait(2200);
    if ((await reply.getAttribute("data-status")) === "needs_info") {
      await glideClick(input); await input.pressSequentially("About 1,500 people.", { delay: 45 }); await wait(300);
      await glideClick(page.getByTestId("scenario-send")); mark("send2");
      await page.waitForFunction(() => document.querySelector('[data-testid="scenario-reply"]')?.getAttribute("data-status") === "ready", null, { timeout: 90000 });
      mark("ready");
    }
    await wait(1800);
    const asm = page.getByTestId("scenario-assumptions");
    await glideTo(asm); mark("assumptions"); await smoothScroll(260, 26); await wait(2600); await smoothScroll(260, 26); await wait(2200);
    await glideClick(page.getByTestId("scenario-run")); mark("run");
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="building3d"]')?.getAttribute("data-tick") || 0) > 3, null, { timeout: 60000 });
    mark("running"); await wait(7000);
    await glideClick(page.getByTestId("open-stats")); mark("stats");
    await page.getByTestId("persona-feed").waitFor({ timeout: 30000 }).catch(() => {}); mark("feed"); await wait(5000);
    const feed = page.getByTestId("persona-feed"); if (await feed.count()) { await glideTo(feed); await smoothScroll(300, 30); await wait(4500); }
    await page.keyboard.press("Escape"); mark("feed-closed"); await wait(6000);
    await glideClick(page.getByTestId("view-2d")); mark("2d"); await wait(8000);
    mark("end");
  });
}

if (CLIPS.includes("optimise")) {
  await page.goto(B + "/optimise"); await page.getByTestId("arch-numbers").waitFor({ timeout: 30000 }); await wait(2500);
  await glide(700, 300, 2);
  await record("optimise", async (mark) => {
    mark("start"); await wait(1200);
    await glideTo(page.getByTestId("arch-plan")); mark("plan"); await wait(1500);
    await glideClick(page.getByText(/^After A/).first()); mark("after"); await wait(2600);
    await glideClick(page.getByText("Difference", { exact: true })); mark("diff"); await wait(2800);
    await glideTo(page.getByTestId("arch-numbers")); mark("numbers"); await wait(2400);
    await glide(760, 600); await smoothScroll(700, 40); mark("scrolled"); await wait(2500); await smoothScroll(700, 40); mark("scrolled2"); await wait(3000);
    mark("end");
  });
}

if (CLIPS.includes("fete")) {
  // replay of the live Haiku run (channel sim:3) at 16x: the whole evacuation, then its statistics
  await page.goto(B + "/?channel=" + encodeURIComponent(process.env.CH || "sim:3")); await page.getByTestId("building3d").waitFor({ timeout: 30000 }); await wait(2000);
  await page.getByTestId("speed").getByText("16×", { exact: true }).click(); await wait(300);
  await glide(1700, 900, 2);
  await record("fete", async (mark) => {
    mark("start"); await wait(13000); mark("3d-late");
    await glideClick(page.getByTestId("view-2d")); mark("2d"); await wait(9000);
    await page.getByTestId("play").click().catch(() => {}); mark("paused"); await wait(600);
    await glideClick(page.getByTestId("open-stats")); mark("stats"); await wait(3500);
    await glide(1700, 500); await smoothScroll(500, 30); mark("stats-scrolled"); await wait(3000);
    mark("end");
  });
}

if (CLIPS.includes("live")) {
  await page.goto(B + "/live"); await page.getByTestId("incident-state").waitFor({ timeout: 30000 });
  await page.getByTestId("ctl-reset").click().catch(() => {}); await wait(3000);
  await glide(700, 300, 2);
  await record("live", async (mark) => {
    mark("start"); await wait(800);
    await glideClick(page.getByTestId("ctl-start_fire")); mark("fire");
    await page.getByTestId("approve").waitFor({ timeout: 120000 }); mark("proposed"); await wait(2500);
    await glideTo(page.getByTestId("approve")); await wait(900);
    await glideClick(page.getByTestId("approve")); mark("approved"); await wait(3500);
    await glideClick(page.getByTestId("ctl-inject_bad_plan")); mark("inject");
    await page.getByTestId("override-reason").waitFor({ timeout: 120000 }); mark("blocked"); await wait(1500);
    await glideTo(page.getByTestId("override-reason")); await wait(4000);
    mark("end");
  });
}
await browser.close();
