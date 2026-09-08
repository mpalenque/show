import KotFluidWorkerClient, { DEFAULT_PARAMETERS } from '../scenes/fluid/KotFluidWorkerClient.js';
import ParticleRenderer, { type FluidRendererQuality } from '../scenes/fluid/FluidRadianceRenderer';
import FluidsShowDirector, {
  FLUIDS_SHOW_MATERIALS,
  hsvToHex,
  type FluidsShowOutput,
} from '../scenes/fluid/FluidsShowDirector';
import TresMasasGeometry from '../scenes/fluid/TresMasasGeometry';
import {
  cloneDoc, createId, emptyDoc, sampleCurveId, type CurveId, type ShowDoc, type ShowEvent,
} from '../fluids-show/show-doc';
import type { FluidsLiveGesture } from '../scenes/fluid/FluidScene';

export const FLUID_WIDTH = 2688;
export const FLUID_HEIGHT = 1008;
export const LIVE_PARTICLE_CAP = 14_000;
/**
 * La población con la que la página original crea el solver
 * (`initialMaterialCounts(20 000)`: tres bandas de 6666 más las dos Azure).
 * En la 25 NO se usa: el documento la vacía con su `reset-fluid` de t = 0,05
 * y el show se escribió así — medido con el documento real en las dos páginas,
 * la integración y la original oscilan igual (21 → 1 → 25 → 18 → 0,2 → 12 de
 * brillo medio en los primeros 15 s). Lo que se recordaba como "el original
 * más brillante" era la página original corriendo el documento VACÍO: en una
 * carga fresca su director no recibe el documento hasta que hay una edición,
 * y sin eventos ni reset esas 20 000 partículas blancas quedan encendidas.
 * Acá sólo sirve para entrar en frío a la 26, donde hace falta fluido con qué
 * jugar aunque la 25 no haya corrido.
 */
export const SHOW_INITIAL_POPULATION: readonly number[] = Object.freeze([6666, 6666, 6666, 2]);
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
  /** Faders de la 26; sólo se leen en modo `sequel`. */
  seq?: Partial<SequelControls>;
}

/**
 * Lo que Manuel mueve por CC en la 26. Los cinco primeros son curvas del
 * documento: mover el fader escribe una key `hold` en el instante actual, así
 * que el director las evalúa exactamente igual que en la secuencia escrita.
 */
export interface SequelControls {
  /** Curva `gravity`, -1..1: negativo sube. */
  gravity: number;
  /** Curva `cohesion`, 0..1: 0 fluye suelto, 1 blobs. */
  cohesion: number;
  /** Curva `viscosity`, 0..1: 1 casi quieto (así termina la 25). */
  viscosity: number;
  /** Curva `lightEmission`, 0..1. */
  light: number;
  /** Curva `exposure`, 0..2. */
  exposure: number;
  /**
   * Curva `bodies`, 0..1: cuánto se ve el cuerpo del fluido sin luz. El
   * documento termina en 0 (sólo luz); la 26 arranca en 0,15 para que la masa
   * heredada se lea como un cuerpo gris entre golpe y golpe.
   */
  bodies: number;
  /** Densidad de la grilla de losetas: 0 = celdas de 1 m, 1 = celdas de 25 cm. */
  grid: number;
  /** Cuánto se va la paleta al blanco y negro, 0..1. */
  mono: number;
  /** Vida de cada loseta y del congelado, en negras a 140. */
  tileLife: number;
  /** Compuerta de amb 1: 1 mientras hay una nota sostenida, 0 si no. La abre el Mapper (gate). */
  amb: number;
  /** Compuerta del atractor: cualquier nota del canal 3 (la pista "atractor" de Ableton) sostenida. */
  attract: number;
}
export const SEQUEL_DEFAULTS: Readonly<SequelControls> = Object.freeze({
  gravity: 0, cohesion: 0.62, viscosity: 1, light: 1, exposure: 1.2, bodies: 0.15, grid: 0, mono: 1, tileLife: 4, amb: 0, attract: 0,
});
/**
 * Cuánto tarda el OBSTÁCULO de una loseta en llegar a su tamaño. El cuadrado
 * se dibuja de golpe, pero si el colisionador aparece entero sobre la masa,
 * el solver proyecta afuera todo lo que encuentra adentro en un subpaso y eso
 * es una detonación (medido: 3 500 partículas expulsadas, la masa entera se va
 * a las paredes en 2 s). Creciendo, empuja el fluido en vez de volarlo.
 */
const TILE_GROW = 0.4;
/** Una loseta de la grilla: cuadrada, blanca (emite y expulsa) o negra (absorbe y congela). */
interface SequelTile {
  /** Centro de la celda destino, en fracciones del cuadro. */
  x: number; y: number;
  /** De dónde viene el último paso, para deslizar hasta (x, y) desde `moveStart`. */
  fromX: number; fromY: number; moveStart: number;
  /** Celda de la que viene el paso en curso: mientras se desliza ocupa las dos. */
  prevCol: number; prevRow: number;
  /** Celda destino en la grilla base de 50 cm y cuántas celdas ocupa de lado. */
  col: number; row: number; span: number;
  /** Dirección del paso: cada loseta viaja en x o en y, fijado al nacer. */
  dx: number; dy: number;
  /** Cuánto dura el deslizamiento en curso (proporcional a la distancia). */
  slide: number;
  /** Si busca la masa del fluido (pistón) o patrulla en línea recta rebotando. */
  hunt: boolean;
  /** Lado en unidades de alto. */
  side: number;
  /** Si es una de las lámparas del sorteo. Cambia con el relámpago, al azar. */
  lit: boolean;
  /** Intensidad propia de la lámpara (0,6..1,2), sorteada con cada relámpago. */
  level: number;
  born: number; life: number;
}
/** La grilla base de las losetas: celdas de 50 cm (16 × 6). Los tamaños son 1 y 2 celdas. */
const TILE_GRID = 2;
/**
 * Tamaños de las losetas por orden de aparición, en celdas de 50 cm: dos de
 * cada tres de 50 cm y una de 1 m. Hubo una de 2 m cada seis y Manuel las
 * sacó ("son demasiado grandes los cuadrados"); los dos tamaños conviven
 * desde el principio en vez de achicarse todos al final.
 */
const TILE_SIZES = [1, 1, 2, 1, 1, 2];
/**
 * Cuántas lámparas por sorteo: casi siempre una o dos, a veces tres (Manuel:
 * "son demasiados los prendidos; que a veces esté todo muy oscuro y sólo un
 * cuadrado o un par ilumina"). Sólo las de 50 cm pueden emitir: "nunca tienen
 * que prender los más grandes".
 */
const LIT_CHOICES = [1, 1, 2, 2, 3];
/** Cuánto dura el destello de las lámparas al cambiar, en segundos. */
const TILE_FLASH = 0.12;
/**
 * Velocidad del deslizamiento: 0,18 s por celda de 50 cm, lineal y seco, como
 * un pistón (Manuel: "más mecánico industrial"). Son ~5 px por subpaso del
 * solver, el empujón que el fluido aguanta sin detonar.
 */
const TILE_SLIDE_PER_CELL = 0.18;
/**
 * La emisión de las azules va del MÍNIMO al máximo con la nota de amb 1
 * (Manuel: "empieza del nivel mínimo de esa emissive hasta el doble de lo que
 * llega ahora, y cuando deja de sonar, en 1 segundo vuelve a su valor
 * mínimo"). Son dos cosas a la vez: cuánta lámpara azul reciben (`mix`, con
 * piso, así nunca se apagan del todo) y cuánto emiten PARADAS (`steady`, la
 * ganancia que le saca la compuerta de velocidad al material). 2,3 es el doble
 * de la ganancia anterior.
 */
const GLOW_MIX_MIN = 0.2;
const GLOW_MIX_MAX = 0.85;
const GLOW_STEADY = 2.3;
/** Lo que tarda en volver al mínimo cuando la nota deja de sonar, en segundos. */
const GLOW_RELEASE = 1;
/** Hz de la vibración de la emisión azul mientras sube. */
const GLOW_VIB_HZ = 11;
/** Cuánto dura el pulso de las lámparas con cada kick, en segundos. */
const LAMP_KICK = 0.15;
/** Cuántas celdas de la secuencia se prueban para colocar una loseta sin pisar otra. */
const PLACE_TRIES = 32;
/** Cuánto tarda el barrido que invierte en cruzar la pared, en segundos. */
const SWEEP_DUR = 0.8;
/** Medio ancho de la banda que invierte, en fracción del ancho (0,06 ≈ 1 m). */
const SWEEP_HALF = 0.06;
/** JEJE FLUID va a 140; la vida de las losetas se mide en negras de ese tempo. */
const SEQUEL_BPM = 140;
/** La pared es 8 × 3 m: la grilla base son celdas cuadradas de 1 m (336 px). */
const SEQUEL_COLS = 8;
const SEQUEL_ROWS = 3;
/** Techo del crecimiento de la vida con la cuenta (×4 = 16 negras con el fader en 4). */
const TILE_LIFE_CAP = 4;
/** El azul del glow de amb 1. */
const AMB_BLUE = 0x3060ff;
/** Paleta Ikeda: blanco, dos grises y blanco, para los cuatro materiales. */
const SEQUEL_MONO = [0xffffff, 0xd8d8d8, 0x9c9c9c, 0xffffff];
type ActionPayload = Partial<FluidsLiveGesture> & { count?: number; material?: number };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/**
 * Van der Corput en base 2: la k-ésima fracción recorre el intervalo de forma
 * pareja sin repetir ni agruparse. Es lo que reparte las losetas por la grilla
 * como una cuenta, no como un sorteo.
 */
const vanDerCorput = (k: number): number => {
  let result = 0;
  let scale = 0.5;
  for (let n = Math.max(0, Math.floor(k)); n > 0; n = Math.floor(n / 2)) {
    if (n % 2 === 1) result += scale;
    scale /= 2;
  }
  return result;
};
const mixColor = (a: number, b: number, t: number): number => {
  const k = clamp(t);
  const channel = (shift: number) => Math.round(mix((a >> shift) & 255, (b >> shift) & 255, k));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

/**
 * One solver and one renderer, driven solely by the host Engine.
 * The timeline director is physically detached on live takeover: pausing its
 * clock alone would keep colliders, gestures, lamps and physics curves active.
 */
export class FluidRuntime {
  canvas: HTMLCanvasElement | null = null;
  mode: 'idle' | 'standby' | 'timeline' | 'sequel' | 'live' = 'idle';
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
  /** Último tiempo que corrió la secuencia: de ahí sigue la 26. */
  private lastTimelineTime = 0;
  /** Copia mutable del documento para la 26: recibe keys y eventos en vivo. */
  private sequelDoc: ShowDoc | null = null;
  private sequelTime = 0;
  private seqApplied: Partial<SequelControls> = {};
  private seqControls: SequelControls = { ...SEQUEL_DEFAULTS };
  private seqPalette: number[] = [];
  private monoStart = 0;
  private tiles: SequelTile[] = [];
  private tileSerial = 0;
  /** Instante (en `tileClock`) del último relámpago de las lámparas. */
  private flashAt = Number.NEGATIVE_INFINITY;
  /** Cuántas lámparas pide el último sorteo. */
  private litTarget = 1;
  /** Instante (en `tileClock`) del último kick, para el pulso de las lámparas. */
  private kickAt = Number.NEGATIVE_INFINITY;
  /** Instante (en `tileClock`) en que arrancó el barrido que invierte. */
  private sweepAt = Number.NEGATIVE_INFINITY;
  /** Cuánto invierte la banda ahora mismo (telemetría). */
  private lastInvert = 0;
  /** Cursor propio de la secuencia de van der Corput para colocar sin pisar. */
  private placeCursor = 0;
  /** El atractor sostenido del canal 3, mientras la compuerta está abierta. */
  private attractEvent: ShowEvent | null = null;
  /** Cuántas veces se abrió la compuerta del atractor: alterna atracción y remolino. */
  private attractCount = 0;
  /** Si las partículas del material principal emiten en este compás. */
  private whitesOn = true;
  /** Destello vigente en el último frame, 0..1 (telemetría). */
  private lastFlash = 0;
  /** Estado del generador determinista con el que se eligen las lámparas. */
  private rng = 0x2f6b1a7d;
  private sweepDir = 1;
  private crackSign = 1;
  /** Hasta cuándo dura el congelado global; -Infinity = suelto. */
  private seqFrozenUntil = Number.NEGATIVE_INFINITY;
  private unfreezeFrames = 0;
  private pruneCountdown = 300;
  /** Interacciones mandadas al solver en el último frame (losetas, línea, eventos). */
  private lastInteractionCount = 0;
  /**
   * Losetas recién muertas que todavía sueltan el fluido. El obstáculo aprieta
   * las partículas contra su borde en una línea de un punto de grosor y, con la
   * viscosidad del cierre, al desaparecer la pared la línea se queda ahí como
   * una cicatriz recta (medido en el ensayo: a los 60 s había diez). Un
   * empujón corto desde el centro de la loseta las desarma.
   */
  private releasing: Array<{ x: number; y: number; radius: number; frames: number }> = [];
  /** Kicks recibidos en la 26; el cuarto de cada cuatro contrae en vez de empujar. */
  private pulseCount = 0;
  /** Glow de amb 1, 0..1, ya con ataque y caída. */
  private ambGlow = 0;
  /**
   * Cuánto tiempo pasó el fluido congelado por el stutter. Las losetas viven
   * en `tileClock` = sequelTime − esto: cuando el fluido es una foto, las
   * losetas también se quedan quietas. Si siguieran deslizándose pasaban por
   * encima de partículas trabadas y al soltar el colisionador las expulsaba
   * todas de golpe (medido: 1 154 adentro de una loseta al salir del stutter).
   */
  private frozenTotal = 0;
  /** El set-lamp de entrada a la 26: su `mix` es la emisión del material del glow. */
  private lampEvent: ShowEvent | null = null;
  /** Material reservado para el glow azul (el segundo con más partículas), o -1. */
  private glowMaterial = -1;
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

  frame({ now, dt, time = 0, playing = false, frozen = false, gain = 1, live = {}, seq = {} }: FluidRuntimeFrame): void {
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
      else if (this.mode === 'sequel') this.sequelFrame(now, step, seq);
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
    this.lastTimelineTime = time;
    const out = this.director!.update({ time, dt, playing, aspect: this.width / this.height, particleCount: solver.count });
    this.commitFrame(out, now, dt, frozen);
  }

  /**
   * Escena 26: la 25 que sigue viva. Mismo solver con sus partículas, mismo
   * director y el mismo documento —clonado para escribirle eventos y keys en
   * vivo sin tocar el que está guardado— con el reloj avanzando desde donde
   * quedó la secuencia. Si no se viene de la 25 (ensayo), arranca en el final
   * del documento con la población de la página original, para que haya
   * fluido con qué trabajar.
   */
  async enterSequel(doc?: ShowDoc): Promise<void> {
    if (doc) this.setDocument(doc);
    if (!this.document) throw new Error('The Fluids timeline document has not loaded.');
    const generation = ++this.generation;
    const continues = this.mode === 'timeline' && !!this.director;
    this.standbyPrepared = false;
    this.suspended = true;
    this.clearInput();
    const solver = this.requireSolver();
    await solver.drain();
    if (generation !== this.generation || this.disposed) return;
    this.sequelDoc = cloneDoc(this.document);
    if (continues) {
      this.sequelTime = this.lastTimelineTime;
    } else {
      this.director = new FluidsShowDirector();
      this.sequelTime = this.document.duration;
      this.director.seek(this.sequelTime);
      this.physicsElapsed = 0.05;
      this.massElapsed = 0;
      this.massScale = 1;
      FLUIDS_SHOW_MATERIALS.masses.forEach((mass, index) => solver.setMaterialMass(index, mass));
      solver.setParameters({ ...DEFAULT_PARAMETERS });
      solver.reset({ initialParticlesByMaterial: [...SHOW_INITIAL_POPULATION] });
      await solver.drain();
      if (generation !== this.generation || this.disposed) return;
      this.renderer!.resetRadiance();
    }
    this.director!.setDoc(this.sequelDoc);
    // La lámpara pasa al material que de verdad domina el fluido. El documento
    // termina alumbrando el material 0, que al final son unas pocas burbujas:
    // el resto de la masa quedaba a oscuras y entre golpe y golpe no se veía
    // nada (medido en el ensayo: cuadro negro a los 12 s). El segundo material
    // (al final de la 25, un cuarto de las partículas) queda reservado para el
    // glow de amb 1: arranca apagado (`mix` 0) y `updateGlow` lo va prendiendo
    // en azul con la nota.
    const [primary, secondary] = this.dominantMaterials();
    this.glowMaterial = secondary ?? -1;
    this.ambGlow = 0;
    this.lampEvent = this.inject('set-lamp', { primary, secondary: secondary ?? 4, mix: 0, fade: 2 }, 0.1);
    // Los faders arrancan donde las curvas dejaron el show: hasta que no se
    // muevan no se escribe ninguna key. `bodies` es la excepción y se escribe
    // ya: la masa heredada tiene que leerse como cuerpo.
    this.seqApplied = this.sequelCurveState();
    this.writeKey('bodies', SEQUEL_DEFAULTS.bodies);
    this.seqPalette = [...this.sequelDoc.materialColors];
    this.monoStart = this.sequelTime;
    this.tiles = [];
    this.releasing = [];
    this.frozenTotal = 0;
    this.pulseCount = 0;
    this.tileSerial = 0;
    this.flashAt = Number.NEGATIVE_INFINITY;
    this.kickAt = Number.NEGATIVE_INFINITY;
    this.sweepAt = Number.NEGATIVE_INFINITY;
    this.lastInvert = 0;
    this.placeCursor = 0;
    this.attractEvent = null;
    this.attractCount = 0;
    this.litTarget = 1;
    this.whitesOn = true;
    this.rng = 0x2f6b1a7d;
    this.sweepDir = 1;
    this.crackSign = 1;
    this.seqFrozenUntil = Number.NEGATIVE_INFINITY;
    this.unfreezeFrames = 0;
    this.pruneCountdown = 300;
    this.renderer!.setOverlay(this.geometry);
    this.lastStatus = null;
    this.mode = 'sequel';
    this.frozen = false;
    this.suspended = false;
    this.publishStats();
  }

  /** Reloj de la 26: sigue desde donde quedó la secuencia. */
  get sequelClock(): number { return this.sequelTime; }

  /** Valor actual de las curvas que los faders de la 26 pueden pisar. */
  sequelCurveState(): Pick<SequelControls, 'gravity' | 'cohesion' | 'viscosity' | 'light' | 'exposure' | 'bodies'> {
    const doc = this.sequelDoc ?? this.document ?? emptyDoc();
    const t = this.sequelTime;
    return {
      gravity: sampleCurveId(doc, 'gravity', t), cohesion: sampleCurveId(doc, 'cohesion', t),
      viscosity: sampleCurveId(doc, 'viscosity', t), light: sampleCurveId(doc, 'lightEmission', t),
      exposure: sampleCurveId(doc, 'exposure', t),
      // El cuerpo nunca arranca apagado en la 26, aunque el documento termine en 0.
      bodies: Math.max(SEQUEL_DEFAULTS.bodies, sampleCurveId(doc, 'bodies', t)),
    };
  }

  /** Los dos materiales con más partículas, para que la lámpara alumbre lo que hay. */
  private dominantMaterials(): number[] {
    const solver = this.solver!;
    const counts = [0, 0, 0, 0];
    const ids = solver.materialIds;
    for (let index = 0; index < solver.count && index < ids.length; index += 1) counts[ids[index]] += 1;
    return counts.map((count, material) => ({ count, material }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map(({ material }) => material);
  }

  private writeKey(id: CurveId, value: number): void {
    const curve = this.sequelDoc!.curves[id];
    curve.keys = curve.keys.filter((k) => k.t < this.sequelTime - 1e-6);
    curve.keys.push({ t: this.sequelTime, v: value, shape: 'hold' });
  }

  private sequelFrame(now: number, dt: number, controls: Partial<SequelControls>): void {
    const solver = this.solver!;
    const seq = { ...SEQUEL_DEFAULTS, ...this.seqApplied, ...controls } as SequelControls;
    this.seqControls = seq;
    this.sequelTime += dt;
    this.applySequelControls(seq);
    this.updateGlow(seq, dt);
    if (this.frozenFluid) this.frozenTotal += dt;
    const out = this.director!.update({ time: this.sequelTime, dt, playing: true,
      aspect: this.width / this.height, particleCount: solver.count });
    // El material del glow emite quieto: la cantidad la pone el `mix` de la
    // lámpara, esto le saca la compuerta de velocidad (Manuel: "se ven los
    // azules pero no se vuelven emissive") y le da +15 % de ganancia, que con
    // el techo 0,85 del `mix` es el +40 % que pidió.
    // Parte de cero —sin nota las azules sólo emiten si se mueven, que es su
    // mínimo— y llega al doble de la ganancia anterior con la nota entera.
    if (this.glowMaterial >= 0) out.render.reactiveSecondarySteady = GLOW_STEADY * this.ambGlow;
    // Los cambios de material principal son instantáneos (el fundido suspende
    // la lámpara secundaria y el glow azul parpadearía).
    out.render.instantEmissionRole = 1;
    // La velocidad ENCIENDE (Manuel: "cuando las partículas se aceleran, si
    // son emissive tendrían que iluminarse más"): el techo de emisión por
    // velocidad sube de 3,4 a 5,5 y se llega a él con menos velocidad. Las
    // azules parten de su ganancia parada y de ahí para arriba con el
    // movimiento. Y cuando las blancas están "apagadas" por compás, en
    // realidad emiten SÓLO en movimiento: quietas son cuerpos negros, y el
    // kick las hace relampaguear.
    out.render.velocityEmissionRange = 5.5;
    out.render.velocityEmissionSensitivity = 2.6;
    out.render.velocityEmissionFloor = this.whitesOn ? 0.2 : 0;
    this.updateAttractor(seq);
    this.updateSweep(out);
    this.updateTiles(seq, out);
    this.commitFrame(out, now, dt, false);
    if (--this.pruneCountdown <= 0) {
      this.pruneCountdown = 300;
      this.pruneInjected();
    }
  }

  private applySequelControls(seq: SequelControls): void {
    const doc = this.sequelDoc!;
    const curves: Array<[keyof SequelControls, CurveId]> = [
      ['gravity', 'gravity'], ['cohesion', 'cohesion'], ['viscosity', 'viscosity'],
      ['light', 'lightEmission'], ['exposure', 'exposure'], ['bodies', 'bodies'],
    ];
    for (const [key, id] of curves) {
      const value = seq[key];
      if (Math.abs(value - (this.seqApplied[key] ?? value)) <= 1e-4) continue;
      this.seqApplied[key] = value;
      // Una key `hold` en el instante actual: desde acá la curva vale lo que
      // dice el fader, y cualquier key futura del documento queda descartada
      // — en la 26 mandan los CC, no el timeline.
      this.writeKey(id, value);
    }
    // Monocromo: la paleta funde en 3 s al blanco y los grises; `mono` dice
    // hasta dónde. El director lee `materialColors` en cada frame.
    const k = clamp((this.sequelTime - this.monoStart) / 3) * clamp(seq.mono);
    doc.materialColors = this.seqPalette.map((from, index) => mixColor(from, SEQUEL_MONO[index], k));
  }

  /**
   * Las losetas viven encima de lo que el director ya dibuja: cuadrados de la
   * grilla que emiten (blancos) o absorben (negros) luz Y tocan el fluido —
   * el blanco lo EXPULSA y queda vacío, con el fluido apilado en sus bordes;
   * el negro lo CONGELA adentro y al apagarse lo suelta. El `lock` del solver
   * es un círculo, así que el bloque congelado es redondo bajo un cuadrado
   * negro; el borde duro lo pone la loseta.
   */
  private updateTiles(seq: SequelControls, out: FluidsShowOutput): void {
    const alive: SequelTile[] = [];
    for (const tile of this.tiles) {
      if (this.tileClock - tile.born >= tile.life) {
        const gone = this.tilePos(tile);
        this.releasing.push({ x: gone.x, y: gone.y, radius: tile.side * 0.8, frames: 6 });
        continue;
      }
      alive.push(tile);
    }
    this.tiles = alive;
    this.ensureLit();
    // El destello del relámpago (×2,5 durante 120 ms) y el pulso del kick
    // (+80 % durante 150 ms): las lámparas laten con la música. Es lo que
    // reemplaza al estrobo de líneas.
    const flash = Math.max(0, 1 - (this.tileClock - this.flashAt) / TILE_FLASH);
    const kick = Math.max(0, 1 - (this.tileClock - this.kickAt) / LAMP_KICK);
    this.lastFlash = flash;
    for (const tile of this.tiles) {
      const pos = this.tilePos(tile);
      const half = tile.side / 2;
      if (tile.lit) {
        // Emite: es una lámpara cuadrada. La emisión va por área, así que se
        // normaliza al tamaño: cada lámpara tira la luz de una de 1 m a 0,45
        // (una de 2 m a 0,6 sin normalizar dejaba la pared entera blanca,
        // ensayo t = 16 s), con techo para que una de 50 cm no sea un sol.
        // Encima, una máscara blanca: dibujo puro, para que el cuadrado quede
        // nítido aunque alumbre poco.
        const emit = Math.min(1.0, 0.4 * (TILE_GRID / tile.span) ** 2) * tile.level;
        out.geometry.push({ x: pos.x, y: pos.y, w: half, h: half, rot: 0,
          color: 0xffffff, emit: emit * (1 + 1.5 * flash) * (1 + 0.8 * kick), absorb: 0.15, shade: 1, shape: 0 });
        out.geometry.push({ x: pos.x, y: pos.y, w: half, h: half, rot: 0,
          color: 0xffffff, emit: 1, absorb: 0, shade: 1, shape: 0, top: true });
      } else {
        // Un bloque negro: absorbe (hace sombra) y tapa. Sin marco: sobre negro
        // no se ve, y se ve donde tapa fluido o luz, que es lo que Manuel
        // quiere ("los que no son emissive que no tengan el borde blanco").
        out.geometry.push({ x: pos.x, y: pos.y, w: half, h: half, rot: 0,
          color: 0x000000, emit: 0, absorb: 1.05, shade: 0.04, shape: 0 });
        out.geometry.push({ x: pos.x, y: pos.y, w: half, h: half, rot: 0,
          color: 0x000000, emit: 0, absorb: 0, shade: 1, shape: 0, top: true });
      }
      // Las dos son OBSTÁCULOS duros: el fluido choca contra los cuatro lados
      // y rebota (Manuel: "que choquen ahí y reboten"). Usa el colisionador
      // rectangular del solver, el mismo con el que rebota la línea del show
      // pero cuadrado. Lo que la loseta encuentra adentro al aparecer sale
      // expulsado por el lado más cercano; el obstáculo sigue a la loseta
      // cuando se desliza.
      // Las grandes crecen más despacio: lo que importa es la velocidad del
      // borde que empuja, no el tiempo (una de 2 m en 0,4 s mandaba 1 016
      // partículas al borde del dominio).
      const grow = Math.min(1, (this.tileClock - tile.born) / (TILE_GROW * Math.max(1, tile.span / TILE_GRID)));
      const k = grow * grow * (3 - 2 * grow);
      if (k > 0) {
        out.interactions.push({
          mode: 'collide-rect', x: pos.x, y: pos.y, vx: 0, vy: 0, radius: 0,
          strength: 1, materialId: 0, emitCount: 0, hw: half * k, hh: half * k,
        });
      }
    }
    this.releasing = this.releasing.filter((zone) => {
      out.interactions.push({ mode: 'repel', x: zone.x, y: zone.y, vx: 0, vy: 0,
        radius: zone.radius, strength: 0.8, materialId: 0, emitCount: 0 });
      zone.frames -= 1;
      return zone.frames > 0;
    });
    // El congelado global: todo el fluido detenido como una foto durante
    // `tileLife` negras y suelto de golpe al cumplirse. Era un toggle, pero el
    // botón que lo dispara en JEJE FLUID llega una vez por vuelta y dejaba el
    // fluido quieto 12 s de cada 25; como stutter de duración fija es un
    // glitch de tiempo, que es lo que se quería.
    if (this.sequelTime < this.seqFrozenUntil) {
      out.interactions.push({ mode: 'lock', x: 0.5, y: 0.5, vx: 0, vy: 0, radius: 3, strength: 1, materialId: 0, emitCount: 0 });
      this.unfreezeFrames = 4;
    } else if (this.unfreezeFrames > 0) {
      this.unfreezeFrames -= 1;
      out.interactions.push({ mode: 'unlock', x: 0.5, y: 0.5, vx: 0, vy: 0, radius: 3, strength: 1, materialId: 0, emitCount: 0 });
    }
    void seq;
  }

  /** ¿Está el fluido congelado por `freeze` ahora? */
  get frozenFluid(): boolean { return this.sequelTime < this.seqFrozenUntil; }

  /** El reloj de las losetas: el de la 26 menos lo que duró congelado. */
  private get tileClock(): number { return this.sequelTime - this.frozenTotal; }

  /** Las acciones MIDI de la 26: cada una es un evento del show o una loseta. */
  sequelAction(name: string): void {
    if (this.mode !== 'sequel' || this.suspended || !this.sequelDoc) return;
    switch (name) {
      case 'pulse': {
        // El kick: un flash corto y un empujón desde el centro de masa; la
        // pared late al tempo y el fluido tiembla con cada golpe. Cada cuarto
        // kick tira para ADENTRO en vez de empujar: tres golpes hacia afuera
        // sin nada que devuelva iban dejando la masa pegada a las paredes del
        // dominio (medido: 14 → 320 partículas en el borde en un minuto), y
        // además la respiración —tres exhalaciones, una inhalación— es el
        // compás que se ve.
        const centre = this.centroid();
        this.inject('flash', { decay: 0.12, gain: 1.8 }, 0.4);
        // Con cada kick las losetas dan su paso (Manuel: "no es tan frenético
        // al ritmo de la música"), y cada compás se sortea si las partículas
        // blancas emiten o se apagan, para que a veces alumbren sólo uno o
        // dos cubos y las azules.
        if (!this.frozenFluid) this.stepTiles(centre);
        this.kickAt = this.tileClock;
        if (this.pulseCount % 4 === 0) this.whitesOn = this.random() < 0.4;
        if (this.pulseCount % 4 === 3) {
          this.inject('attractor', { mode: 0, x: centre.x, y: centre.y, radius: 0.9, force: 2, sustain: 0, soft: 0, wander: 0 }, 0.3);
        } else {
          this.inject('burst', { x: centre.x, y: centre.y, radius: 0.3 }, 0.2);
        }
        this.pulseCount += 1;
        break;
      }
      case 'strobe':
        // El relámpago: cambia al azar qué cuatro losetas emiten y las hace
        // destellar. Reemplaza al estrobo de líneas (Manuel: "las líneas esas
        // blancas con emissive no me gusta; hacé que esos flash sean de los
        // cubos, que vaya siendo random cuáles son, siempre sólo cuatro").
        this.relight();
        this.flashAt = this.tileClock;
        break;
      // Con el fluido congelado el tiempo de las losetas también está parado:
      // el 808 no coloca ni mueve nada hasta que el stutter suelte.
      case 'step':
        // El segundo kick (nota 2, el del contratiempo): otro paso, cruzado.
        // Manuel: "hay 2 notas de kick sincopadas, tenés que usar ambas así
        // los cuadrados son más dinámicos". Con las dos, las losetas avanzan
        // en corcheas y en zigzag en vez de en negras y derecho.
        if (!this.frozenFluid) {
          this.stepTiles(this.centroid(), true);
          this.kickAt = this.tileClock;
        }
        break;
      case 'tile': if (!this.frozenFluid) this.placeTile(false); break;
      case 'tileBig': if (!this.frozenFluid) this.placeTile(true); break;
      case 'flip':
        // Otro sorteo de lámparas, sin destello.
        this.relight();
        break;
      case 'sweep':
        // El barrido ya no es una barra negra que tapa: es una banda que
        // INVIERTE la iluminación de todo lo que cruza (Manuel: "lo que es
        // blanco emissive pasa a ser negro, las partículas negras pasan a ser
        // blancas emissive, y las azules a rojo emissive"). Lo hace el paso de
        // grade del render, que ve la imagen ya compuesta; una barra negra
        // encima habría borrado justo lo que hay que dar vuelta.
        this.sweepDir = -this.sweepDir;
        this.sweepAt = this.tileClock;
        break;
      case 'crack': {
        const centre = this.centroid();
        this.crackSign = -this.crackSign;
        this.inject('fracture', { x: centre.x, y: centre.y, angle: 0.5 * this.crackSign, length: 0.9, force: 2, shards: 3, crackle: 16 }, 0.7);
        break;
      }
      case 'dark': this.inject('blackout', { attack: 0.02, release: 0.25 }, 0.3); break;
      case 'freeze':
        this.seqFrozenUntil = this.sequelTime + Math.max(0.2, this.seqControls.tileLife) * (60 / SEQUEL_BPM);
        break;
      case 'clear':
        for (const tile of this.tiles) this.releasing.push({ x: tile.x, y: tile.y, radius: tile.side * 0.8, frames: 6 });
        this.tiles = [];
        this.tileSerial = 0;
        break;
      case 'reset': this.director?.requestReset(); break;
      default: break;
    }
  }

  private placeTile(big: boolean): void {
    const seq = this.seqControls;
    const cols = SEQUEL_COLS * TILE_GRID;
    const rows = SEQUEL_ROWS * TILE_GRID;
    // El tamaño sigue la serie; el bowl ride pone una de 1 m; `grid` (CC)
    // achica todo a 50 cm.
    let span = big ? 2 : TILE_SIZES[this.tileSerial % TILE_SIZES.length];
    if (seq.grid > 0.5) span = 1;
    // La celda sale de la secuencia de van der Corput, pero las losetas son
    // máquinas y no se pisan (Manuel: "no pueden chocarse ni solaparse"):
    // si la celda está ocupada se prueba la siguiente de la secuencia, y si
    // en 32 no hay lugar, esta vez no nace ninguna.
    let col = -1;
    let row = -1;
    for (let attempt = 0; attempt < PLACE_TRIES; attempt += 1) {
      const cell = Math.floor(vanDerCorput(this.placeCursor) * cols * rows);
      this.placeCursor += 1;
      // Alineada a su propio tamaño y dentro de la pared.
      const c = Math.min(cols - span, (cell % cols) - ((cell % cols) % span));
      const r = Math.min(rows - span, Math.floor(cell / cols) - (Math.floor(cell / cols) % span));
      if (this.isFree([c, r, c + span, r + span])) { col = c; row = r; break; }
    }
    if (col < 0) return;
    // El sentido alterna con la cuenta: una viaja en x, la siguiente en y,
    // y el signo cambia cada dos.
    const sign = (this.tileSerial >> 1) % 2 === 0 ? 1 : -1;
    const alongX = this.tileSerial % 2 === 0;
    const x = (col + span / 2) / cols;
    const y = (row + span / 2) / rows;
    this.tiles.push({
      x, y, fromX: x, fromY: y, moveStart: Number.NEGATIVE_INFINITY, slide: TILE_SLIDE_PER_CELL,
      prevCol: col, prevRow: row,
      col, row, span, dx: alongX ? sign : 0, dy: alongX ? 0 : sign,
      // La mitad son pistones que buscan la masa del fluido para presionarla;
      // la otra mitad patrulla en línea recta y rebota en el borde.
      hunt: (this.tileSerial >> 1) % 2 === 0,
      side: span / rows, lit: false, level: 1, born: this.tileClock,
      // La vida crece con la cuenta hasta un techo de ×4: la loseta 24 vive el
      // doble que la primera y de la 72 en adelante todas viven lo mismo (16
      // negras con el fader en 4). Sin techo, a los cinco minutos vivían medio
      // minuto y la pared quedaba colgada de cuadrados fijos (Manuel: "al
      // final quedaron como colgados"). Lo que las mantiene cambiando es el
      // paso de `stepTiles`, no la vida.
      life: Math.max(0.2, seq.tileLife) * Math.min(TILE_LIFE_CAP, 1 + this.tileSerial / 24) * (60 / SEQUEL_BPM),
    });
    this.tileSerial += 1;
    if (this.tiles.length > 48) this.tiles.shift();
  }

  /**
   * Dónde está una loseta ahora: deslizándose de su celda anterior a la
   * destino, lineal —arranca y frena en seco, como una máquina— y a velocidad
   * constante por celda.
   */
  private tilePos(tile: SequelTile): { x: number; y: number } {
    const k = clamp((this.tileClock - tile.moveStart) / tile.slide);
    return { x: tile.fromX + (tile.x - tile.fromX) * k, y: tile.fromY + (tile.y - tile.fromY) * k };
  }

  /**
   * Con cada kick todas las losetas vivas dan un paso en su eje (Manuel: "que
   * se muevan en el espacio en x o en y de manera geométrica en base a los
   * MIDIs", y después "más mecánico industrial, que busquen presionar y mover
   * al fluido"). Los **pistones** (`hunt`) van hacia el centro de masa del
   * fluido: cuando lo pasan, vuelven, así que martillan la masa de un lado y
   * del otro. Las **patrullas** siguen derecho y rebotan en el borde. El paso
   * es de una celda para las de 50 cm y de dos (1 m) para las de 1 m, y el
   * deslizamiento dura 0,18 s por celda: velocidad constante, arranque y
   * frenada en seco. El obstáculo viaja con el dibujo, así que una loseta en
   * marcha arrastra el fluido que tiene delante.
   */
  private stepTiles(centre: { x: number; y: number }, cross = false): void {
    const cols = SEQUEL_COLS * TILE_GRID;
    const rows = SEQUEL_ROWS * TILE_GRID;
    for (const tile of this.tiles) {
      // Una máquina termina su carrera antes de arrancar la siguiente: si
      // todavía se está deslizando, este golpe no la mueve. Sin esto, un
      // redoble (dos kicks a menos de 0,18 s) la mandaba a una celda nueva
      // mientras seguía viajando desde la anterior, y ahí sí podía pisar a
      // otra (medido: un solape con seis golpes seguidos).
      if (this.tileClock - tile.moveStart < tile.slide) continue;
      const from = this.tilePos(tile);
      const here = this.occupied(tile);
      for (const [dx, dy] of this.tileMoves(tile, centre, cross)) {
        const col = tile.col + dx;
        const row = tile.row + dy;
        if (col < 0 || col + tile.span > cols || row < 0 || row + tile.span > rows) continue;
        // La caja barrida del paso: de donde está (o de donde venía, si todavía
        // se desliza) hasta donde va. Si toca a otra loseta, ni lo intenta.
        const box: [number, number, number, number] = [
          Math.min(here[0], col), Math.min(here[1], row),
          Math.max(here[2], col + tile.span), Math.max(here[3], row + tile.span),
        ];
        if (!this.isFree(box, tile)) continue;
        tile.dx = dx;
        tile.dy = dy;
        tile.prevCol = tile.col;
        tile.prevRow = tile.row;
        tile.col = col;
        tile.row = row;
        tile.fromX = from.x;
        tile.fromY = from.y;
        tile.moveStart = this.tileClock;
        tile.slide = TILE_SLIDE_PER_CELL;
        tile.x = (col + tile.span / 2) / cols;
        tile.y = (row + tile.span / 2) / rows;
        break;
      }
    }
  }

  /**
   * El barrido que invierte: una banda vertical de borde duro que cruza la
   * pared en 0,8 s, alternando el sentido. No dibuja nada: le dice al paso de
   * grade del render qué franja tiene que dar vuelta.
   */
  private updateSweep(out: FluidsShowOutput): void {
    const phase = (this.tileClock - this.sweepAt) / SWEEP_DUR;
    if (!(phase >= 0 && phase <= 1)) { this.lastInvert = 0; return; }
    // Lineal, como una máquina: velocidad constante de lado a lado.
    const travel = this.sweepDir > 0 ? phase : 1 - phase;
    this.lastInvert = 1;
    out.render.invertX = -0.08 + travel * 1.16;
    out.render.invertHalf = SWEEP_HALF;
    out.render.invertTilt = 0;
    out.render.invertAmount = 1;
  }

  /**
   * Las celdas que una loseta ocupa AHORA: su celda, y mientras se desliza
   * también la de la que viene. Es la caja barrida: si dos cajas barridas no
   * se tocan, los cuadrados no pueden solaparse en ningún instante del
   * deslizamiento (Manuel: "tienen que moverse evitando chocarse y pisarse").
   */
  private occupied(tile: SequelTile): [number, number, number, number] {
    const sliding = this.tileClock - tile.moveStart < tile.slide;
    const col0 = sliding ? Math.min(tile.col, tile.prevCol) : tile.col;
    const col1 = (sliding ? Math.max(tile.col, tile.prevCol) : tile.col) + tile.span;
    const row0 = sliding ? Math.min(tile.row, tile.prevRow) : tile.row;
    const row1 = (sliding ? Math.max(tile.row, tile.prevRow) : tile.row) + tile.span;
    return [col0, row0, col1, row1];
  }

  /** ¿Está libre esa caja de celdas? Cuenta dónde está y por dónde pasa cada loseta. */
  private isFree(box: [number, number, number, number], except?: SequelTile): boolean {
    for (const other of this.tiles) {
      if (other === except) continue;
      const [c0, r0, c1, r1] = this.occupied(other);
      if (box[0] < c1 && c0 < box[2] && box[1] < r1 && r0 < box[3]) return false;
    }
    return true;
  }

  /**
   * Adónde puede ir una loseta en este golpe, por orden de preferencia. Un
   * pistón (`hunt`) tira primero hacia el centro de masa por su eje, después
   * por el otro; una patrulla sigue derecho y si no puede dobla. La última
   * opción siempre es quedarse: ninguna se mete donde hay otra.
   */
  private tileMoves(
    tile: SequelTile,
    centre: { x: number; y: number },
    cross: boolean,
  ): Array<[number, number]> {
    const toX = Math.sign(centre.x - tile.x) || 1;
    const toY = Math.sign(centre.y - tile.y) || 1;
    // `cross` da vuelta el eje: el golpe de la negra empuja por el eje propio
    // y el del contratiempo por el perpendicular, así el recorrido es una
    // escalera en vez de una línea. Son los DOS kicks del rack (nota 0 "deep
    // dark kick" y nota 2 "Instrument Rack", que adentro tiene el Cymatics
    // Kick 69), sincopados entre sí.
    const alongX = cross ? tile.dx === 0 : tile.dx !== 0;
    if (tile.hunt) {
      return alongX
        ? [[toX, 0], [0, toY], [-toX, 0], [0, -toY]]
        : [[0, toY], [toX, 0], [0, -toY], [-toX, 0]];
    }
    // Derecho por el eje que toca; si no, dobla noventa grados; si no, se vuelve.
    const dx = tile.dx || 1;
    const dy = tile.dy || 1;
    return alongX
      ? [[dx, 0], [0, dy], [0, -dy], [-dx, 0]]
      : [[0, dy], [dx, 0], [0, -dy], [-dx, 0]];
  }

  /**
   * El atractor sostenido: mientras hay una nota del canal 3 apretada (la
   * pista "atractor" de Ableton, la misma que mueve las otras escenas), un
   * `attractor` del show tira del fluido —o lo hace girar, alternando por
   * nota— desde un punto sorteado del centro del cuadro, con la fuerza de la
   * velocidad. Al soltar, se apaga en 0,3 s. Manuel: "los fluidos no están
   * moviéndose con los atractores que usamos en las otras escenas".
   */
  private updateAttractor(seq: SequelControls): void {
    const gate = clamp(seq.attract);
    if (gate > 0.001) {
      if (!this.attractEvent) {
        const mode = this.attractCount % 2 === 0 ? 0 : 2;
        this.attractCount += 1;
        this.attractEvent = this.inject('attractor', {
          mode, x: 0.25 + 0.5 * this.random(), y: 0.3 + 0.4 * this.random(),
          radius: 0.9, force: 3, sustain: 1, soft: 0, wander: 0.12,
        }, 0.5);
      }
      // Se estira medio segundo por delante mientras dura la nota, así el
      // director nunca lo ve terminar; la fuerza sigue a la velocidad.
      this.attractEvent.dur = this.sequelTime - this.attractEvent.t + 0.5;
      this.attractEvent.params.force = 3 * gate;
    } else if (this.attractEvent) {
      this.attractEvent.dur = Math.max(0.35, this.sequelTime - this.attractEvent.t + 0.3);
      this.attractEvent = null;
    }
  }

  /** Generador determinista (mulberry32): "random" que se repite igual en cada ensayo. */
  private random(): number {
    this.rng = (this.rng + 0x6d2b79f5) | 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Sortea de nuevo cuántas y cuáles losetas chicas emiten. */
  private relight(): void {
    for (const tile of this.tiles) tile.lit = false;
    this.litTarget = LIT_CHOICES[Math.floor(this.random() * LIT_CHOICES.length)];
    this.ensureLit();
    // Cada lámpara con su intensidad: no hay dos iguales en la pared.
    for (const tile of this.tiles) if (tile.lit) tile.level = 0.6 + 0.6 * this.random();
  }

  /**
   * Mantiene la cantidad de lámparas del último sorteo, sólo entre las losetas
   * de 50 cm (las grandes nunca emiten): cuando una lámpara muere, otra chica
   * al azar toma su lugar; si hay menos chicas que lámparas pedidas, emiten
   * todas las chicas.
   */
  private ensureLit(): void {
    const small = this.tiles.filter((tile) => tile.span === 1);
    for (const tile of this.tiles) if (tile.span !== 1) tile.lit = false;
    const wanted = Math.min(this.litTarget, small.length);
    let lit = small.filter((tile) => tile.lit).length;
    while (lit > wanted) {
      const on = small.filter((tile) => tile.lit);
      on[Math.floor(this.random() * on.length)].lit = false;
      lit -= 1;
    }
    while (lit < wanted) {
      const off = small.filter((tile) => !tile.lit);
      off[Math.floor(this.random() * off.length)].lit = true;
      lit += 1;
    }
  }

  /**
   * El glow de amb 1. Mientras la compuerta está abierta (una nota sostenida
   * del canal 11) la emisión del material reservado sube despacio y su color
   * se va al azul; al soltar, decae. Ataque 2,5 s y caída 0,8 s: Manuel pidió
   * "que vaya aumentando cuando suena la nota y cuando no suena que se apague,
   * con un poco de decay". Escribe el `mix` del set-lamp de entrada, que el
   * director relee en cada frame, y pisa el color después del monocromo.
   */
  private updateGlow(seq: SequelControls, dt: number): void {
    const target = clamp(seq.amb);
    if (target > this.ambGlow) {
      // Ataque rápido: al 95 % en dos tercios de segundo.
      this.ambGlow += (target - this.ambGlow) * (1 - Math.exp(-dt / 0.22));
    } else {
      // Release lineal de un segundo hasta el mínimo.
      this.ambGlow = Math.max(target, this.ambGlow - dt / GLOW_RELEASE);
    }
    if (!this.lampEvent || this.glowMaterial < 0 || !this.sequelDoc) return;
    // Mientras sube, la emisión vibra (11 Hz) con una amplitud que se apaga al
    // llegar: es el "temblor" de encendido que pidió Manuel. El techo es el
    // de la lámpara (0,85); la ganancia extra del material parado la pone
    // `GLOW_STEADY` en el render.
    const rising = target > 0 ? clamp((target - this.ambGlow) / target) : 0;
    const vib = 1 + 0.45 * rising * Math.sin(2 * Math.PI * GLOW_VIB_HZ * this.sequelTime);
    const level = GLOW_MIX_MIN + (GLOW_MIX_MAX - GLOW_MIX_MIN) * this.ambGlow;
    this.lampEvent.params.mix = clamp(level * vib, GLOW_MIX_MIN, GLOW_MIX_MAX);
    // El color se queda azul aunque no suene: lo que sube y baja con la nota
    // es cuánto emiten, no de qué color son. Si volvieran al gris del
    // monocromo dejarían de ser "las azules" entre nota y nota.
    const colors = this.sequelDoc.materialColors;
    colors[this.glowMaterial] = mixColor(colors[this.glowMaterial], AMB_BLUE, 0.6 + 0.4 * this.ambGlow);
  }

  /** Mete un evento del show en el documento vivo, en el instante actual y en orden. */
  private inject(type: ShowEvent['type'], params: Record<string, number>, dur: number, intensity = 1): ShowEvent {
    const events = this.sequelDoc!.events;
    const event = { id: createId(`seq-${type}`), t: this.sequelTime, dur, type, intensity, params } as ShowEvent;
    let index = events.length;
    while (index > 0 && events[index - 1].t > event.t) index -= 1;
    events.splice(index, 0, event);
    return event;
  }

  /** Centro de masa del fluido, en fracciones del cuadro. */
  private centroid(): { x: number; y: number } {
    const solver = this.solver!;
    const count = solver.count;
    const positions = solver.positions;
    if (count <= 0 || positions.length < count * 2) return { x: 0.5, y: 0.5 };
    let sx = 0;
    let sy = 0;
    for (let index = 0; index < count; index += 1) {
      sx += positions[index * 2];
      sy += positions[index * 2 + 1];
    }
    return { x: clamp(sx / count / this.width), y: clamp(sy / count / this.height) };
  }

  /**
   * Los eventos inyectados que ya pasaron se borran; los que dejan estado
   * (material, lámpara, reset y la última fractura, que siembra las astillas)
   * se conservan como en el documento original.
   */
  private pruneInjected(): void {
    const doc = this.sequelDoc!;
    const keep = new Set(['set-material', 'set-lamp', 'reset-fluid', 'fracture']);
    doc.events = doc.events.filter((event) => !event.id.startsWith('seq-')
      || keep.has(event.type) || event.t + event.dur > this.sequelTime - 2);
  }

  /** Lo que comparten la secuencia y la 26 después de que el director habló. */
  private commitFrame(out: FluidsShowOutput, now: number, dt: number, frozen: boolean): void {
    this.lastInteractionCount = out.interactions.length;
    const solver = this.solver!;
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
          radius: interaction.radius * Math.min(this.width, this.height),
          hw: (interaction.hw ?? 0) * this.height, hh: (interaction.hh ?? 0) * this.height });
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
    if (this.mode === 'timeline' || this.mode === 'sequel') this.director?.requestReset();
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
      interactions: this.lastInteractionCount,
      activeGestures: this.lastStatus?.activeGestures ?? 0,
      tiles: this.tiles.length, sequelTime: this.sequelTime, frozenFluid: this.frozenFluid,
      tilesMoving: this.tiles.filter((tile) => this.tileClock - tile.moveStart < tile.slide).length,
      tilesLit: this.tiles.filter((tile) => tile.lit).length, flash: this.lastFlash, whitesOn: this.whitesOn,
      attractor: this.attractEvent ? this.attractEvent.params.mode : -1, invert: this.lastInvert,
      glowMix: this.lampEvent?.params.mix ?? 0,
      ambGlow: this.ambGlow, glowMaterial: this.glowMaterial,
      renderer: 'WebGL2 · Radiance HRC', warning: this.warning,
    };
  }

  private publishStats(): void {
    if (!this.canvas) return;
    this.canvas.dataset.fluidDirector = this.mode === 'standby' ? 'fluids-standby'
      : this.mode === 'timeline' ? 'fluids-show' : this.mode === 'sequel' ? 'fluids-sequel' : 'fluids-live';
    this.canvas.dataset.fluidsSequelTiles = String(this.tiles.length);
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
