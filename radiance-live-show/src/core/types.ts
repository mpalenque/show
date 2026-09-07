export const SHOW_PROTOCOL_VERSION = 3 as const;

export type SceneId = 'fluid' | 'depth-sort' | 'blocks' | 'voronoi';
export type ModulationMode = 'manual' | 'audio' | 'hybrid';
export type AudioSource = 'rms' | 'bass' | 'mid' | 'treble' | 'onset' | 'flux' | 'centroid' | 'harmonic';
export type QualityLevel = 'safe' | 'balanced' | 'high';
export type ParameterKind = 'number' | 'toggle' | 'select' | 'color' | 'action';
export type ParameterGroup = 'live' | 'materials' | 'emitters' | 'physics' | 'radiance' | 'grade' | 'look' | 'camera' | 'advanced';

export interface DetectedNote {
  midi: number;
  frequency: number;
  strength: number;
}

export interface AudioSnapshot {
  sequence: number;
  timestamp: number;
  running: boolean;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  onset: number;
  flux: number;
  centroid: number;
  /** Dominant pitch class normalized from C=0 to B=1. */
  harmonicCenter: number;
  /** Stability/strength of the dominant pitch class. */
  harmonicConfidence: number;
  /** Normalized chroma entropy: narrow note=low, wide chord=noisy/high. */
  harmonicSpread: number;
  /** Legacy smoothed/held harmonic center used by existing modulation routes. */
  harmonic: number;
  notes: DetectedNote[];
}

export interface ParameterSpec {
  id: string;
  label: string;
  group: ParameterGroup;
  min: number;
  max: number;
  step: number;
  default: number;
  kind?: ParameterKind;
  options?: Array<{ value: number; label: string; colour?: string }>;
  description?: string;
  /** Explicitly expose this control in the compact live workspace. */
  live?: boolean;
  /** False for colours, selectors, toggles and one-shot actions. */
  modulatable?: boolean;
  unit?: string;
  audioSource?: AudioSource;
  audioAmount?: number;
  smoothing?: number;
}

export interface ParameterState {
  manual: number;
  mode: ModulationMode;
  source: AudioSource;
  amount: number;
  smoothing: number;
  invert: boolean;
}

export interface SceneManifest {
  id: SceneId;
  name: string;
  description: string;
  engine: 'webgl' | 'webgpu';
  looks: Array<{ id: string; name: string }>;
  parameters: ParameterSpec[];
}

export interface SceneState {
  look: string;
  parameters: Record<string, ParameterState>;
}

export interface ShowAutomationState {
  /** Master switch. When false, Output uses the authored manual state verbatim. */
  enabled: boolean;
  /** Allow the director to move through the four top-level scene engines. */
  cycleScenes: boolean;
  /** Blend between the stored manual values and the director's targets. */
  intensity: number;
  /** Nominal duration of a top-level scene before a musical transition. */
  sceneSeconds: number;
  /** Nominal duration of a look before a musical transition. */
  lookSeconds: number;
  /** Monotonic re-arm token, also lets AUTO jump to the same selected scene. */
  run: number;
}

export interface ShowState {
  schemaVersion: 2;
  revision: number;
  scene: SceneId;
  blackout: boolean;
  master: number;
  quality: QualityLevel;
  automation: ShowAutomationState;
  scenes: Record<SceneId, SceneState>;
}

export interface OutputTelemetry {
  timestamp: number;
  connected: boolean;
  scene: SceneId;
  look: string;
  fps: number;
  frameMs: number;
  frameP95Ms: number;
  width: number;
  height: number;
  dpr: number;
  renderer: string;
  automationEnabled: boolean;
  automationMoment: string;
  automationSceneProgress: number;
  automationLookProgress: number;
  drawCalls?: number;
  particles?: number;
  solverMs?: number;
  memoryMb?: number;
  warning?: string | null;
}

export type ControlToOutputMessage =
  | { v: 3; type: 'hello'; sender: string; at: number }
  | { v: 3; type: 'show-state'; sender: string; at: number; state: ShowState }
  | { v: 3; type: 'audio-frame'; sender: string; at: number; audio: AudioSnapshot }
  | { v: 3; type: 'command'; sender: string; at: number; command: 'snapshot' | 'reload' };

export type OutputToControlMessage =
  | { v: 3; type: 'hello-output'; sender: string; at: number }
  | { v: 3; type: 'telemetry'; sender: string; at: number; telemetry: OutputTelemetry }
  | { v: 3; type: 'snapshot'; sender: string; at: number; dataUrl: string }
  | { v: 3; type: 'output-error'; sender: string; at: number; message: string };

export type ShowBusMessage = ControlToOutputMessage | OutputToControlMessage;

export interface SceneFrame {
  now: number;
  dt: number;
  width: number;
  height: number;
  dpr: number;
  look: string;
  params: Record<string, number>;
  audio: AudioSnapshot;
  quality: QualityLevel;
}

export interface SceneRuntimeTelemetry {
  renderer: string;
  drawCalls?: number;
  particles?: number;
  solverMs?: number;
  memoryMb?: number;
  warning?: string | null;
}

export interface VisualScene {
  readonly id: SceneId;
  init(host: HTMLElement, quality: QualityLevel): Promise<void>;
  enter?(look: string): void;
  frame(frame: SceneFrame): void;
  resize(width: number, height: number, dpr: number): void;
  suspend?(suspended: boolean): void;
  snapshot?(): string | null;
  telemetry(): SceneRuntimeTelemetry;
  dispose(): void;
}
