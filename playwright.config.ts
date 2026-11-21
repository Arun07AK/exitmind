import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL(".", import.meta.url));
const PORT = 8090;

function newestMtime(dir: string): number {
  let t = 0;
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true })) if (f.isFile()) t = Math.max(t, statSync(join(f.parentPath, f.name)).mtimeMs);
  return t;
}

function ensureWebBuild(): void {
  if (process.env.EXITMIND_E2E_SKIP_BUILD === "1") return;
  const out = join(root, "dist", "web", "index.html");
  const stale = !existsSync(out) || !existsSync(join(root, "dist", "web", "sign.html")) || newestMtime(join(root, "web")) > statSync(out).mtimeMs || statSync(join(root, "vite.config.ts")).mtimeMs > statSync(out).mtimeMs;
  if (stale) execFileSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: root, stdio: "inherit" });
}

ensureWebBuild();

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 }, launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] } },
    },
  ],
  webServer: {
    command: "node src/server/index.ts",
    url: `http://localhost:${PORT}/api/meta`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, PORT: String(PORT), EXITMIND_OFFLINE: "1" },
  },
});
