import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { Pt } from "../../../src/twin/schema.ts";
import { useGeometry, type Geometry } from "../geometry.ts";
import { useFrameAttrs } from "../lib/useFrameAttrs.ts";
import { useView } from "../sim/viewState.ts";
import { useStore } from "../store.ts";
import { applyOpacity, DIM, makeAnim, type Anim } from "./three/anim.ts";
import { Floors, FloorTags, Stairs } from "./three/Floors.tsx";
import { Hazards } from "./three/Hazards.tsx";
import { floorY, GROUND_GAP, preToneMapped, SLAB_T, STAGE } from "./three/model.ts";
import { People } from "./three/People.tsx";
import { Rig } from "./three/Rig.tsx";

type Gfx = "high" | "low";

let gfxCache: Gfx | null = null;
/** Full quality (shadows, ambient occlusion) on a real GPU; a plain path on software renderers such as SwiftShader. `?gfx=low|high` overrides. */
function detectGfx(): Gfx {
  const q = new URLSearchParams(location.search).get("gfx");
  if (q === "low" || q === "high") return q;
  if (gfxCache) return gfxCache;
  let out: Gfx = "low";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      out = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(r) ? "low" : "high";
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    out = "low";
  }
  return (gfxCache = out);
}

/** key light from the camera's front-left, about 52 degrees up, so the faces turned to the viewer are lit and shadows fall away */
const SUN_DIR = new THREE.Vector3(-0.27, 0.79, 0.55).normalize();
const SUN = 2.5;
const HEMI = 1.9;

/** Explode, fade and dim animation, run before every other part each frame. */
function useAnimator(anim: Anim) {
  useFrame((_, dt) => {
    const v = useView.getState();
    const k = 1 - Math.exp(-7 * Math.min(dt, 0.1));
    const te = v.explode ? 1 : 0;
    anim.explode += (te - anim.explode) * k;
    if (Math.abs(te - anim.explode) < 1e-3) anim.explode = te;
    floorY(anim.lv, anim.explode, anim.ys);
    const sel = v.floor;
    anim.op.forEach((op, i) => {
      const t = sel === "all" ? 1 : anim.lv.elev[i]! > (anim.lv.elev[sel] ?? Infinity) ? 0 : i === sel ? 1 : DIM;
      let o = op + (t - op) * k;
      if (Math.abs(t - o) < 2e-3) o = t;
      anim.op[i] = o;
      for (const m of anim.mats[i]!) applyOpacity(m, o);
    });
  }, -1);
}

function Lights({ anim, n, shadows }: { anim: Anim; n: number; shadows: boolean }) {
  const lights = useMemo(() => Array.from({ length: shadows ? n : 1 }, (_, k) => {
    const l = new THREE.DirectionalLight("#fffaf3", anim.perFloorSun || !shadows ? SUN : SUN / n);
    if (shadows) {
      l.castShadow = true;
      l.shadow.mapSize.set(2048, 2048);
      const c = l.shadow.camera;
      c.left = -128; c.right = 128; c.top = 128; c.bottom = -128; c.near = 1; c.far = 700;
      c.updateProjectionMatrix();
      c.layers.set(k + 1);
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.06;
      l.shadow.radius = 2.5;
      l.shadow.intensity = anim.perFloorSun ? 0.72 : 1;
    }
    return l;
  }), [n, shadows, anim]);
  useEffect(() => () => lights.forEach((l) => l.dispose()), [lights]);
  useFrame(() => {
    lights.forEach((l, k) => {
      const y = shadows ? anim.ys[k]! : (Math.min(...anim.ys) + Math.max(...anim.ys)) / 2;
      l.target.position.set(0, y, 0);
      l.target.updateMatrixWorld();
      l.position.set(SUN_DIR.x * 300, y + SUN_DIR.y * 300, SUN_DIR.z * 300);
    });
  });
  return (
    <>
      <hemisphereLight args={["#ffffff", "#e4e8ed", HEMI]} />
      {lights.map((l, k) => <primitive key={k} object={l} />)}
    </>
  );
}

/** Soft drop shadow of the lowest floor's outline, as a blurred texture on the stage. */
function dropShadow(outline: Pt[], b: [number, number, number, number]): { tex: THREE.CanvasTexture; w: number; h: number; x: number; z: number } {
  const m = 30, s = 3;
  const w = b[2] - b[0] + 2 * m, h = b[3] - b[1] + 2 * m;
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext("2d")!;
  ctx.filter = `blur(${7 * s}px)`;
  ctx.fillStyle = "rgba(20,28,42,1)";
  ctx.beginPath();
  outline.forEach((p, i) => { const x = (p[0] - b[0] + m) * s, y = (p[1] - b[1] + m) * s; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, w, h, x: b[0] - m + w / 2, z: b[1] - m + h / 2 };
}

function Stage({ geo, anim, high }: { geo: Geometry; anim: Anim; high: boolean }) {
  const low = anim.lv.order[0] ?? 0;
  const shadow = useMemo(() => dropShadow(geo.twin.floors[low]!.outline, geo.bounds), [geo, low]);
  useEffect(() => () => shadow.tex.dispose(), [shadow]);
  const ground = useMemo(() => (high ? preToneMapped(STAGE) : new THREE.Color(STAGE)), [high]);
  const gy = -SLAB_T - GROUND_GAP;
  return (
    <group position={[0, gy, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6000, 6000]} />
        <meshBasicMaterial color={ground} toneMapped={high} />
      </mesh>
      <Grid position={[0, 0.03, 0]} args={[10, 10]} infiniteGrid cellSize={8} cellThickness={0.7} cellColor="#d3d8df" sectionSize={40} sectionThickness={1}
        sectionColor="#c5cbd4" fadeDistance={520} fadeStrength={2.2} fadeFrom={0} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[shadow.x - anim.cx + 2.5, 0.06, shadow.z - anim.cz - 2]} renderOrder={1}>
        <planeGeometry args={[shadow.w, shadow.h]} />
        <meshBasicMaterial map={shadow.tex} transparent opacity={0.2} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Scene({ geo, gfx }: { geo: Geometry; gfx: Gfx }) {
  const high = gfx === "high";
  const anim = useMemo(() => makeAnim(geo, useView.getState().explode, high), [geo, high]);
  useAnimator(anim);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.background = high ? preToneMapped(STAGE) : new THREE.Color(STAGE);
  }, [scene, high]);
  const building = useRef<THREE.Group>(null);
  const shake = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = shake.current;
    if (!g) return;
    if (useStore.getState().hazard?.shaking) {
      const t = clock.elapsedTime;
      g.position.set(Math.sin(t * 37) * 0.45, Math.sin(t * 23) * 0.15, Math.cos(t * 31) * 0.45);
      g.rotation.y = Math.sin(t * 19) * 0.0025;
    } else if (g.position.lengthSq() || g.rotation.y) { g.position.set(0, 0, 0); g.rotation.y = 0; }
  });
  return (
    <>
      <Lights anim={anim} n={geo.twin.floors.length} shadows={high} />
      <Stage geo={geo} anim={anim} high={high} />
      <group ref={shake}>
        <group ref={building} position={[-anim.cx, 0, -anim.cz]}>
          <Floors geo={geo} anim={anim} shadows={high} />
          <Stairs geo={geo} anim={anim} />
          <People geo={geo} anim={anim} shadows={high} />
          <Hazards geo={geo} anim={anim} />
          <FloorTags geo={geo} anim={anim} />
        </group>
      </group>
      <Rig geo={geo} anim={anim} building={building} />
      {high ? (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <N8AO halfRes depthAwareUpsampling aoRadius={4} distanceFalloff={1} intensity={1.7} quality="medium" color="black" />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <SMAA />
        </EffectComposer>
      ) : null}
    </>
  );
}

class GLBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    return this.state.error
      ? <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-ink-3">The 3D view could not start ({this.state.error}). WebGL may be disabled in this browser; the 2D view still works.</div>
      : this.props.children;
  }
}

export default function Building3D({ className }: { className?: string }) {
  const { geo, error } = useGeometry();
  const ref = useFrameAttrs<HTMLDivElement>();
  const [gfx] = useState(detectGfx);
  const high = gfx === "high";
  return (
    <div ref={ref} data-testid="building3d" data-tick="" data-state-hash="" data-gfx={gfx} className={`relative h-full min-h-0 ${className ?? ""}`} style={{ background: STAGE }}>
      <GLBoundary>
        {geo ? (
          <Canvas
            dpr={high ? [1, 1.75] : 1}
            shadows={high ? "percentage" : false}
            camera={{ fov: 30, near: 5, far: 8000, position: [180, 260, 420] }}
            gl={{ antialias: !high, powerPreference: "high-performance", stencil: false }}
            onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; gl.toneMappingExposure = 1; }}
          >
            <Scene geo={geo} gfx={gfx} />
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-ink-3">{error ? `Waiting for the building model: ${error}` : "Loading the building model"}</div>
        )}
      </GLBoundary>
    </div>
  );
}
