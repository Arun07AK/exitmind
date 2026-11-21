import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";

const out = repoPath("docs", "verification", "overlays");
mkdirSync(out, { recursive: true });
if (!existsSync(repoPath("data", "sheets", "A107.png"))) { console.log("sheets missing: run `npm run sheets:fetch` first"); process.exit(2); }
const views: [string, number, number, number, number, number][] = [
  ["F1@A107", -5, -5, 245, 95, 0.6], ["F1@A102", -5, -5, 245, 95, 0.6],
  ["F2@A108", -25, -5, 245, 95, 0.6], ["F2@A103", -25, -5, 245, 95, 0.6],
  ["F3@A108", -25, -5, 245, 95, 0.6], ["F3@A103", -25, -5, 245, 95, 0.6],
];
for (const [view, x0, y0, x1, y1, scale] of views) {
  const file = `${out}/${view.replace("@", "_")}.png`;
  execFileSync("python3", [repoPath("tools", "trace_overlay.py"), view, String(x0), String(y0), String(x1), String(y1), String(scale), file, "--grid"], { stdio: "inherit" });
}
console.log(`overlays written to ${out} (git-ignored: the sheets remain the architects' property)`);
