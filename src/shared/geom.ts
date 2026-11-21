export type P2 = readonly [number, number];

export function polygonArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i] as P2;
    const [x2, y2] = poly[(i + 1) % poly.length] as P2;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function centroid(poly: readonly P2[]): [number, number] {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

export function pointInPolygon(x: number, y: number, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as P2;
    const [xj, yj] = poly[j] as P2;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(points: readonly P2[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

export function segmentParam(px: number, py: number, a: P2, b: P2): { t: number; dist: number; len: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const t = len === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / (len * len);
  const tc = Math.min(1, Math.max(0, t));
  return { t, dist: Math.hypot(px - (a[0] + tc * dx), py - (a[1] + tc * dy)), len };
}

export function distToPolygonBoundary(x: number, y: number, poly: readonly P2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segmentParam(x, y, poly[i] as P2, poly[(i + 1) % poly.length] as P2).dist);
  return d;
}

function orient(a: P2, b: P2, c: P2): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

export function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

export function isSimplePolygon(poly: readonly P2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(poly[i] as P2, poly[(i + 1) % n] as P2, poly[j] as P2, poly[(j + 1) % n] as P2)) return false;
    }
  }
  return polygonArea(poly) > 0;
}

export function side(px: number, py: number, a: P2, b: P2): number {
  return Math.sign((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]));
}
