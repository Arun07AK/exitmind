import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import express from "express";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { codeCheck } from "../design/codecheck.ts";
import { nl2params } from "../design/nl2params.ts";
import { Pool } from "../design/pool.ts";
import { setExitCandidates } from "../design/prepare.ts";
import { recommend } from "../design/recommend.ts";
import { env, isOffline } from "../shared/env.ts";
import { repoPath } from "../shared/paths.ts";
import { BADNESS_FORMULA, loadEnv } from "../sim/run.ts";
import { parseScenario } from "../sim/scenario.ts";
import { loadCandidates } from "../twin/candidates.ts";
import { Channels } from "./channels.ts";
import type { ClientMsg, SimRunRequest } from "./contract.ts";
import { gridInfo } from "./frames.ts";
import { runInfo, startSimRun } from "./simrunner.ts";
import { mountLive } from "./live.ts";
import { scenarioPresets } from "./presets.ts";

const RecommendBody = z.strictObject({ seeds: z.array(z.number().int().min(0)).min(1).max(32).optional() });

const LIBRARIES = Object.entries((JSON.parse(readFileSync(repoPath("package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies).map(([k, v]) => `${k}@${v}`);

export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  return "127.0.0.1";
}

export function createApp(opts: { port: number; demo?: boolean }) {
  const simEnv = loadEnv();
  const channels = new Channels();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const grid = gridInfo({ m: simEnv.model });
  let code: ReturnType<typeof codeCheck> | null = null;
  let pool: Pool | null = null;
  let recommending = false;

  app.get("/api/meta", (_req, res) => {
    res.json({ offline: isOffline(), personaBackend: env("PERSONA_BACKEND") ?? "haiku", anthropicKey: !!env("ANTHROPIC_API_KEY"), typesafeKey: !!env("TYPESAFE_API_KEY"), twinHash: simEnv.twin.hash, lan: `http://${lanAddress()}:${opts.port}`, badnessFormula: BADNESS_FORMULA, targets: simEnv.runtime.design.targets, libraries: LIBRARIES });
  });
  app.get("/api/twin", (_req, res) => res.json(simEnv.twin));
  app.get("/api/grid", (_req, res) => res.json(grid));
  app.get("/api/codecheck", (_req, res) => res.json((code ??= codeCheck(simEnv.twin, simEnv.model))));
  app.post("/api/sim/run", (req, res) => {
    try {
      const body = req.body as SimRunRequest;
      const scenario = parseScenario(body.scenario);
      const { channel } = startSimRun(simEnv, channels, { scenario, mode: body.mode ?? "rule", speed: Number(body.speed ?? 4) });
      res.json({ channel });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });
  app.get("/api/sim/runs/:channel", (req, res) => {
    const info = runInfo.get(String(req.params.channel));
    if (!info) return void res.status(404).json({ error: "unknown or expired run" });
    res.json(info);
  });
  app.get("/api/design/:name", (req, res) => {
    const name = String(req.params.name).replace(/[^a-z]/g, "");
    const file = repoPath("data", "design", `${name}.json`);
    if (!existsSync(file)) return void res.status(404).json({ error: `${name} not generated yet` });
    res.type("json").send(readFileSync(file, "utf8"));
  });
  app.post("/api/design/recommend", async (req, res) => {
    const body = RecommendBody.safeParse(req.body ?? {});
    if (!body.success) return void res.status(400).json({ error: z.prettifyError(body.error) });
    if (recommending) return void res.status(409).json({ error: "a recommend run is already in progress" });
    recommending = true;
    try {
      if (!pool) { setExitCandidates(loadCandidates()); pool = new Pool({ size: simEnv.runtime.design.workers, twin: simEnv.twin }); }
      const r = await recommend(simEnv, pool, body.data.seeds ? { seeds: body.data.seeds } : {});
      writeFileSync(repoPath("data", "design", "recommend.json"), `${JSON.stringify(r, null, 1)}\n`);
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    } finally {
      recommending = false;
    }
  });
  app.get("/api/scenarios/presets", (_req, res) => res.json(scenarioPresets()));
  app.post("/api/nl2params", async (req, res) => {
    try { res.json(await nl2params(String((req.body as { text?: string }).text ?? ""), simEnv)); } catch (e) { res.status(400).json({ error: String(e) }); }
  });
  const live = mountLive(app, simEnv, channels, { port: opts.port, lan: lanAddress(), demo: !!opts.demo });

  const web = repoPath("dist", "web");
  if (existsSync(web)) {
    app.get("/sign", (_req, res) => res.sendFile(`${web}/sign.html`));
    app.use(express.static(web));
    app.get(/^\/(live|report|simulate|optimise)?(\/[\w-]+)?$/, (_req, res) => res.sendFile(`${web}/index.html`));
  }

  const server = createServer(app);
  server.on("close", () => void pool?.close());
  const wss = new WebSocketServer({ noServer: true });
  const signWss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/ws") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    else if (path === "/ws/sign") signWss.handleUpgrade(req, socket, head, (ws) => signWss.emit("connection", ws));
    else socket.destroy();
  });
  wss.on("connection", (ws) => {
    channels.attach(ws);
    live.onClient(ws);
    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)) as ClientMsg; } catch { return; }
      if (msg.type === "subscribe") channels.subscribe(ws, msg.channel);
      else if (msg.type === "unsubscribe") channels.unsubscribe(ws, msg.channel);
    });
  });
  signWss.on("connection", (ws) => live.onSign(ws));
  return { app, server, channels, live, simEnv };
}

if (import.meta.main) {
  const port = Number(env("PORT") ?? 8080);
  const demo = process.argv.includes("--demo");
  const { server } = createApp({ port, demo });
  server.listen(port, "0.0.0.0", () => {
    console.log(`EXITMIND server on http://localhost:${port}  (LAN: http://${lanAddress()}:${port})  offline=${isOffline()}`);
    if (!existsSync(repoPath("dist", "web"))) console.log("web app not built: run `npm run build:web` (or `npm run dev:web` for the Vite dev server)");
  });
}
