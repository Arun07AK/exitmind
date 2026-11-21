import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HazardFrame } from "../../../../src/server/contract.ts";
import type { Geometry } from "../../geometry.ts";
import { decodeHazard } from "../../lib/decode.ts";
import { useStore } from "../../store.ts";
import type { Anim } from "./anim.ts";
import { maskSun } from "./sun.ts";

const SMOKE_Y = 4.4;

/** tileable value-noise (fBm), used as the smoke layer's alpha map so smoke reads as cloud rather than a flat sheet */
function noiseTexture(): THREE.DataTexture {
  const N = 128;
  const hash = (x: number, y: number, p: number) => {
    let h = (x * 374761393 + y * 668265263 + p * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const val = (x: number, y: number, P: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (i: number, j: number) => hash(((i % P) + P) % P, ((j % P) + P) % P, P);
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), e = g(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
  };
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = 0.5 * val((x * 4) / N, (y * 4) / N, 4) + 0.3 * val((x * 8) / N, (y * 8) / N, 8) + 0.2 * val((x * 16) / N, (y * 16) / N, 16);
    const k = Math.round(255 * (0.4 + 0.6 * Math.min(1, Math.max(0, (v - 0.2) / 0.6))));
    d.set([k, k, k, 255], (y * N + x) * 4);
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.repeat.set(5, 2);
  t.needsUpdate = true;
  return t;
}

function quad(x0: number, y0: number, W: number, H: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([x0, 0, y0, x0 + W, 0, y0, x0 + W, 0, y0 + H, x0, 0, y0 + H], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

function dataTex(w: number, h: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

interface FloorHaz { fi: number; geom: THREE.BufferGeometry; smoke: THREE.DataTexture; zone: THREE.DataTexture; smokeMat: THREE.MeshBasicMaterial; zoneMat: THREE.MeshBasicMaterial; blur: Float32Array; blurZ: Float32Array }

/** 3x3 weighted blur of a per-cell value into out (0..1) */
function blur3(get: (i: number) => number, w: number, h: number, out: Float32Array): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const wgt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
      acc += get(yy * w + xx) * wgt; n += wgt;
    }
    out[y * w + x] = n ? acc / n : 0;
  }
}

/** Writes the smoke layer (soft grey, 3x3 blurred) and the floor-level threat / blocked tint for one floor. Returns whether anything is visible. */
function paint(h: HazardFrame, L: FloorHaz, w: number, hgt: number): [boolean, boolean] {
  const d = decodeHazard(h);
  const sm = d.smoke[L.fi], th = d.threat[L.fi], bl = d.blocked[L.fi];
  const sd = L.smoke.image.data as Uint8Array, zd = L.zone.image.data as Uint8Array;
  const B = L.blur, Z = L.blurZ;
  let anyS = false, anyZ = false;
  blur3((i) => (sm ? sm[i]! / 255 : 0), w, hgt, B);
  blur3((i) => (bl?.[i] ? 1 : th?.[i] ? 0.6 : 0), w, hgt, Z);
  for (let i = 0; i < w * hgt; i++) {
    const v = B[i]!;
    const o = i * 4;
    if (v > 0.02) {
      anyS = true;
      const k = Math.min(1, v * 1.2);
      sd[o] = 178 - 70 * k; sd[o + 1] = 183 - 70 * k; sd[o + 2] = 191 - 68 * k;
      sd[o + 3] = Math.round(Math.min(0.66, 0.1 + 0.6 * k) * 255);
    } else sd[o + 3] = 0;
    const z = Z[i]!;
    if (z > 0.02) { zd[o] = 214; zd[o + 1] = 48; zd[o + 2] = 36; zd[o + 3] = Math.round(Math.min(1, z) * 120); anyZ = true; }
    else zd[o + 3] = 0;
  }
  L.smoke.needsUpdate = true;
  L.zone.needsUpdate = true;
  return [anyS, anyZ];
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,92,52,0.95)");
  g.addColorStop(0.25, "rgba(239,68,48,0.55)");
  g.addColorStop(0.6, "rgba(229,55,43,0.16)");
  g.addColorStop(1, "rgba(229,55,43,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Hazards({ geo, anim }: { geo: Geometry; anim: Anim }) {
  const layers = useMemo<FloorHaz[]>(() => geo.grid.floors.map((f, fi) => ({
    fi,
    geom: quad(f.ox, f.oy, f.w * f.cellFt, f.h * f.cellFt),
    smoke: dataTex(f.w, f.h),
    zone: dataTex(f.w, f.h),
    smokeMat: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    zoneMat: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    blur: new Float32Array(f.w * f.h),
    blurZ: new Float32Array(f.w * f.h),
  })), [geo]);
  const noise = useMemo(noiseTexture, []);
  useEffect(() => () => noise.dispose(), [noise]);
  useEffect(() => {
    layers.forEach((L) => { L.smokeMat.map = L.smoke; L.smokeMat.alphaMap = noise; L.smokeMat.needsUpdate = true; L.zoneMat.map = L.zone; });
    return () => layers.forEach((L) => { L.geom.dispose(); L.smoke.dispose(); L.zone.dispose(); L.smokeMat.dispose(); L.zoneMat.dispose(); });
  }, [layers, noise]);
  const smokeMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const zoneMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const seen = useRef<{ h: HazardFrame | null; any: [boolean, boolean][] }>({ h: null, any: [] });

  const glow = useMemo(glowTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);
  const fire = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const light = useRef<THREE.PointLight>(null);
  const threat = useRef<THREE.Group>(null);
  const fIdx = useMemo(() => new Map<string, number>(geo.twin.floors.map((f, i) => [f.id, i])), [geo]);
  const elems = useMemo(() => new Map(geo.grid.elements.map((e) => [e.id, e])), [geo]);
  const dmgMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const solid = useMemo(() => ({
    core: maskSun(new THREE.MeshStandardMaterial({ color: "#E5372B", emissive: "#ff4d2e", emissiveIntensity: 2.2 }), anim.mask(null)),
    threat: maskSun(new THREE.MeshStandardMaterial({ color: "#B42318", emissive: "#E5372B", emissiveIntensity: 0.5 }), anim.mask(null)),
  }), [anim]);
  useEffect(() => () => { solid.core.dispose(); solid.threat.dispose(); }, [solid]);

  useFrame(({ clock }) => {
    const h = useStore.getState().hazard;
    const S = seen.current;
    if (h !== S.h) {
      S.h = h;
      S.any = layers.map((L) => (h ? paint(h, L, geo.grid.floors[L.fi]!.w, geo.grid.floors[L.fi]!.h) : [false, false]));
    }
    layers.forEach((L, i) => {
      const op = anim.op[L.fi] ?? 1;
      const y = anim.ys[L.fi] ?? 0;
      const sm = smokeMeshes.current[i], zm = zoneMeshes.current[i];
      if (sm) { sm.visible = !!S.any[i]?.[0] && op > 0.02; sm.position.y = y + SMOKE_Y; }
      if (zm) { zm.visible = !!S.any[i]?.[1] && op > 0.02; zm.position.y = y + 0.06; }
      L.smokeMat.opacity = op;
      L.zoneMat.opacity = op;
    });
    const t = clock.elapsedTime;
    noise.offset.set(t * 0.006, t * 0.0035);
    const fo = h?.fireOrigin, fi = fo ? fIdx.get(fo.floor) : undefined;
    const g = fire.current;
    if (g) {
      const on = !!fo && fi !== undefined && anim.op[fi]! > 0.02;
      g.visible = on;
      const flick = 0.82 + 0.1 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 17.9 + 1.3);
      if (light.current) light.current.intensity = on ? 1800 * flick * anim.op[fi!]! : 0;
      if (on) {
        g.position.set(fo.x, anim.ys[fi]! + 0.1, fo.y);
        sprite.current?.scale.setScalar(20 * (0.92 + 0.08 * flick));
        if (sprite.current) (sprite.current.material as THREE.SpriteMaterial).opacity = anim.op[fi]!;
        core.current?.scale.setScalar(0.85 + 0.2 * flick);
      }
    }
    const tp = h?.threatPos, ti = tp ? fIdx.get(tp.floor) : undefined;
    if (threat.current) {
      const on = !!tp && ti !== undefined && anim.op[ti]! > 0.02;
      threat.current.visible = on;
      if (on) { threat.current.position.set(tp.x, anim.ys[ti]! + 0.1, tp.y); threat.current.scale.setScalar(1 + 0.12 * Math.sin(t * 4)); }
    }
    const ids = h?.damaged ?? [];
    dmgMeshes.current.forEach((m, k) => {
      if (!m) return;
      const e = elems.get(ids[k] ?? "");
      const di = e ? fIdx.get(e.floor) : undefined;
      m.visible = !!e && di !== undefined && anim.op[di]! > 0.02;
      if (e && di !== undefined) { m.position.set(e.x, anim.ys[di]! + 0.15, e.y); m.scale.setScalar(1 + 0.15 * Math.sin(t * 5)); }
    });
  });

  return (
    <>
      {layers.map((L, i) => (
        <group key={L.fi}>
          <mesh ref={(m) => { smokeMeshes.current[i] = m; }} geometry={L.geom} material={L.smokeMat} renderOrder={3} visible={false} />
          <mesh ref={(m) => { zoneMeshes.current[i] = m; }} geometry={L.geom} material={L.zoneMat} renderOrder={1} visible={false} />
        </group>
      ))}
      <group ref={fire} visible={false}>
        <pointLight ref={light} color="#ff6a3d" intensity={0} distance={60} decay={2} position={[0, 5, 0]} />
        <sprite ref={sprite} position={[0, 2.2, 0]} renderOrder={4}>
          <spriteMaterial map={glow} transparent depthWrite={false} toneMapped={false} />
        </sprite>
        <mesh ref={core} position={[0, 1.2, 0]} material={solid.core}>
          <sphereGeometry args={[1.1, 20, 14]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <ringGeometry args={[3.2, 3.7, 40]} />
          <meshBasicMaterial color="#E5372B" transparent opacity={0.8} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
        </mesh>
      </group>
      <group ref={threat} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <circleGeometry args={[4, 40]} />
          <meshBasicMaterial color="#E5372B" transparent opacity={0.28} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
        </mesh>
        <mesh position={[0, 3, 0]} material={solid.threat}>
          <cylinderGeometry args={[0.9, 0.9, 6, 20]} />
        </mesh>
      </group>
      <group>
        {Array.from({ length: 8 }, (_, k) => (
          <mesh key={k} ref={(m) => { dmgMeshes.current[k] = m; }} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[4.2, 5, 40]} />
            <meshBasicMaterial color="#E5372B" transparent opacity={0.9} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
          </mesh>
        ))}
      </group>
    </>
  );
}
