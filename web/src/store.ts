import { create } from "zustand";
import type { ClientMsg, FrameMsg, HazardFrame, LiveState, LogLine, PersonaMsg, ServerMsg, SummaryMsg } from "../../src/server/contract.ts";

export type WsStatus = "connecting" | "open" | "closed";

export interface SeriesPoint {
  tick: number;
  t: number;
  protected: number;
  remaining: number;
}

export interface Store {
  status: WsStatus;
  channel: string | null;
  frameA: FrameMsg | null;
  frameB: FrameMsg | null;
  alpha: number;
  frameMs: number;
  hazard: HazardFrame | null;
  series: SeriesPoint[];
  personas: PersonaMsg[];
  summary: SummaryMsg | null;
  live: LiveState | null;
  log: LogLine[];
  badnessFormula: string | null;
  setChannel: (channel: string | null) => void;
  setLive: (s: LiveState) => void;
  addLog: (records: LogLine[]) => void;
  clearLog: () => void;
}

const MAX_PERSONAS = 50;
const MAX_LOG = 400;
const MAX_SERIES = 4000;

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer = 0;
let lastArrival = 0;
const subs = new Map<string, number>();

function send(msg: ClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function subscribeChannel(channel: string): () => void {
  const n = subs.get(channel) ?? 0;
  subs.set(channel, n + 1);
  if (n === 0) send({ type: "subscribe", channel });
  return () => {
    const k = (subs.get(channel) ?? 1) - 1;
    if (k <= 0) {
      subs.delete(channel);
      send({ type: "unsubscribe", channel });
    } else subs.set(channel, k);
  };
}

let unsubFrames: (() => void) | null = null;

export const useStore = create<Store>()((set, get) => ({
  status: "connecting",
  channel: null,
  frameA: null,
  frameB: null,
  alpha: 1,
  frameMs: 250,
  hazard: null,
  series: [],
  personas: [],
  summary: null,
  live: null,
  log: [],
  badnessFormula: null,
  setChannel: (channel) => {
    if (get().channel === channel) return;
    unsubFrames?.();
    unsubFrames = channel ? subscribeChannel(channel) : null;
    set({ channel, frameA: null, frameB: null, alpha: 1, hazard: null, series: [], personas: [], summary: null });
  },
  setLive: (live) => set({ live }),
  addLog: (records) => {
    if (!records.length) return;
    const seen = new Set(get().log.map((l) => l.seq));
    const add = records.filter((r) => !seen.has(r.seq));
    if (!add.length) return;
    set({ log: [...get().log, ...add].sort((a, b) => a.seq - b.seq).slice(-MAX_LOG) });
  },
  clearLog: () => set({ log: [] }),
}));

function onFrame(msg: FrameMsg): void {
  const s = useStore.getState();
  if (msg.channel !== s.channel) return;
  const now = performance.now();
  const prev = s.frameB;
  const patch: Partial<Store> = {};
  if (msg.hazard) patch.hazard = msg.hazard;
  if (!prev || msg.tick < prev.tick) {
    Object.assign(patch, { frameA: msg, frameB: msg, alpha: 1 });
    if (prev) patch.series = [];
  } else if (msg.tick === prev.tick) {
    Object.assign(patch, { frameB: msg, frameA: s.frameA === prev ? msg : s.frameA });
  } else {
    const dt = now - lastArrival;
    if (lastArrival > 0 && dt > 0 && dt < 5000) patch.frameMs = Math.min(2000, Math.max(50, s.frameMs * 0.7 + dt * 0.3));
    Object.assign(patch, { frameA: prev, frameB: msg, alpha: 0 });
  }
  lastArrival = now;
  const series = patch.series ?? s.series;
  const last = series[series.length - 1];
  if (!last || last.tick !== msg.tick) patch.series = [...series, { tick: msg.tick, t: msg.t, protected: msg.metrics.protected, remaining: msg.metrics.remaining }].slice(-MAX_SERIES);
  useStore.setState(patch);
}

function onMessage(msg: ServerMsg): void {
  const s = useStore.getState();
  switch (msg.type) {
    case "frame":
      onFrame(msg);
      break;
    case "persona":
      if (msg.channel === s.channel) useStore.setState({ personas: [...s.personas, msg].slice(-MAX_PERSONAS) });
      break;
    case "summary":
      if (msg.channel === s.channel) useStore.setState({ summary: msg, badnessFormula: msg.badnessFormula });
      else useStore.setState({ badnessFormula: msg.badnessFormula });
      break;
    case "live":
      s.setLive(msg.state);
      break;
    case "log":
      s.addLog(msg.records);
      break;
  }
}

export function connectWs(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  useStore.setState({ status: "connecting" });
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    useStore.setState({ status: "open" });
    for (const channel of subs.keys()) send({ type: "subscribe", channel });
  };
  sock.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return;
    try {
      onMessage(JSON.parse(ev.data) as ServerMsg);
    } catch {
      /* ignore malformed message */
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    useStore.setState({ status: "closed" });
    window.clearTimeout(retryTimer);
    const delay = Math.min(8000, 500 * 2 ** retry++);
    retryTimer = window.setTimeout(connectWs, delay);
  };
  sock.onerror = () => sock.close();
}

function animate(): void {
  const s = useStore.getState();
  if (s.frameB && s.alpha < 1) {
    const a = Math.min(1, (performance.now() - lastArrival) / s.frameMs);
    if (a !== s.alpha) useStore.setState({ alpha: a });
  }
  requestAnimationFrame(animate);
}

let started = false;
export function startStore(): void {
  if (started) return;
  started = true;
  connectWs();
  requestAnimationFrame(animate);
}
