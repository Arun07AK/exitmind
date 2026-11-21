import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Geometry } from "../../geometry.ts";
import { elementColor } from "../../lib/colors.ts";
import { useStore } from "../../store.ts";
import { applyOpacity, type Anim } from "./anim.ts";
import { maskSun } from "./sun.ts";
import { drawPlan, exitBarGeometry, landingGeometry, PALETTE, planFrame, slabGeometry, stairFlights, stepGeometry, wallGeometry } from "./model.ts";

const DANGER = new THREE.Color("#E5372B");
const PLAN_FONT = "'IBM Plex Sans', system-ui, sans-serif";

function useDisposable<T extends { dispose: () => void }>(make: () => T, deps: unknown[]): T {
  const v = useMemo(make, deps);
  useEffect(() => () => v.dispose(), [v]);
  return v;
}

/** damaged element ids from the current hazard, read without re-rendering */
function damagedNow(): readonly string[] {
  return useStore.getState().hazard?.damaged ?? [];
}

interface ExitModel { id: string; geom: THREE.BufferGeometry; color: THREE.Color; keys: string[] }

function FloorModel({ geo, fi, anim, shadows }: { geo: Geometry; fi: number; anim: Anim; shadows: boolean }) {
  const floor = geo.twin.floors[fi]!;
  const slab = useDisposable(() => slabGeometry(floor), [floor]);
  const walls = useDisposable(() => wallGeometry(floor), [floor]);
  const fr = useMemo(() => planFrame(geo.bounds), [geo]);
  const tex = useDisposable(() => {
    const c = document.createElement("canvas");
    c.width = 3072;
    c.height = Math.round((3072 * fr.h) / fr.w);
    drawPlan(c, floor, fr, PLAN_FONT);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 8;
    t.repeat.set(1 / fr.w, 1 / fr.h);
    t.offset.set(-fr.x0 / fr.w, -fr.y0 / fr.h);
    return t;
  }, [floor, fr]);
  useEffect(() => {
    let alive = true;
    void document.fonts?.load(`500 20px ${PLAN_FONT}`).then(() => {
      if (!alive) return;
      drawPlan(tex.image as HTMLCanvasElement, floor, fr, PLAN_FONT);
      tex.needsUpdate = true;
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [tex, floor, fr]);
  const mats = useMemo(() => ({
    top: maskSun(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }), anim.mask(fi)),
    side: maskSun(new THREE.MeshStandardMaterial({ color: PALETTE.slabSide, roughness: 0.9 }), anim.mask(fi)),
    wall: maskSun(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), anim.mask(fi)),
  }), [tex, anim, fi]);
  const exits = useMemo<ExitModel[]>(() => geo.twin.exits.filter((e) => e.floor === floor.id).flatMap((e) => {
    const p = floor.portals.find((q) => q.id === e.portal);
    if (!p) return [];
    const keys = [e.id, ...(e.stair ? [`${e.stair}@${e.floor}`] : [])];
    return [{ id: e.id, geom: exitBarGeometry(p.a, p.b), color: new THREE.Color(elementColor(e.kind === "stair" && e.stair ? e.stair : e.id)), keys }];
  }), [geo, floor]);
  const exitMats = useMemo(() => exits.map((e) => maskSun(new THREE.MeshStandardMaterial({ color: e.color, emissive: e.color, emissiveIntensity: 0.35, roughness: 0.6 }), anim.mask(fi))), [exits, anim, fi]);
  useEffect(() => {
    const set = anim.mats[fi]!;
    const all = [mats.top, mats.side, mats.wall, ...exitMats];
    all.forEach((m) => set.add(m));
    return () => { all.forEach((m) => { set.delete(m); m.dispose(); }); exits.forEach((e) => e.geom.dispose()); };
  }, [anim, fi, mats, exitMats, exits]);

  const group = useRef<THREE.Group>(null);
  const wallMesh = useRef<THREE.Mesh>(null);
  useEffect(() => { wallMesh.current?.layers.enable(fi + 1); }, [fi]);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.position.y = anim.ys[fi]!;
    g.visible = anim.op[fi]! > 0.01;
    const dmg = damagedNow();
    const pulse = 0.55 + 0.45 * Math.sin(clock.elapsedTime * 5);
    exits.forEach((e, i) => {
      const m = exitMats[i]!;
      const bad = dmg.length > 0 && e.keys.some((k) => dmg.includes(k));
      m.color.copy(bad ? DANGER : e.color);
      m.emissive.copy(bad ? DANGER : e.color);
      m.emissiveIntensity = bad ? 0.4 + 0.5 * pulse : 0.35;
    });
  });
  return (
    <group ref={group}>
      <mesh geometry={slab} material={[mats.top, mats.side]} receiveShadow />
      <mesh ref={wallMesh} geometry={walls} material={mats.wall} castShadow={shadows} receiveShadow />
      {exits.map((e, i) => <mesh key={e.id} geometry={e.geom} material={exitMats[i]} receiveShadow />)}
    </group>
  );
}

export function Floors({ geo, anim, shadows }: { geo: Geometry; anim: Anim; shadows: boolean }) {
  return <>{geo.twin.floors.map((f, i) => <FloorModel key={f.id} geo={geo} fi={i} anim={anim} shadows={shadows} />)}</>;
}

/** Stair flights between floors; they follow the floors as they separate and fade with the fainter of their two floors. */
export function Stairs({ geo, anim }: { geo: Geometry; anim: Anim }) {
  const flights = useMemo(() => stairFlights(geo.twin), [geo]);
  const steps = useDisposable(() => stepGeometry(14), []);
  const flat = useDisposable(() => landingGeometry(), []);
  const mats = useMemo(() => flights.map(() => maskSun(new THREE.MeshStandardMaterial({ color: PALETTE.stair, roughness: 0.8 }), anim.mask(null))), [flights, anim]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  const refs = useRef<(THREE.Mesh | null)[][]>([]);
  const base = useMemo(() => new THREE.Color(PALETTE.stair), []);
  useFrame(({ clock }) => {
    const dmg = damagedNow();
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5);
    flights.forEach((fl, i) => {
      const yA = anim.ys[fl.from]!, yB = anim.ys[fl.to]!;
      const op = Math.min(anim.op[fl.from]!, anim.op[fl.to]!);
      const m = mats[i]!;
      applyOpacity(m, op);
      const bad = dmg.includes(fl.elementId) || dmg.includes(fl.stair);
      m.color.copy(bad ? DANGER : base);
      m.emissive.copy(bad ? DANGER : base).multiplyScalar(bad ? 0.35 + 0.4 * pulse : 0);
      fl.parts.forEach((p, k) => {
        const mesh = refs.current[i]?.[k];
        if (!mesh) return;
        mesh.visible = op > 0.01;
        const ya = yA + (yB - yA) * p.fa, yb = yA + (yB - yA) * p.fb;
        const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1];
        const L = Math.max(0.5, Math.hypot(dx, dz));
        mesh.position.set(p.a[0], ya + 0.02, p.a[1]);
        mesh.rotation.set(0, Math.atan2(dx, dz), 0);
        mesh.scale.set(p.width, p.kind === "run" ? Math.max(0.5, ya - yb) : 8, L);
      });
    });
  });
  return (
    <>
      {flights.map((fl, i) => fl.parts.map((p, k) => (
        <mesh key={`${fl.key}:${k}`} ref={(m) => { (refs.current[i] ??= [])[k] = m; }} geometry={p.kind === "run" ? steps : flat} material={mats[i]} receiveShadow />
      )))}
    </>
  );
}

function tagTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const draw = () => {
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = "#9AA3AF";
    ctx.font = "500 84px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 68);
    t.needsUpdate = true;
  };
  draw();
  void document.fonts?.load("500 84px 'IBM Plex Mono'").then(draw).catch(() => undefined);
  return t;
}

/** "F1", "F2", ... floating beside each floor's west end while the floors are separated. */
export function FloorTags({ geo, anim }: { geo: Geometry; anim: Anim }) {
  const tags = useMemo(() => geo.twin.floors.map((f) => {
    const map = tagTexture(f.id);
    return { id: f.id, map, mat: new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }) };
  }), [geo]);
  useEffect(() => () => tags.forEach((t) => { t.map.dispose(); t.mat.dispose(); }), [tags]);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const [x0, y0, , y1] = geo.bounds;
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const topDown = camera.getWorldDirection(dir).y < -0.93;
    tags.forEach((t, i) => {
      const sp = refs.current[i];
      if (!sp) return;
      sp.position.y = anim.ys[i]! + 2;
      const sep = THREE.MathUtils.smoothstep(anim.explode, 0.45, 0.95);
      t.mat.opacity = Math.min(1, anim.op[i]! * 1.1) * sep;
      sp.visible = !topDown && t.mat.opacity > 0.02;
    });
  });
  return (
    <>
      {tags.map((t, i) => (
        <sprite key={t.id} ref={(s) => { refs.current[i] = s; }} material={t.mat} position={[x0 - 16, 0, y0 + (y1 - y0) * 0.62]} scale={[20, 10, 1]} />
      ))}
    </>
  );
}
