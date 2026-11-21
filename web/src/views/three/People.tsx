import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Geometry } from "../../geometry.ts";
import { DENSE_SMOKE, IN_SMOKE, PERSONA_COLOR, PROTECTED, stateColor } from "../../lib/colors.ts";
import { interpolate } from "../../lib/interp.ts";
import { smokeAt } from "../../sim/derive.ts";
import { useView } from "../../sim/viewState.ts";
import { useStore } from "../../store.ts";
import { applyOpacity, type Anim } from "./anim.ts";
import { elevToY } from "./model.ts";
import { maskSun } from "./sun.ts";

export const FIGURE_H = 5.3;
const FOCUS = "#2F5BEA";

function figureGeometry(): THREE.BufferGeometry {
  const body = new THREE.CapsuleGeometry(0.78, 2.35, 4, 12);
  body.translate(0, 0.78 + 1.175, 0);
  const head = new THREE.SphereGeometry(0.56, 14, 10);
  head.translate(0, FIGURE_H - 0.56, 0);
  const g = mergeGeometries([body, head])!;
  body.dispose();
  head.dispose();
  return g;
}

const colorCache = new Map<string, THREE.Color>();
const col = (hex: string): THREE.Color => {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
};

interface Layer { body: THREE.InstancedMesh; ring: THREE.InstancedMesh; mat: THREE.MeshStandardMaterial; ringMat: THREE.MeshBasicMaterial }

/** Occupants as small instanced figures, one instanced mesh per floor so each floor can fade and cast its own shadows. */
export function People({ geo, anim, shadows }: { geo: Geometry; anim: Anim; shadows: boolean }) {
  const nf = geo.twin.floors.length;
  const [cap, setCap] = useState(1024);
  const fig = useMemo(figureGeometry, []);
  const ringGeom = useMemo(() => new THREE.RingGeometry(1.15, 1.6, 32).rotateX(-Math.PI / 2), []);
  useEffect(() => () => { fig.dispose(); ringGeom.dispose(); }, [fig, ringGeom]);
  const layers = useMemo<Layer[]>(() => Array.from({ length: nf }, (_, k) => {
    const mat = maskSun(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }), anim.mask(k));
    const body = new THREE.InstancedMesh(fig, mat, cap);
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.instanceColor.setUsage(THREE.DynamicDrawUsage);
    body.frustumCulled = false;
    body.count = 0;
    body.castShadow = shadows;
    body.receiveShadow = false;
    body.layers.enable(k + 1);
    const ringMat = new THREE.MeshBasicMaterial({ color: PERSONA_COLOR, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ring = new THREE.InstancedMesh(ringGeom, ringMat, 128);
    ring.frustumCulled = false;
    ring.count = 0;
    return { body, ring, mat, ringMat };
  }), [nf, fig, ringGeom, cap, shadows, anim]);
  useEffect(() => {
    layers.forEach((l, k) => { anim.mats[k]?.add(l.mat); anim.mats[k]?.add(l.ringMat); });
    return () => layers.forEach((l, k) => {
      anim.mats[k]?.delete(l.mat); anim.mats[k]?.delete(l.ringMat);
      l.body.dispose(); l.ring.dispose(); l.mat.dispose(); l.ringMat.dispose();
    });
  }, [layers, anim]);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1), ax: new THREE.Vector3(), cnt: new Int32Array(nf), rc: new Int32Array(nf) }), [nf]);

  useFrame(({ clock }) => {
    const s = useStore.getState();
    const ip = interpolate(s.frameA, s.frameB, s.alpha);
    const { m, p, q, s: sc, ax, cnt, rc } = tmp;
    cnt.fill(0);
    rc.fill(0);
    const pick = anim.pick;
    if (ip) {
      if (ip.n > cap) { setCap(2 ** Math.ceil(Math.log2(ip.n))); return; }
      if (pick.vis.length < ip.n) { pick.pos = new Float32Array(3 * cap); pick.vis = new Uint8Array(cap); }
      pick.n = ip.n;
      const a = s.frameA, b = s.frameB!;
      const useV = !!a && a !== b && a.n === b.n && b.t > a.t;
      const dt = useV ? b.t - a.t : 1;
      const time = clock.elapsedTime;
      const walking = s.playing;
      for (let i = 0; i < ip.n; i++) {
        pick.vis[i] = 0;
        const st = ip.state[i]!;
        if (st === PROTECTED) continue;
        const fi = ip.floor[i]!;
        const L = layers[fi];
        if (!L || anim.op[fi]! < 0.02) continue;
        const x = ip.x[i]!, z = ip.y[i]!;
        const y = elevToY(anim.lv, anim.ys, ip.z[i]!);
        let vx = 0, vz = 0, sp = 0;
        if (useV) { vx = (b.x[i]! - a!.x[i]!) / 10 / dt; vz = (b.y[i]! - a!.y[i]!) / 10 / dt; sp = Math.hypot(vx, vz); }
        const moving = sp > 0.35;
        const bob = moving && walking ? Math.abs(Math.sin(time * 7.2 + i * 2.39996)) * 0.24 : 0;
        if (moving) q.setFromAxisAngle(ax.set(vz / sp, 0, -vx / sp), 0.09);
        else q.identity();
        p.set(x, y + bob, z);
        m.compose(p, q, sc);
        const k = cnt[fi]!++;
        L.body.setMatrixAt(k, m);
        const smoky = smokeAt(geo, s.hazard, fi, x, z) >= DENSE_SMOKE;
        L.body.setColorAt(k, col(smoky ? IN_SMOKE : stateColor(st)));
        if (ip.policy[i] === 2 && rc[fi]! < L.ring.instanceMatrix.count) {
          m.makeTranslation(x, y + 0.06, z);
          L.ring.setMatrixAt(rc[fi]!++, m);
        }
        pick.pos[i * 3] = x; pick.pos[i * 3 + 1] = y; pick.pos[i * 3 + 2] = z;
        pick.vis[i] = 1;
      }
    } else pick.n = 0;
    layers.forEach((L, k) => {
      L.body.count = cnt[k]!;
      L.ring.count = rc[k]!;
      L.body.instanceMatrix.clearUpdateRanges();
      L.body.instanceMatrix.addUpdateRange(0, cnt[k]! * 16);
      L.body.instanceMatrix.needsUpdate = true;
      if (L.body.instanceColor) {
        L.body.instanceColor.clearUpdateRanges();
        L.body.instanceColor.addUpdateRange(0, cnt[k]! * 3);
        L.body.instanceColor.needsUpdate = true;
      }
      L.ring.instanceMatrix.needsUpdate = true;
    });
  });
  return (
    <>
      {layers.map((l, k) => (
        <group key={k}>
          <primitive object={l.body} />
          <primitive object={l.ring} />
        </group>
      ))}
      <InspectMarker anim={anim} />
    </>
  );
}

/** Halo above the inspected occupant and a ring at their feet. */
function InspectMarker({ anim }: { anim: Anim }) {
  const g = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const haloMat = useMemo(() => maskSun(new THREE.MeshStandardMaterial({ color: FOCUS, emissive: FOCUS, emissiveIntensity: 0.6, roughness: 0.4 }), anim.mask(null)), [anim]);
  useEffect(() => () => haloMat.dispose(), [haloMat]);
  useFrame(({ clock }) => {
    const grp = g.current;
    if (!grp) return;
    const id = useView.getState().inspect;
    const pk = anim.pick;
    if (id === null || id < 0 || id >= pk.n || !pk.vis[id]) { grp.visible = false; return; }
    grp.visible = true;
    grp.position.set(pk.pos[id * 3]!, pk.pos[id * 3 + 1]!, pk.pos[id * 3 + 2]!);
    const t = clock.elapsedTime;
    if (halo.current) {
      halo.current.position.y = FIGURE_H + 1.6 + Math.sin(t * 3) * 0.25;
      halo.current.rotation.z = t * 0.8;
    }
  });
  return (
    <group ref={g} visible={false}>
      <mesh ref={halo} rotation={[Math.PI / 2, 0, 0]} material={haloMat}>
        <torusGeometry args={[1.25, 0.22, 10, 36]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[2.1, 2.55, 40]} />
        <meshBasicMaterial color={FOCUS} transparent opacity={0.85} depthWrite={false} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
      </mesh>
    </group>
  );
}
