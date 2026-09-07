import KotFluidWorkerClient, { DEFAULT_PARAMETERS } from '../scenes/fluid/KotFluidWorkerClient.js';
import ParticleRenderer, { type FluidRendererQuality } from '../scenes/fluid/FluidRadianceRenderer';
import FluidsShowDirector, {
  FLUIDS_SHOW_MATERIALS,
  hsvToHex,
  type FluidsShowOutput,
} from '../scenes/fluid/FluidsShowDirector';
import TresMasasGeometry from '../scenes/fluid/TresMasasGeometry';
import { emptyDoc, type ShowDoc } from '../fluids-show/show-doc';
import type { FluidsLiveGesture } from '../scenes/fluid/FluidScene';

export const FLUID_WIDTH = 2688;
export const FLUID_HEIGHT = 1008;
export const LIVE_PARTICLE_CAP = 14_000;
export const LIVE_DEFAULTS = Object.freeze({
  emission: 0, x: 0.5, y: 0.5, hue: 0,
  gravity: 0, viscosity: 0.5, cohesion: 0.5, light: 1, forceX: 0, forceY: 0,
});
export type FluidLiveValues = Partial<Record<keyof typeof LIVE_DEFAULTS, number>>;
export interface FluidRuntimeFrame {
  /** Application monotonic clock in seconds, never the clamped physics clock. */
  now: number;
  dt: number;
  time?: number;
  playing?: boolean;
  /** Only the natural ending freezes; timeline pause retains the original fluid behavior. */
  frozen?: boolean;
  /**
   * Ganancia de salida del show, multiplicando la exposición que publica el
   * documento. 1 es el show tal como fue escrito; el operador la sube desde
   * `fluids.gain` cuando la pared LED pide más luz que un monitor.
   */
  gain?: number;
  live?: FluidLiveValues;
}
type ActionPayload = Partial<FluidsLiveGesture> & { count?: number; material?: number };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * One solver and one renderer, driven solely by the host Engine.
 * The timeline director is physically detached on live takeover: pausing its
 * clock alone would keep colliders, gestures, lamps and physics curves active.
 */
export class FluidRuntime {
  canvas: HTMLCanvasElement | null = null;
  mode: 'idle' | 'standby' | 'timeline' | 'live' = 'idle';
  private solver: KotFluidWorkerClient | null = null;
  private renderer: ParticleRenderer | null = null;
  private geometry: TresMasasGeometry | null = null;
  private director: FluidsShowDirector | null = null;
  private document: ShowDoc | null = null;
  private gesture: FluidsLiveGesture | null = null;
  private suspended = true;
  private disposed = false;
  private generation = 0;
  private width = FLUID_WIDTH;
  private height = FLUID_HEIGHT;
  private dpr = 1;
  private physicsElapsed = 0;
  private massElapsed = 0;
  private massScale = 1;
  private liveEmission = 0;
  private livePendingParticles = 0;
  private lastSolverFrame = -1;
  private actions: Array<{ name: string; payload: ActionPayload }> = [];
  private lastRender: Record<string, number> = {};
  private lastStatus: FluidsShowOutput['status'] | null = null;
  private liveValues: typeof LIVE_DEFAULTS | Required<FluidLiveValues> = { ...LIVE_DEFAULTS };
  private warning: string | null = null;
  private frameCount = 0;
  private frozen = false;
  private gain = 1;
  private standbyPrepared = false;
  private readonly quality: FluidRendererQuality;

  /**
   * `supersample` es la escala del buffer de dibujo sobre el cuadro lógico. La
   * página original del show renderizaba a 2× y bajaba a 2688×1008; a 1× queda
   * a la vista la trama de la reconstrucción del campo de radiancia, que sobre
   * la pared LED se lee como un rayado sucio. Medido en la RTX 3090, subirlo a
   * 2 no movió el tiempo de render (el costo lo manda el campo, que es de
   * resolución fija).
   */
  constructor({ quality = 'high', supersample = 2 }: { quality?: FluidRendererQuality; supersample?: number } = {}) {
    this.quality = quality;
    this.dpr = clamp(supersample, 0.5, 2);
  }

  async init(host: HTMLElement): Promise<void> {
    if (this.renderer) return;
    if (this.disposed) throw new Error('Fluid runtime disposed.');
    const canvas = document.createElement('canvas');
    canvas.dataset.scene = 'radiance-fluid';
    canvas.setAttribute('aria-label', 'Radiance Fluids');
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', pointerEvents: 'none' });
    this.canvas = canvas;
    host.append(canvas);
    try {
      this.renderer = new ParticleRenderer(canvas);
      this.renderer.setQuality(this.quality);
      this.renderer.resize(this.width, this.height, this.dpr);
      this.geometry = new TresMasasGeometry();
      const solver = new KotFluidWorkerClient({
        width: this.width,
        height: this.height,
        initialParticlesByMaterial: [0, 0, 0, 0],
        parameters: { ...DEFAULT_PARAMETERS },
      });
      this.solver = solver;
      await solver.ready;
      if (this.disposed) return;
      this.warmup();
    } catch (error) {
      this.warning = error instanceof Error ? error.message : String(error);
      this.dispose();
      throw error;
    }
  }

  private warmup(): void {
    const renderer = this.renderer!;
    const geometry = this.geometry!;
    const neutral = new FluidsShowDirector();
    this.lastRender = neutral.update({ time: 0, dt: 1 / 60, playing: false,
      aspect: this.width / this.height, particleCount: 0 }).render;
    geometry.setInstances([
      { x: 0.4, y: 0.5, w: 0.02, h: 0.1, rot: 0.4, color: 0xffffff, emit: 1, absorb: 1, shade: 1, shape: 0 },
      { x: 0.6, y: 0.5, w: 0.02, h: 0.1, rot: 0, color: 0xff0000, emit: 1, absorb: 1, shade: 1, shape: 1, top: true },
    ], this.width, this.height);
    renderer.setOverlay(geometry);
    const sample = {
      count: 4,
      positions: new Float32Array([900, 500, 901, 500, 902, 500, 903, 500]),
      materialIds: new Uint8Array([0, 1, 2, 3]),
    };
    renderer.render(sample, { ...this.lastRender, allEmitters: 1, instantEmissionRole: 1, blackOutput: 0 });
    renderer.render(sample, { ...this.lastRender, blackOutput: 1 });
    renderer.finishWarmup();
    renderer.setOverlay(null);
    geometry.setInstances([], this.width, this.height);
    renderer.resetRadiance();
    renderer.render(this.solver, { blackOutput: 1 });
  }

  setDocument(doc: ShowDoc): void {
    if (this.document === doc) return;
    this.document = doc;
    this.director?.setDoc(doc);
    if (this.mode === 'standby' && this.standbyPrepared) this.prepareStandbyVisual();
  }

  async enterTimeline(doc?: ShowDoc): Promise<void> {
    await this.prepareTimeline('timeline', doc);
  }

  /** Scene 24: an empty, stationary field and the initial white line only. */
  async enterStandby(doc?: ShowDoc): Promise<void> {
    await this.prepareTimeline('standby', doc);
  }

  /** Scene 25's cue has no worker round trip or renderer/cache reset. */
  startTimeline(): boolean {
    if (this.disposed || this.mode !== 'standby' || !this.standbyPrepared || !this.director) return false;
    this.mode = 'timeline';
    this.standbyPrepared = false;
    this.clearInput();
    this.suspended = false;
    this.frozen = false;
    this.publishStats();
    return true;
  }

  private async prepareTimeline(mode: 'standby' | 'timeline', doc?: ShowDoc): Promise<void> {
    this.standbyPrepared = false;
    if (doc) this.setDocument(doc);
    if (!this.document) throw new Error('The Fluids timeline document has not loaded.');
    const generation = ++this.generation;
    this.suspended = true;
    this.clearInput();
    const solver = this.requireSolver();
    await solver.drain();
    if (generation !== this.generation || this.disposed) return;
    this.director = new FluidsShowDirector();
    this.director.setDoc(this.document);
    this.director.seek(0);
    this.mode = mode;
    this.physicsElapsed = 0.05;
    this.massElapsed = 0;
    this.massScale = 1;
    FLUIDS_SHOW_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
    solver.setParameters({ ...DEFAULT_PARAMETERS });
    solver.reset({ initialParticlesByMaterial: [0, 0, 0, 0] });
    await solver.drain();
    if (generation !== this.generation || this.disposed) return;
    this.renderer!.resetRadiance();
    this.renderer!.setOverlay(this.geometry);
    this.lastStatus = null;
    this.frozen = false;
    if (mode === 'standby') {
      this.prepareStandbyVisual();
      this.standbyPrepared = true;
    }
    this.suspended = false;
  }

  private prepareStandbyVisual(): void {
    if (!this.document || !this.renderer || !this.geometry) return;
    // Sample only the original blade geometry at zero. A separate visual
    // document guarantees that no timeline event/gesture runs or consumes its
    // first trigger while the real director waits for the next MIDI cue.
    const visualDoc: ShowDoc = {
      ...this.document,
      events: [],
      gestures: [],
      curves: { ...this.document.curves,
        lineEmit: { keys: [{ t: 0, v: 1, shape: 'hold' }] },
        lineBreak: { keys: [{ t: 0, v: 0, shape: 'hold' }] },
      },
    };
    const visual = new FluidsShowDirector();
    visual.setDoc(visualDoc);
    const out = visual.update({ time: 0, dt: 1 / 60, playing: false,
      aspect: this.width / this.height, particleCount: 0 });
    // uGain affects only the HRC source shader. The original white blade's
    // visible face keeps its full brightness, but it injects no diffuse light
    // into the display field while waiting. TimelineFrame restores gain 1.
    this.geometry.setGain(0);
    this.geometry.setInstances(out.geometry, this.width, this.height);
    this.renderer.setOverlay(this.geometry);
    this.lastRender = { ...out.render, blackOutput: 0, backgroundBlack: 1,
      radiance: 0, radianceExposure: 0 };
    this.lastStatus = null;
    this.publishStats();
  }

  async enterLive({ preserve = false }: { preserve?: boolean } = {}): Promise<void> {
    const generation = ++this.generation;
    const keepParticles = preserve && this.mode === 'timeline';
    this.standbyPrepared = false;
    this.suspended = true;
    this.clearInput();
    const solver = this.requireSolver();
    await solver.drain();
    if (generation !== this.generation || this.disposed) return;
    this.director = null;
    this.mode = 'live';
    this.lastStatus = null;
    this.geometry!.setInstances([], this.width, this.height);
    this.renderer!.setOverlay(null);
    FLUIDS_SHOW_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
    // A neutral independent live base. No sampled timeline lamps, brakes or colors leak in.
    this.liveValues = { ...LIVE_DEFAULTS };
    const neutral = new FluidsShowDirector();
    neutral.setDoc(emptyDoc());
    this.lastRender = neutral.update({ time: 0, dt: 1 / 60, playing: false,
      aspect: this.width / this.height, particleCount: 0 }).render;
    this.setLivePhysics(this.liveValues);
    if (!keepParticles) {
      solver.reset({ initialParticlesByMaterial: [0, 0, 0, 0] });
      this.renderer!.resetRadiance();
    }
    await solver.drain();
    if (generation !== this.generation || this.disposed) return;
    this.frozen = false;
    this.suspended = false;
  }

  frame({ now, dt, time = 0, playing = false, frozen = false, gain = 1, live = {} }: FluidRuntimeFrame): void {
    if (this.suspended || this.disposed || !this.renderer || !this.solver || this.mode === 'idle') return;
    if (frozen && this.mode === 'timeline' && this.frozen) return;
    const step = clamp(dt, 0.001, 0.1);
    this.gain = clamp(gain, 0.1, 4);
    try {
      if (this.mode === 'standby') {
        // Redraw the cached line for output/preview; neither timeline nor
        // interpolation, interactions or solver steps advance in standby.
        this.renderer.render(this.solver, this.lastRender);
      } else if (this.mode === 'timeline') this.timelineFrame(now, step, time, playing, frozen);
      else this.liveFrame(now, step, live);
      this.warning = this.solver.error;
      this.frameCount += 1;
      this.frozen = frozen;
    } catch (error) {
      this.warning = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private timelineFrame(now: number, dt: number, time: number, playing: boolean, frozen: boolean): void {
    const solver = this.solver!;
    const out = this.director!.update({ time, dt, playing, aspect: this.width / this.height, particleCount: solver.count });
    if (out.resetParticles) {
      this.gesture = null;
      solver.cancelQueuedStep();
      this.massScale = 1;
      FLUIDS_SHOW_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
      solver.reset({ initialParticlesByMaterial: out.resetParticles });
    }
    if (out.resetRadiance) this.renderer!.resetRadiance();
    this.massElapsed += dt;
    if (this.massElapsed >= 0.1) {
      this.massElapsed %= 0.1;
      const scale = clamp(out.status.materialMassScale, 0.05, 4);
      if (Math.abs(scale - this.massScale) > this.massScale * 0.01) {
        this.massScale = scale;
        FLUIDS_SHOW_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass * scale));
      }
    }
    this.physicsElapsed += dt;
    if (this.physicsElapsed >= 0.05) {
      this.physicsElapsed %= 0.05;
      solver.setParameters({ ...out.physics, pointerForce: DEFAULT_PARAMETERS.pointerForce });
    }
    if (!frozen) {
      for (const interaction of out.interactions) {
        solver.applyPointer({ ...interaction, x: interaction.x * this.width, y: interaction.y * this.height,
          vx: interaction.vx * this.height, vy: interaction.vy * this.height,
          radius: interaction.radius * Math.min(this.width, this.height) });
      }
      this.applyGesture(dt);
      solver.step(3);
    } else solver.cancelQueuedStep();
    solver.updateInterpolation(now * 1000);
    this.geometry!.setGain(1);
    this.geometry!.setInstances(out.geometry, this.width, this.height);
    this.renderer!.setOverlay(this.geometry);
    this.renderer!.render(solver, this.graded(out.render));
    this.lastRender = out.render;
    this.lastStatus = out.status;
    this.publishStats();
  }

  /**
   * Sube la luz del show sin tocar el documento: la energía que entra al
   * transporte y la exposición con la que se muestra van juntas, que es lo
   * mismo que subir la potencia de las lámparas de la escena. Cambiar sólo el
   * brillo del grade lavaría los negros, que es justo lo que sostiene esta
   * imagen. El renderer recorta ambos valores a su rango, así que una ganancia
   * alta satura antes de romper nada.
   */
  private graded(render: Record<string, number>): Record<string, number> {
    if (this.gain === 1) return render;
    return { ...render,
      radiance: (render.radiance ?? 0.82) * this.gain,
      radianceExposure: (render.radianceExposure ?? 1.15) * this.gain };
  }

  private setLivePhysics(live: Required<FluidLiveValues>): void {
    const cohesion = live.cohesion;
    this.solver!.setParameters({
      sameRestDensity: mix(3.2, 11.2, cohesion), differentRestDensity: mix(5.5, 1.3, cohesion),
      stiffness: mix(0.2, 0.3, cohesion), nearStiffness: mix(0.08, 1.45, cohesion),
      gravity: live.gravity < 0 ? live.gravity * 0.3 : live.gravity * 1.2,
      drag: 0.014 + live.viscosity * 0.185, brake: Math.max(0, live.viscosity - 0.8) * 0.06,
      pointerForce: DEFAULT_PARAMETERS.pointerForce,
    });
  }

  private liveFrame(now: number, dt: number, values: FluidLiveValues): void {
    const solver = this.solver!;
    const live = { ...LIVE_DEFAULTS, ...values };
    for (const key of Object.keys(live) as Array<keyof typeof LIVE_DEFAULTS>) {
      live[key] = clamp(live[key], ['gravity', 'forceX', 'forceY'].includes(key) ? -1 : 0, key === 'light' ? 3 : 1);
    }
    if (solver.frame !== this.lastSolverFrame) {
      this.lastSolverFrame = solver.frame;
      this.livePendingParticles = 0;
    }
    const physicsChanged = ['gravity', 'viscosity', 'cohesion'].some(key =>
      live[key as keyof typeof live] !== this.liveValues[key as keyof typeof live]);
    if (physicsChanged) this.setLivePhysics(live);
    this.liveValues = live;
    this.liveEmission += live.emission * 2400 * dt;
    const emit = Math.floor(this.liveEmission / 3) * 3;
    if (emit > 0) {
      this.liveEmission -= emit;
      this.emit(emit, live.x, live.y, 0);
    }
    for (const { name, payload } of this.actions.splice(0)) {
      const x = clamp(payload.x ?? live.x);
      const y = clamp(payload.y ?? live.y);
      if (name === 'burst') this.emit(clamp(payload.count ?? 180, 3, 3000), x, y, payload.material ?? 0);
      else if (name === 'attractor') this.applyInteraction({ ...payload, x, y, mode: payload.mode ?? 'attract' }, dt);
    }
    if (Math.abs(live.forceX) + Math.abs(live.forceY) > 0.0001) {
      solver.applyPointer({ mode: 'drag', x: live.x * this.width, y: live.y * this.height,
        radius: Math.max(this.width, this.height) * 2, vx: live.forceX * dt * this.width * 0.15,
        vy: live.forceY * dt * this.height * 0.15 });
    }
    this.applyGesture(dt);
    solver.step(3);
    solver.updateInterpolation(now * 1000);
    const render = { ...this.lastRender, radiance: clamp(live.light * 1.4, 0, 2.5),
      radianceExposure: live.light * 0.38, materialColor0: hsvToHex(live.hue, 1),
      emissiveMaterial: 0, reactiveSecondaryMaterial: -1, reactiveSecondaryStrength: 0,
      blackOutput: 0, instantEmissionRole: 1, bodyAmbient: 0.08, lightOnly: 0 };
    this.renderer!.render(solver, this.graded(render));
    this.publishStats();
  }

  private emit(count: number, x: number, y: number, material: number): void {
    const solver = this.solver!;
    // The unmodified native brush adds emitCount once in EACH of three substeps.
    const room = LIVE_PARTICLE_CAP - solver.count - this.livePendingParticles;
    const perSubstep = Math.floor(Math.min(count, room) / 3);
    if (perSubstep < 1) return;
    this.livePendingParticles += perSubstep * 3;
    solver.applyPointer({ mode: 'emit', x: x * this.width, y: y * this.height,
      materialId: Math.round(clamp(material, 0, 2)), emitCount: perSubstep, radius: 20, strength: 0.5 });
  }

  setGesture(gesture: FluidsLiveGesture | null): void {
    this.gesture = this.suspended || this.mode === 'standby' ? null : gesture;
  }

  private applyGesture(dt: number): void {
    if (this.gesture) this.applyInteraction(this.gesture, dt);
  }

  private applyInteraction(gesture: ActionPayload, dt: number): void {
    const modes = ['drag', 'attract', 'repel', 'vortex', 'vortex-reverse', 'delete', 'lock', 'unlock'];
    const mode = modes.includes(gesture.mode ?? '') ? gesture.mode! : 'attract';
    this.solver!.applyPointer({ mode, x: clamp(gesture.x ?? 0.5) * this.width,
      y: clamp(gesture.y ?? 0.5) * this.height, vx: (gesture.vx ?? 0) * dt * this.width,
      vy: (gesture.vy ?? 0) * dt * this.height,
      radius: clamp(gesture.radius ?? 0.22, 0.01, 0.5) * Math.min(this.width, this.height),
      strength: clamp(gesture.strength ?? 0.7, 0, 4), materialId: 0, emitCount: 0 });
  }

  liveAction(name: string, payload: ActionPayload = {}): void {
    if (this.mode !== 'live' || this.suspended) return;
    if (name === 'reset') { this.reset(); return; }
    if (name !== 'burst' && name !== 'attractor') return;
    if (this.actions.length >= 16) this.actions.shift();
    this.actions.push({ name, payload: { ...payload } });
  }

  reset(): void {
    this.clearInput();
    if (this.mode === 'standby') return;
    if (this.mode === 'timeline') this.director?.requestReset();
    else {
      this.solver?.reset({ initialParticlesByMaterial: [0, 0, 0, 0] });
      this.renderer?.resetRadiance();
    }
  }

  suspend(suspended = true): void {
    this.suspended = suspended;
    if (suspended) {
      this.generation += 1;
      this.clearInput();
      this.solver?.cancelQueuedStep();
    }
  }

  resize(width = FLUID_WIDTH, height = FLUID_HEIGHT, dpr = 1): void {
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = clamp(dpr, 0.5, 2);
    this.renderer?.resize(this.width, this.height, this.dpr);
    this.solver?.resize(this.width, this.height);
    if (this.mode === 'standby' && this.standbyPrepared) this.prepareStandbyVisual();
  }

  telemetry() {
    const stats = this.renderer?.stats;
    return {
      mode: this.mode, standbyPrepared: this.standbyPrepared,
      suspended: this.suspended, renderedFrames: this.frameCount,
      particles: this.solver?.count ?? 0, solverFrame: this.solver?.frame ?? 0,
      pps: this.mode === 'live' ? this.liveValues.emission * 2400 : this.lastStatus?.pps ?? 0,
      capped: this.mode === 'live' ? (this.solver?.count ?? 0) >= LIVE_PARTICLE_CAP : this.lastStatus?.capped ?? false,
      scale: this.dpr,
      solverMs: this.solver?.lastStepMs ?? 0, roundTripMs: this.solver?.roundTripMs ?? 0,
      snapshotAgeMs: this.solver?.snapshotAgeMs ?? 0,
      stepInFlight: this.solver?._stepInFlight ?? false,
      stepQueued: this.solver?._stepQueued ?? false,
      pendingInteractions: this.solver?._pendingInteractions.length ?? 0,
      drawCalls: stats?.drawCalls ?? 0, memoryMb: (stats?.targetMemoryBytes ?? 0) / 1048576,
      radianceResolution: stats?.resolution, activeEvents: this.lastStatus?.activeEvents ?? 0,
      activeGestures: this.lastStatus?.activeGestures ?? 0,
      renderer: 'WebGL2 · Radiance HRC', warning: this.warning,
    };
  }

  private publishStats(): void {
    if (!this.canvas) return;
    this.canvas.dataset.fluidDirector = this.mode === 'standby' ? 'fluids-standby'
      : this.mode === 'timeline' ? 'fluids-show' : 'fluids-live';
    this.canvas.dataset.fluidsShowParticles = String(this.solver?.count ?? 0);
    this.canvas.dataset.fluidsShowEvents = String(this.lastStatus?.activeEvents ?? 0);
    this.canvas.dataset.fluidsShowGestures = String(this.lastStatus?.activeGestures ?? 0);
  }

  private clearInput(): void {
    this.actions.length = 0;
    this.gesture = null;
    this.liveEmission = 0;
    this.livePendingParticles = 0;
  }

  private requireSolver(): KotFluidWorkerClient {
    if (!this.solver || this.disposed) throw new Error('Fluid runtime has not initialized.');
    return this.solver;
  }

  dispose(): void {
    if (this.disposed) return;
    this.suspended = true;
    this.disposed = true;
    this.standbyPrepared = false;
    this.generation += 1;
    this.clearInput();
    this.solver?.dispose();
    this.renderer?.setOverlay(null);
    this.geometry?.dispose();
    this.renderer?.dispose();
    this.canvas?.remove();
    this.solver = null;
    this.renderer = null;
    this.geometry = null;
    this.canvas = null;
    this.director = null;
  }
}

export default FluidRuntime;
