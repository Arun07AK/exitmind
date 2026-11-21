import { create } from "zustand";
import type { Scenario, SimRunRequest } from "../../../src/server/contract.ts";
import { getJSON, postJSON } from "../api.ts";
import { useStore } from "../store.ts";
import { setVenue } from "../geometry.ts";

export interface Preset { id: string; label: string; hazard: string; description?: string; scenario: Scenario }

let presets: Promise<Preset[]> | null = null;

/** Ready-to-run scenarios from the design results; falls back to the adversary file if the presets route is missing. */
export function loadPresets(): Promise<Preset[]> {
  presets ??= getJSON<Preset[]>("/api/scenarios/presets").catch(async () => {
    try {
      const adv = await getJSON<{ worst: { scenario: { scenario: Scenario } }; baseline: { scenario: { scenario: Scenario } } }>("/api/design/adversary");
      return [
        { id: "fire-worst", label: "Worst-case fire", hazard: "fire", description: "worst case from the adversary search", scenario: adv.worst.scenario.scenario },
        { id: "fire-baseline", label: "Default fire", hazard: "fire", description: "default crowd", scenario: adv.baseline.scenario.scenario },
      ];
    } catch {
      return [];
    }
  });
  return presets;
}

export type CrowdMode = SimRunRequest["mode"];

interface ScenarioState {
  channel: string | null;
  scenario: Scenario | null;
  label: string;
  mode: CrowdMode;
  busy: boolean;
  error: string | null;
  venue: string;
  run: (scenario: Scenario, label: string, mode?: CrowdMode, venue?: string) => Promise<void>;
}

export const lastSim = { channel: null as string | null };

export const useScenario = create<ScenarioState>()((set, get) => ({
  channel: null,
  scenario: null,
  label: "",
  mode: "rule",
  busy: false,
  error: null,
  venue: "rinker-hall",
  run: async (scenario, label, mode = get().mode, venue = "rinker-hall") => {
    set({ busy: true, error: null });
    try {
      setVenue(venue);
      const r = await postJSON<{ channel: string }>("/api/sim/run", { scenario, mode, speed: mode === "crowd" ? 2 : 0, venue: venue as SimRunRequest["venue"] } satisfies SimRunRequest);
      set({ scenario, label, mode, busy: false, channel: r.channel, venue });
      lastSim.channel = r.channel;
      useStore.getState().setChannel(r.channel, { autoplay: true, follow: false });
      const u = new URL(location.href);
      u.searchParams.set("channel", r.channel);
      history.replaceState(null, "", u);
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

/** Describe a run opened from a link (or started elsewhere) by asking the server what it is running. */
export async function adoptRun(channel: string): Promise<void> {
  const st = useScenario.getState();
  if (st.channel === channel && st.scenario) return;
  try {
    const info = await getJSON<{ scenario: Scenario; mode: CrowdMode; venue?: string }>(`/api/sim/runs/${encodeURIComponent(channel)}`);
    setVenue(info.venue ?? "rinker-hall");
    const list = await loadPresets();
    const p = list.find((x) => x.scenario.id === info.scenario.id);
    useScenario.setState({ channel, scenario: info.scenario, mode: info.mode, label: p?.label ?? "Custom run" });
  } catch {
    useScenario.setState({ channel, scenario: null, label: "" });
  }
}

export const OCCUPANCY_LABEL = (o: string): string => (o === "classes_full" ? "classes in session" : o === "after_hours" ? "after hours" : o.startsWith("event_in:") ? "event in one room" : "spread through the building");
export const PROTOCOL_LABEL = (p: string): string => ({ EVACUATE: "Evacuate", PHASED_EVACUATION: "Phased evacuation", HOLD_THEN_EVACUATE: "Hold, then evacuate", LOCKDOWN_SHELTER: "Lockdown and shelter", HORIZONTAL_EVACUATION: "Horizontal evacuation", INFLOW_CONTROL: "Inflow control" } as Record<string, string>)[p] ?? p;
