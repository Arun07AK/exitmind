import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import QRCode from "qrcode";
import { createApp, lanAddress } from "../server/index.ts";
import { env, isOffline } from "../shared/env.ts";
import { repoPath } from "../shared/paths.ts";

if (!existsSync(repoPath("dist", "web", "index.html")) || process.argv.includes("--rebuild")) {
  console.log("building the web app (vite build)...");
  execSync("npx vite build", { cwd: repoPath(), stdio: "inherit" });
}
const port = Number(env("PORT") ?? 8080);
const { server, simEnv } = createApp({ port, demo: true });
server.listen(port, "0.0.0.0", async () => {
  const base = `http://${lanAddress()}:${port}`;
  console.log(`\nEXITMIND demo  (offline mode: ${isOffline() ? "ON, all LLM fallbacks in use" : "off"})`);
  console.log(`Operator console: ${base}/live      Design mode: ${base}/`);
  console.log(`Phones on the same network: open a sign page (or scan its QR on the console):`);
  for (const m of simEnv.model.mounts.slice(0, 6)) {
    const url = `${base}/sign?mount=${encodeURIComponent(m.id)}`;
    console.log(`\n  ${m.id}  ${url}`);
    console.log(await QRCode.toString(url, { type: "terminal", small: true }));
  }
  console.log("Script (3 min): Start fire -> approve the decision -> show phones -> Inject bad plan (FAIL) -> Fail a sensor -> Reset -> Start earthquake -> approve -> All clear -> /report");
  console.log("EXITMIND never contacts emergency services; a human calls 112.");
});
