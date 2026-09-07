export type ViewMode = 'voxel' | 'sorted' | 'source' | 'depth' | 'displacement';
export type SortDirection = 'horizontal' | 'vertical';
export type SortMetric = 'luma' | 'hue' | 'saturation' | 'depth';
export type MaskMode = 'tonal' | 'subject' | 'edges' | 'highlights' | 'circle';
export type SpillDirection = 'both' | 'positive' | 'negative';
export type SourceKind = 'procedural' | 'demo2' | 'image' | 'video' | 'camera' | 'screen';
export type AutomationSync = 'source' | 'free';
export type AutomationTarget = 'strips' | 'thresholds' | 'mask' | 'look' | 'all';
export type AutomationWave = 'sine' | 'triangle' | 'saw' | 'sample-hold';
export type QualityMode = 'auto' | 'full' | 'balanced' | 'performance' | 'realtime';
export type TargetFps = 'source' | '30' | '60';
export type ExperienceMode = 'sorter' | 'radiance' | 'radiance2';

export interface EngineSettings {
  enabled: boolean;
  paused: boolean;
  viewMode: ViewMode;
  sourceKind: SourceKind;
  thresholdMin: number;
  thresholdMax: number;
  affectOutside: boolean;
  ascending: boolean;
  direction: SortDirection;
  triggerMetric: SortMetric;
  sortMetric: SortMetric;
  maskMode: MaskMode;
  maskThreshold: number;
  maskFeather: number;
  maskSpill: number;
  maskInvert: boolean;
  maskCenterX: number;
  maskCenterY: number;
  maskRadius: number;
  maskAspect: number;
  edgeSensitivity: number;
  noiseAmount: number;
  noiseScale: number;
  noiseComplexity: number;
  noiseSeed: number;
  outsideReach: number;
  spillDirection: SpillDirection;
  maxSpan: number;
  fillEnabled: boolean;
  affectBackground: boolean;
  featherStart: number;
  featherEnd: number;
  automationEnabled: boolean;
  automationSync: AutomationSync;
  automationTarget: AutomationTarget;
  automationWave: AutomationWave;
  automationRate: number;
  automationAmount: number;
  animationGrowth: number;
  reverseAnimation: boolean;
  stripOffset: number;
  offsetRandom: number;
  stripSeed: number;
  qualityMode: QualityMode;
  targetFps: TargetFps;
  // Sort strength is applied while selecting the sorted source pixel. At zero
  // each output pixel keeps its own source pixel; it is not a compositing fade.
  sortAmount: number;
  // Thickens streaks only across the sorting axis without quantizing their
  // travel direction or reducing the source working resolution.
  sortBlockSize: number;
  depthMix: number;
  depthScale: number;
  depthCurve: number;
  carryDepth: number;
  sortPosition: number;
  sortExtrusion: number;
  geometryEnabled: boolean;
  gridWidth: number;
  blockScale: number;
  blockDepth: number;
  gap: number;
  autoOrbit: number;
  cameraDistance: number;
  cameraPitch: number;
  cameraYaw: number;
  fog: number;
  lightIntensity: number;
  background: number;
  radianceStrength: number;
  radianceReach: number;
  radianceSpread: number;
  radianceEmitterCutoff: number;
  radianceAbsorption: number;
  // Radiance 2 treats the source image as an HRC material field. Hue is
  // circular in [0, 1]; low-saturation white/grey pixels remain transparent.
  radianceOccluderHue: number;
  radianceHueRange: number;
  radianceSaturationFloor: number;
  radianceMaterialContrast: number;
  radianceEmissionFloor: number;
  radianceEmitterTravel: number;
  radianceAmbient: number;
  radianceBounce: number;
  displayBrightness: number;
  displayContrast: number;
  displayZoom: number;
  seed: number;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  gpuName: string;
  backend: 'webgpu' | 'unavailable';
  sortResolution: string;
  sourceFps: number;
  gpuFrameMs: number;
  qualityLabel: string;
  instances: number;
  sourceLabel: string;
}

export interface EngineCallbacks {
  onStats(stats: EngineStats): void;
  onError(message: string): void;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  enabled: true,
  paused: false,
  viewMode: 'voxel',
  sourceKind: 'demo2',
  thresholdMin: 0,
  thresholdMax: 0.146,
  affectOutside: false,
  ascending: true,
  direction: 'vertical',
  triggerMetric: 'hue',
  sortMetric: 'luma',
  maskMode: 'tonal',
  maskThreshold: 0.56,
  maskFeather: 0.035,
  maskSpill: 1,
  maskInvert: false,
  maskCenterX: 0.5,
  maskCenterY: 0.42,
  maskRadius: 0.46,
  maskAspect: 0.72,
  edgeSensitivity: 2,
  noiseAmount: 1,
  noiseScale: 18,
  noiseComplexity: 4,
  noiseSeed: 1,
  outsideReach: 0,
  spillDirection: 'positive',
  maxSpan: 0,
  fillEnabled: true,
  affectBackground: true,
  featherStart: 0,
  featherEnd: 0,
  automationEnabled: true,
  automationSync: 'free',
  automationTarget: 'strips',
  automationWave: 'sine',
  automationRate: 0.325,
  automationAmount: 0.32,
  animationGrowth: 0.72,
  reverseAnimation: true,
  stripOffset: 0,
  offsetRandom: 0,
  stripSeed: 0,
  qualityMode: 'full',
  targetFps: 'source',
  sortAmount: 1,
  sortBlockSize: 8,
  depthMix: 0.72,
  depthScale: 0,
  depthCurve: 1.2,
  carryDepth: 0.78,
  sortPosition: 0.3,
  sortExtrusion: 0.6,
  geometryEnabled: false,
  gridWidth: 320,
  blockScale: 1,
  blockDepth: 0.02,
  gap: 0,
  autoOrbit: 0,
  cameraDistance: 3.65,
  cameraPitch: 0,
  cameraYaw: 0,
  fog: 0,
  lightIntensity: 0.1,
  background: 0,
  radianceStrength: 1.35,
  radianceReach: 0.72,
  radianceSpread: 0.58,
  radianceEmitterCutoff: 0.56,
  radianceAbsorption: 0.9,
  radianceOccluderHue: 0.333,
  radianceHueRange: 0.09,
  radianceSaturationFloor: 0.16,
  radianceMaterialContrast: 0.84,
  radianceEmissionFloor: 0.08,
  radianceEmitterTravel: 18,
  radianceAmbient: 0.78,
  radianceBounce: 0.03,
  displayBrightness: 1,
  displayContrast: 1,
  displayZoom: 1,
  seed: 13,
};

export const PRESETS: Record<string, Partial<EngineSettings>> = {
  'Zhang Vertical Default': { ...DEFAULT_SETTINGS },
  'Pixel Sorter 4 Match': {
    direction: 'horizontal',
    triggerMetric: 'luma',
    sortMetric: 'luma',
    thresholdMin: 0,
    thresholdMax: 0.776,
    maskMode: 'tonal',
    affectBackground: true,
    sortAmount: 1,
    depthScale: 0,
    geometryEnabled: false,
    qualityMode: 'full',
    automationEnabled: false,
    reverseAnimation: false,
    offsetRandom: 0.42,
    // At the web engine's 1024 px working width this reproduces the organic
    // interval scale produced by PS4's Noise 100 / Scale 18 / Complexity 4.
    // Users can still set 0 for an intentionally unlimited full-row melt.
    maxSpan: 256,
    outsideReach: 0,
    fillEnabled: true,
    noiseAmount: 1,
    noiseScale: 18,
    noiseComplexity: 4,
    noiseSeed: 1,
    stripSeed: 0,
    featherStart: 0,
    featherEnd: 0,
  },
  'Subject Melt': {
    direction: 'vertical',
    triggerMetric: 'luma',
    sortMetric: 'luma',
    thresholdMin: 0.22,
    thresholdMax: 0.86,
    maskMode: 'subject',
    affectBackground: false,
    maskThreshold: 0.56,
    maskFeather: 0.035,
    maskSpill: 1,
    edgeSensitivity: 2,
    noiseAmount: 0.012,
    noiseScale: 11,
    outsideReach: 96,
    spillDirection: 'positive',
    maxSpan: 160,
    automationEnabled: true,
    automationSync: 'source',
    automationTarget: 'strips',
    automationWave: 'sine',
    automationRate: 0.5,
    automationAmount: 0.32,
    animationGrowth: 0.72,
    reverseAnimation: false,
    stripOffset: 0,
    offsetRandom: 0.12,
    qualityMode: 'auto',
    targetFps: 'source',
    maskCenterY: 0.42,
    maskRadius: 0.46,
    maskAspect: 0.72,
    sortAmount: 0.9,
    depthScale: 0.003,
    blockDepth: 0.02,
    blockScale: 1,
    gap: 0,
    sortPosition: 0.3,
    sortExtrusion: 0.6,
    geometryEnabled: false,
    gridWidth: 320,
    autoOrbit: 0,
    cameraPitch: 0,
    cameraYaw: 0,
    fog: 0,
    lightIntensity: 0.1,
  },
  'Chromatic Quarry': {
    thresholdMin: 0.18,
    thresholdMax: 0.86,
    sortMetric: 'hue',
    triggerMetric: 'luma',
    depthScale: 0.65,
    sortPosition: 1,
    sortExtrusion: 1,
    blockScale: 0.82,
    blockDepth: 1.45,
    autoOrbit: 0.09,
  },
  'Depth Cathedral': {
    thresholdMin: 0.08,
    thresholdMax: 0.7,
    sortMetric: 'depth',
    triggerMetric: 'depth',
    direction: 'vertical',
    depthMix: 0.86,
    depthScale: 1.6,
    carryDepth: 0.25,
    sortPosition: 1,
    sortExtrusion: 1,
    blockScale: 0.9,
    blockDepth: 2,
  },
  'Signal Monolith': {
    thresholdMin: 0.32,
    thresholdMax: 0.95,
    sortMetric: 'saturation',
    triggerMetric: 'luma',
    ascending: false,
    depthScale: 0.45,
    sortPosition: 1,
    sortExtrusion: 1.25,
    gridWidth: 128,
    blockScale: 0.72,
    blockDepth: 2.5,
    fog: 0.34,
  },
  'Soft Terrain': {
    thresholdMin: 0,
    thresholdMax: 1,
    sortMetric: 'depth',
    triggerMetric: 'depth',
    sortAmount: 0.78,
    depthScale: 0.8,
    carryDepth: 0,
    sortPosition: 0.75,
    sortExtrusion: 1,
    gridWidth: 256,
    blockScale: 0.96,
    blockDepth: 0.55,
    fog: 0.12,
  },
};
