// Records a captioned walkthrough of the three EXITMIND demos (offline mode).
// Needs the redesign-api (8091, EXITMIND_OFFLINE=1) and redesign-web (5174) servers running.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const B = "http://localhost:5174", API = "http://localhost:8091", DIR = process.argv[2] ?? "runs/demo-video";
fs.mkdirSync(DIR, { recursive: true });
const W = 1600, H = 900;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: DIR, size: { width: W, height: H } } });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", s);

const card = (title, sub, foot) => page.setContent(`<html><body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;background:#0E1013;color:#F2EEE6;font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:center">
  <div style="font-size:22px;letter-spacing:.3em;color:#39C18B;margin-bottom:18px">${foot}</div>
  <div style="font-size:92px;font-weight:700;letter-spacing:.02em">${title}</div>
  <div style="font-size:30px;max-width:1150px;line-height:1.4;margin-top:22px;color:#cfcac0">${sub}</div></body></html>`);

async function cap(step, text) {
  await page.evaluate(([step, text]) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div"); el.id = "__cap";
      el.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;max-width:1240px;width:max-content;background:rgba(14,16,19,.88);color:#F2EEE6;font:500 21px/1.45 -apple-system,Helvetica,Arial,sans-serif;padding:14px 22px;border-radius:10px;border-left:6px solid #E2432A;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font:700 14px/1 -apple-system,Helvetica,Arial,sans-serif;letter-spacing:.18em;color:#39C18B;margin-bottom:7px">${step}</div>${text}`;
  }, [step, text]);
}
const speed = (s) => page.getByTestId("speed").getByText(`${s}×`, { exact: true }).click();

// 0 · title
await card("EXITMIND", "A crash test for crowds, run before the event and again during it.<br>The AI decides, a simulation tries to break the decision, and a human approves.", "TEAM PIED PIPER · SATHACK · SATURNALIA '26");
await wait(7000); log("title");

// 1 · Simulate: Rinker Hall
await page.goto(B + "/"); await page.getByTestId("building3d").waitFor({ timeout: 30000 });
await cap("1 · SIMULATE · RINKER HALL", "A three-storey university building, traced from its construction drawings into a digital twin.<br>Every dot is one person. The simulator moves everyone on a 0.4 m grid in 0.25 s steps.");
await speed(8); await wait(13000);
await page.getByTestId("view-2d").click(); await wait(400);
await cap("1 · SIMULATE · 2D FLOW", "The same run as a flow map: where people walk and where they queue.");
await wait(7000); log("rinker");

// 2 · Saturnalia Fete Area with the AI crowd
const chat = JSON.parse(fs.readFileSync("docs/demo/scenario-saturnalia.json", "utf8"));
const r = await fetch(API + "/api/sim/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: chat.scenario, mode: "crowd", venue: "thapar-fete", speed: 0 }) }).then((x) => x.json());
await page.goto(`${B}/?channel=${encodeURIComponent(r.channel)}`); await page.getByTestId("building3d").waitFor({ timeout: 30000 });
await cap("2 · SATURNALIA · THAPAR FETE AREA", "Our real Fete Area, built from OpenStreetMap. Claude Opus turns one sentence into a full scenario.<br>Every person has a profile: student or staff, first-timer or regular, and the gate they came in through.");
await speed(16); await wait(12000);
await page.getByTestId("view-2d").click(); await wait(400);
await cap("2 · SATURNALIA · AI CROWD", "An AI crowd brain decides how each group reacts: first-timers head back to the gate they came in through.<br>Offline, as in this recording, it uses a policy distilled from recorded Claude Haiku decisions.");
await wait(10000); log("fete");

// 3 · Optimise: architectural changes
await page.goto(B + "/optimise"); await page.getByTestId("arch-numbers").waitFor({ timeout: 30000 }); await wait(1500);
await cap("3 · OPTIMISE · FIND THE WORST CASE", "An adversary searches for the fire that hurts most: 82.5 of 547 people still inside at 10 minutes.<br>Red patch H1 is the cause: the south stair exit carries 25% of everyone on 7% of the exit capacity.");
await wait(10000);
await page.getByText("After A1", { exact: true }).click(); await wait(400);
await cap("3 · OPTIMISE · FIX IT", "EXITMIND turns the diagnosis into construction options (wider doors, new exits, an external stair),<br>and Claude Opus proposes its own. Every option is built and simulated on the same crowds.");
await wait(8000);
await page.getByText("Difference", { exact: true }).click(); await wait(400);
await cap("3 · OPTIMISE · RESULT", "392 simulations across 49 alternatives. Safe capacity: 362 → 556 people,<br>with everyone out in all eight test runs.");
await wait(9000); log("optimise");

// 4 · Live: three keys
await page.goto(B + "/live"); await page.getByTestId("incident-state").waitFor({ timeout: 30000 });
await page.getByTestId("ctl-reset").click().catch(() => {}); await wait(2000);
await cap("4 · LIVE · THREE KEYS", "Fire on the second floor. An AI planner proposes a response, but no sign changes until three keys turn:<br>the AI decides, a simulation tries to break the decision, and a human approves.");
await page.getByTestId("ctl-start_fire").click();
await page.getByTestId("approve").waitFor({ timeout: 90000 }); await wait(5000);
await page.getByTestId("approve").click(); await wait(400);
await cap("4 · LIVE · APPROVED", "The plan passed its simulation check, and a human approved it. The signs update.");
await wait(5000);
await page.getByTestId("ctl-inject_bad_plan").click(); await wait(400);
await cap("4 · LIVE · A CONFIDENTLY WRONG PLAN", "Now a plan that sounds sensible: shut the ground-floor doors to contain the smoke.");
await page.getByTestId("override-reason").waitFor({ timeout: 90000 }); await wait(1000);
await cap("4 · LIVE · BLOCKED", "The simulation shows gridlock, so approval is blocked.<br>Overriding it takes a typed reason, written to a log nobody can quietly edit.");
await wait(10000); log("live");

// 5 · end
await card("EXITMIND", "Real today: simulator, digital twins, AI crowd, architectural optimiser, live three-key gate.<br>Next: exit-node hardware (sensors, ESP-NOW and LoRa mesh).", "GITHUB.COM/ARUN07AK/EXITMIND");
await wait(6000); log("end");

const vpath = await page.video().path();
await ctx.close(); await browser.close();
console.log("VIDEO", vpath);
