import * as THREE from "three";

/**
 * Per-floor sunlight. With shadows on there is one directional light per floor; each light's shadow camera only sees
 * that floor's walls and people (layers), and each floor's materials are lit only by their own light, so an exploded
 * floor is never shadowed by the floor above it and its own shadows keep full strength.
 */
const TARGET = "getDirectionalLightInfo( directionalLight, directLight );";
const PATCHED = THREE.ShaderChunk.lights_fragment_begin.replace(TARGET, `${TARGET}\n\t\tdirectLight.color *= uSunMask[ i ];`);
export const SUN_MASKING = PATCHED !== THREE.ShaderChunk.lights_fragment_begin;
const SLOTS = 8;

export function sunMask(floors: number, perFloor: boolean, fi: number | null): number[] {
  const out = new Array<number>(SLOTS).fill(0);
  if (!perFloor) out[0] = 1;
  else if (fi === null) for (let i = 0; i < Math.min(floors, SLOTS); i++) out[i] = 1 / floors;
  else out[Math.min(fi, SLOTS - 1)] = 1;
  return out;
}

export function maskSun<M extends THREE.Material>(m: M, mask: number[]): M {
  if (!SUN_MASKING) return m;
  const value = mask.slice(0, SLOTS);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSunMask = { value };
    sh.fragmentShader = `uniform float uSunMask[ ${SLOTS} ];\n${sh.fragmentShader.replace("#include <lights_fragment_begin>", PATCHED)}`;
  };
  m.customProgramCacheKey = () => "exitmind-sunmask";
  m.needsUpdate = true;
  return m;
}
