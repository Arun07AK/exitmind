import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";
import { buildFeteTwin, type OsmExtract } from "../venue/osm.ts";
import { validateTwin } from "../twin/validate.ts";

const raw = repoPath("data", "twin", "thapar-fete", "osm.json");
const QUERY = '[out:json][timeout:40];(way(396666360);way(around:250,30.3544,76.3639)[highway];way(around:150,30.3544,76.3639)[building];way(around:150,30.3544,76.3639)[barrier];way(around:150,30.3544,76.3639)[amenity];way(around:150,30.3544,76.3639)[leisure];);out geom;';
if (process.argv.includes("--fetch") || !existsSync(raw)) {
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(QUERY)}`;
  const res = await fetch(url, { headers: { "user-agent": "EXITMIND/0.2 (hackathon prototype)" } });
  if (!res.ok) { console.log(`Overpass returned ${res.status}; keeping the saved extract`); process.exit(2); }
  writeFileSync(raw, await res.text());
  console.log(`fetched OSM extract -> ${raw}`);
}
const osm = JSON.parse(readFileSync(raw, "utf8")) as OsmExtract;
const twin = buildFeteTwin(osm);
const report = validateTwin(twin);
for (const e of report.errors) console.log(`ERROR: ${e}`);
for (const w of report.warnings) console.log(`warning: ${w}`);
console.log(JSON.stringify(report.stats));
if (report.errors.length) process.exit(1);
writeFileSync(repoPath("data", "twin", "thapar-fete.twin.json"), `${JSON.stringify(twin, null, 1)}\n`);
console.log(`OSM data timestamp ${osm.osm3s?.timestamp_osm_base ?? "?"}; wrote data/twin/thapar-fete.twin.json hash ${twin.hash.slice(0, 16)}`);
for (const a of twin.venue!.assumptions) console.log(`assumption: ${a}`);
for (const e of twin.exits) console.log(`${e.id}: ${e.name}`);
