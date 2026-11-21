import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function repoPath(...parts: string[]): string {
  return [REPO_ROOT.replace(/\/$/, ""), ...parts].join("/");
}
