import type {
  QualityLevel,
  SceneFrame,
  SceneRuntimeTelemetry,
  VisualScene,
} from '../../core/types';
import { GpuEngine } from './GpuEngine';
import {
  DEFAULT_SETTINGS,
  type EngineSettings,
  type EngineStats,
  type ExperienceMode,
  type QualityMode,
} from './engine-types';
import { RadianceOverlay } from './radiance/RadianceOverlay';

type DepthLook = ExperienceMode;

const LOOKS = new Set<DepthLook>(['sorter', 'radiance', 'radiance2']);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

const parameter = (frame: SceneFrame, id: string, fallback: number): number => {
  const value = frame.params[id];
  return Number.isFinite(value) ? value : fallback;
};

const engineQuality = (quality: QualityLevel): QualityMode => {
  if (quality === 'high') return 'full';
  if (quality === 'balanced') return 'balanced';
  return 'performance';
};

const hrcQuality = (quality: QualityLevel): 'high' | 'safe' =>
  quality === 'high' ? 'high' : 'safe';

const styleCanvas = (canvas: HTMLCanvasElement, zIndex: number): void => {
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none',
    zIndex: String(zIndex),
  });
};

export class DepthSortScene implements VisualScene {
  readonly id = 'depth-sort' as const;

  private host: HTMLElement | null = null;
  private root: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private atlasCanvas: HTMLCanvasElement | null = null;
  private radianceCanvas: HTMLCanvasElement | null = null;
  private engine: GpuEngine | null = null;
  private overlay: RadianceOverlay | null = null;
  private settings: EngineSettings = { ...DEFAULT_SETTINGS };
  private look: DepthLook = 'sorter';
  private quality: QualityLevel = 'high';
  private suspended = false;
  private disposed = false;
  private initialized = false;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private previousHostPosition = '';
  private latestStats: EngineStats | null = null;
  private warning: string | null = null;

  async init(host: HTMLElement, quality: QualityLevel): Promise<void> {
    if (this.initialized) return;
    if (this.disposed) throw new Error('DepthSort scene has already been disposed.');

    this.host = host;
    this.quality = quality;
    this.previousHostPosition = host.style.position;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      background: '#000',
      contain: 'strict',
    });

    const canvas = document.createElement('canvas');
    canvas.dataset.sceneLayer = 'depth-sort-output';
    styleCanvas(canvas, 0);

    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.dataset.sceneLayer = 'depth-sort-radiance2-atlas';
    atlasCanvas.style.display = 'none';

    const radianceCanvas = document.createElement('canvas');
    radianceCanvas.dataset.sceneLayer = 'depth-sort-radiance';
    styleCanvas(radianceCanvas, 1);
    radianceCanvas.style.display = 'none';

    root.append(canvas, atlasCanvas, radianceCanvas);
    host.append(root);
    this.root = root;
    this.canvas = canvas;
    this.atlasCanvas = atlasCanvas;
    this.radianceCanvas = radianceCanvas;

    const engine = new GpuEngine(canvas, {
      onStats: (stats) => { this.latestStats = stats; },
      onError: (message) => { this.warning = message; },
    }, this.look, atlasCanvas);
    this.engine = engine;
    this.settings = {
      ...DEFAULT_SETTINGS,
      sourceKind: 'demo2',
      viewMode: 'voxel',
      geometryEnabled: false,
      qualityMode: engineQuality(quality),
    };
    engine.setSettings(this.settings);
    await engine.initialize();
    if (this.disposed) throw new Error('DepthSort scene was disposed during initialization.');

    this.initialized = true;
    const bounds = host.getBoundingClientRect();
    this.resize(Math.max(1, bounds.width), Math.max(1, bounds.height), window.devicePixelRatio || 1);
    this.activateLook(this.look);
  }

  enter(look: string): void {
    this.activateLook(LOOKS.has(look as DepthLook) ? look as DepthLook : 'sorter');
  }

  frame(frame: SceneFrame): void {
    if (!this.initialized || this.disposed || this.suspended || !this.engine) return;
    const nextLook = LOOKS.has(frame.look as DepthLook) ? frame.look as DepthLook : 'sorter';
    if (nextLook !== this.look) this.activateLook(nextLook);
    if (frame.quality !== this.quality) this.setQuality(frame.quality);
    if (frame.width !== this.width || frame.height !== this.height || frame.dpr !== this.dpr) {
      this.resize(frame.width, frame.height, frame.dpr);
    }

    const strength = clamp(parameter(frame, 'strength', 0.72), 0, 1.5);
    const speed = clamp(parameter(frame, 'speed', 0.7), 0, 2.5);
    const depth = clamp(parameter(frame, 'depth', 0.9), 0, 2);
    const spread = clamp(parameter(frame, 'spread', 0.66), 0, 2);
    const feedback = clamp(parameter(frame, 'feedback', 0.72), 0, 1);
    const contrast = clamp(parameter(frame, 'contrast', 1.08), 0.5, 2);
    const brightness = clamp(parameter(frame, 'brightness', 1), 0.2, 2);
    const zoom = clamp(parameter(frame, 'cameraZoom', 1), 0.4, 2.2);

    this.settings = {
      ...this.settings,
      enabled: strength > 0.001,
      paused: false,
      sourceKind: 'demo2',
      viewMode: 'voxel',
      direction: 'vertical',
      geometryEnabled: false,
      qualityMode: engineQuality(this.quality),
      sortAmount: clamp(strength, 0, 1),
      automationEnabled: speed > 0.001,
      automationRate: speed * (0.325 / 0.7),
      automationAmount: clamp(0.12 + strength * 0.28, 0, 0.75),
      animationGrowth: 0.35 + feedback * 0.9,
      offsetRandom: feedback * 0.42,
      sortBlockSize: Math.round(clamp(2 + spread * 9, 1, 24)),
      depthScale: depth * 0.025,
      radianceStrength: 0.5 + strength * 1.2,
      radianceReach: 0.32 + spread * 0.5,
      radianceSpread: spread,
      radianceAbsorption: 0.58 + feedback * 0.42,
      radianceBounce: feedback * 0.08,
      displayBrightness: brightness,
      displayContrast: contrast,
      displayZoom: zoom,
    };

    this.engine.setSettings(this.settings);
    // SceneFrame.now is expressed in seconds by the show host; the original
    // DepthSort scheduler uses DOMHighResTimeStamp milliseconds.
    this.engine.frame(frame.now * 1000);
    if (this.overlay) {
      this.overlay.setSettings({
        strength: this.settings.radianceStrength,
        reach: this.settings.radianceReach,
        spread: this.settings.radianceSpread,
        emitterCutoff: this.settings.radianceEmitterCutoff,
        absorption: this.settings.radianceAbsorption,
        ambient: this.settings.radianceAmbient,
        bounce: this.settings.radianceBounce,
        effectAmount: clamp(strength, 0, 1),
        persistence: feedback,
      });
      this.overlay.frame();
    }
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.max(0.5, Math.min(3, dpr || 1));
    this.engine?.resize(this.width, this.height, this.dpr);
  }

  suspend(suspended: boolean): void {
    this.suspended = suspended;
    this.engine?.suspend(suspended);
    this.overlay?.suspend(suspended);
  }

  snapshot(): string | null {
    if (!this.canvas) return null;
    try {
      if (!this.overlay || !this.radianceCanvas) return this.canvas.toDataURL('image/png');
      const composite = document.createElement('canvas');
      composite.width = this.canvas.width;
      composite.height = this.canvas.height;
      const context = composite.getContext('2d');
      if (!context) return this.canvas.toDataURL('image/png');
      context.filter = this.canvas.style.filter || 'none';
      context.drawImage(this.canvas, 0, 0, composite.width, composite.height);
      context.filter = 'none';
      context.globalAlpha = clamp(Number(this.radianceCanvas.style.opacity || 1), 0, 1);
      context.drawImage(this.radianceCanvas, 0, 0, composite.width, composite.height);
      return composite.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  telemetry(): SceneRuntimeTelemetry {
    const light = this.overlay?.telemetry;
    return {
      renderer: light
        ? `WebGPU + WebGL2 HRC ${light.resolution}²`
        : 'WebGPU DepthSort',
      drawCalls: 1 + (light?.drawCalls ?? 0),
      solverMs: this.latestStats?.gpuFrameMs,
      memoryMb: Number((18 + (light?.memoryMb ?? 0)).toFixed(1)),
      warning: this.warning ?? this.engine?.warning ?? null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.initialized = false;
    this.overlay?.dispose();
    this.overlay = null;
    this.engine?.destroy();
    this.engine = null;
    this.root?.remove();
    if (this.host) this.host.style.position = this.previousHostPosition;
    this.root = null;
    this.canvas = null;
    this.atlasCanvas = null;
    this.radianceCanvas = null;
    this.host = null;
  }

  private setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.settings = { ...this.settings, qualityMode: engineQuality(quality) };
    this.engine?.setSettings(this.settings);
    this.overlay?.setQuality(hrcQuality(quality));
  }

  private activateLook(look: DepthLook): void {
    this.look = look;
    this.engine?.setExperienceMode(look);
    this.overlay?.dispose();
    this.overlay = null;
    if (!this.radianceCanvas) return;
    this.radianceCanvas.style.display = 'none';
    if (!this.initialized || look === 'sorter' || !this.canvas || !this.atlasCanvas) return;

    const source = look === 'radiance2' ? this.atlasCanvas : this.canvas;
    this.radianceCanvas.style.display = 'block';
    this.overlay = new RadianceOverlay(
      source,
      this.radianceCanvas,
      look === 'radiance2' ? 'image' : 'waterfall',
      this.canvas,
      hrcQuality(this.quality),
    );
    this.overlay.suspend(this.suspended);
  }
}
