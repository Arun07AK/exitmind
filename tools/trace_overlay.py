"""Draw the built twin (data/twin/rinker.twin.json) over the registered drawing sheets.

Usage: python3 tools/trace_overlay.py VIEW X0 Y0 X1 Y1 SCALE OUT.png [--grid]
VIEW is a key of data/twin/rinker/frames.json, e.g. F1@A107, F2@A108, F3@A108, F2@A103.
X/Y are twin feet (x along lettered grids from A, y along numbered grids from 1).
Needs Pillow; sheets must exist in data/sheets (npm run sheets:fetch).
"""
import json, math, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = __file__.rsplit("/tools/", 1)[0]
FRAMES = json.load(open(f"{ROOT}/data/twin/rinker/frames.json"))
KIND = {"room": (0, 120, 255), "corridor": (0, 170, 60), "lobby": (0, 170, 60), "stair": (200, 0, 200),
        "elevator": (90, 90, 90), "service": (230, 140, 0), "exterior": (120, 120, 0)}

def to_px(fr, x, y):
    ox, oy = fr["origin_px"]; sx, sy = fr["px_per_ft"]; t = fr["theta_rad"]; c, s = math.cos(t), math.sin(t)
    return ox + sx * x * c - sy * y * s, oy + sx * x * s + sy * y * c

def render(view, x0, y0, x1, y1, scale, out, grid=False, twin_path=f"{ROOT}/data/twin/rinker.twin.json"):
    fr = FRAMES[view]; floor_id = view.split("@")[0]
    im = Image.open(f"{ROOT}/data/sheets/{fr['sheet']}.png").convert("RGB")
    (a, b), (c, d) = to_px(fr, x0, y0), to_px(fr, x1, y1)
    box = (int(min(a, c)), int(min(b, d)), int(max(a, c)), int(max(b, d)))
    im = im.crop(box).resize((int((box[2] - box[0]) * scale), int((box[3] - box[1]) * scale)), Image.LANCZOS)
    dr = ImageDraw.Draw(im, "RGBA")
    try: font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", max(10, int(7 * scale)))
    except Exception: font = None
    P = lambda x, y: ((to_px(fr, x, y)[0] - box[0]) * scale, (to_px(fr, x, y)[1] - box[1]) * scale)
    if grid:
        for x in range(int(math.floor(x0 / 5) * 5), int(x1) + 1, 5):
            dr.line([P(x, y0), P(x, y1)], fill=(255, 0, 0, 140 if x % 10 == 0 else 60), width=1)
            if x % 10 == 0: dr.text((P(x, y0)[0] + 2, 2), str(x), fill=(220, 0, 0, 255), font=font)
        for y in range(int(math.floor(y0 / 5) * 5), int(y1) + 1, 5):
            dr.line([P(x0, y), P(x1, y)], fill=(0, 0, 255, 140 if y % 10 == 0 else 60), width=1)
            if y % 10 == 0: dr.text((2, P(x0, y)[1] + 2), str(y), fill=(0, 0, 220, 255), font=font)
    try: twin = json.load(open(twin_path))
    except FileNotFoundError: twin = None
    if twin:
        floor = next(f for f in twin["floors"] if f["id"] == floor_id)
        dr.polygon([P(*p) for p in floor["outline"]], outline=(0, 0, 0, 255))
        for v in floor["voids"]: dr.polygon([P(*p) for p in v], outline=(120, 0, 0, 255), fill=(120, 0, 0, 40))
        for s in floor["spaces"]:
            col = KIND.get(s["kind"], (0, 0, 0))
            dr.polygon([P(*p) for p in s["polygon"]], outline=col + (255,), fill=col + (35,))
            cx = sum(p[0] for p in s["polygon"]) / len(s["polygon"]); cy = sum(p[1] for p in s["polygon"]) / len(s["polygon"])
            dr.text(P(cx, cy), s["id"], fill=col + (255,), font=font)
        for p in floor["portals"]:
            col = (255, 0, 0, 255) if "OUTSIDE" in p["connects"] else (255, 0, 150, 255) if p["kind"] != "corridor_section" else (0, 160, 160, 255)
            dr.line([P(*p["a"]), P(*p["b"])], fill=col, width=max(3, int(2 * scale)))
        for st in twin["stairs"]:
            for f in st["flights"]:
                if f["from"] == floor_id: dr.polygon([P(*q) for q in f["head"]], outline=(160, 0, 255, 255), fill=(160, 0, 255, 70))
                if f["to"] == floor_id: dr.polygon([P(*q) for q in f["landing"]], outline=(0, 200, 255, 255), fill=(0, 200, 255, 70))
        for m in twin["signMounts"]:
            if m["floor"] != floor_id: continue
            u, v = P(*m["at"]); r = 5 * scale
            dr.ellipse([u - r, v - r, u + r, v + r], fill=(255, 200, 0, 230), outline=(0, 0, 0, 255))
            dr.text((u + r, v - r), m["id"], fill=(120, 80, 0, 255), font=font)
    im.save(out); print(out, im.size)

if __name__ == "__main__":
    a = sys.argv
    render(a[1], *map(float, a[2:6]), float(a[6]), a[7], grid="--grid" in a)
