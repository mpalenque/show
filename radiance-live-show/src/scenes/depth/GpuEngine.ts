import { mat4, vec3 } from 'gl-matrix';
import { CASCADE_HEIGHT, cascadeShader } from './shaders/cascadeShader';
import { renderShader } from './shaders/renderShader';
import { SORT_HEIGHT, SORT_WIDTH, sortShader } from './shaders/sortShader';
import {
  DEFAULT_SETTINGS,
  type EngineCallbacks,
  type EngineSettings,
  type ExperienceMode,
  type MaskMode,
  type QualityMode,
  type SourceKind,
  type SortMetric,
  type ViewMode,
} from './engine-types';

type SourceElement = HTMLImageElement | HTMLVideoElement | ImageBitmap | HTMLCanvasElement;

interface Pipelines {
  sort: GPUComputePipeline;
  cascade: GPUComputePipeline;
  plane: GPURenderPipeline;
  cube: GPURenderPipeline;
  quad: GPURenderPipeline;
  radiance2Material: GPURenderPipeline;
}

interface BindGroups {
  sort: GPUBindGroup;
  cascade: [GPUBindGroup, GPUBindGroup];
  plane: GPUBindGroup;
  cube: GPUBindGroup;
  quad: [GPUBindGroup, GPUBindGroup];
  radiance2Material: GPUBindGroup;
}

const VIEW_MODE_INDEX: Record<Exclude<ViewMode, 'voxel'>, number> = {
  source: 0,
  sorted: 1,
  depth: 2,
  displacement: 3,
};

const METRIC_INDEX: Record<SortMetric, number> = {
  luma: 0,
  hue: 1,
  saturation: 2,
  depth: 3,
};

const MASK_INDEX: Record<MaskMode, number> = {
  tonal: 0,
  subject: 1,
  edges: 2,
  highlights: 3,
  circle: 4,
};

const SPILL_DIRECTION_INDEX = {
  both: 0,
  positive: 1,
  negative: 2,
} as const;

interface QualityProfile {
  label: string;
  width: number;
  height: number;
  renderScale: number;
  gridScale: number;
  maxSpan: number;
  outsideReach: number;
}

const QUALITY_PROFILES: readonly QualityProfile[] = [
  { label: 'FULL', width: 1024, height: 576, renderScale: 1, gridScale: 1, maxSpan: 512, outsideReach: 256 },
  { label: 'BALANCED', width: 768, height: 432, renderScale: 0.9, gridScale: 0.78, maxSpan: 224, outsideReach: 176 },
  { label: 'PERFORMANCE', width: 512, height: 288, renderScale: 0.72, gridScale: 0.55, maxSpan: 112, outsideReach: 96 },
  { label: 'REALTIME', width: 320, height: 180, renderScale: 0.58, gridScale: 0.4, maxSpan: 64, outsideReach: 64 },
  { label: 'SAFE', width: 256, height: 144, renderScale: 0.48, gridScale: 0.32, maxSpan: 32, outsideReach: 48 },
  { label: 'LOW LATENCY', width: 224, height: 126, renderScale: 0.42, gridScale: 0.28, maxSpan: 24, outsideReach: 40 },
] as const;

const RADIANCE2_ATLAS_WIDTH = 1024;
const RADIANCE2_ATLAS_HEIGHT = 512;

const QUALITY_MODE_INDEX: Record<Exclude<QualityMode, 'auto'>, number> = {
  full: 0,
  balanced: 1,
  performance: 2,
  realtime: 3,
};

const SORT_SETTING_KEYS: ReadonlyArray<keyof EngineSettings> = [
  'thresholdMin', 'thresholdMax', 'affectOutside', 'ascending', 'direction',
  'triggerMetric', 'sortMetric', 'maskMode', 'maskThreshold', 'maskFeather',
  'maskInvert', 'maskCenterX', 'maskCenterY', 'maskRadius', 'maskAspect',
  'edgeSensitivity', 'noiseAmount', 'noiseScale', 'outsideReach',
  'spillDirection', 'maxSpan', 'automationEnabled', 'automationSync',
  'automationTarget', 'automationWave', 'automationRate', 'automationAmount',
  'animationGrowth', 'reverseAnimation', 'stripOffset', 'offsetRandom', 'depthMix', 'seed',
  'fillEnabled', 'affectBackground', 'noiseComplexity', 'noiseSeed',
  'stripSeed', 'featherStart', 'featherEnd', 'sortAmount',
];

interface VideoFrameMetadataLite {
  mediaTime: number;
  presentedFrames: number;
}

interface RuntimeAutomation {
  time: number;
  value: number;
  phase: number;
}

type FrameTrackedVideo = HTMLVideoElement & {
  requestVideoFrameCallback?(callback: (now: number, metadata: VideoFrameMetadataLite) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
};

function sourceDimensions(source: SourceElement): [number, number] {
  if (source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight];
  if (source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight];
  return [source.width, source.height];
}

function buildCubeVertices(): Float32Array {
  const values: number[] = [];
  const pushFace = (normal: [number, number, number], corners: Array<[number, number, number]>) => {
    const order = [0, 1, 2, 0, 2, 3];
    for (const index of order) values.push(...corners[index], ...normal);
  };
  pushFace([0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]);
  pushFace([0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]);
  pushFace([1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]);
  pushFace([-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]);
  pushFace([0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]);
  pushFace([0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]);
  return new Float32Array(values);
}

function drawContained(
  context: CanvasRenderingContext2D,
  source: SourceElement,
  width: number,
  height: number,
) {
  const [sourceWidth, sourceHeight] = sourceDimensions(source);
  if (sourceWidth <= 0 || sourceHeight <= 0) return false;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(source, (width - drawWidth) * 0.5, (height - drawHeight) * 0.5, drawWidth, drawHeight);
  return true;
}

export class GpuEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: EngineCallbacks;
  private context: GPUCanvasContext | null = null;
  private radiance2AtlasContext: GPUCanvasContext | null = null;
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private pipelines: Pipelines | null = null;
  private bindGroups: BindGroups | null = null;
  private sourceTexture: GPUTexture | null = null;
  private sortedTexture: GPUTexture | null = null;
  private indexTexture: GPUTexture | null = null;
  private maskTexture: GPUTexture | null = null;
  private cascadeTextures: [GPUTexture, GPUTexture] | null = null;
  private depthTexture: GPUTexture | null = null;
  private sortUniformBuffer: GPUBuffer | null = null;
  private cascadeUniformBuffer: GPUBuffer | null = null;
  private sceneUniformBuffer: GPUBuffer | null = null;
  private cubeVertexBuffer: GPUBuffer | null = null;
  private sampler: GPUSampler | null = null;
  private settings: EngineSettings = { ...DEFAULT_SETTINGS };
  private source: SourceElement | null = null;
  private sourceLabel = 'DEMO 2 / ZHANG';
  private sourceKind: SourceKind = 'demo2';
  private demoImage: HTMLImageElement | null = null;
  private demo2Image: HTMLImageElement | null = null;
  private readonly stagingCanvas = document.createElement('canvas');
  private readonly stagingContext: CanvasRenderingContext2D;
  private visualTime = 0;
  private lastTimestamp = 0;
  private statsTimestamp = 0;
  private statsFrames = 0;
  private manualYaw = 0;
  private manualPitch = 0;
  private manualDistance = 0;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private gpuName = 'WebGPU adapter';
  private sourceDirty = true;
  private sortDirty = true;
  private sceneDirty = true;
  private inFlightFrames = 0;
  private destroyed = false;
  private videoFrameCallback: number | null = null;
  private trackedVideo: FrameTrackedVideo | null = null;
  private sourceMediaTime = 0;
  private lastSourceMediaTime = -1;
  private lastUploadedVideoTime = -1;
  private sourceFps = 0;
  private lastGpuFrameMs = 0;
  private lastSubmittedTimestamp = 0;
  private submitFrameMs = 0;
  private qualityStress = 0;
  private activeQualityIndex = 1;
  private lastAutomationTime = Number.NaN;
  private lastSceneAutomationTime = Number.NaN;
  private frozenAutomationTime = 0;
  private cascadeTextureIndex = 0;
  private cascadeNeedsClear = true;
  private initialized = false;
  private suspended = false;
  private requestedWidth = 1;
  private requestedHeight = 1;
  private requestedDpr = 1;
  private canvasConfigurationDirty = true;
  private deviceWarning: string | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: EngineCallbacks,
    private experienceMode: ExperienceMode = 'sorter',
    private readonly radiance2AtlasCanvas: HTMLCanvasElement | null = null,
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.stagingCanvas.width = SORT_WIDTH;
    this.stagingCanvas.height = SORT_HEIGHT;
    const stagingContext = this.stagingCanvas.getContext('2d', { alpha: false });
    if (!stagingContext) throw new Error('Canvas 2D staging context is unavailable.');
    this.stagingContext = stagingContext;
    this.attachCameraControls();
  }

  async initialize() {
    if (this.destroyed) throw new Error('DepthSort engine was disposed before initialization.');
    if (!navigator.gpu) {
      throw new Error('WebGPU is unavailable. Open the app in a current Chrome, Edge, Safari, or supported Firefox build.');
    }
    this.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (this.destroyed) throw new Error('DepthSort engine was disposed during adapter initialization.');
    if (!this.adapter) throw new Error('No WebGPU adapter was found on this device.');
    this.device = await this.adapter.requestDevice();
    if (this.destroyed) {
      this.device.destroy();
      this.device = null;
      throw new Error('DepthSort engine was disposed during device initialization.');
    }
    this.device.lost.then((info) => {
      if (this.destroyed) return;
      this.initialized = false;
      this.deviceWarning = `GPU device lost: ${info.message || info.reason}`;
      this.callbacks.onError(this.deviceWarning);
    });
    const adapterWithInfo = this.adapter as GPUAdapter & { info?: GPUAdapterInfo };
    this.gpuName = adapterWithInfo.info?.description || adapterWithInfo.info?.vendor || 'WebGPU adapter';
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('Could not create the WebGPU canvas context.');
    if (this.radiance2AtlasCanvas) {
      this.radiance2AtlasContext = this.radiance2AtlasCanvas.getContext('webgpu');
      if (!this.radiance2AtlasContext) throw new Error('Could not create the Radiance 2 WebGPU atlas context.');
    }
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.createResources();
    await this.createPipelines();
    this.createBindGroups();
    await this.loadDemoSources();
    if (this.destroyed) throw new Error('DepthSort engine was disposed during source initialization.');
    this.initialized = true;
    this.lastTimestamp = performance.now();
    this.statsTimestamp = this.lastTimestamp - 501;
  }

  setExperienceMode(mode: ExperienceMode) {
    if (this.experienceMode === mode) return;
    this.experienceMode = mode;
    this.canvasConfigurationDirty = true;
    this.cascadeNeedsClear = true;
    this.sortDirty = true;
    this.sceneDirty = true;
  }

  resize(width: number, height: number, dpr: number) {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const nextDpr = Math.max(0.5, Math.min(3, dpr || 1));
    if (nextWidth === this.requestedWidth && nextHeight === this.requestedHeight && nextDpr === this.requestedDpr) return;
    this.requestedWidth = nextWidth;
    this.requestedHeight = nextHeight;
    this.requestedDpr = nextDpr;
    this.sceneDirty = true;
  }

  suspend(suspended: boolean) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    this.lastTimestamp = performance.now();
    if (suspended) this.stopVideoFrameTracking();
    else if (this.source instanceof HTMLVideoElement) this.startVideoFrameTracking(this.source);
  }

  frame(timestamp: number) {
    if (!this.initialized || this.destroyed || this.suspended) return;
    try {
      this.render(timestamp);
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
    }
  }

  get warning(): string | null {
    return this.deviceWarning;
  }

  setSettings(settings: EngineSettings) {
    const previous = this.settings;
    if (settings.paused && !previous.paused) {
      this.frozenAutomationTime = this.automationState().time;
    }
    this.settings = settings;
    if (SORT_SETTING_KEYS.some((key) => previous[key] !== settings[key])) this.sortDirty = true;
    if (previous.direction !== settings.direction
      || previous.enabled !== settings.enabled
      || previous.sortBlockSize !== settings.sortBlockSize
      || previous.seed !== settings.seed
      || previous.stripSeed !== settings.stripSeed) {
      this.cascadeNeedsClear = true;
    }
    this.sceneDirty = true;
    if (settings.qualityMode !== 'auto') {
      this.setQualityIndex(QUALITY_MODE_INDEX[settings.qualityMode]);
    }
  }

  setSource(source: SourceElement | null, label: string, kind: SourceKind) {
    this.stopVideoFrameTracking();
    this.source = source;
    this.sourceLabel = label.toUpperCase();
    this.sourceKind = kind;
    this.sourceDirty = true;
    this.sortDirty = true;
    this.sceneDirty = true;
    this.lastUploadedVideoTime = -1;
    this.lastSourceMediaTime = -1;
    this.sourceMediaTime = 0;
    this.sourceFps = 0;
    this.cascadeNeedsClear = true;
    if (source instanceof HTMLVideoElement) this.startVideoFrameTracking(source);
  }

  useProcedural() {
    this.setSource(this.demoImage, 'DEMO 1 / EDITORIAL SUBJECT', 'procedural');
  }

  useDemo2() {
    this.setSource(this.demo2Image, 'DEMO 2 / ZHANG', 'demo2');
  }

  private loadImage(path: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = path;
    });
  }

  private async loadDemoSources() {
    const demo2 = await this.loadImage('/depth/zhang.avif');
    this.demoImage = demo2;
    this.demo2Image = demo2;
    if (this.sourceKind === 'demo2' && demo2) this.useDemo2();
    else if (demo2) this.useProcedural();
  }

  private startVideoFrameTracking(video: FrameTrackedVideo) {
    this.trackedVideo = video;
    if (!video.requestVideoFrameCallback) return;
    const onFrame = (_now: number, metadata: VideoFrameMetadataLite) => {
      if (this.destroyed || this.trackedVideo !== video) return;
      const delta = metadata.mediaTime - this.lastSourceMediaTime;
      if (delta > 1 / 240 && delta < 1) {
        const instantaneousFps = 1 / delta;
        this.sourceFps = this.sourceFps > 0
          ? this.sourceFps * 0.86 + instantaneousFps * 0.14
          : instantaneousFps;
      }
      this.lastSourceMediaTime = metadata.mediaTime;
      this.sourceMediaTime = metadata.mediaTime;
      this.sourceDirty = true;
      this.videoFrameCallback = video.requestVideoFrameCallback?.(onFrame) ?? null;
    };
    this.videoFrameCallback = video.requestVideoFrameCallback(onFrame);
  }

  private stopVideoFrameTracking() {
    if (this.trackedVideo && this.videoFrameCallback !== null) {
      this.trackedVideo.cancelVideoFrameCallback?.(this.videoFrameCallback);
    }
    this.videoFrameCallback = null;
    this.trackedVideo = null;
  }

  private get qualityProfile() {
    return QUALITY_PROFILES[this.activeQualityIndex];
  }

  private setQualityIndex(nextIndex: number) {
    const clamped = Math.max(0, Math.min(QUALITY_PROFILES.length - 1, Math.round(nextIndex)));
    if (clamped === this.activeQualityIndex) return;
    this.activeQualityIndex = clamped;
    this.sourceDirty = true;
    this.sortDirty = true;
    this.sceneDirty = true;
    this.cascadeNeedsClear = true;
  }

  private targetFrameRate() {
    if (this.settings.targetFps === '30') return 30;
    if (this.settings.targetFps === '60') return 60;
    if (this.sourceFps > 8 && this.sourceFps < 121) return Math.max(12, Math.min(60, this.sourceFps));
    return this.source instanceof HTMLVideoElement ? 30 : 60;
  }

  private updateAutoQuality() {
    if (this.settings.qualityMode !== 'auto' || document.hidden || this.lastGpuFrameMs <= 0) return;
    const budget = 1000 / this.targetFrameRate();
    const gpuStressed = this.lastGpuFrameMs > budget * 0.92;
    const cadenceStressed = this.submitFrameMs > budget * 1.1;
    const cadenceHealthy = this.submitFrameMs <= 0 || this.submitFrameMs < budget * 1.03;
    if (gpuStressed || cadenceStressed) {
      this.qualityStress = Math.min(8, this.qualityStress + 1);
    } else if (this.lastGpuFrameMs < budget * 0.55 && cadenceHealthy) {
      this.qualityStress = Math.max(-120, this.qualityStress - 1);
    } else {
      this.qualityStress *= 0.8;
    }
    if (this.qualityStress >= 3 && this.activeQualityIndex < QUALITY_PROFILES.length - 1) {
      this.setQualityIndex(this.activeQualityIndex + 1);
      this.qualityStress = 0;
    } else if (this.qualityStress <= -90 && this.activeQualityIndex > 0) {
      this.setQualityIndex(this.activeQualityIndex - 1);
      this.qualityStress = 0;
    }
  }

  private automationState(): RuntimeAutomation {
    const sourceClockAvailable = this.source instanceof HTMLVideoElement && this.lastSourceMediaTime >= 0;
    const liveTime = this.settings.automationSync === 'source' && sourceClockAvailable
      ? this.sourceMediaTime
      : this.visualTime;
    const time = this.settings.paused ? this.frozenAutomationTime : liveTime;
    const rawPhase = this.settings.stripOffset + time * this.settings.automationRate;
    const phase = rawPhase - Math.floor(rawPhase);
    let value = Math.sin(phase * Math.PI * 2);
    if (this.settings.automationWave === 'triangle') value = 1 - 4 * Math.abs(phase - 0.5);
    else if (this.settings.automationWave === 'saw') value = phase * 2 - 1;
    else if (this.settings.automationWave === 'sample-hold') {
      const cycle = Math.floor(rawPhase);
      const hashed = Math.sin((cycle + this.settings.seed * 0.013) * 91.3458) * 47453.5453;
      value = (hashed - Math.floor(hashed)) * 2 - 1;
    }
    if (!this.settings.automationEnabled) value = 0;
    return { time, value, phase };
  }

  resetCamera() {
    this.manualYaw = 0;
    this.manualPitch = 0;
    this.manualDistance = 0;
    this.sceneDirty = true;
  }

  async snapshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not capture canvas.'))), 'image/png');
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.initialized = false;
    this.stopVideoFrameTracking();
    this.detachCameraControls();
    this.sourceTexture?.destroy();
    this.sortedTexture?.destroy();
    this.indexTexture?.destroy();
    this.maskTexture?.destroy();
    this.cascadeTextures?.forEach((texture) => texture.destroy());
    this.depthTexture?.destroy();
    this.sortUniformBuffer?.destroy();
    this.cascadeUniformBuffer?.destroy();
    this.sceneUniformBuffer?.destroy();
    this.cubeVertexBuffer?.destroy();
    this.context?.unconfigure();
    this.radiance2AtlasContext?.unconfigure();
    this.device?.destroy();
    this.context = null;
    this.radiance2AtlasContext = null;
    this.device = null;
  }

  private createResources() {
    const device = this.requireDevice();
    this.sourceTexture = device.createTexture({
      label: 'source-rgba',
      size: [SORT_WIDTH, SORT_HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sortedTexture = device.createTexture({
      label: 'sorted-rgba',
      size: [SORT_WIDTH, SORT_HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.indexTexture = device.createTexture({
      label: 'sorted-index-map',
      size: [SORT_WIDTH, SORT_HEIGHT],
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.maskTexture = device.createTexture({
      label: 'authoritative-effect-mask',
      size: [SORT_WIDTH, SORT_HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const makeCascadeTexture = (index: number) => device.createTexture({
      label: `radiance-waterfall-${index}`,
      size: [SORT_WIDTH, CASCADE_HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.cascadeTextures = [makeCascadeTexture(0), makeCascadeTexture(1)];
    this.sortUniformBuffer = device.createBuffer({
      label: 'sort-uniforms',
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.cascadeUniformBuffer = device.createBuffer({
      label: 'radiance-waterfall-uniforms',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sceneUniformBuffer = device.createBuffer({
      label: 'scene-uniforms',
      size: 288,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const vertices = buildCubeVertices();
    this.cubeVertexBuffer = device.createBuffer({
      label: 'cube-vertices',
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      this.cubeVertexBuffer,
      0,
      vertices.buffer as ArrayBuffer,
      vertices.byteOffset,
      vertices.byteLength,
    );
    this.sampler = device.createSampler({
      label: 'linear-clamp',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private async createPipelines() {
    const device = this.requireDevice();
    const sortModule = device.createShaderModule({ label: 'segmented-sort-wgsl', code: sortShader });
    const cascadeModule = device.createShaderModule({ label: 'radiance-waterfall-wgsl', code: cascadeShader });
    const renderModule = device.createShaderModule({ label: 'depthsort-render-wgsl', code: renderShader });
    const sort = await device.createComputePipelineAsync({
      label: 'segmented-sort-pipeline',
      layout: 'auto',
      compute: { module: sortModule, entryPoint: 'sortMain' },
    });
    const cascade = await device.createComputePipelineAsync({
      label: 'radiance-waterfall-pipeline',
      layout: 'auto',
      compute: { module: cascadeModule, entryPoint: 'cascadeMain' },
    });
    const cube = await device.createRenderPipelineAsync({
      label: 'voxel-pipeline',
      layout: 'auto',
      vertex: {
        module: renderModule,
        entryPoint: 'cubeVertex',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: renderModule,
        entryPoint: 'cubeFragment',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });
    const plane = await device.createRenderPipelineAsync({
      label: 'source-plane-pipeline',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'planeVertex' },
      fragment: {
        module: renderModule,
        entryPoint: 'planeFragment',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const quad = await device.createRenderPipelineAsync({
      label: 'preview-2d-pipeline',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'quadVertex' },
      fragment: {
        module: renderModule,
        entryPoint: 'quadFragment',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const radiance2Material = await device.createRenderPipelineAsync({
      label: 'radiance2-material-atlas-pipeline',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'quadVertex' },
      fragment: {
        module: renderModule,
        entryPoint: 'radiance2MaterialFragment',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.pipelines = { sort, cascade, plane, cube, quad, radiance2Material };
  }

  private createBindGroups() {
    const device = this.requireDevice();
    const pipelines = this.requirePipelines();
    const sourceTexture = this.requireTexture(this.sourceTexture);
    const sortedTexture = this.requireTexture(this.sortedTexture);
    const indexTexture = this.requireTexture(this.indexTexture);
    const maskTexture = this.requireTexture(this.maskTexture);
    if (!this.cascadeTextures) throw new Error('Radiance waterfall textures are unavailable.');
    const cascadeTextures = this.cascadeTextures;
    const sortUniformBuffer = this.requireBuffer(this.sortUniformBuffer);
    const cascadeUniformBuffer = this.requireBuffer(this.cascadeUniformBuffer);
    const sceneUniformBuffer = this.requireBuffer(this.sceneUniformBuffer);
    if (!this.sampler) throw new Error('Sampler is unavailable.');
    const sort = device.createBindGroup({
      layout: pipelines.sort.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: sortUniformBuffer } },
        { binding: 1, resource: sourceTexture.createView() },
        { binding: 2, resource: sortedTexture.createView() },
        { binding: 3, resource: indexTexture.createView() },
        { binding: 4, resource: maskTexture.createView() },
      ],
    });
    const cascade = cascadeTextures.map((outputTexture, outputIndex) => {
      const previousTexture = cascadeTextures[1 - outputIndex];
      return device.createBindGroup({
        layout: pipelines.cascade.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: cascadeUniformBuffer } },
          { binding: 1, resource: previousTexture.createView() },
          { binding: 2, resource: outputTexture.createView() },
          { binding: 3, resource: sortedTexture.createView() },
          { binding: 4, resource: indexTexture.createView() },
          { binding: 5, resource: maskTexture.createView() },
        ],
      });
    }) as [GPUBindGroup, GPUBindGroup];
    const renderEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: sceneUniformBuffer } },
      { binding: 1, resource: sourceTexture.createView() },
      { binding: 2, resource: sortedTexture.createView() },
      { binding: 3, resource: indexTexture.createView() },
      { binding: 4, resource: this.sampler },
      { binding: 5, resource: maskTexture.createView() },
    ];
    const cube = device.createBindGroup({ layout: pipelines.cube.getBindGroupLayout(0), entries: renderEntries });
    const plane = device.createBindGroup({ layout: pipelines.plane.getBindGroupLayout(0), entries: renderEntries });
    const quad = cascadeTextures.map((cascadeTexture) => device.createBindGroup({
      layout: pipelines.quad.getBindGroupLayout(0),
      entries: [...renderEntries, { binding: 6, resource: cascadeTexture.createView() }],
    })) as [GPUBindGroup, GPUBindGroup];
    const radiance2Material = device.createBindGroup({
      layout: pipelines.radiance2Material.getBindGroupLayout(0),
      entries: renderEntries,
    });
    this.bindGroups = { sort, cascade, plane, cube, quad, radiance2Material };
  }

  private render(timestamp: number) {
    const delta = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
    this.lastTimestamp = timestamp;
    if (!this.settings.paused) this.visualTime += delta;
    // Keep latency bounded without serializing the CPU behind every GPU frame.
    // Two frames in flight lets upload/dispatch overlap while retaining a
    // latest-frame-wins policy when the GPU is genuinely saturated.
    if (this.inFlightFrames >= 2) return;
    this.resizeIfNeeded();
    const sourceUpdated = this.settings.paused ? false : this.updateSourceFrame();
    const automation = this.automationState();
    const animationAffectsSort = this.settings.automationEnabled
      && this.settings.automationTarget !== 'look';
    const automationChanged = animationAffectsSort
      && (!Number.isFinite(this.lastAutomationTime) || Math.abs(automation.time - this.lastAutomationTime) > 0.00001);
    const sortOutputNeeded = this.experienceMode === 'radiance2' || this.settings.viewMode !== 'source';
    if (sourceUpdated && !sortOutputNeeded) this.sortDirty = true;
    const shouldCompute = sortOutputNeeded && (sourceUpdated || this.sortDirty || automationChanged);
    const animationAffectsScene = !this.settings.paused && (
      Math.abs(this.settings.autoOrbit) > 0.00001
      || (this.settings.automationEnabled
        && (this.settings.automationTarget === 'look' || this.settings.automationTarget === 'all'))
    );
    const sceneAnimationChanged = animationAffectsScene
      && (!Number.isFinite(this.lastSceneAutomationTime)
        || Math.abs(automation.time - this.lastSceneAutomationTime) > 0.00001);
    const shouldAdvanceCascade = this.experienceMode === 'radiance'
      && !this.settings.paused
      && this.settings.enabled
      && this.settings.direction === 'vertical'
      && (this.settings.viewMode === 'sorted' || this.settings.viewMode === 'voxel');
    if (!sourceUpdated && !shouldCompute && !this.sceneDirty && !sceneAnimationChanged && !shouldAdvanceCascade) return;
    if (shouldCompute) this.writeSortUniforms(automation);
    const { instanceCount, camera } = this.writeSceneUniforms(automation);
    const device = this.requireDevice();
    const context = this.requireContext();
    const pipelines = this.requirePipelines();
    const bindGroups = this.requireBindGroups();
    const encoder = device.createCommandEncoder({ label: 'depthsort-frame' });
    if (shouldCompute) {
      const compute = encoder.beginComputePass({ label: 'segmented-pixel-sort' });
      compute.setPipeline(pipelines.sort);
      compute.setBindGroup(0, bindGroups.sort);
      const lineCount = this.settings.direction === 'horizontal'
        ? this.qualityProfile.height
        : this.qualityProfile.width;
      compute.dispatchWorkgroups(lineCount, 1, 1);
      compute.end();
    }
    if (shouldAdvanceCascade) {
      const outputIndex = 1 - this.cascadeTextureIndex;
      this.writeCascadeUniforms(shouldCompute);
      const cascade = encoder.beginComputePass({ label: 'radiance-waterfall-advance' });
      cascade.setPipeline(pipelines.cascade);
      cascade.setBindGroup(0, bindGroups.cascade[outputIndex]);
      cascade.dispatchWorkgroups(
        Math.ceil(this.qualityProfile.width / 8),
        Math.ceil(CASCADE_HEIGHT / 8),
        1,
      );
      cascade.end();
      this.cascadeTextureIndex = outputIndex;
      this.cascadeNeedsClear = false;
    }
    const background = this.settings.background;
    const pass = encoder.beginRenderPass({
      label: 'depthsort-present',
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: background, g: background * 1.08, b: background * 1.1, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: this.settings.viewMode === 'voxel' && this.settings.geometryEnabled && this.depthTexture ? {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      } : undefined,
    });
    if (this.settings.viewMode === 'voxel') {
      if (this.settings.geometryEnabled) {
        pass.setPipeline(pipelines.plane);
        pass.setBindGroup(0, bindGroups.plane);
        pass.draw(6, 1, 0, 0);
        pass.setPipeline(pipelines.cube);
        pass.setBindGroup(0, bindGroups.cube);
        pass.setVertexBuffer(0, this.requireBuffer(this.cubeVertexBuffer));
        pass.draw(36, instanceCount, 0, 0);
      } else {
        pass.setPipeline(pipelines.quad);
        pass.setBindGroup(0, bindGroups.quad[this.cascadeTextureIndex]);
        pass.draw(3, 1, 0, 0);
      }
    } else {
      pass.setPipeline(pipelines.quad);
      pass.setBindGroup(0, bindGroups.quad[this.cascadeTextureIndex]);
      pass.draw(3, 1, 0, 0);
    }
    pass.end();
    if (this.experienceMode === 'radiance2' && this.radiance2AtlasContext) {
      const materialPass = encoder.beginRenderPass({
        label: 'radiance2-material-atlas',
        colorAttachments: [{
          view: this.radiance2AtlasContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      materialPass.setPipeline(pipelines.radiance2Material);
      materialPass.setBindGroup(0, bindGroups.radiance2Material);
      materialPass.draw(3, 1, 0, 0);
      materialPass.end();
    }
    const submittedAt = performance.now();
    if (this.lastSubmittedTimestamp > 0) {
      const submitInterval = timestamp - this.lastSubmittedTimestamp;
      this.submitFrameMs = this.submitFrameMs > 0
        ? this.submitFrameMs * 0.8 + submitInterval * 0.2
        : submitInterval;
    }
    this.lastSubmittedTimestamp = timestamp;
    device.queue.submit([encoder.finish()]);
    this.inFlightFrames += 1;
    const pendingAtSubmit = this.inFlightFrames;
    if (shouldCompute) {
      this.sortDirty = false;
      this.lastAutomationTime = automation.time;
    }
    this.sceneDirty = false;
    this.lastSceneAutomationTime = automation.time;
    void device.queue.onSubmittedWorkDone().then(() => {
      if (this.destroyed) return;
      if (shouldCompute) {
        this.lastGpuFrameMs = (performance.now() - submittedAt) / pendingAtSubmit;
        this.updateAutoQuality();
      }
      this.inFlightFrames = Math.max(0, this.inFlightFrames - 1);
    }).catch((cause: unknown) => {
      this.inFlightFrames = Math.max(0, this.inFlightFrames - 1);
      if (this.destroyed) return;
      this.callbacks.onError(cause instanceof Error ? cause.message : String(cause));
    });
    const visibleInstances = this.settings.viewMode === 'voxel' && this.settings.geometryEnabled
      ? instanceCount
      : 0;
    this.updateStats(timestamp, visibleInstances, camera);
  }

  private resizeIfNeeded() {
    const device = this.requireDevice();
    const context = this.requireContext();
    const ratio = Math.min(this.requestedDpr, 1.5) * this.qualityProfile.renderScale;
    const width = Math.max(1, Math.min(2560, Math.round(this.requestedWidth * ratio)));
    const height = Math.max(1, Math.min(1440, Math.round(this.requestedHeight * ratio)));
    if (this.canvas.width === width && this.canvas.height === height && this.depthTexture && !this.canvasConfigurationDirty) return;
    this.sceneDirty = true;
    this.canvas.width = width;
    this.canvas.height = height;
    context.configure({
      device,
      format: this.format,
      alphaMode: this.experienceMode === 'radiance' ? 'premultiplied' : 'opaque',
    });
    if (this.radiance2AtlasCanvas && this.radiance2AtlasContext) {
      this.radiance2AtlasCanvas.width = RADIANCE2_ATLAS_WIDTH;
      this.radiance2AtlasCanvas.height = RADIANCE2_ATLAS_HEIGHT;
      this.radiance2AtlasContext.configure({
        device,
        format: this.format,
        alphaMode: 'opaque',
      });
    }
    this.canvasConfigurationDirty = false;
    this.depthTexture?.destroy();
    this.depthTexture = device.createTexture({
      label: 'scene-depth',
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private updateSourceFrame() {
    const profile = this.qualityProfile;
    if (this.source instanceof HTMLVideoElement) {
      const currentTime = this.source.currentTime;
      const tracksDecodedFrames = Boolean(this.source.requestVideoFrameCallback);
      // currentTime advances continuously between decoded frames. When rVFC
      // exists, sourceDirty is the authoritative signal; comparing currentTime
      // would sort the same decoded image again at the monitor's 60 Hz cadence.
      if (tracksDecodedFrames && !this.sourceDirty) return false;
      if (!tracksDecodedFrames && !this.sourceDirty && Math.abs(currentTime - this.lastUploadedVideoTime) < 0.00001) return false;
      if (this.source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
      if (!tracksDecodedFrames && currentTime !== this.lastUploadedVideoTime) {
        const delta = currentTime - this.lastUploadedVideoTime;
        if (delta > 1 / 240 && delta < 1) {
          const instantaneousFps = 1 / delta;
          this.sourceFps = this.sourceFps > 0 ? this.sourceFps * 0.86 + instantaneousFps * 0.14 : instantaneousFps;
        }
        this.lastSourceMediaTime = currentTime;
      }
      this.sourceMediaTime = currentTime;
    } else if (!this.sourceDirty && this.source) {
      return false;
    }
    const context = this.stagingContext;
    context.save();
    context.fillStyle = '#050607';
    context.fillRect(0, 0, profile.width, profile.height);
    let drewSource = false;
    if (this.source) {
      if (!(this.source instanceof HTMLVideoElement) || this.source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        drewSource = drawContained(context, this.source, profile.width, profile.height);
      }
    }
    if (!drewSource) this.drawProceduralSource(context, this.visualTime);
    context.restore();
    this.requireDevice().queue.copyExternalImageToTexture(
      { source: this.stagingCanvas },
      { texture: this.requireTexture(this.sourceTexture) },
      [profile.width, profile.height],
    );
    if (this.source instanceof HTMLVideoElement) this.lastUploadedVideoTime = this.source.currentTime;
    this.sourceDirty = !drewSource && !this.source;
    return true;
  }

  private drawProceduralSource(context: CanvasRenderingContext2D, time: number) {
    const { width, height } = this.qualityProfile;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.7);
    const base = context.createRadialGradient(width * 0.52, height * 0.42, 20, width * 0.52, height * 0.42, width * 0.7);
    base.addColorStop(0, '#30343a');
    base.addColorStop(0.42, '#171a1f');
    base.addColorStop(1, '#050608');
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    context.globalCompositeOperation = 'screen';
    for (let i = 0; i < 7; i += 1) {
      const phase = time * 0.12 + i * 1.73;
      const x = width * (0.15 + (i / 6) * 0.72 + Math.sin(phase) * 0.025);
      const y = height * (0.24 + Math.cos(phase * 0.83) * 0.18);
      const haze = context.createRadialGradient(x, y, 0, x, y, 70 + i * 11);
      haze.addColorStop(0, `rgba(${130 + i * 8}, ${150 + i * 5}, ${170 + i * 4}, ${0.05 + pulse * 0.025})`);
      haze.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = haze;
      context.fillRect(x - 170, y - 170, 340, 340);
    }

    context.globalCompositeOperation = 'source-over';
    const metal = context.createLinearGradient(width * 0.3, 0, width * 0.72, height);
    metal.addColorStop(0, '#34383e');
    metal.addColorStop(0.24, '#e4e7e9');
    metal.addColorStop(0.38, '#61666d');
    metal.addColorStop(0.57, '#f4f5f2');
    metal.addColorStop(0.73, '#4e535a');
    metal.addColorStop(1, '#c3c7ca');
    context.fillStyle = metal;
    context.beginPath();
    context.moveTo(width * 0.25, height);
    context.quadraticCurveTo(width * 0.29, height * 0.72, width * 0.43, height * 0.68);
    context.lineTo(width * 0.45, height * 0.57);
    context.lineTo(width * 0.58, height * 0.57);
    context.lineTo(width * 0.61, height * 0.69);
    context.quadraticCurveTo(width * 0.77, height * 0.73, width * 0.82, height);
    context.closePath();
    context.fill();

    const face = context.createLinearGradient(width * 0.4, height * 0.12, width * 0.63, height * 0.6);
    face.addColorStop(0, '#f7f8f6');
    face.addColorStop(0.22, '#777c83');
    face.addColorStop(0.47, '#dadde0');
    face.addColorStop(0.7, '#30343a');
    face.addColorStop(1, '#b9bec2');
    context.fillStyle = face;
    context.beginPath();
    context.ellipse(width * 0.515, height * 0.38, width * 0.115, height * 0.27, -0.03, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#090b0e';
    context.beginPath();
    context.roundRect(width * 0.405, height * 0.245, width * 0.225, height * 0.105, 34);
    context.fill();
    const visor = context.createLinearGradient(width * 0.41, 0, width * 0.63, 0);
    visor.addColorStop(0, 'rgba(45,55,65,0.3)');
    visor.addColorStop(0.55 + pulse * 0.08, 'rgba(220,235,242,0.76)');
    visor.addColorStop(1, 'rgba(30,36,42,0.28)');
    context.fillStyle = visor;
    context.beginPath();
    context.roundRect(width * 0.42, height * 0.26, width * 0.195, height * 0.075, 26);
    context.fill();

    context.strokeStyle = 'rgba(255,255,255,0.42)';
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(width * 0.515, height * 0.38, width * 0.115, height * 0.27, -0.03, 0, Math.PI * 2);
    context.stroke();

  }

  private writeCascadeUniforms(injectNewEdge: boolean) {
    const profile = this.qualityProfile;
    const data = new Uint32Array(8);
    data[0] = profile.width;
    data[1] = profile.height;
    data[2] = CASCADE_HEIGHT;
    data[3] = 2;
    data[4] = this.cascadeNeedsClear ? 1 : 0;
    data[5] = Math.max(1, Math.round(this.settings.sortBlockSize));
    data[6] = Math.max(0, Math.round(this.settings.seed + this.settings.stripSeed));
    data[7] = injectNewEdge ? 1 : 0;
    this.requireDevice().queue.writeBuffer(this.requireBuffer(this.cascadeUniformBuffer), 0, data);
  }

  private writeSortUniforms(automation: RuntimeAutomation) {
    const profile = this.qualityProfile;
    const target = this.settings.automationTarget;
    const amount = this.settings.automationEnabled
      ? automation.value * this.settings.automationAmount
      : 0;
    const automateThresholds = target === 'thresholds' || target === 'all';
    const automateMask = target === 'mask' || target === 'all';
    const automateStrips = target === 'strips' || target === 'all';
    const thresholdShift = automateThresholds ? amount * 0.16 : 0;
    const thresholdMin = Math.max(0, Math.min(0.995, this.settings.thresholdMin + thresholdShift));
    const thresholdMax = Math.max(thresholdMin + 0.005, Math.min(1, this.settings.thresholdMax + thresholdShift));
    const maskThreshold = Math.max(0, Math.min(1, this.settings.maskThreshold + (automateMask ? amount * 0.12 : 0)));
    const noiseAmount = Math.max(0, Math.min(1, this.settings.noiseAmount * (automateMask ? 1 + amount * 0.8 : 1)));
    const stripGrowth = automateStrips
      ? Math.max(0.2, Math.min(1.8, 1 + amount * this.settings.animationGrowth))
      : 1;
    const sourceScale = profile.width / SORT_WIDTH;
    const maxSpan = this.settings.maxSpan <= 0
      ? 0
      : Math.max(4, Math.min(
        profile.maxSpan,
        Math.round(this.settings.maxSpan * sourceScale * stripGrowth),
      ));
    const outsideReach = Math.max(0, Math.min(
      profile.outsideReach,
      Math.round(this.settings.outsideReach * sourceScale * stripGrowth),
    ));
    // This only reverses the travel of the sorted pixels. Threshold/mask/look
    // automation keep their original timeline, so a direction flip is visual
    // and does not change the rest of an automation setup.
    const animatedStripPhase = this.settings.reverseAnimation
      ? (1 - automation.phase) % 1
      : automation.phase;
    const stripPhase = automateStrips ? animatedStripPhase : this.settings.stripOffset;
    const buffer = new ArrayBuffer(144);
    const floats = new Float32Array(buffer);
    const integers = new Uint32Array(buffer);
    floats[0] = thresholdMin;
    floats[1] = thresholdMax;
    floats[2] = this.settings.depthMix;
    floats[3] = automation.time;
    integers[4] = profile.width;
    integers[5] = profile.height;
    integers[6] = this.settings.direction === 'horizontal' ? 0 : 1;
    integers[7] = this.settings.ascending ? 1 : 0;
    integers[8] = METRIC_INDEX[this.settings.triggerMetric];
    integers[9] = METRIC_INDEX[this.settings.sortMetric];
    integers[10] = this.settings.affectOutside ? 1 : 0;
    integers[11] = this.settings.seed >>> 0;
    integers[12] = MASK_INDEX[this.settings.maskMode];
    integers[13] = this.settings.maskInvert ? 1 : 0;
    floats[14] = maskThreshold;
    floats[15] = this.settings.maskFeather;
    floats[16] = this.settings.edgeSensitivity;
    floats[17] = noiseAmount;
    floats[18] = this.settings.noiseScale;
    integers[19] = maxSpan;
    floats[20] = this.settings.maskCenterX;
    floats[21] = this.settings.maskCenterY;
    floats[22] = this.settings.maskRadius;
    floats[23] = this.settings.maskAspect;
    integers[24] = outsideReach;
    integers[25] = SPILL_DIRECTION_INDEX[this.settings.spillDirection];
    floats[26] = stripPhase;
    floats[27] = this.settings.offsetRandom;
    integers[28] = this.settings.fillEnabled ? 1 : 0;
    integers[29] = this.settings.affectBackground ? 1 : 0;
    integers[30] = Math.max(1, Math.min(8, Math.round(this.settings.noiseComplexity)));
    integers[31] = this.settings.noiseSeed >>> 0;
    integers[32] = this.settings.stripSeed >>> 0;
    floats[33] = this.settings.featherStart;
    floats[34] = this.settings.featherEnd;
    floats[35] = this.settings.sortAmount;
    this.requireDevice().queue.writeBuffer(this.requireBuffer(this.sortUniformBuffer), 0, buffer);
  }

  private writeSceneUniforms(automation: RuntimeAutomation) {
    const profile = this.qualityProfile;
    const sourceAspect = profile.width / profile.height;
    const gridWidth = Math.max(32, Math.min(profile.width, Math.round(this.settings.gridWidth * profile.gridScale)));
    const gridHeight = Math.max(18, Math.round(gridWidth / sourceAspect));
    const target = this.settings.automationTarget;
    const lookAmount = this.settings.automationEnabled && (target === 'look' || target === 'all')
      ? automation.value * this.settings.automationAmount
      : 0;
    // Opacity stays at 1: effect intensity is resolved in the sort pass by
    // selecting a progressively less-displaced source pixel (sortAmount).
    // This prevents a source/sorted crossfade in every output mode.
    const mixAmount = 1;
    const depthScale = Math.max(0, this.settings.depthScale * (1 + lookAmount * 0.55));
    const yaw = this.settings.cameraYaw + this.manualYaw + automation.time * this.settings.autoOrbit;
    const pitch = Math.max(-1.25, Math.min(1.25, this.settings.cameraPitch + this.manualPitch));
    const distance = Math.max(2.4, this.settings.cameraDistance + this.manualDistance);
    const eye = vec3.fromValues(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    const view = mat4.create();
    const projection = mat4.create();
    const viewProjection = mat4.create();
    mat4.lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
    mat4.perspective(projection, Math.PI / 4.4, this.canvas.width / this.canvas.height, 0.05, 100);
    mat4.multiply(viewProjection, projection, view);
    const data = new Float32Array(72);
    data.set(viewProjection, 0);
    data[16] = profile.width;
    data[17] = profile.height;
    data[18] = gridWidth;
    data[19] = gridHeight;
    data[20] = automation.time;
    data[21] = this.settings.depthMix;
    data[22] = depthScale;
    data[23] = this.settings.depthCurve;
    data[24] = this.settings.carryDepth;
    data[25] = this.settings.sortPosition;
    data[26] = this.settings.sortExtrusion;
    data[27] = this.settings.blockScale;
    data[28] = this.settings.blockDepth;
    data[29] = this.settings.gap;
    data[30] = this.settings.fog;
    data[31] = this.settings.lightIntensity;
    data[32] = mixAmount;
    data[33] = this.settings.background;
    data[34] = this.settings.enabled ? 1 : 0;
    data[35] = this.settings.viewMode === 'voxel' ? 4 : VIEW_MODE_INDEX[this.settings.viewMode];
    data[36] = eye[0];
    data[37] = eye[1];
    data[38] = eye[2];
    data[39] = this.settings.direction === 'horizontal' ? 0 : 1;
    data[40] = MASK_INDEX[this.settings.maskMode];
    data[41] = this.settings.maskThreshold;
    data[42] = this.settings.maskFeather;
    data[43] = this.settings.edgeSensitivity;
    data[44] = this.settings.noiseAmount;
    data[45] = this.settings.noiseScale;
    data[46] = this.settings.maskInvert ? 1 : 0;
    data[47] = this.settings.maskSpill;
    data[48] = this.settings.maskCenterX;
    data[49] = this.settings.maskCenterY;
    data[50] = this.settings.maskRadius;
    data[51] = this.settings.maskAspect;
    data[52] = this.canvas.width;
    data[53] = this.canvas.height;
    data[56] = this.experienceMode === 'radiance' ? 1 : this.experienceMode === 'radiance2' ? 2 : 0;
    data[57] = this.settings.radianceStrength;
    data[58] = this.settings.radianceReach;
    data[59] = this.settings.radianceSpread;
    data[60] = Math.max(1, Math.round(this.settings.sortBlockSize));
    data[61] = this.experienceMode === 'radiance2'
      ? this.settings.radianceEmissionFloor
      : this.settings.radianceEmitterCutoff;
    data[62] = this.settings.radianceAbsorption;
    data[63] = this.settings.radianceEmitterTravel;
    data[64] = this.settings.radianceOccluderHue;
    data[65] = this.settings.radianceHueRange;
    data[66] = this.settings.radianceSaturationFloor;
    data[67] = this.settings.radianceMaterialContrast;
    data[68] = this.settings.displayBrightness;
    data[69] = this.settings.displayContrast;
    data[70] = this.settings.displayZoom;
    data[71] = 0;
    this.requireDevice().queue.writeBuffer(this.requireBuffer(this.sceneUniformBuffer), 0, data);
    return { instanceCount: gridWidth * gridHeight, camera: eye };
  }

  private updateStats(timestamp: number, instances: number, _camera: vec3) {
    this.statsFrames += 1;
    if (timestamp - this.statsTimestamp < 500) return;
    const elapsed = timestamp - this.statsTimestamp;
    const profile = this.qualityProfile;
    this.callbacks.onStats({
      fps: Math.round((this.statsFrames * 1000) / elapsed),
      frameMs: Number(this.lastGpuFrameMs.toFixed(1)),
      gpuName: this.gpuName,
      backend: 'webgpu',
      sortResolution: `${profile.width}×${profile.height}`,
      sourceFps: Math.round(this.sourceFps),
      gpuFrameMs: Number(this.lastGpuFrameMs.toFixed(1)),
      qualityLabel: `${this.settings.qualityMode === 'auto' ? 'AUTO / ' : ''}${profile.label}`,
      instances,
      sourceLabel: this.sourceLabel,
    });
    this.statsFrames = 0;
    this.statsTimestamp = timestamp;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.dragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.manualYaw += deltaX * 0.006;
    this.manualPitch = Math.max(-1.05, Math.min(1.05, this.manualPitch + deltaY * 0.005));
    this.sceneDirty = true;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.manualDistance = Math.max(-2, Math.min(8, this.manualDistance + event.deltaY * 0.004));
    this.sceneDirty = true;
  };

  private attachCameraControls() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private detachCameraControls() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private requireDevice() {
    if (!this.device) throw new Error('GPU device is not initialized.');
    return this.device;
  }

  private requireContext() {
    if (!this.context) throw new Error('GPU canvas context is not initialized.');
    return this.context;
  }

  private requirePipelines() {
    if (!this.pipelines) throw new Error('GPU pipelines are not initialized.');
    return this.pipelines;
  }

  private requireBindGroups() {
    if (!this.bindGroups) throw new Error('GPU bind groups are not initialized.');
    return this.bindGroups;
  }

  private requireTexture(texture: GPUTexture | null) {
    if (!texture) throw new Error('GPU texture is not initialized.');
    return texture;
  }

  private requireBuffer(buffer: GPUBuffer | null) {
    if (!buffer) throw new Error('GPU buffer is not initialized.');
    return buffer;
  }
}
