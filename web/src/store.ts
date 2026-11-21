import { create } from "zustand";
import type { ClientMsg, FrameMsg, HazardFrame, LiveState, LogLine, PersonaMsg, ServerMsg, SummaryMsg } from "../../src/server/contract.ts";

export type WsStatus = "connecting" | "open" | "closed";

/** Everything received on one channel. Simulation channels replay their whole history on subscribe, so a run is complete once `done`. */
export interface Run {
  channel: string;
  frames: FrameMsg[];
  hazards: { tick: number; h: HazardFrame }[];
  personas: PersonaMsg[];
  summary: SummaryMsg | null;
  done: boolean;
}

export interface Store {
  status: WsStatus;
  /** the run the page is showing; views read it through the playhead */
  channel: string | null;
  runs: Record<string, Run>;
  /** bumps whenever any run buffer changes */
  runVersion: number;
  /** playhead in simulated seconds, shared by every view */
  t: number;
  playing: boolean;
  speed: number;
  /** follow the newest frame (live feeds) instead of playing a buffered run */
  follow: boolean;
  /** frame at or before the playhead, the next frame, and the fraction between them */
  frame: FrameMsg | null;
  frameA: FrameMsg | null;
  frameB: FrameMsg | null;
  alpha: number;
  hazard: HazardFrame | null;
  personas: PersonaMsg[];
  summary: SummaryMsg | null;
  live: LiveState | null;
  log: LogLine[];
  badnessFormula: string | null;
  setChannel: (channel: string | null, opts?: { follow?: boolean; autoplay?: boolean }) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  setLive: (s: LiveState) => void;
  addLog: (records: LogLine[]) => void;
  clearLog: () => void;
}

const MAX_PERSONAS = 200;
const MAX_LOG = 400;
const MAX_STREAM_FRAMES = 300;

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer = 0;
const subs = new Map<string, number>();
const runs: Record<string, Run> = {};
let version = 0;
let lastArrival = 0;
let arrivalMs = 1000;

function send(msg: ClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Ref-counted subscription; the run buffer for the channel fills as messages arrive. */
export function subscribeChannel(channel: string): () => void {
  const n = subs.get(channel) ?? 0;
  subs.set(channel, n + 1);
  if (n === 0) {
    delete runs[channel];
    send({ type: "subscribe", channel });
  }
  return () => {
    const k = (subs.get(channel) ?? 1) - 1;
    if (k <= 0) {
      subs.delete(channel);
      send({ type: "unsubscribe", channel });
    } else subs.set(channel, k);
  };
}

export function getRun(channel: string | null): Run | null {
  return channel ? runs[channel] ?? null : null;
}

/** index of the last frame with t <= time (0 when time is before the first frame) */
export function frameIndexAt(frames: readonly FrameMsg[], time: number): number {
  let lo = 0, hi = frames.length - 1;
  if (hi < 0) return -1;
  if (time >= frames[hi]!.t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.t <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function hazardAt(run: Run, tick: number): HazardFrame | null {
  let h: HazardFrame | null = null;
  for (const x of run.hazards) {
    if (x.tick > tick) break;
    h = x.h;
  }
  return h;
}

/** Frames around a time for any run, so a second view (Optimise compare) can share the global playhead. */
export function sampleRun(run: Run | null, time: number): { a: FrameMsg; b: FrameMsg; alpha: number } | null {
  if (!run || !run.frames.length) return null;
  const i = frameIndexAt(run.frames, time);
  const a = run.frames[Math.max(0, i)]!;
  const b = run.frames[Math.min(run.frames.length - 1, i + 1)]!;
  const span = b.t - a.t;
  return { a, b, alpha: span > 0 ? Math.max(0, Math.min(1, (time - a.t) / span)) : 0 };
}

let unsubMain: (() => void) | null = null;

export const useStore = create<Store>()((set, get) => ({
  status: "connecting",
  channel: null,
  runs,
  runVersion: 0,
  t: 0,
  playing: false,
  speed: 4,
  follow: false,
  frame: null,
  frameA: null,
  frameB: null,
  alpha: 1,
  hazard: null,
  personas: [],
  summary: null,
  live: null,
  log: [],
  badnessFormula: null,
  setChannel: (channel, opts) => {
    if (get().channel === channel) return;
    unsubMain?.();
    unsubMain = channel ? subscribeChannel(channel) : null;
    set({ channel, t: 0, playing: opts?.autoplay ?? true, follow: opts?.follow ?? !channel?.startsWith("sim:"), frame: null, frameA: null, frameB: null, alpha: 1, hazard: null, personas: [], summary: null });
  },
  play: () => {
    const s = get();
    const run = getRun(s.channel);
    const end = run?.frames.at(-1)?.t ?? 0;
    if (run?.done && s.t >= end) set({ t: 0 });
    set({ playing: true });
  },
  pause: () => set({ playing: false }),
  togglePlay: () => (get().playing ? get().pause() : get().play()),
  seek: (t) => set({ t: Math.max(0, t), follow: false }),
  setSpeed: (speed) => set({ speed }),
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

function runFor(channel: string): Run {
  return (runs[channel] ??= { channel, frames: [], hazards: [], personas: [], summary: null, done: false });
}

function onFrame(msg: FrameMsg): void {
  if (!subs.has(msg.channel)) return;
  const run = runFor(msg.channel);
  const last = run.frames.at(-1);
  if (last && msg.tick < last.tick) {
    run.frames = []; run.hazards = []; run.personas = []; run.summary = null; run.done = false;
    if (useStore.getState().channel === msg.channel) useStore.setState({ t: 0 });
  }
  if (last && msg.tick === last.tick) run.frames[run.frames.length - 1] = msg;
  else run.frames.push(msg);
  if (msg.hazard) run.hazards.push({ tick: msg.tick, h: msg.hazard });
  if (msg.done) run.done = true;
  if (!msg.channel.startsWith("sim:") && run.frames.length > MAX_STREAM_FRAMES) {
    const drop = run.frames.length - MAX_STREAM_FRAMES;
    run.frames.splice(0, drop);
    const first = run.frames[0]!.tick;
    const keep = run.hazards.filter((h) => h.tick >= first);
    const before = run.hazards.filter((h) => h.tick < first).at(-1);
    run.hazards = before ? [before, ...keep] : keep;
  }
  const now = performance.now();
  if (lastArrival > 0) { const dt = now - lastArrival; if (dt > 0 && dt < 5000) arrivalMs = Math.min(2000, Math.max(50, arrivalMs * 0.7 + dt * 0.3)); }
  lastArrival = now;
  version++;
}

function onMessage(msg: ServerMsg): void {
  switch (msg.type) {
    case "frame":
      onFrame(msg);
      break;
    case "persona": {
      if (!subs.has(msg.channel)) break;
      const run = runFor(msg.channel);
      run.personas = [...run.personas, msg].slice(-MAX_PERSONAS);
      version++;
      break;
    }
    case "summary":
      useStore.setState({ badnessFormula: msg.badnessFormula });
      if (!subs.has(msg.channel)) break;
      runFor(msg.channel).summary = msg;
      runFor(msg.channel).done = true;
      version++;
      break;
    case "live":
      useStore.getState().setLive(msg.state);
      break;
    case "log":
      useStore.getState().addLog(msg.records);
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
    for (const channel of subs.keys()) { delete runs[channel]; send({ type: "subscribe", channel }); }
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

let prevNow = 0;
let seenVersion = -1;
function animate(now: number): void {
  requestAnimationFrame(animate);
  const dtReal = prevNow ? Math.min(0.25, (now - prevNow) / 1000) : 0;
  prevNow = now;
  const s = useStore.getState();
  const run = getRun(s.channel);
  const patch: Partial<Store> = {};
  if (version !== seenVersion) { seenVersion = version; patch.runVersion = version; }
  if (!run || !run.frames.length) {
    if (s.frame) Object.assign(patch, { frame: null, frameA: null, frameB: null, hazard: null, summary: null, personas: [] });
    if (Object.keys(patch).length) useStore.setState(patch);
    return;
  }
  const frames = run.frames;
  const end = frames.at(-1)!.t;
  let t = s.t;
  if (s.follow) {
    const prev = frames.at(-2) ?? frames.at(-1)!;
    const a = Math.min(1, (performance.now() - lastArrival) / arrivalMs);
    t = prev.t + (end - prev.t) * a;
  } else if (s.playing) {
    t = Math.min(end, t + dtReal * s.speed);
    if (t >= end && run.done) patch.playing = false;
  }
  if (t !== s.t) patch.t = t;
  const smp = sampleRun(run, t)!;
  if (smp.a !== s.frame) patch.frame = smp.a;
  if (smp.a !== s.frameA) patch.frameA = smp.a;
  if (smp.b !== s.frameB) patch.frameB = smp.b;
  if (smp.alpha !== s.alpha) patch.alpha = smp.alpha;
  const hz = hazardAt(run, smp.a.tick);
  if (hz !== s.hazard) patch.hazard = hz;
  if (run.summary !== s.summary) patch.summary = run.summary;
  if (run.personas !== s.personas) patch.personas = run.personas;
  if (Object.keys(patch).length) useStore.setState(patch);
}

let started = false;
export function startStore(): void {
  if (started) return;
  started = true;
  connectWs();
  requestAnimationFrame(animate);
}
