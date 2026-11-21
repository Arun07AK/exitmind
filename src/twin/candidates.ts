import { existsSync, readFileSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";
import type { ExitCandidate } from "./edit.ts";

export function loadCandidates(path = repoPath("data", "twin", "rinker.candidates.json")): ExitCandidate[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ExitCandidate[]) : [];
}
