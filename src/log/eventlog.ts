import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalJSON, sha256Hex } from "../shared/hash.ts";
import { eventId } from "../shared/ids.ts";
import { ACTORS, EVENT_TYPES, PAYLOAD_SCHEMAS, type Actor, type EventType } from "./events.ts";

export const GENESIS_HASH = "0".repeat(64);

export interface EventRecord {
  readonly id: string;
  readonly seq: number;
  readonly tick: number;
  readonly wall: string;
  readonly actor: Actor;
  readonly type: EventType;
  readonly payload: unknown;
  readonly refs: readonly string[];
  readonly prev: string;
  readonly hash: string;
}

export interface AppendInput {
  tick: number;
  actor: Actor;
  type: EventType;
  payload: unknown;
  refs?: readonly string[];
}

export interface EventFilter {
  type?: EventType | readonly EventType[];
  actor?: Actor;
  fromSeq?: number;
  toSeq?: number;
  fromTick?: number;
  toTick?: number;
  ref?: string;
}

export type ChainCheck = { ok: true; count: number; head: string } | { ok: false; seq: number; reason: string };
export type EventHandler = (record: EventRecord) => void;

export interface EventLogOptions {
  path?: string;
  wallClock?: () => string;
}

const actorSet: ReadonlySet<string> = new Set(ACTORS);
const typeSet: ReadonlySet<string> = new Set(EVENT_TYPES);

export function recordHash(prev: string, r: Pick<EventRecord, "seq" | "tick" | "actor" | "type" | "payload" | "refs">): string {
  return sha256Hex(prev + canonicalJSON({ seq: r.seq, tick: r.tick, actor: r.actor, type: r.type, payload: r.payload, refs: r.refs }));
}

export function verifyRecords(records: readonly EventRecord[]): ChainCheck {
  let prev = GENESIS_HASH;
  const seen = new Set<string>();
  for (const [i, r] of records.entries()) {
    const seq = i + 1;
    const fail = (reason: string): ChainCheck => ({ ok: false, seq, reason });
    if (r.seq !== seq || r.id !== eventId(seq)) return fail(`expected ${eventId(seq)}, found ${r.id} (seq ${r.seq})`);
    if (!actorSet.has(r.actor)) return fail(`unknown actor ${r.actor}`);
    if (!typeSet.has(r.type)) return fail(`unknown type ${r.type}`);
    if (r.prev !== prev) return fail("prev hash does not match the previous record");
    for (const ref of r.refs) if (!seen.has(ref)) return fail(`ref ${ref} is not an earlier record`);
    if (recordHash(prev, r) !== r.hash) return fail("hash does not match record content");
    seen.add(r.id);
    prev = r.hash;
  }
  return { ok: true, count: records.length, head: prev };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function parseLines(path: string): EventRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as EventRecord;
      } catch {
        throw new Error(`${path}: line ${i + 1} is not valid JSON`);
      }
    });
}

export class EventLog {
  readonly #records: EventRecord[] = [];
  readonly #byId = new Map<string, EventRecord>();
  readonly #subs: { types: ReadonlySet<string> | null; handler: EventHandler }[] = [];
  readonly #queue: EventRecord[] = [];
  readonly #path: string | undefined;
  readonly #wallClock: () => string;
  #draining = false;

  constructor(options: EventLogOptions = {}) {
    this.#path = options.path;
    this.#wallClock = options.wallClock ?? (() => new Date().toISOString());
    if (this.#path && existsSync(this.#path)) {
      const loaded = parseLines(this.#path);
      const check = verifyRecords(loaded);
      if (!check.ok) throw new Error(`${this.#path}: chain broken at seq ${check.seq}: ${check.reason}`);
      for (const r of loaded) this.#store(deepFreeze(r));
    }
  }

  static verifyFile(path: string): ChainCheck {
    return verifyRecords(parseLines(path));
  }

  get size(): number {
    return this.#records.length;
  }

  get head(): string {
    return this.#records.at(-1)?.hash ?? GENESIS_HASH;
  }

  append(input: AppendInput): EventRecord {
    const { tick, actor, type } = input;
    if (!actorSet.has(actor)) throw new Error(`unknown actor "${actor}"`);
    if (!typeSet.has(type)) throw new Error(`unknown event type "${type}"`);
    if (!Number.isInteger(tick) || tick < -1) throw new RangeError(`tick must be an integer >= -1, got ${tick}`);
    const refs = [...(input.refs ?? [])];
    for (const ref of refs) if (!this.#byId.has(ref)) throw new Error(`ref ${ref} does not exist in the log`);
    const schema = PAYLOAD_SCHEMAS[type];
    const checked = schema ? schema.parse(input.payload) : input.payload;
    const payload: unknown = JSON.parse(canonicalJSON(checked ?? null));

    const seq = this.#records.length + 1;
    const prev = this.head;
    const body = { seq, tick, actor, type, payload, refs };
    const record: EventRecord = deepFreeze({ id: eventId(seq), ...body, wall: this.#wallClock(), prev, hash: recordHash(prev, body) });
    if (this.#path) appendFileSync(this.#path, `${JSON.stringify(record)}\n`);
    this.#store(record);
    this.#deliver(record);
    return record;
  }

  get(id: string): EventRecord | undefined {
    return this.#byId.get(id);
  }

  records(): readonly EventRecord[] {
    return this.#records.slice();
  }

  query(filter: EventFilter = {}): EventRecord[] {
    const types = filter.type === undefined ? null : new Set<string>(typeof filter.type === "string" ? [filter.type] : filter.type);
    return this.#records.filter(
      (r) =>
        (types === null || types.has(r.type)) &&
        (filter.actor === undefined || r.actor === filter.actor) &&
        (filter.fromSeq === undefined || r.seq >= filter.fromSeq) &&
        (filter.toSeq === undefined || r.seq <= filter.toSeq) &&
        (filter.fromTick === undefined || r.tick >= filter.fromTick) &&
        (filter.toTick === undefined || r.tick <= filter.toTick) &&
        (filter.ref === undefined || r.refs.includes(filter.ref)),
    );
  }

  subscribe(types: readonly EventType[] | "*", handler: EventHandler): () => void {
    const sub = { types: types === "*" ? null : new Set<string>(types), handler };
    this.#subs.push(sub);
    return () => {
      const i = this.#subs.indexOf(sub);
      if (i >= 0) this.#subs.splice(i, 1);
    };
  }

  verifyChain(): ChainCheck {
    return verifyRecords(this.#records);
  }

  #store(record: EventRecord): void {
    this.#records.push(record);
    this.#byId.set(record.id, record);
  }

  #deliver(record: EventRecord): void {
    this.#queue.push(record);
    if (this.#draining) return;
    this.#draining = true;
    const errors: unknown[] = [];
    try {
      for (let next = this.#queue.shift(); next; next = this.#queue.shift()) {
        for (const sub of this.#subs.slice()) {
          if (sub.types !== null && !sub.types.has(next.type)) continue;
          try {
            sub.handler(next);
          } catch (err) {
            errors.push(err);
          }
        }
      }
    } finally {
      this.#draining = false;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} event handlers failed`);
  }
}
