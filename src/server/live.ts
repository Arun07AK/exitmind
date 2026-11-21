import { existsSync, mkdirSync } from "node:fs";
import type { Express } from "express";
import QRCode from "qrcode";
import type { WebSocket } from "ws";
import { ClaudeClient } from "../llm/claude.ts";
import { Pool, type Evaluator } from "../design/pool.ts";
import { isOffline } from "../shared/env.ts";
import { repoPath } from "../shared/paths.ts";
import type { SimEnv } from "../sim/run.ts";
import { LiveSession, type Control } from "../live/session.ts";
import type { Channels } from "./channels.ts";
import { FrameEncoder } from "./frames.ts";

export const LIVE_CHANNEL = "live";

export function mountLive(app: Express, simEnv: SimEnv, channels: Channels, opts: { port: number; lan: string; demo: boolean; evaluator?: Evaluator; logDir?: string }) {
  const lan = `http://${opts.lan}:${opts.port}`;
  const evaluator = opts.evaluator ?? new Pool({ size: Math.max(2, Math.min(9, simEnv.runtime.design.workers)), twin: simEnv.twin, mode: existsSync(repoPath("data", "policy", "distilled.policy.json")) ? "distilled" : "rule" });
  const logDir = opts.logDir ?? repoPath("runs", "live");
  mkdirSync(logDir, { recursive: true });
  let session!: LiveSession;
  let enc!: FrameEncoder;
  let timer: NodeJS.Timeout | null = null;
  let pushTimer: NodeJS.Timeout | null = null;
  let lastLogSeq = 0;
  const signSockets = new Set<WebSocket>();

  const pushState = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      channels.broadcast({ type: "live", state: session.state(LIVE_CHANNEL, isOffline()) });
      const lines = session.logLines(lastLogSeq);
      if (lines.length) { lastLogSeq = lines.at(-1)!.seq; channels.broadcast({ type: "log", records: lines }); }
    }, 150);
  };

  const start = () => {
    if (timer) clearInterval(timer);
    const id = `S${Date.now().toString(36)}`;
    session = new LiveSession({ simEnv, evaluator, claude: new ClaudeClient({ sink: (r) => session?.log.append({ tick: session.tick, actor: r.role === "planner" ? "planner" : r.role === "liaison" ? "liaison" : "orchestrator", type: "llm.call", payload: { provider: r.provider, role: r.role, model: r.model, outcome: r.outcome, latencyMs: r.latencyMs, ...(r.error ? { error: r.error.slice(0, 200) } : {}) } }) }), logPath: `${logDir}/${id}.jsonl`, sessionId: id, lan });
    session.onUpdate = pushState;
    enc = new FrameEncoder(LIVE_CHANNEL);
    lastLogSeq = 0;
    for (const ws of signSockets) ws.close();
    const ticksPerFrame = 4;
    const frameMs = (ticksPerFrame * simEnv.runtime.sim.dtSec * 1000) / session.cfg.speed;
    timer = setInterval(() => {
      for (let k = 0; k < ticksPerFrame; k++) session.step();
      channels.publish(LIVE_CHANNEL, enc.encode(session.truth));
      if (session.tick % 8 === 0) pushState();
    }, frameMs);
    timer.unref?.();
    pushState();
  };
  start();

  app.get("/api/live/state", (_req, res) => res.json(session.state(LIVE_CHANNEL, isOffline())));
  app.get("/api/live/log", (req, res) => res.json(session.logLines(Number(req.query.since ?? 0))));
  app.get("/api/live/brief", (_req, res) => res.json(session.brief));
  app.get("/api/live/report", (_req, res) => (session.report ? res.json(session.report) : res.status(404).json({ error: "no report yet: press All clear" })));
  app.get("/api/live/records", (_req, res) => res.json(session.log.records()));
  app.post("/api/live/control", (req, res) => {
    const body = req.body as Control | { action: "reset" };
    if (body.action === "reset") { start(); return void res.json({ ok: true, sessionId: session.id }); }
    const r = session.control(body as Control);
    res.status(r.ok ? 200 : 400).json(r);
  });
  app.post("/api/live/decision", (req, res) => {
    const b = req.body as { id: string; verdict: "approve" | "reject"; reason?: string };
    const r = session.decide(String(b.id), b.verdict === "reject" ? "reject" : "approve", b.reason);
    res.status(r.ok ? 200 : 400).json(r);
  });
  app.get("/api/signs/qr", async (req, res) => {
    const mount = String(req.query.mount ?? "");
    if (!simEnv.model.mounts.some((m) => m.id === mount)) return void res.status(404).end();
    res.type("image/svg+xml").send(await QRCode.toString(`${lan}/sign?mount=${encodeURIComponent(mount)}`, { type: "svg", margin: 1 }));
  });

  return {
    get session() { return session; },
    onClient: (ws: WebSocket) => { ws.send(JSON.stringify({ type: "live", state: session.state(LIVE_CHANNEL, isOffline()) })); },
    onSign: (ws: WebSocket) => { signSockets.add(ws); ws.on("close", () => signSockets.delete(ws)); session.hub.attach(ws, () => session.tick, session.dt); },
    stop: async () => { if (timer) clearInterval(timer); await evaluator.close(); },
  };
}
