import type { WebSocket } from "ws";
import type { EventLog, EventRecord } from "../log/eventlog.ts";
import type { Model } from "../sim/model.ts";
import type { SignState } from "../sim/types.ts";
import { staticDefault } from "./signcompiler.ts";
import { approvedStateFor } from "./gate.ts";

interface Phone {
  ws: WebSocket;
  mount: string;
  phoneId: string;
  lastBeat: number;
}

const HEARTBEAT_TIMEOUT_MS = 6000;
const RESEND_MS = 2000;

/** Reads approved sign plans only from gate.published records in the log. It cannot create a plan itself. */
export class SignHub {
  readonly #m: Model;
  readonly #log: EventLog;
  readonly #phones = new Map<WebSocket, Phone>();
  readonly #sent = new Map<string, string>();
  readonly #sentAt = new Map<string, number>();
  #published: EventRecord | null = null;
  readonly #now: () => number;
  onChange: () => void = () => {};

  constructor(m: Model, log: EventLog, now: () => number = Date.now) {
    this.#m = m;
    this.#log = log;
    this.#now = now;
    log.subscribe(["gate.published"], (r) => { this.#published = r; });
  }

  get published(): EventRecord | null { return this.#published; }

  approvedState(mount: string, tick: number, dt: number): { state: SignState; ref: string | null } {
    const a = approvedStateFor(this.#m, this.#published, mount, tick, dt);
    return a.state ? { state: a.state, ref: a.ref } : { state: staticDefault(this.#m, mount), ref: null };
  }

  attach(ws: WebSocket, tick: () => number, dt: number): void {
    ws.on("message", (raw) => {
      let msg: { type?: string; mount?: string; phoneId?: string };
      try { msg = JSON.parse(String(raw)) as typeof msg; } catch { return; }
      if (msg.type === "register" && msg.mount && this.#m.mounts.some((x) => x.id === msg.mount)) {
        const phoneId = String(msg.phoneId ?? "anon").slice(0, 40);
        const wasOnline = this.online(msg.mount);
        this.#phones.set(ws, { ws, mount: msg.mount, phoneId, lastBeat: this.#now() });
        this.#log.append({ tick: tick(), actor: "signs", type: "sign.registered", payload: { mount: msg.mount, phoneId } });
        if (!wasOnline) this.#log.append({ tick: tick(), actor: "signs", type: "sign.online", payload: { mount: msg.mount } });
        this.#sent.delete(`${msg.mount}:${phoneId}`);
        this.push(tick(), dt);
        this.onChange();
      } else if (msg.type === "heartbeat") {
        const p = this.#phones.get(ws);
        if (p) p.lastBeat = this.#now();
      }
    });
    ws.on("close", () => this.#drop(ws, tick()));
  }

  #drop(ws: WebSocket, tick: number): void {
    const p = this.#phones.get(ws);
    if (!p) return;
    this.#phones.delete(ws);
    if (!this.online(p.mount)) this.#log.append({ tick, actor: "signs", type: "sign.offline", payload: { mount: p.mount, reason: "connection lost" } });
    this.onChange();
  }

  sweep(tick: number): void {
    const now = this.#now();
    for (const [ws, p] of this.#phones) if (now - p.lastBeat > HEARTBEAT_TIMEOUT_MS) { ws.terminate(); this.#drop(ws, tick); }
  }

  online(mount: string): boolean {
    for (const p of this.#phones.values()) if (p.mount === mount) return true;
    return false;
  }
  phones(mount: string): number {
    let k = 0;
    for (const p of this.#phones.values()) if (p.mount === mount) k++;
    return k;
  }
  lastBeat(mount: string): number | null {
    let b: number | null = null;
    for (const p of this.#phones.values()) if (p.mount === mount) b = Math.max(b ?? 0, p.lastBeat);
    return b;
  }

  push(tick: number, dt: number): void {
    const now = this.#now();
    for (const p of this.#phones.values()) {
      const { state, ref } = this.approvedState(p.mount, tick, dt);
      const body = JSON.stringify({ type: "state", mount: p.mount, state, approvedRef: ref });
      const key = `${p.mount}:${p.phoneId}`;
      const changed = this.#sent.get(key) !== body;
      if (!changed && now - (this.#sentAt.get(key) ?? 0) < RESEND_MS) continue;
      this.#sent.set(key, body);
      this.#sentAt.set(key, now);
      if (p.ws.readyState === 1) p.ws.send(body);
      if (changed) this.#log.append({ tick, actor: "signs", type: "sign.state_sent", payload: { mount: p.mount, phoneId: p.phoneId, kind: state.kind }, refs: ref ? [ref] : [] });
    }
  }
}
