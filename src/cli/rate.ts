import { rating, stars } from "../design/rating.ts";
import type { HazardKind, ProfileId } from "../sim/types.ts";
import { args, ledger, setup, writeJson } from "./common.ts";

const a = args();
const { env, ev } = setup(a.workers ? Number(a.workers) : undefined);
const hazards = (a.hazards ?? "fire,crush,quake,threat").split(",") as HazardKind[];
const profiles = (a.profiles ?? "college,school,mall,hospital").split(",") as ProfileId[];
const n = Number(a.scenarios ?? env.runtime.design.rating.scenarios);
const t0 = Date.now();
const r = await rating(env, ev, { hazards, profiles, scenarios: n, onCell: (c) => { console.log(`${c.hazard} x ${c.profile}: survived ${c.survived}/${c.total} (${stars(c.survived / c.total)} stars) against ${c.targetSec} s`); ledger("rate", { status: "running", done: `${c.hazard}x${c.profile}` }); } });
const path = writeJson(["data", "design", "rating.json"], r);
ledger("rate", { status: "done", output: path, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(r.disclaimer);
console.log(`wrote ${path}`);
await ev.close();
