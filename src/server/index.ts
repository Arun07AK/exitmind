import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import express from "express";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { codeCheck } from "../design/codecheck.ts";
import { nl2params } from "../design/nl2params.ts";
import { Pool, makeEvaluator } from "../design/pool.ts";
import { setExitCandidates } from "../design/prepare.ts";
import { recommend } from "../design/recommend.ts";
import { env, isOffline } from "../shared/env.ts";
import { repoPath } from "../shared/paths.ts";
import { BADNESS_FORMULA, loadEnv, type SimEnv } from "../sim/run.ts";
import { isVenue, listVenues, loadVenue, type VenueId } from "../twin/build.ts";
import { scenarioAgent } from "../scenario/agent.ts";
import { buildScenario } from "../scenario/build.ts";
import { venueInfo } from "../scenario/spec.ts";
import { ClaudeClient } from "../llm/claude.ts";
import { architect } from "../optimise/architect.ts";
import { DraftSchema, draftToTwin, suggestDoors } from "../plans/draft.ts";
import { MAX_UPLOAD_BYTES, listPlans, planDir, readDraft, readMeta, storePlan, writeDraft } from "../plans/store.ts";
import { checkDraft, tracePlan } from "../plans/trace.ts";
import type { Scenario } from "../sim/types.ts";
import { parseScenario } from "../sim/scenario.ts";
import { loadCandidates } from "../twin/candidates.ts";
import { Channels } from "./channels.ts";
import type { ClientMsg, ScenarioChatReply, ScenarioTurn, SimRunRequest } from "./contract.ts";
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
  const scenarioClaude = new ClaudeClient();
  let pool: Pool | null = null;
  let recommending = false;

  app.get("/api/meta", (_req, res) => {
    res.json({ offline: isOffline(), personaBackend: env("PERSONA_BACKEND") ?? "haiku", anthropicKey: !!env("ANTHROPIC_API_KEY"), typesafeKey: !!env("TYPESAFE_API_KEY"), twinHash: simEnv.twin.hash, lan: `http://${lanAddress()}:${opts.port}`, badnessFormula: BADNESS_FORMULA, targets: simEnv.runtime.design.targets, libraries: LIBRARIES });
  });
  const envs = new Map<string, SimEnv>([["rinker-hall", simEnv]]);
  const grids = new Map<string, ReturnType<typeof gridInfo>>([["rinker-hall", grid]]);
  const venueOf = (v: unknown): VenueId => (isVenue(v) ? v : "rinker-hall");
  const envFor = (v: VenueId): SimEnv => { let e = envs.get(v); if (!e) { e = loadEnv(loadVenue(v)); envs.set(v, e); } return e; };
  const gridFor = (v: VenueId) => { let g = grids.get(v); if (!g) { g = gridInfo({ m: envFor(v).model }); grids.set(v, g); } return g; };
  const venueList = () => listVenues().map((v) => venueInfo(v, envFor(v).twin));
  app.get("/api/twin", (req, res) => res.json(envFor(venueOf(req.query.venue)).twin));
  app.get("/api/grid", (req, res) => res.json(gridFor(venueOf(req.query.venue))));
  app.get("/api/venues", (_req, res) => res.json(venueList()));
  const architectFile = (v: string) => repoPath("data", "design", v === "rinker-hall" ? "architect.json" : `architect-${v}.json`);
  const job: { running: boolean; venue: string | null; log: string[]; error: string | null; finishedAt: string | null } = { running: false, venue: null, log: [], error: null, finishedAt: null };
  app.get("/api/architect/report", (req, res) => {
    const f = architectFile(venueOf(req.query.venue));
    if (!existsSync(f)) return void res.status(404).json({ error: "no architectural analysis for this venue yet" });
    res.type("json").send(readFileSync(f, "utf8"));
  });
  app.get("/api/architect/status", (_req, res) => res.json({ ...job, log: job.log.slice(-40) }));
  app.post("/api/architect/run", (req, res) => {
    if (job.running) return void res.status(409).json({ error: `an analysis is already running for ${job.venue}` });
    const v = venueOf((req.body as { venue?: unknown } | undefined)?.venue);
    Object.assign(job, { running: true, venue: v, log: [], error: null, finishedAt: null });
    const t0 = Date.now();
    const e = envFor(v);
    const ev = makeEvaluator({ twin: e.twin, mode: existsSync(repoPath("data", "policy", "distilled.policy.json")) ? "distilled" : "rule" });
    void architect(e, ev, scenarioClaude, { log: (l) => job.log.push(`[${Math.round((Date.now() - t0) / 1000)} s] ${l}`) })
      .then((r) => { writeFileSync(architectFile(v), JSON.stringify(r)); job.log.push(`done in ${Math.round((Date.now() - t0) / 1000)} s`); })
      .catch((err: unknown) => { job.error = String(err instanceof Error ? err.message : err); })
      .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); void ev.close(); });
    res.json({ started: true, venue: v });
  });
  app.post("/api/plans", express.raw({ type: ["application/pdf", "image/png", "image/jpeg"], limit: MAX_UPLOAD_BYTES }), (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error("send the plan file as the request body (PDF, PNG or JPEG)");
      const meta = storePlan(req.body, String(req.headers["content-type"] ?? ""), String(req.query.name ?? "Uploaded plan"), Math.max(1, Number(req.query.page ?? 1) || 1));
      res.json({ ...meta, draft: readDraft(meta.id) });
    } catch (e) { res.status(400).json({ error: String(e instanceof Error ? e.message : e) }); }
  });
  app.get("/api/plans", (_req, res) => res.json(listPlans()));
  app.get("/api/plans/:id", (req, res) => {
    try { const id = String(req.params.id); res.json({ ...readMeta(id), draft: readDraft(id) }); } catch (e) { res.status(404).json({ error: String(e) }); }
  });
  app.get("/api/plans/:id/image", (req, res) => {
    try { res.type("png").send(readFileSync(planDir(String(req.params.id), "plan.png"))); } catch { res.status(404).end(); }
  });
  app.post("/api/plans/:id/trace", async (req, res) => {
    try {
      const meta = readMeta(String(req.params.id));
      const r = await tracePlan(meta, scenarioClaude, { scaleFtPerPx: (req.body as { ftPerPx?: number } | undefined)?.ftPerPx ?? null });
      writeDraft(meta.id, r.draft);
      res.json(r);
    } catch (e) { res.status(400).json({ error: String(e instanceof Error ? e.message : e) }); }
  });
  app.post("/api/plans/:id/check", (req, res) => {
    try {
      const meta = readMeta(String(req.params.id));
      const d = DraftSchema.parse((req.body as { draft: unknown }).draft);
      res.json(checkDraft(d, meta));
    } catch (e) { res.status(400).json({ error: String(e instanceof Error ? e.message : e) }); }
  });
  app.post("/api/plans/:id/suggest-doors", (req, res) => {
    try {
      const meta = readMeta(String(req.params.id));
      const d = DraftSchema.parse((req.body as { draft: unknown }).draft);
      res.json({ doors: suggestDoors(d, meta, loadEnv(draftToTwin(d, meta)).model) });
    } catch (e) { res.status(400).json({ error: String(e instanceof Error ? e.message : e) }); }
  });
  app.post("/api/plans/:id/save", (req, res) => {
    try {
      const body = req.body as { draft: unknown; name?: string };
      const meta0 = readMeta(String(req.params.id));
      const meta = { ...meta0, name: (body.name ?? meta0.name).trim().slice(0, 80) || meta0.name };
      const d = DraftSchema.parse(body.draft);
      const check = checkDraft(d, meta);
      if (check.errors.length) return void res.status(400).json({ error: "the plan does not pass the checks yet", ...check });
      const twin = draftToTwin(d, meta);
      writeDraft(meta.id, d);
      writeFileSync(planDir(meta.id, "meta.json"), JSON.stringify(meta, null, 1));
      writeFileSync(planDir(meta.id, "twin.json"), `${JSON.stringify(twin, null, 1)}\n`);
      envs.delete(twin.id); grids.delete(twin.id);
      res.json({ venue: twin.id, hash: twin.hash, ...check });
    } catch (e) { res.status(400).json({ error: String(e instanceof Error ? e.message : e) }); }
  });
  app.post("/api/scenario/chat", async (req, res) => {
    try {
      const prefer = (req.body as { venue?: unknown }).venue;
      const turns = ((req.body as { messages?: ScenarioTurn[] }).messages ?? []).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string").slice(-20).map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));
      const r = await scenarioAgent(turns, venueList(), scenarioClaude, isVenue(prefer) ? prefer : null);
      const venue = venueOf(r.spec.venue ?? "rinker-hall");
      const e = envFor(venue);
      let scenario: Scenario | null = null, crowd: ScenarioChatReply["crowd"] = null;
      const assumptions = [...r.assumptions];
      if (r.status === "ready") {
        const b = buildScenario(r.spec, e.model, e.params, e.profiles, 1);
        scenario = parseScenario(b.scenario);
        crowd = { size: b.crowd.size, ages: b.crowd.ages as Record<string, number>, roles: b.crowd.roles as Record<string, number> };
        for (const a of b.assumptions) if (!assumptions.some((x) => x.slice(0, 40) === a.slice(0, 40))) assumptions.push(a);
        if (e.twin.venue) for (const a of e.twin.venue.assumptions) assumptions.push(`Venue: ${a}`);
      }
      const reply: ScenarioChatReply = { status: r.status, missing: r.missing, questions: r.questions, assumptions, summary: r.summary, source: r.source, model: r.model, ...(r.note ? { note: r.note } : {}), venue, venueLabel: e.twin.venue?.label ?? e.twin.name, attribution: e.twin.venue?.attribution ?? null, scenario, crowd };
      res.json(reply);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });
  app.get("/api/codecheck", (_req, res) => res.json((code ??= codeCheck(simEnv.twin, simEnv.model))));
  app.post("/api/sim/run", (req, res) => {
    try {
      const body = req.body as SimRunRequest;
      const scenario = parseScenario(body.scenario);
      const venue = venueOf(body.venue);
      const { channel } = startSimRun(envFor(venue), channels, { scenario, mode: body.mode ?? "rule", speed: Number(body.speed ?? 4), venue });
      res.json({ channel, venue });
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
    app.get(/^\/(live|report|simulate|optimise|plans)?(\/[\w-]+)?$/, (_req, res) => res.sendFile(`${web}/index.html`));
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
