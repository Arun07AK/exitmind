import { create } from "zustand";

export type ViewMode = "3d" | "2d" | "split";
export type FloorSel = number | "all";
export interface Layers { agents: boolean; trails: boolean; density: boolean; bottlenecks: boolean; exits: boolean; smoke: boolean }
export type CameraCmd = "zoomIn" | "zoomOut" | "reset" | "top" | "iso";

/** View state shared by the 2D and 3D views, so switching between them keeps the floor, layers and selection. */
export interface ViewState {
  view: ViewMode;
  floor: FloorSel;
  layers: Layers;
  inspect: number | null;
  followAgent: boolean;
  explode: boolean;
  cmd: { kind: CameraCmd; n: number } | null;
  setView: (v: ViewMode) => void;
  setFloor: (f: FloorSel) => void;
  toggleLayer: (k: keyof Layers) => void;
  setInspect: (a: number | null) => void;
  setFollowAgent: (f: boolean) => void;
  setExplode: (e: boolean) => void;
  camera: (kind: CameraCmd) => void;
}

export const LAYER_DEFS: { key: keyof Layers; label: string; swatch: string }[] = [
  { key: "agents", label: "Agents", swatch: "#1f2530" },
  { key: "trails", label: "Trajectories", swatch: "#0891b2" },
  { key: "density", label: "Density", swatch: "#f97316" },
  { key: "bottlenecks", label: "Bottlenecks", swatch: "#f59e0b" },
  { key: "exits", label: "Exits", swatch: "#db2777" },
  { key: "smoke", label: "Smoke", swatch: "#8a93a0" },
];

export const useView = create<ViewState>()((set, get) => ({
  view: "3d",
  floor: "all",
  layers: { agents: true, trails: true, density: true, bottlenecks: true, exits: true, smoke: true },
  inspect: null,
  followAgent: false,
  explode: true,
  cmd: null,
  setView: (view) => set({ view }),
  setFloor: (floor) => set({ floor }),
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setInspect: (inspect) => set({ inspect, followAgent: inspect === null ? false : get().followAgent }),
  setFollowAgent: (followAgent) => set({ followAgent }),
  setExplode: (explode) => set({ explode }),
  camera: (kind) => set({ cmd: { kind, n: (get().cmd?.n ?? 0) + 1 } }),
}));
