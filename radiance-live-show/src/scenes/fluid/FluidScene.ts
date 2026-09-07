import type {
  AudioSnapshot,
  QualityLevel,
  SceneFrame,
  SceneRuntimeTelemetry,
  VisualScene,
} from '../../core/types';
import { actionCounterDelta } from '../../core/action-counter';
import KotFluidWorkerClient, {
  DEFAULT_MATERIALS,
  DEFAULT_PARAMETERS,
} from './KotFluidWorkerClient.js';
import ParticleRenderer from './FluidRadianceRenderer';
import { applyFluidLookTrim, readFluidLook, type FluidLook } from './looks';
import ReactiveFluidDirector, {
  type ReactiveFluidMusic,
  type ReactiveFluidOutput,
} from './ReactiveFluidDirector';
import OpeningFluidDirector, {
  type OpeningFluidOutput,
  type OpeningFluidScene,
} from './OpeningFluidDirector';
import TresMasasDirector, {
  TRES_MASAS_CUES,
  TRES_MASAS_MATERIALS,
  type TresMasasOutput,
} from './TresMasasDirector';
import TresMasasGeometry from './TresMasasGeometry';
import FluidsShowDirector, {
  FLUIDS_SHOW_MATERIALS,
  type FluidsShowOutput,
} from './FluidsShowDirector';
import type { ShowDoc } from '../../fluids-show/show-doc';
import {
  FLUID_INTERACTION_MODES,
  ORIGINAL_FLUID_DEFAULTS,
  type FluidInteractionMode,
} from './parameter-specs';

const TOTAL_PARTICLES = ORIGINAL_FLUID_DEFAULTS.particleLimit;
const AZURE_EMITTERS = 2;
const MANUAL_FLUID_SEED = 0x52414449;
const OPENING_PARTICLES = 500;

interface SolverParameters {
  sameRestDensity: number;
  differentRestDensity: number;
  stiffness: number;
  nearStiffness: number;
  gravity: number;
  /** Nunca llegó al solver; se conserva porque lo escriben los presets. */
  drag: number;
  /**
   * El freno que el solver SÍ aplica: cuánta velocidad se pierde por
   * subpaso. Sólo el show de fluidos lo levanta, en su cierre quieto; todo
   * lo demás lo manda en 0 para que nada quede frenado al cambiar de escena.
   */
  brake: number;
  pointerForce: number;
}

interface FluidSolverRuntime {
  readonly ready: Promise<unknown>;
  width: number;
  height: number;
  count: number;
  frame: number;
  lastStepMs: number;
  roundTripMs: number;
  error: string | null;
  positions: Float32Array;
  materialIds: Uint8Array;
  parameters: SolverParameters;
  materials: Array<{ name: string; color: string; mass: number }>;
  step(substeps: number): this;
  updateInterpolation(timestamp: number): this;
  setParameters(parameters: Partial<SolverParameters>): this;
  setMaterialMass(materialId: number, mass: number): this;
  applyPointer(interaction: Record<string, number | string>): this;
  reset(options: {
    initialParticlesByMaterial: number[];
    openingLayout?: {
      scene: OpeningFluidScene;
      emitters: OpeningFluidOutput['emitters'];
    };
  }): this;
  setOpeningEmitters(emitters: OpeningFluidOutput['emitters']): this;
  resize(width: number, height: number): this;
  cancelQueuedStep(): this;
  dispose(): void;
}

interface ReactiveFeatures {
  onsetEvent: boolean;
  bass: number;
  mid: number;
  treble: number;
  fastEnergy: number;
  slowEnergy: number;
  transient: number;
  beatPulse: number;
  rhythmDensity: number;
  harmonicCenter: number;
  harmonicConfidence: number;
  harmonicSpread: number;
  noteDensity: number;
  noteCenter: number;
  chordWidth: number;
  climax: number;
}

interface SecondaryEmitter {
  material: number;
  startedAt: number;
  duration: number;
  strength: number;
  fraction: number;
}

interface CanvasPointer {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Gesto en vivo del show Fluids. Llega desde el overlay de la página (no del
 * canvas) porque el puntero del canvas sólo sabe hacer `drag`, y el show
 * necesita atraer, repeler y hacer vórtice. Coordenadas 0..1 del frame
 * lógico; `vx`/`vy` en fracción del eje por segundo.
 */
export interface FluidsLiveGesture {
  mode: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  strength: number;
}

const clamp = (value: number, min = 0, max = 1): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const approach = (from: number, to: number, speed: number, dt: number): number => (
  from + (to - from) * (1 - Math.exp(-speed * clamp(dt, 0.001, 0.1)))
);

const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;

const hasParam = (params: Record<string, number>, id: string): boolean => (
  Object.prototype.hasOwnProperty.call(params, id) && Number.isFinite(Number(params[id]))
);

const readParam = (
  params: Record<string, number>,
  id: string,
  fallback: number,
  min = -Infinity,
  max = Infinity,
): number => clamp(Number(params[id] ?? fallback), min, max);

const readToggle = (params: Record<string, number>, id: string, fallback = false): boolean => (
  readParam(params, id, fallback ? 1 : 0, 0, 1) >= 0.5
);

const initialMaterialCounts = (total: number = TOTAL_PARTICLES): number[] => {
  const requestedTotal = Math.max(AZURE_EMITTERS, Math.round(total));
  const remaining = requestedTotal - AZURE_EMITTERS;
  const base = Math.floor(remaining / 3);
  const remainder = remaining % 3;
  return [
    base + (remainder > 0 ? 1 : 0),
    base + (remainder > 1 ? 1 : 0),
    base,
    AZURE_EMITTERS,
  ];
};

const openingMaterialCounts = (total: number = OPENING_PARTICLES): number[] => {
  const count = Math.max(4, Math.round(total));
  const base = Math.floor(count / 4);
  const remainder = count % 4;
  return Array.from({ length: 4 }, (_, material) => base + (material < remainder ? 1 : 0));
};

export class FluidScene implements VisualScene {
  readonly id = 'fluid' as const;

  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private reactiveVignette: HTMLDivElement | null = null;
  private solver: FluidSolverRuntime | null = null;
  private renderer: ParticleRenderer | null = null;
  private look: FluidLook = readFluidLook('original');
  private quality: QualityLevel = 'high';
  private width = 1;
  private height = 1;
  private dpr = 1;
  private suspended = false;
  private disposed = false;
  private physicsElapsed = 0;
  private interactionElapsed = 0;
  private lastAudioSequence = -1;
  private lastMusicalInteractionAt = -Infinity;
  private previousBurst = 0;
  private warning: string | null = null;
  private physics: SolverParameters = { ...DEFAULT_PARAMETERS } as SolverParameters;
  private particleLimit: number = TOTAL_PARTICLES;
  private readonly materialMasses: number[] = DEFAULT_MATERIALS.map((material) => material.mass);
  private resetActionInitialized = false;
  private resetActionValue = 0;
  private interactionActionInitialized = false;
  private interactionActionValue = 0;
  private autoCycleStartedAt = 0;
  private autoCycleWasEnabled = false;
  private fastEnergy = 0;
  private slowEnergy = 0;
  private transientEnvelope = 0;
  private previousOnset = 0;
  private lastOnsetAt = -Infinity;
  private onsetTimes: number[] = [];
  private beatPeriod = 0.5;
  private secondaryEmitter: SecondaryEmitter | null = null;
  private nextSecondaryAt = 0;
  private randomState = 0x52414354;
  private reactiveOriginalDirector = new ReactiveFluidDirector();
  private reactiveOriginalPhysicsInitialized = false;
  private readonly openingDirector = new OpeningFluidDirector();
  private openingScene: OpeningFluidScene = 0;
  private openingMotionEpoch = 0;
  private openingEmitterSignature = '';
  private openingImpulseCounter = 0;
  private readonly activePointers = new Map<number, CanvasPointer>();
  private pointerInteractionCount = 0;
  private tresMasasDirector: TresMasasDirector | null = null;
  private tresMasasGeometry: TresMasasGeometry | null = null;
  private tresMasasHud: HTMLDivElement | null = null;
  private tmCueParamInitialized = false;
  private tmLastCueParam = 0;
  private tmNextInitialized = false;
  private tmNextActionValue = 0;
  private tmPrevInitialized = false;
  private tmPrevActionValue = 0;
  private tmKeySteps = 0;
  private fluidsShowDirector: FluidsShowDirector | null = null;
  private fluidsShowGeometry: TresMasasGeometry | null = null;
  private fluidsShowDoc: ShowDoc | null = null;
  private fluidsLiveGesture: FluidsLiveGesture | null = null;
  private fluidsMassElapsed = 0;
  private fluidsMassScale = 1;

  private readonly onTresMasasKey = (event: KeyboardEvent): void => {
    if (!this.tresMasasDirector || this.disposed) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      this.tmKeySteps += 1;
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.tmKeySteps -= 1;
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const canvas = this.canvas;
    if (!canvas || this.disposed) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers and already-cancelled gestures cannot always be
      // captured. They still work while they remain over the canvas.
    }
    const pointer = this.makeCanvasPointer(event);
    this.activePointers.set(event.pointerId, pointer);
    this.publishPointerDiagnostics(pointer, 'drag');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const previous = this.activePointers.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const pointer = this.makeCanvasPointer(event, previous);
    // Pointer events can arrive several times between render frames. Keep the
    // whole travelled delta until the solver consumes it instead of retaining
    // only the final (often tiny) event segment.
    pointer.vx += previous.vx;
    pointer.vy += previous.vy;
    this.activePointers.set(event.pointerId, pointer);
    this.publishPointerDiagnostics(pointer, 'drag');
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    this.publishPointerDiagnostics();
  };

  private readonly onWindowBlur = (): void => {
    this.clearCanvasPointers();
  };

  async init(host: HTMLElement, quality: QualityLevel): Promise<void> {
    if (this.renderer || this.solver) return;
    this.disposed = false;
    this.openingDirector.reset();
    this.openingScene = 0;
    this.openingMotionEpoch = 0;
    this.openingEmitterSignature = '';
    this.openingImpulseCounter = 0;
    this.host = host;
    this.quality = quality;

    const canvas = document.createElement('canvas');
    canvas.dataset.scene = 'fluid';
    canvas.setAttribute('aria-label', 'Radiance fluid visual output');
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      display: 'block',
      width: '100%',
      height: '100%',
      background: '#000',
      pointerEvents: 'auto',
      touchAction: 'none',
      userSelect: 'none',
    });
    host.append(canvas);
    this.canvas = canvas;
    this.bindCanvasInteraction();

    const reactiveVignette = document.createElement('div');
    reactiveVignette.dataset.fluidReactiveVignette = 'true';
    Object.assign(reactiveVignette.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      pointerEvents: 'none',
      background: 'radial-gradient(circle at 50% 48%, transparent 48%, rgb(0 0 0 / 25%) 100%)',
      mixBlendMode: 'multiply',
    });
    host.append(reactiveVignette);
    this.reactiveVignette = reactiveVignette;

    const renderer = new ParticleRenderer(canvas);
    this.renderer = renderer;
    this.applyQuality(quality);

    const rect = host.getBoundingClientRect();
    this.resize(
      Math.max(1, Math.round(rect.width || host.clientWidth || 1)),
      Math.max(1, Math.round(rect.height || host.clientHeight || 1)),
      window.devicePixelRatio || 1,
    );

    const solver = new KotFluidWorkerClient({
      width: this.width,
      height: this.height,
      maxParticles: 40_000,
      initialParticlesByMaterial: initialMaterialCounts(),
      seed: MANUAL_FLUID_SEED,
      parameters: { ...DEFAULT_PARAMETERS },
    }) as FluidSolverRuntime;
    this.solver = solver;

    try {
      await solver.ready;
    } catch (error) {
      this.warning = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  enter(look: string): void {
    const nextLook = readFluidLook(look);
    if (nextLook.id === 'reactive-original' && this.look.id !== 'reactive-original') {
      // `/reactive/` owns one director for the lifetime of its page. Re-entering
      // this subscene gets the equivalent clean, deterministic performance.
      this.reactiveOriginalDirector = new ReactiveFluidDirector();
      this.reactiveOriginalPhysicsInitialized = false;
    }
    if (nextLook.id === 'tres-masas' && this.look.id !== 'tres-masas') {
      this.startTresMasas();
    } else if (nextLook.id !== 'tres-masas' && this.look.id === 'tres-masas') {
      this.stopTresMasas();
    }
    if (nextLook.id === 'fluids-show' && this.look.id !== 'fluids-show') {
      this.startFluidsShow();
    } else if (nextLook.id !== 'fluids-show' && this.look.id === 'fluids-show') {
      this.stopFluidsShow();
    }
    this.look = nextLook;
    if (this.reactiveVignette) {
      this.reactiveVignette.style.display = nextLook.id === 'reactive-original' ? 'block' : 'none';
    }
  }

  frame(frame: SceneFrame): void {
    const solver = this.solver;
    const renderer = this.renderer;
    if (!solver || !renderer || this.disposed || this.suspended) return;

    if (frame.quality !== this.quality) this.applyQuality(frame.quality);
    if (frame.look !== this.look.id) this.enter(frame.look);
    if (frame.width !== this.width || frame.height !== this.height || frame.dpr !== this.dpr) {
      this.resize(frame.width, frame.height, frame.dpr);
    }

    if (this.look.id === 'tres-masas') {
      this.frameTresMasas(frame);
      return;
    }
    if (this.look.id === 'fluids-show') {
      this.frameFluidsShow(frame);
      return;
    }

    const params = frame.params;
    const completeControls = hasParam(params, 'sameRestDensity');
    const dt = clamp(frame.dt, 0.001, 0.1);
    const features = this.updateReactiveFeatures(frame.audio, dt, frame.now);
    const energy = clamp(readParam(params, 'energy', 0.34));
    const flow = clamp(readParam(params, 'flow', 0.48));
    const turbulence = clamp(readParam(params, 'turbulence', 0.32));
    const burst = clamp(readParam(params, 'burst', 0));
    const reactiveAmount = completeControls
      ? readParam(params, 'reactiveAmount', 0, 0, 1)
      : 1;
    const reactiveOriginal = this.look.id === 'reactive-original'
      ? this.reactiveOriginalDirector.update(
        this.makeReactiveOriginalMusic(frame.audio, features),
        frame.audio.notes,
        dt,
        frame.now,
      )
      : null;
    // AUTO's faithful `/reactive/` look owns the entire Fluid performance and
    // therefore resolves to cue 0 regardless of a saved manual opening cue.
    const requestedOpeningScene = (reactiveOriginal
      ? 0
      : Math.round(readParam(params, 'openingScene', 0, 0, 5))) as OpeningFluidScene;
    const opening = this.openingDirector.update(
      frame.audio,
      frame.now,
      dt,
      requestedOpeningScene,
    );
    const openingActive = opening.scene > 0 && !reactiveOriginal;

    const manualInteractionCount = this.syncSimulationControls(
      params,
      completeControls,
      openingActive,
    );
    this.syncOpeningScene(opening);
    if (reactiveOriginal) {
      this.updateReactiveOriginalPhysics(dt, reactiveOriginal);
    } else if (openingActive) {
      this.updateOpeningPhysics(dt, opening.scene, params, completeControls);
    } else {
      this.updatePhysics(
        dt,
        params,
        completeControls,
        reactiveAmount,
        features,
        energy,
        flow,
        turbulence,
        frame.now,
      );
    }

    const paused = !openingActive && completeControls && readToggle(params, 'paused');
    const emitterMaterial = reactiveOriginal
      ? reactiveOriginal.render.emissiveMaterial
      : openingActive
      ? opening.lighting.palette === 'red' ? 0 : 3
      : this.resolveEmitterMaterial(params, frame, completeControls);
    const requestedSubsteps = reactiveOriginal
      ? ORIGINAL_FLUID_DEFAULTS.substeps
      : completeControls
      ? Math.round(readParam(params, 'substeps', ORIGINAL_FLUID_DEFAULTS.substeps, 1, 4))
      : this.quality === 'safe' ? 2 : 3;
    if (!paused) {
      if (reactiveOriginal) {
        this.applyReactiveOriginalInteractions(reactiveOriginal, emitterMaterial);
      } else if (openingActive) {
        this.applyOpeningInteractions(opening, dt, frame.now);
      } else {
        const configuredInteractionCount = Math.max(
          manualInteractionCount,
          completeControls && readToggle(params, 'interactionContinuous') ? 1 : 0,
        );
        for (let count = 0; count < configuredInteractionCount; count += 1) {
          this.applyConfiguredInteraction(params, emitterMaterial);
        }
        const autoMotion = completeControls ? readToggle(params, 'autoMotion') : true;
        if (autoMotion) this.applyContinuousInteraction(dt, frame.now, flow, turbulence, emitterMaterial);
        const musicalInteractions = completeControls
          ? readToggle(params, 'musicalInteractions', true)
          : true;
        if (musicalInteractions) {
          this.applyMusicalInteraction(
            frame,
            features,
            burst,
            flow,
            turbulence,
            emitterMaterial,
          );
        }
      }
      this.applyCanvasPointerInteractions(emitterMaterial, reactiveOriginal ? 0 : 5);
      solver.step(requestedSubsteps);
    } else {
      solver.cancelQueuedStep();
    }

    // SceneFrame.now is seconds; the worker interpolator uses DOMHighResTimeStamp milliseconds.
    solver.updateInterpolation(frame.now * 1000);

    try {
      const renderState = reactiveOriginal
        ? this.makeReactiveOriginalRenderState(reactiveOriginal)
        : openingActive
        ? this.makeOpeningRenderState(opening)
        : completeControls
        ? this.makeCompleteRenderState(params, frame, features, reactiveAmount, emitterMaterial, energy, turbulence)
        : this.makeLegacyRenderState(params, frame, emitterMaterial, energy, turbulence);
      renderer.render(solver, renderState);
      this.publishDiagnostics(
        renderState,
        emitterMaterial,
        requestedSubsteps,
        paused,
        reactiveOriginal,
        opening,
      );
      this.warning = solver.error;
    } catch (error) {
      this.warning = error instanceof Error ? error.message : String(error);
    }

    this.previousBurst = burst;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.max(0.5, dpr || 1);
    this.renderer?.resize(this.width, this.height, this.dpr);
    this.solver?.resize(this.width, this.height);
  }

  suspend(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) {
      this.solver?.cancelQueuedStep();
      this.clearCanvasPointers();
    }
  }

  snapshot(): string | null {
    try {
      return this.canvas?.toDataURL('image/png') ?? null;
    } catch {
      return null;
    }
  }

  telemetry(): SceneRuntimeTelemetry {
    const stats = this.renderer?.stats;
    const solver = this.solver;
    return {
      renderer: stats
        ? `WebGL2 · Amitabha HRC ${stats.resolution}²/${stats.frustumsPerFrame}F`
        : 'WebGL2 · Amitabha HRC',
      drawCalls: stats?.drawCalls,
      particles: solver?.count ?? 0,
      solverMs: solver?.lastStepMs,
      memoryMb: stats ? stats.targetMemoryBytes / (1024 * 1024) : undefined,
      warning: this.warning,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.suspended = true;
    window.removeEventListener('keydown', this.onTresMasasKey);
    this.tresMasasDirector = null;
    this.tresMasasHud?.remove();
    this.tresMasasHud = null;
    this.fluidsShowDirector = null;
    this.fluidsShowDoc = null;
    this.fluidsLiveGesture = null;
    this.renderer?.setOverlay(null);
    this.tresMasasGeometry?.dispose();
    this.tresMasasGeometry = null;
    this.fluidsShowGeometry?.dispose();
    this.fluidsShowGeometry = null;
    this.unbindCanvasInteraction();
    this.clearCanvasPointers();
    this.solver?.cancelQueuedStep();
    this.solver?.dispose();
    this.renderer?.dispose();
    this.reactiveVignette?.remove();
    this.canvas?.remove();
    this.solver = null;
    this.renderer = null;
    this.canvas = null;
    this.reactiveVignette = null;
    this.host = null;
    this.onsetTimes = [];
    this.secondaryEmitter = null;
  }

  private startTresMasas(): void {
    this.tresMasasDirector = new TresMasasDirector();
    this.tmCueParamInitialized = false;
    this.tmNextInitialized = false;
    this.tmPrevInitialized = false;
    this.tmKeySteps = 0;
    if (!this.tresMasasGeometry) this.tresMasasGeometry = new TresMasasGeometry();
    this.renderer?.setOverlay(this.tresMasasGeometry);
    const solver = this.solver;
    if (solver) {
      solver.cancelQueuedStep();
      TRES_MASAS_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
    }
    this.renderer?.resetRadiance();
    window.addEventListener('keydown', this.onTresMasasKey);
  }

  private stopTresMasas(): void {
    window.removeEventListener('keydown', this.onTresMasasKey);
    this.tresMasasDirector = null;
    this.renderer?.setOverlay(null);
    this.tresMasasHud?.remove();
    this.tresMasasHud = null;
    const solver = this.solver;
    if (solver) {
      solver.cancelQueuedStep();
      this.materialMasses.forEach((mass, index) => solver.setMaterialMass(index, mass));
      solver.reset({ initialParticlesByMaterial: initialMaterialCounts(this.particleLimit) });
    }
    this.renderer?.resetRadiance();
  }

  private frameTresMasas(frame: SceneFrame): void {
    const solver = this.solver;
    const renderer = this.renderer;
    if (!solver || !renderer) return;
    if (!this.tresMasasDirector) this.startTresMasas();
    const director = this.tresMasasDirector;
    const geometry = this.tresMasasGeometry;
    if (!director || !geometry) return;
    // The look can arrive before init() resolves; attaching here is idempotent
    // and guarantees the overlay exists once the renderer does.
    renderer.setOverlay(geometry);
    const params = frame.params;
    const dt = clamp(frame.dt, 0.001, 0.1);

    // Cue selection: selector in Control, next/prev actions and ←/→ keys.
    const cueParam = Math.round(readParam(params, 'tresMasasCue', 0, 0, TRES_MASAS_CUES.length - 1));
    if (!this.tmCueParamInitialized) {
      this.tmCueParamInitialized = true;
      this.tmLastCueParam = cueParam;
      director.setCue(cueParam);
    } else if (cueParam !== this.tmLastCueParam) {
      this.tmLastCueParam = cueParam;
      director.setCue(cueParam);
    }
    const nextValue = Math.round(readParam(params, 'tresMasasNext', 0, 0, 999));
    if (!this.tmNextInitialized) {
      this.tmNextInitialized = true;
      this.tmNextActionValue = nextValue;
    } else {
      const steps = actionCounterDelta(this.tmNextActionValue, nextValue);
      this.tmNextActionValue = nextValue;
      for (let step = 0; step < Math.min(steps, 8); step += 1) director.next();
    }
    const prevValue = Math.round(readParam(params, 'tresMasasPrev', 0, 0, 999));
    if (!this.tmPrevInitialized) {
      this.tmPrevInitialized = true;
      this.tmPrevActionValue = prevValue;
    } else {
      const steps = actionCounterDelta(this.tmPrevActionValue, prevValue);
      this.tmPrevActionValue = prevValue;
      for (let step = 0; step < Math.min(steps, 8); step += 1) director.prev();
    }
    while (this.tmKeySteps !== 0) {
      if (this.tmKeySteps > 0) {
        director.next();
        this.tmKeySteps -= 1;
      } else {
        director.prev();
        this.tmKeySteps += 1;
      }
    }

    const out = director.update({
      dt,
      now: frame.now,
      aspect: this.width / Math.max(1, this.height),
      particleCount: solver.count,
    });

    // Per-cue operator trims. The director still authors every cue; these are
    // applied as multipliers so its per-cue variation survives, and absolute
    // values only where the director has no opinion. The dedicated Tres Masas
    // page stores one set of these per sub-scene.
    const scale = (id: string, fallback = 1): number => readParam(params, id, fallback, 0, 12);
    out.render.particleSize = clamp(out.render.particleSize * scale('tresMasasParticleScale'), 1, 48);
    out.render.radiance *= scale('tresMasasRadianceScale');
    out.render.radianceExposure *= scale('tresMasasExposureScale');
    out.render.velocityEmissionFloor = clamp(
      (out.render.velocityEmissionFloor ?? 0.04) * scale('tresMasasVelocityFloorScale'),
      0,
      1,
    );
    out.render.velocityEmissionRange = readParam(params, 'tresMasasVelocityRange', 2.2, 0, 8);
    out.render.velocityEmissionSensitivity = readParam(params, 'tresMasasVelocitySensitivity', 1, 0.05, 20);
    // The fallback matches the dedicated page's default, not the renderer's
    // global 0.68: tresMasasSharpness is registered only in TresMasasApp, so
    // the show Output was silently running the unsoftened value.
    out.render.displaySharpness = readParam(params, 'tresMasasSharpness', 0.2, 0, 1);

    if (out.resetParticles) {
      this.clearCanvasPointers();
      solver.cancelQueuedStep();
      TRES_MASAS_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
      solver.reset({ initialParticlesByMaterial: out.resetParticles });
      renderer.resetRadiance();
    }

    // Tres Masas no frena: su director no tiene opinión sobre el freno y
    // dejarlo pasar heredaría el del show de fluidos al cambiar de escena.
    this.physics = { ...out.physics, brake: 0, pointerForce: DEFAULT_PARAMETERS.pointerForce };
    this.physicsElapsed += dt;
    if (this.physicsElapsed >= 0.05) {
      this.physicsElapsed %= 0.05;
      solver.setParameters(this.physics);
    }

    const minDimension = Math.min(this.width, this.height);
    for (const interaction of out.interactions) {
      solver.applyPointer({
        mode: interaction.mode,
        x: interaction.x * this.width,
        y: interaction.y * this.height,
        vx: interaction.vx * this.height,
        vy: interaction.vy * this.height,
        radius: interaction.radius * minDimension,
        strength: interaction.strength,
        materialId: interaction.materialId,
        emitCount: interaction.emitCount,
      });
    }
    const lampMaterial = Math.max(0, Math.min(3, Math.round(Number(out.render.emissiveMaterial ?? 0))));
    this.applyCanvasPointerInteractions(lampMaterial === 3 ? 0 : lampMaterial, 0);
    solver.step(3);
    solver.updateInterpolation(frame.now * 1000);

    geometry.setGain(readParam(params, 'tresMasasGeoGain', 1, 0, 3));
    geometry.setInstances(out.geometry, this.width, this.height);

    try {
      renderer.render(solver, out.render);
      this.warning = solver.error;
    } catch (error) {
      this.warning = error instanceof Error ? error.message : String(error);
    }

    this.updateTresMasasHud(params, out);
    const canvas = this.canvas;
    if (canvas) {
      canvas.dataset.fluidDirector = 'tres-masas';
      canvas.dataset.tresMasasCue = out.cueId;
      canvas.dataset.tresMasasCueName = out.cueName;
      canvas.dataset.tresMasasCueIndex = String(out.cueIndex);
      canvas.dataset.tresMasasParticles = String(solver.count);
      canvas.dataset.tresMasasGeoCount = String(out.geometry.length);
      canvas.dataset.tresMasasWarning = this.warning ?? '';
    }
  }

  // ------------------------------------------------------------ Fluids show

  /**
   * El documento vive en la página `/fluids` y llega por referencia: el editor
   * lo muta y el director ve el cambio en el frame siguiente, sin reiniciar
   * nada. Es lo que hace que editar una curva se refleje en vivo.
   */
  setFluidsShowDoc(doc: ShowDoc): void {
    this.fluidsShowDoc = doc;
    this.fluidsShowDirector?.setDoc(doc);
  }

  /** Puntero activo del overlay de la página, o null si nadie está tocando. */
  setFluidsLiveGesture(gesture: FluidsLiveGesture | null): void {
    this.fluidsLiveGesture = gesture;
  }

  /**
   * Vacía el campo del show Fluids. Utilidad de ensayo, no mecanismo de
   * sincronización: las partículas arrastran su historia a propósito, y
   * saltar en la timeline no las toca.
   */
  resetFluidsShow(): void {
    this.fluidsShowDirector?.requestReset();
  }

  private startFluidsShow(): void {
    const director = new FluidsShowDirector();
    if (this.fluidsShowDoc) director.setDoc(this.fluidsShowDoc);
    this.fluidsShowDirector = director;
    this.fluidsMassScale = 1;
    this.fluidsMassElapsed = 0;
    if (!this.fluidsShowGeometry) this.fluidsShowGeometry = new TresMasasGeometry();
    this.renderer?.setOverlay(this.fluidsShowGeometry);
    const solver = this.solver;
    if (solver) {
      solver.cancelQueuedStep();
      FLUIDS_SHOW_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
    }
    this.renderer?.resetRadiance();
  }

  private stopFluidsShow(): void {
    this.fluidsShowDirector = null;
    this.fluidsLiveGesture = null;
    this.renderer?.setOverlay(null);
    const solver = this.solver;
    if (solver) {
      solver.cancelQueuedStep();
      this.materialMasses.forEach((mass, index) => solver.setMaterialMass(index, mass));
      solver.reset({ initialParticlesByMaterial: initialMaterialCounts(this.particleLimit) });
    }
    this.renderer?.resetRadiance();
  }

  private frameFluidsShow(frame: SceneFrame): void {
    const solver = this.solver;
    const renderer = this.renderer;
    if (!solver || !renderer) return;
    if (!this.fluidsShowDirector) this.startFluidsShow();
    const director = this.fluidsShowDirector;
    const geometry = this.fluidsShowGeometry;
    if (!director || !geometry) return;
    // El look puede llegar antes de que init() resuelva; enganchar acá es
    // idempotente y garantiza que el overlay exista apenas exista el renderer.
    renderer.setOverlay(geometry);
    const params = frame.params;
    const dt = clamp(frame.dt, 0.001, 0.1);

    const out = director.update({
      time: readParam(params, 'fluidsShowTime', 0, 0, 24 * 3600),
      dt,
      playing: readToggle(params, 'fluidsShowPlaying', false),
      aspect: this.width / Math.max(1, this.height),
      particleCount: solver.count,
    });

    if (out.resetParticles) {
      this.clearCanvasPointers();
      solver.cancelQueuedStep();
      this.fluidsMassScale = 1;
      FLUIDS_SHOW_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
      solver.reset({ initialParticlesByMaterial: out.resetParticles });
    }
    if (out.resetRadiance) renderer.resetRadiance();

    // Sensibilidad a la gravedad. El worker vuelca las cuatro masas en
    // `_pvfs_set_parameters` en cada paso, así que cambiarlas en caliente no
    // reinicia ni ensucia nada: cuesta lo mismo que mover cualquier otro
    // parámetro. Aun así va throttleado a 10 Hz y sólo si se movió más de un
    // 1%, porque cada cambio es un postMessage al worker.
    this.fluidsMassElapsed += dt;
    if (this.fluidsMassElapsed >= 0.1) {
      this.fluidsMassElapsed %= 0.1;
      const scale = clamp(out.status.materialMassScale, 0.05, 4);
      if (Math.abs(scale - this.fluidsMassScale) > this.fluidsMassScale * 0.01) {
        this.fluidsMassScale = scale;
        FLUIDS_SHOW_MATERIALS.masses.forEach(
          (mass, index) => solver.setMaterialMass(index, mass * scale),
        );
      }
    }

    this.physics = { ...out.physics, pointerForce: DEFAULT_PARAMETERS.pointerForce };
    this.physicsElapsed += dt;
    if (this.physicsElapsed >= 0.05) {
      this.physicsElapsed %= 0.05;
      solver.setParameters(this.physics);
    }

    const minDimension = Math.min(this.width, this.height);
    for (const interaction of out.interactions) {
      solver.applyPointer({
        mode: interaction.mode,
        x: interaction.x * this.width,
        y: interaction.y * this.height,
        vx: interaction.vx * this.height,
        vy: interaction.vy * this.height,
        radius: interaction.radius * minDimension,
        strength: interaction.strength,
        materialId: interaction.materialId,
        emitCount: interaction.emitCount,
      });
    }
    this.applyFluidsLiveGesture(dt, minDimension);
    // El puntero del canvas no participa: en este show los gestos entran por
    // el overlay de la página, que es el único que sabe de modos y de REC.
    solver.step(3);
    solver.updateInterpolation(frame.now * 1000);

    geometry.setGain(readParam(params, 'fluidsShowGeoGain', 1, 0, 3));
    geometry.setInstances(out.geometry, this.width, this.height);

    try {
      renderer.render(solver, out.render);
      this.warning = solver.error;
    } catch (error) {
      this.warning = error instanceof Error ? error.message : String(error);
    }

    this.publishFluidsShowStats(out, solver.count);
  }

  /**
   * El gesto en vivo entra por la misma ruta que un clip grabado: lo que se
   * siente en la mano es exactamente lo que después reproduce la timeline.
   * `vx`/`vy` llegan en fracción por segundo y el solver los quiere como
   * desplazamiento por paso, en unidades de alto.
   */
  private applyFluidsLiveGesture(dt: number, minDimension: number): void {
    const gesture = this.fluidsLiveGesture;
    const solver = this.solver;
    if (!gesture || !solver) return;
    const aspect = this.width / Math.max(1, this.height);
    solver.applyPointer({
      mode: gesture.mode,
      x: clamp(gesture.x) * this.width,
      y: clamp(gesture.y) * this.height,
      vx: gesture.vx * aspect * dt * this.height,
      vy: gesture.vy * dt * this.height,
      radius: clamp(gesture.radius, 0.01, 0.5) * minDimension,
      strength: clamp(gesture.strength, 0, 4),
      materialId: 0,
      emitCount: 0,
    });
  }

  private publishFluidsShowStats(out: FluidsShowOutput, particles: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.dataset.fluidDirector = 'fluids-show';
    canvas.dataset.fluidsShowParticles = String(particles);
    canvas.dataset.fluidsShowPps = out.status.pps.toFixed(0);
    canvas.dataset.fluidsShowCapped = out.status.capped ? '1' : '';
    canvas.dataset.fluidsShowAngle = out.status.angle.toFixed(3);
    canvas.dataset.fluidsShowMaterial = String(out.status.emitMaterial);
    canvas.dataset.fluidsShowEvents = String(out.status.activeEvents);
    canvas.dataset.fluidsShowGestures = String(out.status.activeGestures);
    canvas.dataset.fluidsShowGeoCount = String(out.geometry.length);
    canvas.dataset.fluidsShowWarning = this.warning ?? '';
  }

  private updateTresMasasHud(params: Record<string, number>, out: TresMasasOutput): void {
    const wantsHud = readToggle(params, 'tresMasasHud', true);
    if (!wantsHud) {
      this.tresMasasHud?.remove();
      this.tresMasasHud = null;
      return;
    }
    if (!this.tresMasasHud && this.host) {
      const hud = document.createElement('div');
      hud.dataset.tresMasasHud = 'true';
      Object.assign(hud.style, {
        position: 'absolute',
        left: '14px',
        bottom: '12px',
        font: '11px "IBM Plex Mono", Consolas, monospace',
        letterSpacing: '0.14em',
        color: 'rgb(155 153 163 / 85%)',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        zIndex: '4',
      });
      this.host.append(hud);
      this.tresMasasHud = hud;
    }
    if (this.tresMasasHud) {
      this.tresMasasHud.textContent = `${out.cueId} · ${out.cueName} — ${out.cueIndex + 1}/${TRES_MASAS_CUES.length} · ←/→`;
    }
  }

  private applyQuality(quality: QualityLevel): void {
    this.quality = quality;
    try {
      this.renderer?.setQuality(quality);
      this.renderer?.resize(this.width, this.height, this.dpr);
    } catch (error) {
      this.warning = `Quality ${quality} failed: ${error instanceof Error ? error.message : String(error)}`;
      if (quality !== 'safe') {
        this.quality = 'safe';
        this.renderer?.setQuality('safe');
      }
    }
  }

  private syncSimulationControls(
    params: Record<string, number>,
    complete: boolean,
    openingActive = false,
  ): number {
    const solver = this.solver;
    if (!solver || !complete) return 0;

    let resetRequested = false;
    const nextLimit = Math.round(readParam(
      params,
      'particleLimit',
      ORIGINAL_FLUID_DEFAULTS.particleLimit,
      500,
      40_000,
    ));
    if (nextLimit !== this.particleLimit) {
      this.particleLimit = nextLimit;
      resetRequested = true;
    }

    for (let index = 0; index < DEFAULT_MATERIALS.length; index += 1) {
      const mass = readParam(
        params,
        `materialMass${index}`,
        DEFAULT_MATERIALS[index].mass,
        0.05,
        2,
      );
      if (Math.abs(mass - this.materialMasses[index]) <= 1e-6) continue;
      this.materialMasses[index] = mass;
      solver.setMaterialMass(index, mass);
    }

    const resetValue = Math.round(readParam(params, 'resetSimulation', 0, 0, 999));
    if (!this.resetActionInitialized) {
      this.resetActionInitialized = true;
      this.resetActionValue = resetValue;
    } else {
      const resetDelta = actionCounterDelta(this.resetActionValue, resetValue);
      this.resetActionValue = resetValue;
      if (resetDelta > 0 && resetDelta <= 64) resetRequested = true;
    }
    if (resetRequested && !openingActive) {
      this.clearCanvasPointers();
      solver.cancelQueuedStep();
      solver.reset({ initialParticlesByMaterial: initialMaterialCounts(this.particleLimit) });
    }

    const interactionValue = Math.round(readParam(params, 'interactionTrigger', 0, 0, 999));
    if (!this.interactionActionInitialized) {
      this.interactionActionInitialized = true;
      this.interactionActionValue = interactionValue;
      return 0;
    }
    const interactionCount = actionCounterDelta(this.interactionActionValue, interactionValue);
    this.interactionActionValue = interactionValue;
    return interactionCount;
  }

  private syncOpeningScene(directed: OpeningFluidOutput): void {
    const solver = this.solver;
    const renderer = this.renderer;
    if (!solver || directed.scene === this.openingScene) return;

    const previousScene = this.openingScene;
    this.openingScene = directed.scene;
    this.openingMotionEpoch += 1;
    this.interactionElapsed = 0;
    // Force the newly selected cue's gravity/drag into the worker before its
    // first post-reset step; otherwise a previous manual gravity can leak for
    // up to the normal 50 ms parameter batching interval.
    this.physicsElapsed = 0.05;

    if (directed.scene === 0) {
      if (previousScene > 0) {
        solver.cancelQueuedStep();
        solver.reset({ initialParticlesByMaterial: initialMaterialCounts(this.particleLimit) });
      }
      this.openingEmitterSignature = '';
      if (this.canvas) this.canvas.style.background = '#000107';
      return;
    }

    const activeEmitters = directed.emitters.filter((emitter) => emitter.active);
    const emitterSignature = activeEmitters.map((emitter) => emitter.id).join(',');
    // One physical preparation only: direct entry from the manual engine gets
    // the 500-body cloud. Every move inside the 1..5 opening chain keeps that
    // same solver state, including reverse navigation back to cue 01.
    const mustInitializeField = previousScene === 0;
    if (mustInitializeField) {
      solver.cancelQueuedStep();
      solver.reset({
        initialParticlesByMaterial: openingMaterialCounts(OPENING_PARTICLES),
        openingLayout: {
          scene: directed.scene,
          emitters: directed.emitters,
        },
      });
    } else if (emitterSignature !== this.openingEmitterSignature) {
      // Advancing 01 -> 02 -> 03 -> 04 never recreates the ambient field.
      // Only the stable Azure slots are positioned/activated in-place.
      const previousIds = new Set(
        this.openingEmitterSignature.split(',').filter(Boolean).map(Number),
      );
      const newlyActive = directed.emitters.map((emitter) => ({
        ...emitter,
        active: emitter.active && !previousIds.has(emitter.id),
      }));
      if (newlyActive.some((emitter) => emitter.active)) {
        solver.setOpeningEmitters(newlyActive);
      }
    }
    this.openingEmitterSignature = emitterSignature;
    if (this.canvas) this.canvas.style.background = '#000000';

    // Cue 01 drives this field to zero while it is black. Moving 01 -> 02 must
    // not clear it again (that caused the first Azure source to flash). A
    // direct jump from manual into a later cue still starts from a clean field.
    if (directed.scene === 1 || (previousScene === 0 && directed.scene > 1)) {
      renderer?.resetRadiance();
    }
  }

  private updateOpeningPhysics(
    dt: number,
    scene: OpeningFluidScene,
    params: Record<string, number>,
    complete: boolean,
  ): void {
    const solver = this.solver;
    if (!solver) return;
    const presets: Record<number, Omit<SolverParameters, 'pointerForce' | 'brake'>> = {
      1: { sameRestDensity: 5.2, differentRestDensity: 4.9, stiffness: 0.14, nearStiffness: 0.055, gravity: 0, drag: 0.012 },
      2: { sameRestDensity: 5.65, differentRestDensity: 5.15, stiffness: 0.17, nearStiffness: 0.065, gravity: 0, drag: 0.01 },
      3: { sameRestDensity: 5.82, differentRestDensity: 5.28, stiffness: 0.185, nearStiffness: 0.072, gravity: 0, drag: 0.009 },
      // Selecting cue 04 must not kick the complete cloud. It keeps cue 03's
      // body and adds damping; only real collisions/pointer motion excite it.
      4: { sameRestDensity: 5.82, differentRestDensity: 5.28, stiffness: 0.185, nearStiffness: 0.072, gravity: 0, drag: 0.015 },
      5: { sameRestDensity: 6.2, differentRestDensity: 5.55, stiffness: 0.21, nearStiffness: 0.08, gravity: 0, drag: 0.007 },
    };
    const preset = presets[scene] ?? presets[1];
    this.physics = {
      ...preset,
      brake: 0,
      pointerForce: complete
        ? readParam(params, 'pointerForce', DEFAULT_PARAMETERS.pointerForce, 0, 3)
        : DEFAULT_PARAMETERS.pointerForce,
    };
    this.physicsElapsed += dt;
    if (this.physicsElapsed >= 0.05) {
      this.physicsElapsed %= 0.05;
      solver.setParameters(this.physics);
    }
  }

  private applyOpeningInteractions(
    directed: OpeningFluidOutput,
    dt: number,
    now: number,
  ): void {
    const solver = this.solver;
    if (!solver) return;

    this.interactionElapsed += dt;
    if (this.interactionElapsed >= 0.11) {
      this.interactionElapsed %= 0.11;
      const phase = now * 0.23;
      solver.applyPointer({
        mode: Math.sin(phase * 0.7) >= 0 ? 'vortex' : 'vortex-reverse',
        x: this.width * (0.5 + Math.sin(phase) * 0.16),
        y: this.height * (0.5 + Math.cos(phase * 0.83) * 0.12),
        vx: 0,
        vy: 0,
        radius: Math.min(this.width, this.height) * 0.34,
        strength: directed.scene === 1 ? 0.006 : directed.collisions ? 0.004 : 0.011,
        materialId: 3,
        emitCount: 0,
      });
    }

    // Director positions move continuously (entry -> composition plus a soft
    // musical spring). Steer the three stable Azure bodies locally through
    // the native drag brush instead of teleporting solver memory every frame.
    let azureSlot = 0;
    for (let index = 0; index < solver.count && azureSlot < 3; index += 1) {
      if (solver.materialIds[index] !== 3) continue;
      const emitter = directed.emitters[azureSlot];
      azureSlot += 1;
      if (!emitter?.active) continue;
      const x = solver.positions[index * 2];
      const y = solver.positions[index * 2 + 1];
      const targetX = emitter.x * this.width;
      const targetY = emitter.y * this.height;
      const maxStep = Math.min(this.width, this.height) * 0.075;
      solver.applyPointer({
        mode: 'drag',
        x,
        y,
        vx: clamp((targetX - x) * 0.34, -maxStep, maxStep),
        vy: clamp((targetY - y) * 0.34, -maxStep, maxStep),
        radius: Math.max(18, Math.min(this.width, this.height) * 0.018 * emitter.sizeScale),
        strength: this.physics.pointerForce,
        materialId: 3,
        emitCount: 0,
      });
    }

    const impulse = directed.impulse;
    if (!impulse || impulse.counter <= this.openingImpulseCounter) return;
    this.openingImpulseCounter = impulse.counter;
    const radius = impulse.radius * Math.min(this.width, this.height);
    if (directed.collisions) {
      solver.applyPointer({
        mode: 'collide',
        x: impulse.x * this.width,
        y: impulse.y * this.height,
        vx: 0,
        vy: 0,
        radius,
        strength: impulse.strength,
        materialId: 3,
        emitCount: 0,
      });
    }
    solver.applyPointer({
      mode: directed.collisions ? 'repel' : 'vortex',
      x: impulse.x * this.width,
      y: impulse.y * this.height,
      vx: 0,
      vy: 0,
      radius,
      strength: directed.collisions ? impulse.strength * 0.18 : impulse.strength,
      materialId: 3,
      emitCount: 0,
    });
  }

  private makeOpeningRenderState(directed: OpeningFluidOutput): Record<string, number> {
    const scene = directed.scene;
    const activeEmitters = directed.emitters.filter((emitter) => emitter.active);
    const isBlack = scene === 1;
    const isCollision = directed.collisions;
    const isRubyEnergy = directed.lighting.palette === 'red';
    const state: Record<string, number> = {
      particleSize: isBlack ? 3 : 3.4,
      radiance: isBlack ? 0 : isRubyEnergy ? 1.55 : isCollision ? 0.97 : 1.35,
      radianceSpread: isBlack || isCollision ? 1 : 0.94,
      radianceAbsorption: isBlack || isCollision ? 1.5 : 1.28,
      radianceExposure: isBlack ? 0.2 : isRubyEnergy ? 0.38 : isCollision ? 0.135 : 0.36,
      gradeHue: isCollision ? -9.5 : 0,
      gradeSaturation: isCollision ? 1.02 : 1.08,
      gradeContrast: isCollision ? 1.71 : 1.48,
      gradeBrightness: isCollision ? 0.002 : 0,
      gradeBlackPoint: isCollision ? 0.085 : 0.065,
      emissiveMaterial: directed.lighting.palette === 'red' ? 0 : 3,
      allEmitters: directed.lighting.allEmitters ? 1 : 0,
      velocityEmission: isRubyEnergy && directed.lighting.velocityEmission ? 1 : 0,
      velocityEmissionFloor: isCollision || isRubyEnergy ? 0 : 0.04,
      ambientVelocityEmission: isCollision ? 1 : 0,
      ambientEmissionScale: isCollision ? 0.06 : 1,
      ambientRedBlueOnly: isCollision ? 1 : 0,
      lightOnly: 1,
      instantEmissionRole: 1,
      openingEmitterCount: activeEmitters.length,
      emitterVisualScale: 1,
      emitterFluxScale: directed.lighting.palette === 'blue' ? 1.25 : 1,
      backgroundBlack: 1,
      blackOutput: isBlack ? 1 : 0,
      motionEpoch: this.openingMotionEpoch,
      materialColor0: 0xff1744,
      materialColor1: 0xff7a00,
      materialColor2: 0xffb000,
      materialColor3: 0x1265ff,
    };
    directed.emitters.forEach((emitter) => {
      // A regular body remains 3.4px. The three designed slots are visibly
      // larger, while their individual low-note bounce remains independent.
      state[`openingEmitterScale${emitter.id}`] = emitter.sizeScale * 2.15;
    });
    return state;
  }

  private makeReactiveOriginalMusic(
    audio: AudioSnapshot,
    features: ReactiveFeatures,
  ): ReactiveFluidMusic {
    return {
      rms: audio.rms,
      bass: audio.bass,
      mid: audio.mid,
      treble: audio.treble,
      onset: audio.onset,
      flux: audio.flux,
      centroid: Number.isFinite(audio.centroid) ? audio.centroid : 0.5,
      harmonicCenter: Number.isFinite(audio.harmonicCenter)
        ? audio.harmonicCenter
        : audio.harmonic,
      harmonicConfidence: Number.isFinite(audio.harmonicConfidence)
        ? audio.harmonicConfidence
        : features.harmonicConfidence,
      harmonicSpread: Number.isFinite(audio.harmonicSpread)
        ? audio.harmonicSpread
        : features.harmonicSpread,
    };
  }

  private updateReactiveOriginalPhysics(
    dt: number,
    directed: ReactiveFluidOutput,
  ): void {
    const solver = this.solver;
    if (!solver) return;
    this.physics = {
      ...directed.physics,
      brake: 0,
      pointerForce: DEFAULT_PARAMETERS.pointerForce,
    };
    this.physicsElapsed += dt;
    if (!this.reactiveOriginalPhysicsInitialized || this.physicsElapsed >= 0.05) {
      this.reactiveOriginalPhysicsInitialized = true;
      this.physicsElapsed %= 0.05;
      solver.setParameters(this.physics);
    }
  }

  private makeReactiveOriginalRenderState(
    directed: ReactiveFluidOutput,
  ): Record<string, number> {
    return {
      ...directed.render,
      emitterCrossfadeSeconds: 1.25,
      materialColor0: Number.parseInt(DEFAULT_MATERIALS[0].color.slice(1), 16),
      materialColor1: Number.parseInt(DEFAULT_MATERIALS[1].color.slice(1), 16),
      materialColor2: Number.parseInt(DEFAULT_MATERIALS[2].color.slice(1), 16),
      materialColor3: Number.parseInt(DEFAULT_MATERIALS[3].color.slice(1), 16),
    };
  }

  private applyReactiveOriginalInteractions(
    directed: ReactiveFluidOutput,
    materialId: number,
  ): void {
    const solver = this.solver;
    if (!solver) return;
    for (const interaction of directed.interactions) {
      solver.applyPointer({
        mode: interaction.mode,
        x: interaction.x * this.width,
        y: interaction.y * this.height,
        vx: 0,
        vy: 0,
        radius: interaction.radius * Math.min(this.width, this.height),
        strength: interaction.strength,
        materialId,
        emitCount: 0,
      });
    }
  }

  private updatePhysics(
    dt: number,
    params: Record<string, number>,
    complete: boolean,
    reactiveAmount: number,
    features: ReactiveFeatures,
    energy: number,
    flow: number,
    turbulence: number,
    now: number,
  ): void {
    const solver = this.solver;
    if (!solver) return;
    const energyDelta = energy - 0.34;
    const flowDelta = flow - 0.48;
    const turbulenceDelta = turbulence - 0.32;

    let targets: Omit<SolverParameters, 'brake'>;
    if (complete) {
      const lookAmount = readParam(params, 'lookAmount', 1, 0, 1);
      const macroAmount = 1 - reactiveAmount;
      const phraseMotion = Math.sin(
        now * (0.22 + features.rhythmDensity * 0.26) + features.harmonicCenter * Math.PI * 2,
      );
      const manualSame = applyFluidLookTrim(
        readParam(params, 'sameRestDensity', DEFAULT_PARAMETERS.sameRestDensity, 0, 12),
        DEFAULT_PARAMETERS.sameRestDensity,
        this.look.same,
        lookAmount,
      );
      const manualCross = applyFluidLookTrim(
        readParam(params, 'differentRestDensity', DEFAULT_PARAMETERS.differentRestDensity, 0, 12),
        DEFAULT_PARAMETERS.differentRestDensity,
        this.look.cross,
        lookAmount,
      );
      const manualStiffness = applyFluidLookTrim(
        readParam(params, 'stiffness', DEFAULT_PARAMETERS.stiffness, 0.05, 2),
        DEFAULT_PARAMETERS.stiffness,
        this.look.pressure,
        lookAmount,
      );
      const manualNear = applyFluidLookTrim(
        readParam(params, 'nearStiffness', DEFAULT_PARAMETERS.nearStiffness, 0.05, 3),
        DEFAULT_PARAMETERS.nearStiffness,
        this.look.tension,
        lookAmount,
      );
      const manualGravity = applyFluidLookTrim(
        readParam(params, 'gravity', DEFAULT_PARAMETERS.gravity, 0, 1.5),
        DEFAULT_PARAMETERS.gravity,
        this.look.gravity,
        lookAmount,
      );
      const manualDrag = applyFluidLookTrim(
        readParam(params, 'drag', DEFAULT_PARAMETERS.drag, 0, 0.3),
        DEFAULT_PARAMETERS.drag,
        this.look.drag,
        lookAmount,
      );
      const reactiveGravity = manualGravity <= 0.0001
        ? 0
        : manualGravity * (0.58 + features.bass * 0.34 + features.slowEnergy * 0.2);

      targets = {
        sameRestDensity: clamp(
          manualSame
            + reactiveAmount * (
              features.bass * 0.75
              + features.beatPulse * 0.55
              - features.harmonicSpread * 0.28
              + phraseMotion * features.slowEnergy * 0.35
            )
            + flowDelta * 2 * macroAmount
            - turbulenceDelta * 0.8 * macroAmount,
          0,
          12,
        ),
        differentRestDensity: clamp(
          manualCross
            + reactiveAmount * (
              features.mid * 0.7
              + features.harmonicSpread * 0.45
              - features.bass * 0.2
              - phraseMotion * features.slowEnergy * 0.32
            )
            + flowDelta * 2 * macroAmount
            + turbulenceDelta * 1.4 * macroAmount,
          0,
          12,
        ),
        stiffness: clamp(
          manualStiffness
            + reactiveAmount * (features.bass * 0.14 + features.transient * 0.18)
            + energyDelta * 0.24 * macroAmount
            + turbulenceDelta * 0.12 * macroAmount,
          0.05,
          2,
        ),
        nearStiffness: clamp(
          manualNear
            + reactiveAmount * (
              features.mid * 0.16
              + features.harmonicConfidence * 0.12
              + features.chordWidth * 0.12
            )
            + flowDelta * 0.25 * macroAmount,
          0.05,
          3,
        ),
        gravity: clamp(mix(manualGravity, reactiveGravity, reactiveAmount), 0, 1.5),
        drag: clamp(
          manualDrag
            + reactiveAmount * (
              features.treble * 0.008
              + features.harmonicSpread * features.slowEnergy * 0.007
            )
            + (0.48 - flow) * 0.004 * macroAmount,
          0,
          0.3,
        ),
        pointerForce: readParam(params, 'pointerForce', DEFAULT_PARAMETERS.pointerForce, 0, 3),
      };
    } else {
      targets = {
        sameRestDensity: clamp(this.look.same + flowDelta * 2 - turbulenceDelta * 0.8, 0, 12),
        differentRestDensity: clamp(this.look.cross + flowDelta * 2 + turbulenceDelta * 1.4, 0, 12),
        stiffness: clamp(this.look.pressure + energyDelta * 0.24 + turbulence * 0.12, 0.05, 2),
        nearStiffness: clamp(this.look.tension + flowDelta * 0.25, 0.05, 3),
        gravity: clamp(this.look.gravity + readParam(params, 'gravity', 0), -1.5, 1.5),
        drag: clamp(this.look.drag + (1 - flow) * 0.004, 0, 0.3),
        pointerForce: DEFAULT_PARAMETERS.pointerForce,
      };
    }

    // El freno es del operador acá: por defecto 0, o sea el fluido de siempre.
    this.physics = {
      ...targets,
      brake: readParam(params, 'brake', DEFAULT_PARAMETERS.brake, 0, 0.05),
    };
    this.physicsElapsed += dt;
    if (this.physicsElapsed >= 0.05) {
      this.physicsElapsed %= 0.05;
      solver.setParameters(this.physics);
    }
  }

  private makeCompleteRenderState(
    params: Record<string, number>,
    frame: SceneFrame,
    features: ReactiveFeatures,
    reactiveAmount: number,
    emitterMaterial: number,
    energy: number,
    turbulence: number,
  ): Record<string, number> {
    const lookAmount = readParam(params, 'lookAmount', 1, 0, 1);
    const macroAmount = 1 - reactiveAmount;
    const energyDelta = energy - 0.34;
    const turbulenceDelta = turbulence - 0.32;
    const audio = frame.audio;
    const manualParticleSize = applyFluidLookTrim(
      readParam(params, 'particleSize', ORIGINAL_FLUID_DEFAULTS.particleSize, 2, 18),
      ORIGINAL_FLUID_DEFAULTS.particleSize,
      ORIGINAL_FLUID_DEFAULTS.particleSize + this.look.size,
      lookAmount,
    );
    const reactiveParticleSize = 2 + this.look.size * lookAmount
      + audio.rms * 1.05
      + features.transient * 0.55
      + features.noteDensity * 0.35
      + (readParam(params, 'particleSize', ORIGINAL_FLUID_DEFAULTS.particleSize) - ORIGINAL_FLUID_DEFAULTS.particleSize);
    const manualRadiance = applyFluidLookTrim(
      readParam(params, 'radiance', ORIGINAL_FLUID_DEFAULTS.radiance, 0, 1.6),
      ORIGINAL_FLUID_DEFAULTS.radiance,
      ORIGINAL_FLUID_DEFAULTS.radiance + this.look.light,
      lookAmount,
    );
    const reactiveRadiance = 1.03 + this.look.light * lookAmount
      + features.fastEnergy * 0.4
      + features.transient * 0.2
      + (readParam(params, 'radiance', ORIGINAL_FLUID_DEFAULTS.radiance) - ORIGINAL_FLUID_DEFAULTS.radiance);
    const manualSpread = readParam(params, 'radianceSpread', ORIGINAL_FLUID_DEFAULTS.radianceSpread, 0, 1);
    const reactiveSpread = 0.9 + (1 - audio.flux) * 0.1
      + (manualSpread - ORIGINAL_FLUID_DEFAULTS.radianceSpread);
    const manualAbsorption = readParam(params, 'radianceAbsorption', ORIGINAL_FLUID_DEFAULTS.radianceAbsorption, 0, 1.5);
    const reactiveAbsorption = 1.5 - audio.rms * 0.31 + audio.bass * 0.16
      + (manualAbsorption - ORIGINAL_FLUID_DEFAULTS.radianceAbsorption);
    const manualExposure = applyFluidLookTrim(
      readParam(params, 'radianceExposure', ORIGINAL_FLUID_DEFAULTS.radianceExposure, 0, 2),
      ORIGINAL_FLUID_DEFAULTS.radianceExposure,
      ORIGINAL_FLUID_DEFAULTS.radianceExposure + this.look.exposure,
      lookAmount,
    );
    const reactiveExposure = 0.15 + this.look.exposure * lookAmount
      + features.fastEnergy * 0.15
      + audio.bass * 0.045
      + features.beatPulse * 0.035
      + (readParam(params, 'radianceExposure', ORIGINAL_FLUID_DEFAULTS.radianceExposure) - ORIGINAL_FLUID_DEFAULTS.radianceExposure);
    const brightnessMotion = (audio.centroid - 0.5) * 2;
    const manualHue = readParam(params, 'gradeHue', ORIGINAL_FLUID_DEFAULTS.gradeHue, -180, 180);
    const reactiveHue = -3 + (features.harmonicCenter - 0.5) * 13 + brightnessMotion * 2
      + (manualHue - ORIGINAL_FLUID_DEFAULTS.gradeHue);
    const manualSaturation = readParam(params, 'gradeSaturation', ORIGINAL_FLUID_DEFAULTS.gradeSaturation, 0, 2.5);
    const reactiveSaturation = 0.93 + audio.centroid * 0.18 + features.harmonicConfidence * 0.11
      + (manualSaturation - ORIGINAL_FLUID_DEFAULTS.gradeSaturation);
    const manualContrast = applyFluidLookTrim(
      readParam(params, 'gradeContrast', ORIGINAL_FLUID_DEFAULTS.gradeContrast, 0.25, 3),
      ORIGINAL_FLUID_DEFAULTS.gradeContrast,
      ORIGINAL_FLUID_DEFAULTS.gradeContrast + this.look.contrast,
      lookAmount,
    );
    const reactiveContrast = 1.55 + this.look.contrast * lookAmount
      + audio.flux * 0.2
      + (1 - features.slowEnergy) * 0.08
      - audio.rms * 0.1
      + (readParam(params, 'gradeContrast', ORIGINAL_FLUID_DEFAULTS.gradeContrast) - ORIGINAL_FLUID_DEFAULTS.gradeContrast);
    const manualBrightness = readParam(params, 'gradeBrightness', ORIGINAL_FLUID_DEFAULTS.gradeBrightness, -0.5, 0.5);
    const reactiveBrightness = 0.002 + features.fastEnergy * 0.045 + features.beatPulse * 0.012
      + (manualBrightness - ORIGINAL_FLUID_DEFAULTS.gradeBrightness);
    const manualBlackPoint = readParam(params, 'gradeBlackPoint', ORIGINAL_FLUID_DEFAULTS.gradeBlackPoint, 0, 0.65);
    const reactiveBlackPoint = 0.085 - features.slowEnergy * 0.027 + features.harmonicSpread * 0.008
      + (manualBlackPoint - ORIGINAL_FLUID_DEFAULTS.gradeBlackPoint);
    const secondary = this.resolveSecondaryEmitter(params, frame.now, features, emitterMaterial, reactiveAmount);

    return {
      particleSize: clamp(mix(manualParticleSize, reactiveParticleSize, reactiveAmount) + energyDelta * 0.8 * macroAmount, 2, 18),
      radiance: clamp(mix(manualRadiance, reactiveRadiance, reactiveAmount) + energyDelta * 0.5 * macroAmount, 0, 1.6),
      radianceSpread: clamp(mix(manualSpread, reactiveSpread, reactiveAmount) - turbulenceDelta * 0.1 * macroAmount, 0, 1),
      radianceAbsorption: clamp(mix(manualAbsorption, reactiveAbsorption, reactiveAmount), 0, 1.5),
      radianceExposure: clamp(mix(manualExposure, reactiveExposure, reactiveAmount) + energyDelta * 0.12 * macroAmount, 0, 2),
      gradeHue: clamp(mix(manualHue, reactiveHue, reactiveAmount), -180, 180),
      gradeSaturation: clamp(mix(manualSaturation, reactiveSaturation, reactiveAmount), 0, 2.5),
      gradeContrast: clamp(mix(manualContrast, reactiveContrast, reactiveAmount), 0.25, 3),
      gradeBrightness: clamp(mix(manualBrightness, reactiveBrightness, reactiveAmount) + energyDelta * 0.02 * macroAmount, -0.5, 0.5),
      gradeBlackPoint: clamp(mix(manualBlackPoint, reactiveBlackPoint, reactiveAmount), 0, 0.65),
      emissiveMaterial: emitterMaterial,
      allEmitters: readToggle(params, 'allEmitters') ? 1 : 0,
      velocityEmission: readToggle(params, 'velocityEmission') ? 1 : 0,
      lightOnly: readToggle(params, 'lightOnly') ? 1 : 0,
      emitterCrossfadeSeconds: readParam(params, 'emitterCrossfadeSeconds', 1.25, 0.1, 5),
      reactiveSecondaryMaterial: secondary.material,
      reactiveSecondaryStrength: secondary.strength,
      reactiveSecondaryFraction: secondary.fraction,
      materialColor0: readParam(params, 'materialColor0', 0xff1744, 0, 0xffffff),
      materialColor1: readParam(params, 'materialColor1', 0xff7a00, 0, 0xffffff),
      materialColor2: readParam(params, 'materialColor2', 0xffb000, 0, 0xffffff),
      materialColor3: readParam(params, 'materialColor3', 0x1265ff, 0, 0xffffff),
    };
  }

  private makeLegacyRenderState(
    params: Record<string, number>,
    frame: SceneFrame,
    emitterMaterial: number,
    energy: number,
    turbulence: number,
  ): Record<string, number> {
    const brightness = clamp(readParam(params, 'brightness', 1), 0.2, 2);
    const radiance = clamp(
      readParam(params, 'radiance', 1.15) + this.look.light + (energy - 0.34) * 0.5,
      0,
      2.5,
    );
    const activeAudio = frame.audio.running && frame.audio.rms > 0.015;
    return {
      particleSize: clamp(
        2 + this.look.size
          + (readParam(params, 'particleSize', 1) - 1) * 1.2
          + energy * 0.8,
        2,
        7,
      ),
      radiance,
      radianceSpread: clamp(0.9 + (1 - turbulence) * 0.1, 0.82, 1),
      radianceAbsorption: clamp(1.5 - energy * 0.3 + frame.audio.bass * 0.08, 1.05, 1.5),
      radianceExposure: clamp(
        0.2 + this.look.exposure + (brightness - 1) * 0.12 + (energy - 0.34) * 0.12,
        0.08,
        0.65,
      ),
      gradeHue: activeAudio ? (clamp(frame.audio.harmonic) - 0.5) * 14 - 3 : -3,
      gradeSaturation: clamp(readParam(params, 'saturation', 1.08), 0, 2),
      gradeContrast: clamp(readParam(params, 'contrast', 1.08) + 0.42 + this.look.contrast, 0.4, 2.4),
      gradeBrightness: clamp((brightness - 1) * 0.14 + (energy - 0.34) * 0.02, -0.3, 0.3),
      gradeBlackPoint: clamp(0.085 - energy * 0.027, 0.045, 0.1),
      emissiveMaterial: emitterMaterial,
      allEmitters: 1,
      velocityEmission: activeAudio ? 1 : 0,
      lightOnly: 0,
    };
  }

  private resolveEmitterMaterial(
    params: Record<string, number>,
    frame: SceneFrame,
    complete: boolean,
  ): number {
    if (!complete) {
      return frame.audio.running && frame.audio.rms > 0.015
        ? Math.min(3, Math.floor(clamp(frame.audio.harmonic) * 3.999))
        : 3;
    }
    const manual = Math.round(readParam(params, 'emissiveMaterial', ORIGINAL_FLUID_DEFAULTS.activeMaterial, 0, 3));
    if (readToggle(params, 'emitterFollowAudio') && frame.audio.running && frame.audio.rms > 0.015) {
      return Math.min(3, Math.floor(clamp(frame.audio.harmonic) * 3.999));
    }
    const autoCycle = readToggle(params, 'emitterAutoCycle');
    if (!autoCycle) {
      this.autoCycleWasEnabled = false;
      return manual;
    }
    if (!this.autoCycleWasEnabled) {
      this.autoCycleWasEnabled = true;
      this.autoCycleStartedAt = frame.now;
    }
    const seconds = readParam(params, 'emitterCycleSeconds', 8, 1.5, 60);
    return (manual + Math.floor(Math.max(0, frame.now - this.autoCycleStartedAt) / seconds)) % 4;
  }

  private resolveSecondaryEmitter(
    params: Record<string, number>,
    now: number,
    features: ReactiveFeatures,
    primaryMaterial: number,
    reactiveAmount: number,
  ): { material: number; strength: number; fraction: number } {
    const manualMaterial = Math.round(readParam(params, 'reactiveSecondaryMaterial', -1, -1, 3));
    const manualStrength = readParam(params, 'reactiveSecondaryStrength', 0, 0, 0.85);
    const manualFraction = readParam(params, 'reactiveSecondaryFraction', 1, 0.01, 1);
    if (manualMaterial >= 0 && manualMaterial !== primaryMaterial && manualStrength > 0.001) {
      return { material: manualMaterial, strength: manualStrength, fraction: manualFraction };
    }

    if (reactiveAmount <= 0.001) {
      this.secondaryEmitter = null;
      return { material: -1, strength: 0, fraction: 0 };
    }
    if (!this.secondaryEmitter && features.onsetEvent && now >= this.nextSecondaryAt) {
      const trigger = clamp((features.climax - 0.26) * 1.55 + features.transient * 0.22);
      if (trigger >= 0.2 && this.random() <= trigger * 0.62) {
        const candidates = [0, 1, 2].filter((material) => material !== primaryMaterial);
        const material = candidates[Math.min(candidates.length - 1, Math.floor(features.harmonicCenter * candidates.length))]
          ?? ((primaryMaterial + 1) % 4);
        this.secondaryEmitter = {
          material,
          startedAt: now,
          duration: 0.85 + features.harmonicSpread * 1.25 + this.random() * 0.45,
          fraction: clamp(0.07 + features.harmonicCenter * 0.17 + features.transient * 0.12, 0.07, 0.34),
          strength: clamp(0.22 + features.transient * 0.28 + features.climax * 0.22, 0.22, 0.66),
        };
        this.nextSecondaryAt = now + 4.5 + this.random() * 5;
      }
    }
    if (!this.secondaryEmitter) return { material: -1, strength: 0, fraction: 0 };
    const progress = (now - this.secondaryEmitter.startedAt) / this.secondaryEmitter.duration;
    if (progress >= 1) {
      this.secondaryEmitter = null;
      return { material: -1, strength: 0, fraction: 0 };
    }
    const smoothstep = (value: number): number => {
      const x = clamp(value);
      return x * x * (3 - 2 * x);
    };
    const attack = smoothstep(progress / 0.18);
    const release = 1 - smoothstep((progress - 0.45) / 0.55);
    return {
      material: this.secondaryEmitter.material,
      strength: this.secondaryEmitter.strength * attack * release * reactiveAmount,
      fraction: this.secondaryEmitter.fraction,
    };
  }

  private updateReactiveFeatures(
    audio: AudioSnapshot,
    dt: number,
    now: number,
  ): ReactiveFeatures {
    const spectralEnergy = clamp(audio.rms * 0.52 + audio.bass * 0.2 + audio.mid * 0.17 + audio.treble * 0.11);
    this.fastEnergy = approach(this.fastEnergy, spectralEnergy, spectralEnergy > this.fastEnergy ? 14 : 4.2, dt);
    this.slowEnergy = approach(this.slowEnergy, spectralEnergy, spectralEnergy > this.slowEnergy ? 2.2 : 0.65, dt);
    this.transientEnvelope = Math.max(audio.onset, approach(this.transientEnvelope, 0, 7.5, dt));
    const onsetEvent = audio.running
      && audio.onset > 0.18
      && now - this.lastOnsetAt > 0.12
      && (this.previousOnset <= 0.18 || audio.onset > this.previousOnset + 0.11);
    this.previousOnset = audio.onset;
    if (onsetEvent) this.registerOnset(now);
    const beatPhase = Number.isFinite(this.lastOnsetAt)
      ? ((now - this.lastOnsetAt) / this.beatPeriod) % 1
      : 1;
    const beatPulse = Math.exp(-Math.max(0, beatPhase) * 8.5) * clamp(audio.onset * 1.2 + audio.flux * 0.55);
    const rhythmDensity = clamp(this.onsetTimes.filter((value) => now - value <= 4).length / 10);

    let weight = 0;
    let weightedMidi = 0;
    let minimum = 108;
    let maximum = 21;
    let strongest = 0;
    for (const note of audio.notes) {
      const strength = clamp(note.strength, 0.05, 1);
      const midi = clamp(note.midi, 21, 108);
      weight += strength;
      weightedMidi += midi * strength;
      minimum = Math.min(minimum, midi);
      maximum = Math.max(maximum, midi);
      strongest = Math.max(strongest, strength);
    }
    const noteDensity = clamp(audio.notes.length / 8);
    const silentHarmonicCenter = audio.running ? clamp(audio.harmonic) : 0.5;
    const noteCenter = weight > 0 ? clamp(((weightedMidi / weight) - 21) / 87) : silentHarmonicCenter;
    const chordWidth = audio.notes.length ? clamp((maximum - minimum) / 36) : 0;
    const harmonicConfidence = audio.notes.length ? strongest : 0;
    const harmonicSpread = chordWidth;
    const climax = clamp(
      this.fastEnergy * 0.36
      + audio.onset * 0.24
      + audio.flux * 0.16
      + harmonicSpread * 0.12
      + rhythmDensity * 0.12,
    );
    return {
      onsetEvent,
      bass: clamp(audio.bass),
      mid: clamp(audio.mid),
      treble: clamp(audio.treble),
      fastEnergy: this.fastEnergy,
      slowEnergy: this.slowEnergy,
      transient: this.transientEnvelope,
      beatPulse,
      rhythmDensity,
      harmonicCenter: silentHarmonicCenter,
      harmonicConfidence,
      harmonicSpread,
      noteDensity,
      noteCenter,
      chordWidth,
      climax,
    };
  }

  private registerOnset(now: number): void {
    if (Number.isFinite(this.lastOnsetAt)) {
      let interval = now - this.lastOnsetAt;
      if (interval >= 0.12 && interval <= 1.8) {
        while (interval < 0.34) interval *= 2;
        while (interval > 0.86) interval *= 0.5;
        this.beatPeriod = approach(this.beatPeriod, clamp(interval, 0.34, 0.86), 4.5, 0.1);
      }
    }
    this.lastOnsetAt = now;
    this.onsetTimes.push(now);
    this.onsetTimes = this.onsetTimes.filter((value) => now - value <= 8).slice(-24);
  }

  private applyConfiguredInteraction(params: Record<string, number>, fallbackMaterial: number): void {
    const solver = this.solver;
    if (!solver) return;
    const modeIndex = Math.round(readParam(params, 'interactionMode', 0, 0, FLUID_INTERACTION_MODES.length - 1));
    const mode: FluidInteractionMode = FLUID_INTERACTION_MODES[modeIndex] ?? 'drag';
    const materialId = Math.round(readParam(params, 'interactionMaterial', fallbackMaterial, 0, 3));
    if (mode === 'emit' && materialId === 3) return;
    solver.applyPointer({
      mode,
      x: this.width * readParam(params, 'interactionX', 0.5, 0, 1),
      y: this.height * readParam(params, 'interactionY', 0.32, 0, 1),
      vx: readParam(params, 'interactionVelocityX', 0, -100, 100),
      vy: readParam(params, 'interactionVelocityY', 0, -100, 100),
      radius: readParam(params, 'interactionRadius', 100, 1, 500),
      strength: readParam(params, 'interactionStrength', this.physics.pointerForce, 0, 3),
      materialId,
      emitCount: Math.round(readParam(params, 'interactionEmitCount', 5, 0, 100)),
    });
  }

  private bindCanvasInteraction(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerEnd);
    canvas.addEventListener('pointercancel', this.onPointerEnd);
    canvas.addEventListener('lostpointercapture', this.onPointerEnd);
    canvas.addEventListener('pointerleave', this.onPointerEnd);
    window.addEventListener('blur', this.onWindowBlur);
    this.publishPointerDiagnostics();
  }

  private unbindCanvasInteraction(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerEnd);
      canvas.removeEventListener('pointercancel', this.onPointerEnd);
      canvas.removeEventListener('lostpointercapture', this.onPointerEnd);
      canvas.removeEventListener('pointerleave', this.onPointerEnd);
    }
    window.removeEventListener('blur', this.onWindowBlur);
  }

  private makeCanvasPointer(event: PointerEvent, previous?: CanvasPointer): CanvasPointer {
    const canvas = this.canvas;
    if (!canvas) return { x: 0, y: 0, vx: 0, vy: 0 };
    const rect = canvas.getBoundingClientRect();
    const rectWidth = Math.max(1, rect.width);
    const rectHeight = Math.max(1, rect.height);
    const x = clamp(event.clientX - rect.left, 0, rectWidth) * this.width / rectWidth;
    const y = clamp(event.clientY - rect.top, 0, rectHeight) * this.height / rectHeight;
    return {
      x,
      y,
      vx: previous ? x - previous.x : 0,
      vy: previous ? y - previous.y : 0,
    };
  }

  private applyCanvasPointerInteractions(materialId: number, emitCount = 5): void {
    const solver = this.solver;
    if (!solver || this.activePointers.size === 0) return;
    const radius = this.canvasPointerRadius();
    for (const pointer of this.activePointers.values()) {
      solver.applyPointer({
        mode: 'drag',
        x: pointer.x,
        y: pointer.y,
        vx: pointer.vx,
        vy: pointer.vy,
        radius,
        strength: solver.parameters.pointerForce,
        materialId,
        emitCount,
      });
      pointer.vx = 0;
      pointer.vy = 0;
      this.pointerInteractionCount += 1;
      this.publishPointerDiagnostics(pointer, 'drag');
    }
  }

  private canvasPointerRadius(): number {
    const canvas = this.canvas;
    if (!canvas) return 100;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 100;

    // A 100 px brush in the original demo should remain 100 visible CSS px in
    // the scaled output preview. The geometric mean converts CSS pixels into
    // solver pixels while preserving brush area if the two axes differ. At
    // native size both ratios are 1, retaining the original radius exactly.
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    return 100 * Math.sqrt(scaleX * scaleY);
  }

  private clearCanvasPointers(): void {
    this.activePointers.clear();
    this.publishPointerDiagnostics();
  }

  private publishPointerDiagnostics(pointer?: CanvasPointer, mode = 'idle'): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.dataset.fluidActivePointers = String(this.activePointers.size);
    canvas.dataset.fluidPointerInteractions = String(this.pointerInteractionCount);
    canvas.dataset.fluidPointerMode = this.activePointers.size > 0 ? mode : 'idle';
    if (pointer) {
      canvas.dataset.fluidPointerX = pointer.x.toFixed(2);
      canvas.dataset.fluidPointerY = pointer.y.toFixed(2);
      canvas.dataset.fluidPointerVelocityX = pointer.vx.toFixed(2);
      canvas.dataset.fluidPointerVelocityY = pointer.vy.toFixed(2);
    }
  }

  private publishDiagnostics(
    renderState: Record<string, number>,
    emitterMaterial: number,
    substeps: number,
    paused: boolean,
    reactiveOriginal: ReactiveFluidOutput | null,
    opening: OpeningFluidOutput,
  ): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.dataset.requestedEmissiveMaterial = String(emitterMaterial);
    canvas.dataset.requestedEmissiveName = DEFAULT_MATERIALS[emitterMaterial]?.name ?? 'Unknown';
    canvas.dataset.fluidParticleLimit = String(opening.scene > 0 ? OPENING_PARTICLES : this.particleLimit);
    canvas.dataset.fluidSubsteps = String(substeps);
    canvas.dataset.fluidPaused = String(paused);
    canvas.dataset.fluidDirector = reactiveOriginal
      ? 'reactive-original'
      : opening.scene > 0 ? 'opening' : 'manual';
    canvas.dataset.fluidDirectorAutomatic = reactiveOriginal ? 'true' : 'false';
    canvas.dataset.fluidMaterialMasses = this.materialMasses.map((mass) => mass.toFixed(3)).join(',');
    canvas.dataset.fluidPhysics = [
      this.physics.sameRestDensity,
      this.physics.differentRestDensity,
      this.physics.stiffness,
      this.physics.nearStiffness,
      this.physics.gravity,
      this.physics.drag,
      this.physics.brake,
      this.physics.pointerForce,
    ].map((value) => value.toFixed(4)).join(',');
    canvas.dataset.fluidGrade = [
      renderState.gradeHue,
      renderState.gradeSaturation,
      renderState.gradeContrast,
      renderState.gradeBrightness,
      renderState.gradeBlackPoint,
    ].map((value) => Number(value).toFixed(4)).join(',');
    const activeOpeningEmitters = opening.emitters.filter((emitter) => emitter.active);
    canvas.dataset.openingScene = String(opening.scene);
    canvas.dataset.openingParticleTarget = opening.scene > 0 ? String(OPENING_PARTICLES) : '0';
    canvas.dataset.openingEmitterCount = String(activeOpeningEmitters.length);
    canvas.dataset.openingEmitterSlots = activeOpeningEmitters.map((emitter) => (
      `${emitter.id}:${emitter.entry}:${emitter.x.toFixed(4)},${emitter.y.toFixed(4)},${emitter.sizeScale.toFixed(3)}`
    )).join(';');
    canvas.dataset.openingImpulseCounter = String(opening.impulseCounter);
    canvas.dataset.openingImpulseEmitterIndex = opening.impulseEmitterIndex === null
      ? '-1'
      : String(opening.impulseEmitterIndex);
    canvas.dataset.openingImpulseRoute = opening.impulseEmitterIndex === null
      ? 'idle'
      : `slot-${opening.impulseEmitterIndex}`;
    canvas.dataset.openingPalette = opening.lighting.palette;
    canvas.dataset.openingCollisions = opening.collisions ? 'true' : 'false';
    if (reactiveOriginal) {
      const telemetry = reactiveOriginal.telemetry;
      canvas.dataset.primaryEmitter = String(telemetry.primaryMaterial);
      canvas.dataset.secondaryEmitter = String(telemetry.secondaryMaterial);
      canvas.dataset.secondaryEmitterFraction = telemetry.secondaryFraction.toFixed(3);
      canvas.dataset.detectedBpm = telemetry.bpm.toFixed(1);
      canvas.dataset.reactiveMoment = telemetry.momentId;
      canvas.dataset.reactiveMomentName = telemetry.momentName;
      canvas.dataset.reactiveMomentTransition = telemetry.momentTransition.toFixed(3);
      canvas.dataset.reactiveMomentRemaining = telemetry.momentRemaining.toFixed(2);
      canvas.dataset.reactiveGravity = telemetry.gravity.toFixed(4);
      canvas.dataset.reactiveSamePull = telemetry.sameRestDensity.toFixed(3);
      canvas.dataset.reactiveCrossPull = telemetry.differentRestDensity.toFixed(3);
    } else {
      canvas.dataset.primaryEmitter = String(emitterMaterial);
      canvas.dataset.secondaryEmitter = '-1';
      canvas.dataset.secondaryEmitterFraction = '0.000';
      canvas.dataset.reactiveMoment = 'manual';
      canvas.dataset.reactiveMomentName = 'MANUAL';
      canvas.dataset.reactiveMomentTransition = '0.000';
      canvas.dataset.reactiveMomentRemaining = '0.00';
    }
  }

  private applyContinuousInteraction(
    dt: number,
    now: number,
    flow: number,
    turbulence: number,
    materialId: number,
  ): void {
    const solver = this.solver;
    if (!solver) return;
    this.interactionElapsed += dt;
    if (this.interactionElapsed < 0.11 || turbulence < 0.035) return;
    this.interactionElapsed %= 0.11;
    const phase = now * 0.17;
    const mode = this.look.id === 'cluster'
      ? 'attract'
      : this.look.id === 'burst'
        ? 'repel'
        : Math.sin(phase * 3.1) >= 0
          ? 'vortex'
          : 'vortex-reverse';
    solver.applyPointer({
      mode,
      x: this.width * (0.5 + Math.sin(phase) * 0.23),
      y: this.height * (0.5 + Math.cos(phase * 0.83) * 0.18),
      vx: 0,
      vy: 0,
      radius: Math.min(this.width, this.height) * (0.1 + turbulence * 0.08),
      strength: (0.025 + flow * 0.065) * turbulence * this.look.impulse,
      materialId,
      emitCount: 0,
    });
  }

  private applyMusicalInteraction(
    frame: SceneFrame,
    features: ReactiveFeatures,
    burst: number,
    flow: number,
    turbulence: number,
    materialId: number,
  ): void {
    const solver = this.solver;
    if (!solver) return;
    const freshAudio = frame.audio.sequence !== this.lastAudioSequence;
    if (freshAudio) this.lastAudioSequence = frame.audio.sequence;
    const manualBurst = burst >= 0.55 && this.previousBurst < 0.55;
    const noteEvent = freshAudio && frame.audio.notes.length > 0;
    if ((!features.onsetEvent && !manualBurst && !noteEvent) || frame.now - this.lastMusicalInteractionAt < 0.075) return;
    this.lastMusicalInteractionAt = frame.now;

    let mode = 'vortex';
    if (this.look.id === 'cluster') mode = 'attract';
    else if (this.look.id === 'burst' || frame.audio.bass >= Math.max(frame.audio.mid, frame.audio.treble)) mode = 'repel';
    else if (frame.audio.treble > frame.audio.mid) mode = 'attract';
    else if (frame.audio.harmonic < 0.5) mode = 'vortex-reverse';

    solver.applyPointer({
      mode,
      x: this.width * clamp(0.12 + features.noteCenter * 0.76, 0.08, 0.92),
      y: this.height * clamp(0.68 - frame.audio.treble * 0.38, 0.2, 0.78),
      vx: 0,
      vy: 0,
      radius: Math.min(this.width, this.height) * (0.09 + turbulence * 0.09),
      strength: (0.18 + burst * 0.55 + frame.audio.onset * 0.42 + flow * 0.12)
        * this.look.impulse,
      materialId,
      emitCount: 0,
    });
  }

  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 0x1_0000_0000;
  }
}

export default FluidScene;
