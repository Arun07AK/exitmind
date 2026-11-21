import { Billboard, Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import type { HazardFrame, PersonaMsg, SignState } from "../../../src/server/contract.ts";
import type { Floor, Pt } from "../../../src/twin/schema.ts";
import { centroid, useGeometry, type Geometry } from "../geometry.ts";
import { PERSONA_COLOR, PROTECTED, SIGN_COLORS, signGlyph, stateColor } from "../lib/colors.ts";
import { decodeHazard } from "../lib/decode.ts";
import { interpolate } from "../lib/interp.ts";
import { useFrameAttrs } from "../lib/useFrameAttrs.ts";
import { useStore } from "../store.ts";

interface Elev {
  floorY: number[];
  map: (e: number) => number;
  mid: number;
}

function makeElev(geo: Geometry, explode: number): Elev {
  const E = geo.twin.floors.map((f) => f.elevationFt);
  const order = E.map((e, i) => ({ e, i })).sort((a, b) => a.e - b.e);
  const rank = new Array<number>(E.length);
  order.forEach((o, r) => (rank[o.i] = r));
  const sorted = order.map((o) => o.e);
  const map = (e: number): number => {
    if (!sorted.length) return e;
    if (e <= sorted[0]!) return e;
    for (let k = 0; k + 1 < sorted.length; k++) {
      const a = sorted[k]!, b = sorted[k + 1]!;
      if (e <= b) return e + explode * (k + (b > a ? (e - a) / (b - a) : 0));
    }
    return e + explode * (sorted.length - 1);
  };
  const floorY = E.map((e, i) => e + explode * rank[i]!);
  return { floorY, map, mid: floorY.length ? (Math.min(...floorY) + Math.max(...floorY)) / 2 : 0 };
}

function slabGeometry(floor: Floor): THREE.BufferGeometry {
  let contour: Pt[] = floor.outline;
  if (contour.length < 3) {
    const pts = floor.spaces.flatMap((s) => s.polygon);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    contour = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  const v2 = (ps: Pt[]) => ps.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = floor.voids.filter((v) => v.length >= 3);
  const faces = THREE.ShapeUtils.triangulateShape(v2(contour), holes.map(v2));
  const all = [...contour, ...holes.flat()];
  const pos = new Float32Array(all.length * 3);
  all.forEach((p, i) => pos.set([p[0], 0, p[1]], i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(faces.flat());
  g.computeVertexNormals();
  return g;
}

function wallGeometry(floor: Floor, height: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const s of floor.spaces) {
    if (s.kind === "exterior") continue;
    const P = s.polygon;
    for (let i = 0; i < P.length; i++) {
      const a = P[i]!, b = P[(i + 1) % P.length]!;
      pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], height, b[1], a[0], 0, a[1], b[0], height, b[1], a[0], height, a[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function outlineGeometry(floor: Floor): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const s of floor.spaces) {
    if (s.kind === "exterior") continue;
    const P = s.polygon;
    for (let i = 0; i < P.length; i++) {
      const a = P[i]!, b = P[(i + 1) % P.length]!;
      pos.push(a[0], 0.05, a[1], b[0], 0.05, b[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function FloorMesh({ floor, y, damaged }: { floor: Floor; y: number; damaged: Set<string> }) {
  const slab = useMemo(() => slabGeometry(floor), [floor]);
  const walls = useMemo(() => wallGeometry(floor, 3), [floor]);
  const lines = useMemo(() => outlineGeometry(floor), [floor]);
  useEffect(() => () => { slab.dispose(); walls.dispose(); lines.dispose(); }, [slab, walls, lines]);
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={slab}>
        <meshStandardMaterial color="#1e293b" side={THREE.DoubleSide} transparent opacity={0.85} />
      </mesh>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#64748b" />
      </lineSegments>
      <mesh geometry={walls}>
        <meshStandardMaterial color="#94a3b8" side={THREE.DoubleSide} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {floor.portals.filter((p) => p.connects.includes("OUTSIDE")).map((p) => {
        const dmg = damaged.has(p.id);
        return (
          <mesh key={p.id} position={[(p.a[0] + p.b[0]) / 2, 1.5, (p.a[1] + p.b[1]) / 2]}>
            <boxGeometry args={[Math.max(1, Math.abs(p.b[0] - p.a[0])), 3, Math.max(1, Math.abs(p.b[1] - p.a[1]))]} />
            <meshStandardMaterial color={dmg ? "#ef4444" : "#22c55e"} emissive={dmg ? "#7f1d1d" : "#14532d"} />
          </mesh>
        );
      })}
    </group>
  );
}

function Stairs({ geo, elev, damaged }: { geo: Geometry; elev: Elev; damaged: Set<string> }) {
  const idx = new Map<string, number>(geo.twin.floors.map((f, i) => [f.id, i]));
  return (
    <>
      {geo.twin.stairs.flatMap((st) =>
        st.flights.map((fl) => {
          const fa = idx.get(fl.from), fb = idx.get(fl.to);
          if (fa === undefined || fb === undefined) return null;
          const [hx, hy] = centroid(fl.head), [lx, ly] = centroid(fl.landing);
          const a = new THREE.Vector3(hx, elev.floorY[fa]! + 0.2, hy), b = new THREE.Vector3(lx, elev.floorY[fb]! + 0.2, ly);
          const dir = b.clone().sub(a);
          const len = dir.length();
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
          const dmg = damaged.has(st.id) || damaged.has(`${st.id}@${fl.from}`);
          return (
            <mesh key={`${st.id}:${fl.from}>${fl.to}`} position={a.clone().add(b).multiplyScalar(0.5)} quaternion={q}>
              <boxGeometry args={[Math.max(2, st.clearWidthIn / 12), 0.5, len]} />
              <meshStandardMaterial color={dmg ? "#ef4444" : "#8b5cf6"} transparent opacity={0.75} emissive={dmg ? "#7f1d1d" : "#2e1065"} />
            </mesh>
          );
        }),
      )}
    </>
  );
}

const colorCache = new Map<string, THREE.Color>();
const col = (hex: string): THREE.Color => {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
};

function Agents({ elevRef }: { elevRef: RefObject<Elev> }) {
  const [cap, setCap] = useState(1024);
  const geom = useMemo(() => new THREE.CapsuleGeometry(0.75, 2.6, 2, 6), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.6 }), []);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geom, mat, cap);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, [geom, mat, cap]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const s = useStore.getState();
    const ip = interpolate(s.frameA, s.frameB, s.alpha);
    if (!ip) { mesh.count = 0; return; }
    if (ip.n > cap) { setCap(2 ** Math.ceil(Math.log2(ip.n))); return; }
    const elev = elevRef.current;
    let k = 0;
    for (let a = 0; a < ip.n; a++) {
      const st = ip.state[a]!;
      if (st === PROTECTED) continue;
      m4.makeTranslation(ip.x[a]!, elev.map(ip.z[a]!) + 2.05, ip.y[a]!);
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, col(ip.policy[a] === 2 ? PERSONA_COLOR : stateColor(st)));
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

function PersonaLabels({ elevRef }: { elevRef: RefObject<Elev> }) {
  const frameB = useStore((s) => s.frameB);
  const personas = useStore((s) => s.personas);
  const key = useMemo(() => {
    if (!frameB) return "";
    const out: number[] = [];
    for (let a = 0; a < frameB.n && out.length < 12; a++) if (frameB.policy[a] === 2 && frameB.state[a] !== PROTECTED) out.push(a);
    return out.join(",");
  }, [frameB]);
  const agents = useMemo(() => (key ? key.split(",").map(Number) : []), [key]);
  const latest = useMemo(() => {
    const m = new Map<number, PersonaMsg>();
    for (const p of personas) m.set(p.agent, p);
    return m;
  }, [personas]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const s = useStore.getState();
    const ip = interpolate(s.frameA, s.frameB, s.alpha);
    if (!ip) return;
    agents.forEach((a, i) => {
      const g = groups.current[i];
      if (g && a < ip.n) g.position.set(ip.x[a]!, elevRef.current.map(ip.z[a]!) + 6, ip.y[a]!);
    });
  });
  return (
    <>
      {agents.map((a, i) => (
        <group key={a} ref={(g) => { groups.current[i] = g; }}>
          <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded border border-white/40 bg-slate-950/85 px-1 text-[10px] text-white">
              #{a} {latest.get(a)?.chosen ?? "persona"}
            </div>
          </Html>
        </group>
      ))}
    </>
  );
}

function smokeTexture(h: HazardFrame, fi: number, w: number, hgt: number): THREE.DataTexture | null {
  const d = decodeHazard(h);
  const sm = d.smoke[fi], th = d.threat[fi], bl = d.blocked[fi];
  const data = new Uint8Array(w * hgt * 4);
  let any = false;
  for (let i = 0; i < w * hgt; i++) {
    const o = i * 4;
    if (bl?.[i]) { data.set([127, 29, 29, 210], o); any = true; }
    else if (th?.[i]) { data.set([239, 68, 68, 130], o); any = true; }
    else if (sm?.[i]) { data.set([180, 180, 186, Math.round(sm[i]! * 0.8)], o); any = true; }
  }
  if (!any) return null;
  const t = new THREE.DataTexture(data, w, hgt, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function quad(x0: number, y0: number, W: number, H: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([x0, 0, y0, x0 + W, 0, y0, x0 + W, 0, y0 + H, x0, 0, y0 + H], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

function HazardLayers({ geo, elev, hazard }: { geo: Geometry; elev: Elev; hazard: HazardFrame | null }) {
  const layers = useMemo(() => {
    if (!hazard) return [];
    return geo.grid.floors.map((f, fi) => {
      const tex = smokeTexture(hazard, fi, f.w, f.h);
      return tex ? { fi, tex, geom: quad(f.ox, f.oy, f.w * f.cellFt, f.h * f.cellFt) } : null;
    }).filter((x): x is { fi: number; tex: THREE.DataTexture; geom: THREE.BufferGeometry } => !!x);
  }, [geo, hazard]);
  useEffect(() => () => layers.forEach((l) => { l.tex.dispose(); l.geom.dispose(); }), [layers]);
  const fire = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (fire.current) fire.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 5));
  });
  const fIdx = (id: string) => geo.twin.floors.findIndex((f) => f.id === id);
  const fo = hazard?.fireOrigin, tp = hazard?.threatPos;
  const dmgEls = geo.grid.elements.filter((e) => hazard?.damaged.includes(e.id));
  return (
    <>
      {layers.map((l) => (
        <mesh key={l.fi} geometry={l.geom} position={[0, elev.floorY[l.fi]! + 4.5, 0]} renderOrder={2}>
          <meshBasicMaterial map={l.tex} transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {fo && fIdx(fo.floor) >= 0 ? (
        <mesh ref={fire} position={[fo.x, elev.floorY[fIdx(fo.floor)]! + 3, fo.y]}>
          <sphereGeometry args={[3, 20, 14]} />
          <meshStandardMaterial color="#f97316" emissive="#f97316" emissiveIntensity={2} />
        </mesh>
      ) : null}
      {tp && fIdx(tp.floor) >= 0 ? (
        <mesh position={[tp.x, elev.floorY[fIdx(tp.floor)]! + 3.5, tp.y]}>
          <cylinderGeometry args={[3, 3, 7, 20]} />
          <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" transparent opacity={0.85} />
        </mesh>
      ) : null}
      {dmgEls.map((e) => fIdx(e.floor) >= 0 ? (
        <mesh key={e.id} position={[e.x, elev.floorY[fIdx(e.floor)]! + 2, e.y]}>
          <torusGeometry args={[5, 0.6, 8, 24]} />
          <meshStandardMaterial color="#ef4444" emissive="#991b1b" />
        </mesh>
      ) : null)}
    </>
  );
}

const signTextures = new Map<string, THREE.CanvasTexture>();
function signTexture(s: SignState | null): THREE.CanvasTexture {
  const label = !s ? "" : s.kind === "ARROW" || s.kind === "STATIC_DEFAULT" ? s.arrow.label : s.kind === "X_ALT" ? s.alt.label : s.kind;
  const key = `${s?.kind ?? "none"}|${signGlyph(s)}|${label}`;
  let t = signTextures.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = s ? SIGN_COLORS[s.kind] : "#334155";
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = "#f8fafc"; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, 125, 61);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.fillText(signGlyph(s) || "-", 64, 24);
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.fillText(label.slice(0, 16), 64, 52);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  signTextures.set(key, t);
  return t;
}

function SignBoards({ geo, elev }: { geo: Geometry; elev: Elev }) {
  const signs = useStore((s) => s.frameB?.signs);
  const byMount = useMemo(() => new Map((signs ?? []).map((s) => [s.mount, s.state])), [signs]);
  const fIdx = new Map<string, number>(geo.twin.floors.map((f, i) => [f.id, i]));
  return (
    <>
      {geo.grid.mounts.map((m) => {
        const fi = fIdx.get(m.floor);
        if (fi === undefined) return null;
        return (
          <Billboard key={m.id} position={[m.x, elev.floorY[fi]! + 8.5, m.y]}>
            <mesh>
              <planeGeometry args={[5, 2.5]} />
              <meshBasicMaterial map={signTexture(byMount.get(m.id) ?? null)} side={THREE.DoubleSide} />
            </mesh>
          </Billboard>
        );
      })}
    </>
  );
}

function Scene({ geo, explode }: { geo: Geometry; explode: number }) {
  const hazard = useStore((s) => s.hazard);
  const elev = useMemo(() => makeElev(geo, explode), [geo, explode]);
  const elevRef = useRef(elev);
  elevRef.current = elev;
  const damaged = useMemo(() => {
    const d = new Set(hazard?.damaged ?? []);
    for (const ex of geo.twin.exits) if (d.has(ex.id)) d.add(ex.portal);
    return d;
  }, [hazard, geo]);
  const [x0, y0, x1, y1] = geo.bounds;
  const shake = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = shake.current;
    if (!g) return;
    if (useStore.getState().hazard?.shaking) {
      const t = clock.elapsedTime;
      g.position.set(Math.sin(t * 37) * 0.7, Math.sin(t * 23) * 0.35, Math.cos(t * 31) * 0.7);
    } else if (g.position.lengthSq()) g.position.set(0, 0, 0);
  });
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[120, 260, 90]} intensity={1.1} />
      <group ref={shake}>
        <group position={[-(x0 + x1) / 2, 0, -(y0 + y1) / 2]}>
          {geo.twin.floors.map((f, i) => <FloorMesh key={f.id} floor={f} y={elev.floorY[i]!} damaged={damaged} />)}
          <Stairs geo={geo} elev={elev} damaged={damaged} />
          <Agents elevRef={elevRef} />
          <PersonaLabels elevRef={elevRef} />
          <HazardLayers geo={geo} elev={elev} hazard={hazard} />
          <SignBoards geo={geo} elev={elev} />
        </group>
      </group>
      <OrbitControls makeDefault target={[0, elev.mid, 0]} />
    </>
  );
}

class GLBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    return this.state.error ? <div className="flex h-full items-center justify-center p-4 text-center text-sm text-slate-400">3D view unavailable: {this.state.error}</div> : this.props.children;
  }
}

export default function Building3D({ className }: { className?: string }) {
  const { geo, error } = useGeometry();
  const ref = useFrameAttrs<HTMLDivElement>();
  const [explode, setExplode] = useState(0);
  const span = geo ? Math.max(geo.bounds[2] - geo.bounds[0], geo.bounds[3] - geo.bounds[1]) : 200;
  return (
    <div ref={ref} data-testid="building3d" data-tick="" data-state-hash="" className={`relative h-full min-h-0 ${className ?? ""}`}>
      <GLBoundary>
        {geo ? (
          <Canvas camera={{ position: [span * 0.75, span * 0.85, span * 1.05], fov: 40, near: 1, far: 20000 }} dpr={[1, 2]} gl={{ antialias: true }} style={{ background: "#020617" }}>
            <Scene geo={geo} explode={explode} />
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">{error ? `Waiting for geometry: ${error}` : "Loading geometry"}</div>
        )}
      </GLBoundary>
      <label className="absolute top-1 left-2 flex items-center gap-2 rounded bg-slate-950/80 px-2 py-1 text-[11px] text-slate-300">
        explode
        <input type="range" min={0} max={60} step={1} value={explode} onChange={(e) => setExplode(Number(e.target.value))} data-testid="explode" />
      </label>
    </div>
  );
}
