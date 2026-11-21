import { buildPlaybook } from "../design/playbook.ts";
import type { ProfileId } from "../sim/types.ts";
import { args, ledger, setup, writeJson } from "./common.ts";

const a = args();
const { env, ev } = setup(a.workers ? Number(a.workers) : undefined);
const profiles = (a.profiles ?? "college").split(",") as ProfileId[];
const t0 = Date.now();
const book = await buildPlaybook(env, ev, profiles, (e) => { console.log(`${e.id}: ${e.protocol} (badness ${e.verified.badness}, do-nothing ${e.doNothing.badness})`); ledger("playbook", { status: "running", last: e.id }); });
const p1 = writeJson(["data", "playbook", "rinker.playbook.json"], book);
writeJson(["data", "design", "playbook.json"], book);
ledger("playbook", { status: "done", output: p1, entries: book.length, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`wrote ${p1} (${book.length} entries)`);
await ev.close();
