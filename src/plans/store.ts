import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { uploadsDir } from "../twin/build.ts";
import { DraftSchema, type PlanDraft, type PlanMeta } from "./draft.ts";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_PX = 1600;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

export function planDir(id: string, ...p: string[]): string {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("bad plan id");
  return uploadsDir(id, ...p);
}

/** Store an uploaded plan (deduplicated by content) and render one page to a PNG of at most IMAGE_MAX_PX on its long side. */
export function storePlan(bytes: Buffer, contentType: string, name: string, page = 1): PlanMeta {
  const ext = TYPES[contentType.split(";")[0]!.trim()];
  if (!ext) throw new Error("upload a PDF, PNG or JPEG");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("plan is larger than 25 MB");
  if (ext === "pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("not a PDF file");
  const id = createHash("sha256").update(bytes).update(String(page)).digest("hex").slice(0, 12);
  const dir = planDir(id);
  mkdirSync(dir, { recursive: true });
  const orig = planDir(id, `original.${ext}`);
  writeFileSync(orig, bytes);
  const png = planDir(id, "plan.png");
  let src = orig;
  if (ext === "pdf") {
    execFileSync("pdftoppm", ["-png", "-r", "150", "-f", String(page), "-l", String(page), "-singlefile", orig, planDir(id, "page")], { stdio: "ignore", timeout: 120_000 });
    src = planDir(id, "page.png");
  }
  const out = execFileSync("python3", ["-c", "import sys\nfrom PIL import Image\nImage.MAX_IMAGE_PIXELS=None\nim=Image.open(sys.argv[1]).convert('RGB')\nim.thumbnail((int(sys.argv[3]),int(sys.argv[3])))\nim.save(sys.argv[2])\nprint(im.size[0],im.size[1])", src, png, String(IMAGE_MAX_PX)], { encoding: "utf8", timeout: 120_000 }).trim().split(" ").map(Number);
  const meta: PlanMeta = { id, name: name.trim().slice(0, 80) || "Uploaded plan", width: out[0]!, height: out[1]!, source: `${ext.toUpperCase()}${ext === "pdf" ? `, page ${page}` : ""}`, createdAt: new Date().toISOString() };
  writeFileSync(planDir(id, "meta.json"), JSON.stringify(meta, null, 1));
  return meta;
}

export function readMeta(id: string): PlanMeta {
  return JSON.parse(readFileSync(planDir(id, "meta.json"), "utf8")) as PlanMeta;
}

export function readDraft(id: string): PlanDraft | null {
  const f = planDir(id, "draft.json");
  return existsSync(f) ? DraftSchema.parse(JSON.parse(readFileSync(f, "utf8"))) : null;
}

export function writeDraft(id: string, d: PlanDraft): void {
  writeFileSync(planDir(id, "draft.json"), JSON.stringify(d, null, 1));
}

export function listPlans(): (PlanMeta & { traced: boolean; saved: boolean })[] {
  if (!existsSync(uploadsDir())) return [];
  return readdirSync(uploadsDir()).filter((d) => /^[a-f0-9]{12}$/.test(d) && existsSync(planDir(d, "meta.json"))).sort()
    .map((d) => ({ ...readMeta(d), traced: existsSync(planDir(d, "draft.json")), saved: existsSync(planDir(d, "twin.json")) }));
}
