// Shared contract between the server (src/server) and the web app (web/). Types only, no runtime code.
import type { HazardKind, ProfileId, Protocol, RoutePolicy, Scenario, SignState } from "../sim/types.ts";
import type { RunMetrics } from "../sim/world.ts";

export type { HazardKind, ProfileId, Protocol, RoutePolicy, Scenario, SignState, RunMetrics };

/** Every number shown in the UI comes with where it came from. */
export interface Sourced<T = number> {
  value: T;
  source: string;
}

// ---------- geometry (GET /api/twin, GET /api/grid) ----------
export interface GridFloor {
  id: string;
  name: string;
  elevationFt: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  cellFt: number;
  /** base64 of a Uint8Array(w*h): 1 = walkable cell */
  walkable: string;
}
export interface GridInfo {
  twinHash: string;
  cellM: number;
  floors: GridFloor[];
  /** egress elements the simulator routes to (exits and stair heads) */
  elements: { id: string; label: string; kind: "exit" | "stair"; floor: string; x: number; y: number }[];
  mounts: { id: string; floor: string; x: number; y: number; facing: [number, number]; staticTarget: string | null }[];
  /** doors and openings with their midpoints, so views can place queue markers */
  portals: { id: string; floor: string; x: number; y: number; label: string }[];
}

// ---------- frames (WebSocket /ws, JSON text messages) ----------
export interface HazardFrame {
  version: number;
  /** base64 Uint8Array(w*h) per floor, 0..255 smoke level */
  smoke: string[];
  /** base64 Uint8Array(w*h) per floor, 1 = threat zone */
  threat: string[];
  /** base64 Uint8Array(w*h) per floor, 1 = impassable (fire core or dense smoke) */
  blocked: string[];
  damaged: string[];
  shaking: boolean;
  threatPos: { floor: string; x: number; y: number } | null;
  fireOrigin: { floor: string; x: number; y: number } | null;
}
export interface FrameMsg {
  type: "frame";
  channel: string;
  tick: number;
  t: number;
  /** sha256 of the full simulator state at this tick; both views display it as data-state-hash */
  hash: string;
  n: number;
  /** positions in tenths of a foot (integers); z = elevation in tenths of a foot */
  x: number[];
  y: number[];
  z: number[];
  floor: number[];
  /** 1 premove, 2 moving, 3 on_stair, 4 holding, 5 sheltering, 6 waiting, 7 deciding, 8 refuge, 9 protected */
  state: number[];
  /** 0..100 */
  stress: number[];
  /** 0 rule, 1 distilled, 2 live LLM persona */
  policy: number[];
  /** index into GridInfo.elements of the exit or stair head each agent is heading for; -1 when none */
  target: number[];
  /** cumulative people through each element, aligned with GridInfo.elements */
  exits: number[];
  /** cumulative person-seconds of queuing per portal id (non-zero entries only) */
  queues: Record<string, number>;
  /** present on the first frame and whenever hazard geometry changes */
  hazard?: HazardFrame;
  signs: { mount: string; state: SignState | null; dynamic: boolean }[];
  metrics: { protected: number; remaining: number; clearance95Sec: number | null; endSec: number };
  done: boolean;
}
export interface PersonaMsg {
  type: "persona";
  channel: string;
  tick: number;
  agent: number;
  point: string;
  persona: { age: string; role: string; mobility: string; familiar: boolean; stress: string };
  chosen: string;
  source: string;
  note?: string;
  label: string;
}
export interface SummaryMsg {
  type: "summary";
  channel: string;
  metrics: RunMetrics;
  badness: number;
  badnessFormula: string;
}
export interface LiveMsg {
  type: "live";
  state: LiveState;
}
export interface LogMsg {
  type: "log";
  records: LogLine[];
}
export type ServerMsg = FrameMsg | PersonaMsg | SummaryMsg | LiveMsg | LogMsg;
/** client -> server on /ws */
export type ClientMsg = { type: "subscribe"; channel: string } | { type: "unsubscribe"; channel: string };

// ---------- design mode ----------
/** POST /api/sim/run  body: SimRunRequest -> { channel } ; frames stream on that channel, then a SummaryMsg */
export interface SimRunRequest {
  scenario: Scenario;
  mode: "rule" | "distilled" | "showcase" | "crowd";
  /** venue id; defaults to rinker-hall */
  venue?: string;
  /** playback speed relative to real time; 0 = as fast as possible */
  speed: number;
}
export interface CodeCheckItem {
  id: string;
  group: "occupant_load" | "egress_width" | "exits" | "travel" | "dead_end" | "common_path";
  label: string;
  required: Sourced | null;
  provided: Sourced | null;
  unit: string;
  status: "passes_on_paper" | "does_not_pass_on_paper" | "info";
  method: string;
  printed: number | null;
  sheet: string;
  note?: string;
}
export interface CodeCheckResult {
  basis: string;
  items: CodeCheckItem[];
  disclaimer: string;
}
export interface Outcome {
  clearance95Sec: number | null;
  remainingAtTarget: number;
  densityDangerPS: number;
  smokeExposurePS: number;
  gridlock: boolean;
  badness: number;
  /** id of the run or log record the figures come from */
  ref: string;
}
export interface ScenarioRef {
  id: string;
  label: string;
  scenario: Scenario;
}
export interface BottleneckResult {
  runs: number;
  seeds: number[];
  densityThreshold: number;
  hotspots: { id: string; rank: number; kind: "portal" | "stair" | "area"; floor: string; x: number; y: number; label: string; queuePS: number; dangerPS: number; replay: ScenarioRef }[];
  exits: { id: string; label: string; share: number; status: "under_used" | "overloaded" | "balanced" }[];
  /** per floor base64 Float32Array(w*h): mean person-seconds above the density threshold per run */
  dangerHeat: string[];
}
export interface AdversaryResult {
  layout: string;
  baseline: Outcome & { scenario: ScenarioRef };
  worst: Outcome & { scenario: ScenarioRef };
  explanation: string[];
  history: { generation: number; best: number; mean: number }[];
  evaluations: number;
  seeds: number[];
}
export interface OptimiserStep {
  edit: { kind: string; target: string; amount?: number; protocol?: Protocol };
  label: string;
  cost: number;
  feasible: boolean;
  worstBefore: number;
  worstAfter: number;
  accepted: boolean;
  tradeoffs: string[];
}
export interface OptimiserResult {
  budget: number;
  spent: number;
  costTable: string;
  steps: OptimiserStep[];
  original: Outcome;
  optimised: Outcome;
  seeds: number[];
  codeLimitsOk: boolean;
}
export interface RatingCell {
  hazard: HazardKind;
  profile: ProfileId;
  survived: number;
  total: number;
  targetSec: number;
  breaking: ScenarioRef[];
}
export interface RatingResult {
  layout: string;
  cells: RatingCell[];
  disclaimer: string;
  criterion?: string;
}
export interface PlaybookEntry {
  id: string;
  situation: { hazard: HazardKind; zone: string; blocked: string[]; occupancy: string; profile: ProfileId };
  protocol: Protocol;
  policy: RoutePolicy;
  verified: Outcome;
  doNothing: Outcome;
  rationale: string;
}
export interface Nl2ParamsResult {
  text: string;
  profile: ProfileId;
  occupancy: Scenario["occupancy"];
  loadFactor: number;
  behaviour: Record<string, { value: number; min: number; max: number; why: string }>;
  personaMix: Record<string, number>;
  source: "llm" | "lexicon";
}

// ---------- live mode ----------
export type IncidentState = "NORMAL" | "SUSPECTED" | "CONFIRMED" | "RESPONDING" | "ALL_CLEAR";
export interface SensorHealth {
  id: string;
  kind: "smoke" | "door_count" | "density" | "panel" | "seismic";
  zone: string;
  status: "ok" | "silent" | "corrupt";
}
export interface Estimate {
  id: string;
  hazard: HazardKind;
  zone: string | null;
  confidence: number;
  reasons: string[];
  sensors: SensorHealth[];
  countsByZone: Record<string, Sourced>;
}
export interface DecisionCard {
  id: string;
  createdTick: number;
  protocol: Protocol;
  policy: RoutePolicy;
  rationale: string;
  rationaleSource: "llm" | "playbook" | "default";
  playbookMatch: string | null;
  verdict: {
    id: string;
    verdict: "PASS" | "FAIL";
    predicted: Outcome;
    worstCase: Outcome & { scenario: string };
    doNothing: Outcome;
    reasons: string[];
  } | null;
  alternatives: { protocol: Protocol; reason: string; predicted: Outcome | null }[];
  status: "verifying" | "pending" | "approved" | "rejected" | "timeout" | "blocked" | "overridden" | "superseded";
  signPreview: { mount: string; state: SignState }[];
  injected: boolean;
}
export interface SignInfo {
  mount: string;
  floor: string;
  x: number;
  y: number;
  online: boolean;
  phones: number;
  state: SignState;
  approvedRef: string | null;
  lastHeartbeatMs: number | null;
  url: string;
}
export interface BriefLine {
  text: string;
  refs: string[];
}
export interface Brief {
  id: string;
  createdTick: number;
  source: "llm" | "template";
  lines: BriefLine[];
  notice: string;
}
export interface LogLine {
  id: string;
  seq: number;
  tick: number;
  actor: string;
  type: string;
  summary: string;
}
export interface LiveState {
  sessionId: string;
  running: boolean;
  tick: number;
  t: number;
  incident: IncidentState;
  estimate: Estimate | null;
  current: DecisionCard | null;
  history: DecisionCard[];
  signs: SignInfo[];
  brief: Brief | null;
  approvalDeadlineTick: number | null;
  failMode: "block_with_override" | "warn";
  holdReason: string | null;
  frameChannel: string;
  offline: boolean;
}
/**
 * Live REST:
 *  GET  /api/live/state                       -> LiveState
 *  POST /api/live/control  {action: "start_fire"|"start_quake"|"inject_bad_plan"|"fail_sensor"|"restore_sensors"|"reset"|"all_clear", sensor?: string}
 *  POST /api/live/decision {id, verdict: "approve"|"reject", reason?: string}   (approve of a FAIL needs reason when failMode=block_with_override)
 *  GET  /api/live/log?since=<seq>             -> LogLine[]
 *  GET  /api/live/brief                       -> Brief | null
 *  GET  /api/live/report                      -> HistorianReport | null
 * Signs:
 *  GET  /sign?mount=<id>   phone page; it opens WebSocket /ws/sign and sends {type:"register", mount, phoneId} then {type:"heartbeat"} every 2 s
 *  server -> phone: {type:"state", mount, state: SignState, approvedRef: string|null}
 *  GET  /api/signs/qr?mount=<id> -> image/svg+xml QR code of the sign URL on the LAN address
 * Design REST:
 *  GET /api/twin -> Twin ; GET /api/grid -> GridInfo ; GET /api/codecheck -> CodeCheckResult
 *  POST /api/sim/run -> {channel} ; GET /api/sim/runs/<channel> -> {scenario, mode} for recent runs ; GET /api/design/{bottlenecks|adversary|optimiser|rating|playbook} -> the matching result (404 if not generated yet)
 *  POST /api/nl2params {text} -> Nl2ParamsResult
 *  GET /api/meta -> { offline: boolean, personaBackend: string, libraries: string[] }
 */
export interface HistorianReport {
  id: string;
  predicted: Outcome | null;
  simulated: Outcome;
  differences: string[];
  newBreakingScenarios: string[];
  playbookUpdated: boolean;
  policyUpdated: boolean;
}

// ---------- optimise mode (POST /api/design/recommend {seeds?} -> RecommendResult; GET /api/design/recommend serves the last one) ----------
export type RecommendEdit = NonNullable<Scenario["edits"]>[number];
export type EvidenceStatus = "validated" | "no_effect" | "worse";
export interface RecommendSeed {
  seed: number;
  occupants: number;
  remainingAtTarget: number;
  /** occupants - remainingAtTarget */
  outByTarget: number;
  clearance95Sec: number | null;
  densityDangerPS: number;
  smokeExposurePS: number;
  crushSec: number;
  gridlock: boolean;
  exitUsage: Record<string, number>;
  badness: number;
  hash: string;
}
export interface RecommendStats {
  mean: number;
  min: number;
  max: number;
}
export interface RecommendDangerFloor {
  floor: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  cellFt: number;
  /** mean person-seconds above the danger density per run, summed over the floor */
  total: number;
  /** sparse [cellIndex, mean person-seconds] for cells above 0.5; cellIndex = y*w + x, cell centre = (ox + (x+0.5)*cellFt, oy + (y+0.5)*cellFt) */
  cells: [number, number][];
}
export interface RecommendExitShare {
  id: string;
  label: string;
  clearWidthIn: number;
  /** mean people through this exterior exit per run */
  uses: number;
  /** share of all exterior exit use */
  share: number;
  /** share of total exterior clear width */
  widthShare: number;
}
export interface RecommendAggregate {
  perSeed: RecommendSeed[];
  outByTarget: RecommendStats;
  remainingAtTarget: RecommendStats;
  /** seeds where 95% of occupants were out or protected before the run ended (byTarget: by the clearance target) */
  reached95: { seeds: number; of: number; byTarget: number; minSec: number | null; maxSec: number | null };
  densityDangerPS: number;
  smokeExposurePS: number;
  crushSec: number;
  gridlockSeeds: number;
  badness: number;
  exitShares: RecommendExitShare[];
  danger: RecommendDangerFloor[];
}
export interface RecommendExitShareProblem {
  id: string;
  exit: string;
  label: string;
  share: number;
  widthShare: number;
  clearWidthIn: number;
  /** share / widthShare; flagged above 1.5 */
  ratio: number;
  text: string;
}
export interface RecommendDensityProblem {
  id: string;
  floor: string;
  /** mean person-seconds above the danger density per run on this floor */
  totalPS: number;
  centroid: [number, number];
  portal: string;
  portalLabel: string;
  /** exterior exit whose door this portal is, if any */
  exit: string | null;
  x: number;
  y: number;
  radiusFt: number;
  /** share of this floor's danger within radiusFt of the portal midpoint */
  fractionWithin: number;
  text: string;
}
export interface RecommendInsideProblem {
  id: string;
  targetSec: number;
  occupants: number;
  remainingAtTarget: RecommendStats;
  reached95: number;
  of: number;
  text: string;
}
export interface RecommendGain {
  /** mean over seeds of (variant outByTarget - original outByTarget), same seed */
  mean: number;
  se: number;
  perSeed: number[];
}
export interface Recommendation {
  id: string;
  edits: RecommendEdit[];
  label: string;
  kind: "architectural" | "operational";
  source: "optimiser" | "bottlenecks" | "candidates" | "combination";
  whatChanges: string;
  why: string;
  /** ids of the problems this change targets */
  addresses: string[];
  status: EvidenceStatus | "untestable";
  reason?: string;
  gain: RecommendGain | null;
  codeLimitsOk: boolean | null;
  variant: RecommendAggregate | null;
}
export interface RecommendResult {
  scenario: ScenarioRef;
  hazard: HazardKind;
  profile: ProfileId;
  seeds: number[];
  targetSec: number;
  policy: "rule" | "distilled";
  runs: number;
  evidenceRule: string;
  sources: string[];
  original: RecommendAggregate;
  problems: { exitShares: RecommendExitShareProblem[]; density: RecommendDensityProblem[]; insideAtTarget: RecommendInsideProblem };
  recommendations: Recommendation[];
}
/** GET /api/scenarios/presets -> ScenarioPreset[] */
export interface ScenarioPreset {
  id: string;
  label: string;
  hazard: HazardKind;
  description: string;
  scenario: Scenario;
}

// ---------- custom scenario generator ----------
/** POST /api/scenario/chat { messages: ScenarioTurn[] } -> ScenarioChatReply */
export interface ScenarioTurn { role: "user" | "assistant"; text: string }
export interface ScenarioChatReply {
  status: "needs_info" | "ready";
  missing: string[];
  questions: string[];
  assumptions: string[];
  summary: string;
  source: "llm" | "lexicon";
  model: string | null;
  note?: string;
  venue: string;
  venueLabel: string;
  attribution: string | null;
  /** present when status = ready: run it with POST /api/sim/run { scenario, mode: "crowd", venue, speed } */
  scenario: Scenario | null;
  crowd: { size: number; ages: Record<string, number>; roles: Record<string, number> } | null;
}
