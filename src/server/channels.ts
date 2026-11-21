import type { WebSocket } from "ws";
import type { ServerMsg } from "./contract.ts";

export class Channels {
  readonly #subs = new Map<string, Set<WebSocket>>();
  readonly #last = new Map<string, ServerMsg[]>();
  readonly #all = new Set<WebSocket>();

  attach(ws: WebSocket): void {
    this.#all.add(ws);
    ws.on("close", () => {
      this.#all.delete(ws);
      for (const s of this.#subs.values()) s.delete(ws);
    });
  }

  subscribe(ws: WebSocket, channel: string): void {
    let s = this.#subs.get(channel);
    if (!s) this.#subs.set(channel, (s = new Set()));
    s.add(ws);
    for (const m of this.#last.get(channel) ?? []) ws.send(JSON.stringify(m));
  }

  unsubscribe(ws: WebSocket, channel: string): void {
    this.#subs.get(channel)?.delete(ws);
  }

  publish(channel: string, msg: ServerMsg, sticky = false): void {
    const data = JSON.stringify(msg);
    if (channel.startsWith("sim:")) this.#remember(channel, msg);
    else if (sticky) this.#last.set(channel, [msg]);
    else if (msg.type === "frame" && msg.hazard) this.#last.set(channel, [msg]);
    for (const ws of this.#subs.get(channel) ?? []) if (ws.readyState === 1) ws.send(data);
  }

  /** Simulation runs keep their whole history so a late subscriber (or a second view) can replay the run from the start. */
  #remember(channel: string, msg: ServerMsg): void {
    let h = this.#last.get(channel);
    if (!h) {
      this.#last.set(channel, (h = []));
      const sims = [...this.#last.keys()].filter((k) => k.startsWith("sim:"));
      for (const k of sims.slice(0, Math.max(0, sims.length - Channels.KEEP_RUNS))) this.#last.delete(k);
    }
    h.push(msg);
  }

  static readonly KEEP_RUNS = 12;

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.#all) if (ws.readyState === 1) ws.send(data);
  }
}
