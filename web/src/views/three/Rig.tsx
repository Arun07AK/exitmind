import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type CameraControlsImpl from "camera-controls";
import type { Geometry } from "../../geometry.ts";
import { useView, type CameraCmd } from "../../sim/viewState.ts";
import type { Anim } from "./anim.ts";
import { floorY, SLAB_T } from "./model.ts";
import { FIGURE_H } from "./People.tsx";

type ViewKind = "home" | "iso" | "top";
const ANGLES: Record<ViewKind, { az: number; polar: number }> = {
  home: { az: 0.5, polar: 1.03 },
  iso: { az: Math.PI / 4, polar: 0.9553 },
  top: { az: 0, polar: 0 },
};
const FILL = 0.97;

/** Fractions of the canvas covered by the page's floating panels (left rail, right summary, top bar, bottom legend), which hug the window edges. */
function insets(el: HTMLElement): { l: number; r: number; t: number; b: number } {
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  let l = rect.left < 100 ? 90 : 16, r = innerWidth - rect.right < 100 && w > 700 ? 340 : 16;
  if (l + r > w * 0.62) { const k = (w * 0.62) / (l + r); l *= k; r *= k; }
  return { l: l / w, r: r / w, t: Math.min(0.16, 72 / h), b: Math.min(0.16, 104 / h) };
}

interface Fit { pos: THREE.Vector3; target: THREE.Vector3; ox: number; oy: number }

/** Distance and focal offset that put every corner of the box inside the open screen area, for a given view direction. */
function fitBox(box: THREE.Box3, az: number, polar: number, cam: THREE.PerspectiveCamera, w: number, h: number, el: HTMLElement): Fit {
  const sp = Math.max(polar, 1e-4);
  const d = new THREE.Vector3(Math.sin(sp) * Math.sin(az), Math.cos(sp), Math.sin(sp) * Math.cos(az));
  const r = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const u = new THREE.Vector3().crossVectors(d, r);
  const c0 = box.getCenter(new THREE.Vector3());
  const pts: [number, number, number][] = [];
  for (const X of [box.min.x, box.max.x]) for (const Y of [box.min.y, box.max.y]) for (const Z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(X, Y, Z).sub(c0);
    pts.push([p.dot(r), p.dot(u), p.dot(d)]);
  }
  const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tanX = tanY * (w / Math.max(1, h));
  const ins = insets(el);
  const lx = -1 + 2 * ins.l, hx = 1 - 2 * ins.r, ly = -1 + 2 * ins.b, hy = 1 - 2 * ins.t;
  const cx = (lx + hx) / 2, cy = (ly + hy) / 2, hwx = ((hx - lx) / 2) * FILL, hwy = ((hy - ly) / 2) * FILL;
  const solve = (D: number): [number, number] | null => {
    let loX = -Infinity, upX = Infinity, loY = -Infinity, upY = Infinity;
    for (const [x, y, z] of pts) {
      const dz = D - z;
      if (dz <= 1) return null;
      loX = Math.max(loX, x - (cx + hwx) * dz * tanX); upX = Math.min(upX, x - (cx - hwx) * dz * tanX);
      loY = Math.max(loY, y - (cy + hwy) * dz * tanY); upY = Math.min(upY, y - (cy - hwy) * dz * tanY);
    }
    return loX <= upX && loY <= upY ? [(loX + upX) / 2, (loY + upY) / 2] : null;
  };
  let lo = 1, hi = 20000;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (solve(mid)) hi = mid; else lo = mid; }
  const [ox, oy] = solve(hi) ?? [0, 0];
  return { pos: c0.clone().addScaledVector(d, hi), target: c0, ox, oy };
}

/** World box of what is visible once the current floor / explode transition settles. */
function targetBox(geo: Geometry, anim: Anim): THREE.Box3 {
  const v = useView.getState();
  const ys = floorY(anim.lv, v.explode ? 1 : 0, []);
  const sel = v.floor;
  let y0 = Infinity, y1 = -Infinity;
  ys.forEach((y, i) => {
    if (sel !== "all" && anim.lv.elev[i]! > anim.lv.elev[sel]!) return;
    y0 = Math.min(y0, y - SLAB_T); y1 = Math.max(y1, y + FIGURE_H);
  });
  const [x0, z0, x1, z1] = geo.bounds;
  return new THREE.Box3(new THREE.Vector3(x0 - anim.cx, y0, z0 - anim.cz), new THREE.Vector3(x1 - anim.cx, y1, z1 - anim.cz));
}

export function Rig({ geo, anim, building }: { geo: Geometry; anim: Anim; building: RefObject<THREE.Group | null> }) {
  const ctl = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const st = useRef({ kind: "home" as ViewKind, user: false, fitted: false });

  const fit = (kind: ViewKind, smooth: boolean) => {
    const c = ctl.current;
    if (!c || size.width < 2 || size.height < 2) return;
    const a = kind === "home" || kind === "iso" || kind === "top" ? ANGLES[kind] : ANGLES.home;
    const f = fitBox(targetBox(geo, anim), a.az, a.polar, camera, size.width, size.height, gl.domElement);
    st.current = { kind, user: false, fitted: true };
    void c.setFocalOffset(f.ox, -f.oy, 0, smooth);
    void c.setLookAt(f.pos.x, f.pos.y, f.pos.z, f.target.x, f.target.y, f.target.z, smooth);
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => { if (!st.current.user) fitRef.current(st.current.kind, st.current.fitted); }, [size.width, size.height]);

  useEffect(() => {
    const on = (kind: CameraCmd) => {
      const c = ctl.current;
      if (!c) return;
      if (kind === "zoomIn") void c.dolly(c.distance * 0.3, true);
      else if (kind === "zoomOut") void c.dolly(-c.distance * 0.45, true);
      else fitRef.current(kind === "reset" ? "home" : kind, true);
    };
    return useView.subscribe((s, p) => {
      if (s.cmd && s.cmd !== p.cmd) on(s.cmd.kind);
      if (s.floor !== p.floor || s.explode !== p.explode) {
        if (!st.current.user) fitRef.current(st.current.kind, true);
        else {
          const c = ctl.current;
          if (!c) return;
          const b = targetBox(geo, anim);
          const t = c.getTarget(new THREE.Vector3());
          void c.moveTo(t.x, (b.min.y + b.max.y) / 2, t.z, true);
        }
      }
    });
  }, [geo, anim]);

  // picking: nearest drawn occupant within a few pixels of a click (not a drag)
  const pickTmp = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const nearest = (ev: PointerEvent): number | null => {
      const g = building.current;
      if (!g) return null;
      const rect = el.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const pk = anim.pick;
      let best = -1, bd = 14 * 14;
      for (let i = 0; i < pk.n; i++) {
        if (!pk.vis[i]) continue;
        for (const dy of [1.2, 3.6]) {
          pickTmp.set(pk.pos[i * 3]!, pk.pos[i * 3 + 1]! + dy, pk.pos[i * 3 + 2]!).applyMatrix4(g.matrixWorld).project(camera);
          if (pickTmp.z > 1) continue;
          const sx = ((pickTmp.x + 1) / 2) * rect.width, sy = ((1 - pickTmp.y) / 2) * rect.height;
          const dd = (sx - mx) ** 2 + (sy - my) ** 2;
          if (dd < bd) { bd = dd; best = i; }
        }
      }
      return best >= 0 ? best : null;
    };
    const onDown = (e: PointerEvent) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;
      useView.getState().setInspect(nearest(e));
    };
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf || e.buttons) return;
      raf = requestAnimationFrame(() => { raf = 0; el.style.cursor = nearest(e) !== null ? "pointer" : ""; });
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [gl, camera, anim, building, pickTmp]);

  const follow = useMemo(() => ({ v: new THREE.Vector3(), t: new THREE.Vector3() }), []);
  useFrame(() => {
    const v = useView.getState();
    const c = ctl.current, g = building.current;
    if (!c || !g || !v.followAgent || v.inspect === null) return;
    const pk = anim.pick, i = v.inspect;
    if (i >= pk.n || !pk.vis[i]) return;
    follow.v.set(pk.pos[i * 3]!, pk.pos[i * 3 + 1]! + 2, pk.pos[i * 3 + 2]!).applyMatrix4(g.matrixWorld);
    c.getTarget(follow.t);
    if (follow.t.distanceToSquared(follow.v) > 0.25) void c.moveTo(follow.v.x, follow.v.y, follow.v.z, true);
  });

  return (
    <CameraControls ref={ctl} makeDefault smoothTime={0.32} draggingSmoothTime={0.1} dollyToCursor minDistance={20} maxDistance={2000}
      maxPolarAngle={Math.PI * 0.48} onStart={() => { st.current.user = true; }} />
  );
}
