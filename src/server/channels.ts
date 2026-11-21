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
    if (sticky) this.#last.set(channel, [msg]);
    else if (msg.type === "frame" && msg.hazard) this.#last.set(channel, [msg]);
    for (const ws of this.#subs.get(channel) ?? []) if (ws.readyState === 1) ws.send(data);
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.#all) if (ws.readyState === 1) ws.send(data);
  }
}
