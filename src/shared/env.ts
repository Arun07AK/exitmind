import { existsSync } from "node:fs";
import { repoPath } from "./paths.ts";

let loaded = false;

export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const p = repoPath(".env");
  if (existsSync(p)) process.loadEnvFile(p);
}

export function env(name: string): string | undefined {
  loadDotEnv();
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export const isOffline = (): boolean => env("EXITMIND_OFFLINE") === "1";
