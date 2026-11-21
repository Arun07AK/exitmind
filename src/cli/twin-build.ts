import { writeFileSync } from "node:fs";
import { rinker } from "../../data/twin/rinker/index.ts";
import { repoPath } from "../shared/paths.ts";
import { finalizeTwin } from "../twin/build.ts";
import { validateTwin } from "../twin/validate.ts";

const twin = finalizeTwin(rinker);
const report = validateTwin(twin);
for (const w of report.warnings) console.log(`warning: ${w}`);
for (const e of report.errors) console.log(`ERROR: ${e}`);
console.log(JSON.stringify(report.stats));
if (report.errors.length) {
  console.log(`twin invalid: ${report.errors.length} error(s); not written`);
  process.exit(1);
}
writeFileSync(repoPath("data", "twin", "rinker.twin.json"), `${JSON.stringify(twin, null, 1)}\n`);
console.log(`wrote data/twin/rinker.twin.json  hash ${twin.hash.slice(0, 16)}`);
