import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { repoPath } from "../shared/paths.ts";

export const SHEET_BASE = "http://coremng.dcp.ufl.edu/rinkerhall/images/rinker/Drawings/";
export const SHEETS = [
  { sheet: "A102", file: "Rinker_009.pdf", title: "Mechanical level & first floor plan" },
  { sheet: "A103", file: "Rinker_010.pdf", title: "Second & third floor plan" },
  { sheet: "A107", file: "Rinker_012.pdf", title: "Mechanical level & first floor egress plan" },
  { sheet: "A108", file: "Rinker_013.pdf", title: "Second & third level egress plan" },
  { sheet: "A602", file: "Rinker_031.pdf", title: "Atrium stair plans, sections, elevations" },
  { sheet: "A603", file: "Rinker_032.pdf", title: "Stair & elevator enlarged plans & sections" },
] as const;
export const SHEET_DPI = 100;

const dir = repoPath("data", "sheets");
mkdirSync(dir, { recursive: true });
for (const s of SHEETS) {
  const pdf = `${dir}/${s.sheet}.pdf`;
  if (!existsSync(pdf)) {
    const res = await fetch(SHEET_BASE + s.file);
    if (!res.ok) throw new Error(`${s.sheet}: HTTP ${res.status}`);
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  }
  const png = `${dir}/${s.sheet}.png`;
  if (!existsSync(png)) execFileSync("pdftoppm", ["-r", String(SHEET_DPI), "-gray", "-png", "-singlefile", pdf, `${dir}/${s.sheet}`]);
  console.log(`${s.sheet}  ${s.title}  -> data/sheets/${s.sheet}.png`);
}
