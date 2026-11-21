import NoSleep from "nosleep.js";
import type { GridInfo, LiveState, SignState } from "../../../src/server/contract.ts";

type Arrow = Extract<SignState, { kind: "ARROW" }>["arrow"];
type Mount = GridInfo["mounts"][number];
interface Shown { state: SignState; ref: string | null }

const ROT: Record<string, number> = { AHEAD: 0, RIGHT: 90, DOWN_RIGHT: 135, BACK: 180, DOWN_LEFT: 225, LEFT: 270 };
const HOLD_TEXT = "HOLD \u2014 wait for instructions";
const LOCKDOWN_TEXT = "LOCKDOWN \u2014 go into a lockable room, stay out of sight";
const SILENCE_MS = 6000;
const PROBE_AFTER_MS = 3500;

const root = document.getElementById("sign")!;
const note = document.getElementById("note")!;
const tap = document.getElementById("tap")!;
const params = new URLSearchParams(location.search);
const mountId = params.get("mount") ?? params.get("m");

const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function phoneId(): string {
  let id = store.get("exitmind.phoneId");
  if (!id) {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    id = `P${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
    store.set("exitmind.phoneId", id);
  }
  return id;
}

const arrowSvg = (dir: string, cls = "glyph"): string =>
  `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><polygon transform="rotate(${ROT[dir] ?? 0} 50 50)" points="50,4 92,46 65,46 65,96 35,96 35,46 8,46" fill="#fff"/></svg>`;

const runnerSvg = (): string =>
  `<svg class="glyph" viewBox="0 0 100 100" aria-hidden="true"><circle cx="60" cy="13" r="10" fill="#fff"/><g fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M55 30 L42 60"/><path d="M42 60 L60 75 L54 95"/><path d="M42 60 L30 78 L12 82"/><path d="M53 34 L70 47 L84 41"/><path d="M51 34 L34 40 L25 56"/></g></svg>`;

const xSvg = (): string =>
  `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M6 6 L94 94 M94 6 L6 94" stroke="#ef2b2b" stroke-width="10" stroke-linecap="round"/></svg>`;

function html(s: SignState): string {
  switch (s.kind) {
    case "ARROW":
      return `<div class="stack">${arrowSvg(s.arrow.dir)}<div class="big">${esc(s.arrow.label)}</div></div>`;
    case "X_ALT":
      return `<div class="mid blocked">${esc(s.blocked)}${xSvg()}</div><div class="alt"><div class="stack">${arrowSvg(s.alt.dir)}<div class="big">${esc(s.alt.label)}</div></div></div>`;
    case "HOLD":
      return `<div class="big">${esc(HOLD_TEXT)}</div>`;
    case "LOCKDOWN":
      return `<div class="big">${esc(LOCKDOWN_TEXT)}</div>`;
    case "STATIC_DEFAULT": {
      const extra = s.arrow.label && s.arrow.label.toUpperCase() !== "EXIT" ? `<div class="mid">${esc(s.arrow.label)}</div>` : "";
      return `<div class="row pair">${runnerSvg()}${arrowSvg(s.arrow.dir)}</div><div class="big">EXIT</div>${extra}`;
    }
  }
}

let lastKey = "";
function render(shown: Shown, connected: boolean): void {
  const key = JSON.stringify([shown, connected]);
  if (key === lastKey) return;
  lastKey = key;
  root.innerHTML = html(shown.state);
  root.dataset.signKind = shown.state.kind;
  root.dataset.approvedRef = shown.ref ?? "";
  root.dataset.connection = connected ? "online" : "offline";
  note.hidden = connected;
}

async function loadMounts(): Promise<Mount[]> {
  try {
    const res = await fetch("/api/grid", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const grid = (await res.json()) as GridInfo;
    store.set("exitmind.mounts", JSON.stringify(grid.mounts));
    return grid.mounts;
  } catch {
    const cached = store.get("exitmind.mounts");
    return cached ? (JSON.parse(cached) as Mount[]) : [];
  }
}

function showPicker(mounts: Mount[], message: string): void {
  const floors = [...new Set(mounts.map((m) => m.floor))].sort();
  root.removeAttribute("data-sign-kind");
  root.innerHTML = "";
  const div = document.createElement("div");
  div.className = "pick";
  div.innerHTML = `<h1>${esc(message)}</h1>${mounts.length ? floors.map((f) => `<h2>${esc(f)}</h2>${mounts.filter((m) => m.floor === f).map((m) => `<a href="?mount=${encodeURIComponent(m.id)}" data-mount="${esc(m.id)}">${esc(m.id)}</a>`).join("")}`).join("") : "<p>No sign locations available. Check the connection and reload.</p>"}`;
  document.body.appendChild(div);
}

function runSign(id: string, mount: Mount | undefined): void {
  const cachedStatic = store.get(`exitmind.static.${id}`);
  const fallback = (): Shown => ({
    state: cachedStatic ? (JSON.parse(cachedStatic) as SignState) : { kind: "STATIC_DEFAULT", arrow: { dir: "AHEAD", toward: mount?.staticTarget ?? "EXIT", label: "EXIT" } satisfies Arrow },
    ref: null,
  });
  const me = phoneId();
  let ws: WebSocket | null = null;
  let server: Shown | null = null;
  let lastMsg = 0;
  let lastProbe = 0;
  let retryTimer = 0;

  const accept = (state: SignState, ref: string | null) => {
    server = { state, ref };
    lastMsg = Date.now();
    if (state.kind === "STATIC_DEFAULT") store.set(`exitmind.static.${id}`, JSON.stringify(state));
  };
  const alive = () => navigator.onLine !== false && !!ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMsg < SILENCE_MS;
  const update = () => {
    const ok = alive() && !!server;
    render(ok ? server! : fallback(), ok);
  };
  const send = (m: object) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

  const connect = () => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    window.clearTimeout(retryTimer);
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/sign`);
    ws = sock;
    sock.onopen = () => {
      lastMsg = Date.now();
      send({ type: "register", mount: id, phoneId: me });
    };
    sock.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string; mount?: string; state?: SignState; approvedRef?: string | null };
        if (msg.type === "state" && msg.state && (!msg.mount || msg.mount === id)) accept(msg.state, msg.approvedRef ?? null);
        else lastMsg = Date.now();
      } catch { /* ignore malformed message */ }
      update();
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      update();
      retryTimer = window.setTimeout(connect, 1000);
    };
    sock.onerror = () => sock.close();
  };

  const probe = async () => {
    lastProbe = Date.now();
    try {
      const res = await fetch("/api/live/state", { cache: "no-store" });
      if (!res.ok) return;
      const st = (await res.json()) as LiveState;
      const s = st.signs.find((x) => x.mount === id);
      if (s && ws && ws.readyState === WebSocket.OPEN) accept(s.state, s.approvedRef);
    } catch { /* offline: the watchdog shows the static sign */ }
    update();
  };

  window.setInterval(() => send({ type: "heartbeat", mount: id, phoneId: me }), 2000);
  window.setInterval(() => {
    const now = Date.now();
    if (ws?.readyState === WebSocket.OPEN && navigator.onLine !== false && now - lastMsg > PROBE_AFTER_MS && now - lastProbe > 2000) void probe();
    update();
  }, 500);
  window.addEventListener("offline", update);
  window.addEventListener("online", () => {
    const old = ws;
    ws = null;
    old?.close();
    connect();
  });
  update();
  connect();

  tap.hidden = false;
  const noSleep = new NoSleep();
  tap.addEventListener("click", () => {
    tap.hidden = true;
    noSleep.enable().catch(() => undefined);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, { once: true });
}

async function main(): Promise<void> {
  const mountsP = loadMounts();
  if (!mountId) {
    showPicker(await mountsP, "Choose this sign's location");
    return;
  }
  const cached = store.get("exitmind.mounts");
  const fromCache = cached ? (JSON.parse(cached) as Mount[]).find((m) => m.id === mountId) : undefined;
  if (fromCache) {
    runSign(mountId, fromCache);
    return;
  }
  const mounts = await mountsP;
  const mount = mounts.find((m) => m.id === mountId);
  if (!mount && mounts.length) {
    showPicker(mounts, `Unknown location ${mountId}. Choose this sign's location`);
    return;
  }
  runSign(mountId, mount);
}

void main();
