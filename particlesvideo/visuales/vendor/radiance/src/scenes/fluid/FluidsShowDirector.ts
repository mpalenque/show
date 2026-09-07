import type { GeoInstance } from './TresMasasGeometry';
import {
  DEFAULT_MATERIAL_COLORS,
  emitMaterialAt,
  emptyDoc,
  eventParam,
  eventPhase,
  eventsAt,
  gesturesAt,
  integrateCurveId,
  lampAt,
  lampGapAt,
  lampFadeAt,
  sampleCurveId,
  sampleGesture,
  type ShowDoc,
  type ShowEvent,
} from '../../fluids-show/show-doc';

/**
 * Fluids — director del show sincronizado a `fluids.wav`.
 *
 * Una línea que gira lento en el centro (la de 1C · RELOJ DE SOL, un poco más
 * chica) y desde la que se emiten las partículas con la mecánica de 3B ·
 * PORTAL BLANCO. Lo que hace ese director no lo decide un estado interno sino
 * el documento de show: curvas, eventos y gestos evaluados en el tiempo de la
 * timeline.
 *
 * Regla de oro: todo lo que se ve tiene que derivarse del **tiempo absoluto**,
 * nunca de un acumulador frame a frame. Es lo que permite saltar a cualquier
 * punto del track y que la línea, los estrobos y las curvas caigan exactos.
 * Las dos excepciones están declaradas y acotadas: el acumulador de emisión
 * (se limpia en cada salto) y el `approach()` de la física hacia su target
 * (converge en menos de un segundo, y el fluido es estatal de todos modos).
 * Las partículas arrastran su historia y así se quieren: ver §10 del plan.
 *
 * No importa nada de TresMasasDirector: los directores no se conocen entre sí.
 */

export const FLUIDS_SHOW_MATERIALS = Object.freeze({
  /** Sólo el punto de partida: la paleta viva vive en el documento. */
  colors: DEFAULT_MATERIAL_COLORS,
  /**
   * Las cuatro iguales, a propósito. Con masas distintas el rojo se hundía y
   * el blanco flotaba, así que un mismo chorro se separaba en capas por color
   * en vez de mezclarse: el color tiene que ser una decisión de luz, no de
   * física. Lo que sí sigue moviendo la masa es `gravitySense`, parejo para
   * todos.
   */
  masses: [0.45, 0.45, 0.45, 0.45] as const,
});

/**
 * Techo de población: el solver arranca con 40 000 de capacidad. Menos que
 * antes (era 20 000) a propósito: con menos cuerpos cada uno recibe y tapa más
 * luz, y el cuadro gana luces y sombras en vez de ser una masa pareja.
 */
export const FLUIDS_SHOW_PARTICLE_CAP = 14_000;
/**
 * Techo duro, sólo para los chorros de evento. El techo blando frena la curva
 * de emisión, pero un `emit-burst` tiene que salir **siempre**: es el chorro
 * que el show necesita sí o sí, y si una curva dibujada a mano ya se comió el
 * techo —o quedó población de una pasada anterior— el chorro pasa igual. El
 * único límite real es la capacidad del solver.
 */
export const FLUIDS_SHOW_PARTICLE_HARD_CAP = 36_000;

/** Radianes por segundo con la curva `lineSpin` en 1. */
const SPIN_SCALE = 0.35;
/** Largo del blade emisor: `lineSize` 0 -> 0.06, 1 -> 0.22 (default 0.12). */
const LINE_LEN_MIN = 0.06;
const LINE_LEN_MAX = 0.22;
/**
 * Cuánto se encoge la línea con la emisión a fondo, y en cuánto se recupera.
 * El achique es instantáneo y profundo (queda a un cuarto); la vuelta es
 * larga y suave — la línea escupe y se rearma despacio.
 */
const LINE_SHRINK = 0.78;
const LINE_RECOVER_SECONDS = 1.7;
/**
 * Techo del ritmo de emisión, en partículas por segundo con `emission` en 1.
 *
 * El ritmo real no es una constante: sale de la curva del documento (ver
 * `rateForDoc`). Esto sólo evita que una curva de emisión brevísima pida un
 * caudal absurdo.
 */
const EMISSION_PPS_MAX = 12_000;

/** Tamaño del lote de emisión, como el pulso de 3B. */
const EMIT_BATCH = 6;
/**
 * Tope de lotes por frame: un dt largo no puede escupir un chorro entero. Con
 * el caudal derivado del documento los picos piden ~90 partículas por frame,
 * así que el tope tiene que dejarlas pasar — en 12 se comía la cola de los
 * golpes fuertes y el pico se sentía menos.
 */
const MAX_BATCHES_PER_FRAME = 20;
/** Salto de tiempo que se interpreta como seek y no como reproducción. */
const SEEK_THRESHOLD = 0.25;
/** Ventana en la que un `burst` empuja, contada desde el arranque del evento. */
const BURST_WINDOW = 0.09;
/** Duración mínima de un chorro, para que su caudal no se vaya a infinito. */
const MIN_BURST_DUR = 0.05;
/** Los modos de un atractor, en el orden del parámetro `mode`. */
const ATTRACTOR_MODES = ['attract', 'repel', 'vortex', 'vortex-reverse', 'drag'] as const;
/** El agarre pasea más lento que los demás: agarra y lleva, no revuelve. */
const DRAG_WANDER_HZ = 0.12;
/**
 * En cuántas astillas se parte la línea cuando la quiebra una fractura, y
 * cómo se comportan: cuánto hueco se abre entre ellas, cuánto se apartan del
 * eje, cuánto se tuercen, y cuánto late su brillo (nunca a negro: se pidió
 * que DESTELLE suave, no que se apague).
 */
const LINE_SHARD_GAP = 0.42;
/** Cuánto se desparrama cada astilla del eje, en unidades de alto. */
const LINE_SHARD_APART = 0.13;
/**
 * CADA ASTILLA APUNTA A CUALQUIER LADO: la puntería se sortea en el círculo
 * COMPLETO (360°), no en un cono alrededor del eje. Una rama quebrada tiene
 * pedazos mirando para cualquier parte, y con ±66° todavía se leía como una
 * línea con juntas. El blade es simétrico, así que el círculo entero rinde.
 */
const LINE_SHARD_AIM = Math.PI * 2;
/**
 * Y TUMBAN: después de cada crujido cada astilla sigue girando sola —hasta
 * este ritmo en radianes por segundo— y se va frenando, como un pedazo de
 * rama que quedó dando vueltas. `age/(1 + 1.6·age)` da el giro acumulado:
 * arranca al ritmo pleno y se asienta sin pararse en seco.
 */
const LINE_SHARD_SPIN = 3.4;
/**
 * LA VIBRACIÓN: un temblor de posición cuantizado (saltos discretos, no un
 * seno — glitch, no flotación) que va SOLO CON EL RUIDO: explota con cada
 * crujido (`kick`, pesado por la fuerza del golpe) y con el sonido (`live`),
 * y en el silencio es CERO — la nota grave constante no mueve nada. Se pidió
 * explícito: los palitos no pueden estar vibrando cuando no suena nada más
 * que el fondo. En unidades de alto.
 */
const LINE_SHARD_VIB_HZ = 47;
const LINE_SHARD_VIB_KICK = 0.032;
/**
 * EL TWITCH: en cada paso del crujido (`crackle` por segundo), hasta esta
 * fracción de las astillas suelta su puntería y mira a CUALQUIER otro lado
 * por un paso, con un destello encima (`FLASH`) y el largo tartamudeado.
 * TAMBIÉN va con el ruido: la fracción se escala por `kick`, así que en el
 * golpe pleno twitchea el 28 % y en el silencio ninguna.
 */
const LINE_SHARD_SNAP = 0.28;
const LINE_SHARD_FLASH = 1.45;
/**
 * Cada una arde distinto: su nivel propio va de 0.2 a 1.6 del brillo de la
 * línea, y el conjunto se normaliza para que el promedio siga siendo 1 — así
 * las intensidades se separan sin que el cuadro (donde la línea es la única
 * luz) se apague ni se queme.
 */
const LINE_SHARD_LEVEL_MIN = 0.2;
const LINE_SHARD_LEVEL_MAX = 1.6;
/**
 * Cuánto late cada astilla por encima de su nivel. La brasa (`EMBER`) es el
 * único latido del silencio —apenas—; el resto entra con el crujido y con el
 * sonido.
 */
const LINE_SHARD_FLICKER_EMBER = 0.08;
const LINE_SHARD_FLICKER = 0.55;
/** Pero nunca a negro: el piso de cada astilla es este pedazo de su brillo. */
const LINE_SHARD_GLOW_FLOOR = 0.1;
/**
 * Una vez que se quebró, QUEDA QUEBRADA: entre golpe y golpe la línea no se
 * rearma, se queda astillada en reposo hasta que se apaga. El golpe sólo
 * abre más y vuelve a apuntar cada pedazo a otro lado.
 */
const LINE_SHARD_REST = 0.5;
/** Sin fractura viva, el destello late a esto; con una, a su `crackle`. */
const LINE_FLICKER_HZ = 7;
/** El radio de la cuña dura de una fractura, en unidades del lado corto. */
const FRACTURE_WEDGE_RADIUS = 0.035;
/** Cuánto se apartan del corte los dos empujones que lo abren. */
const FRACTURE_OPEN = 0.055;
const FRACTURE_OPEN_RADIUS = 0.085;
/** Ruido determinista 0..1 para el temblor de la grieta: el mismo paso, el
 * mismo lugar, así el scrub cae siempre igual. */
const fractureNoise = (value: number): number => {
  const x = Math.sin(value * 91.7 + 13.1) * 47453.13;
  return x - Math.floor(x);
};
const WANDER_HZ = 0.24;
/** Debajo de esto, `bodies` es cero: lo que no recibe luz no se ve. */
const BODY_VISIBLE_MIN = 0.02;
/** Ambiente que muestra un cuerpo con `bodies` en 1: su pigmento, legible. */
const BODY_AMBIENT_FULL = 0.12;

/** Física suelta: el fluido corre y se dispersa (extremos de `float`/`mix`). */
const COHESION_LOOSE = Object.freeze({
  sameRestDensity: 3.2, differentRestDensity: 5.5, nearStiffness: 0.08, stiffness: 0.2,
});
/** Física atascada: se cierra en blobs orgánicos (extremos de `cluster`). */
const COHESION_JAMMED = Object.freeze({
  sameRestDensity: 11.2, differentRestDensity: 1.3, nearStiffness: 1.45, stiffness: 0.3,
});
/**
 * NO hay una "física pegajosa" para el cierre, y se probó a fondo.
 *
 * Subiendo `sameRestDensity` a 14 y bajando `differentRestDensity` a 0.2 las
 * blancas efectivamente se buscan entre ellas —medido, las que quedan fuera
 * del grupo pasan de 519 a 79— pero el precio es que la masa NO SE ASIENTA:
 * el brillo mediano salta de 0.62 a 1.36 y quedan encendidas con estela todo
 * el cierre. Bajar `nearStiffness` las pega todavía más (1.5 px entre
 * vecinas) y es peor: 2.21.
 *
 * Los grumos sueltos NO se arreglan acá. Se arreglan en la JUNTADA de 1:52,
 * ensanchándole el radio a cuadro entero (`GATHER_RADIUS`): con los eventos
 * reales replayados contra el solver, las blancas fuera del grupo pasan de
 * 994 a 37 y el cierre se queda en su brillo de piso. El cierre tiene que
 * llegar con el trabajo hecho, no hacerlo.
 */

export interface FluidsShowContext {
  /** Tiempo de timeline en segundos: el reloj del audio. */
  time: number;
  dt: number;
  playing: boolean;
  /** Ancho / alto de la salida, para convertir fracciones entre ejes. */
  aspect: number;
  particleCount: number;
}

export interface FluidsShowInteraction {
  mode: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  strength: number;
  materialId: number;
  emitCount: number;
}

export interface FluidsShowPhysics {
  sameRestDensity: number;
  differentRestDensity: number;
  stiffness: number;
  nearStiffness: number;
  gravity: number;
  drag: number;
  /**
   * El freno de verdad: cuánta velocidad pierde el fluido en cada subpaso del
   * solver. `drag` nunca llegó al motor —el worker lo recibía y no lo
   * usaba—, así que lo único que frenaba era la relajación de presión. Este
   * sí se aplica, y por eso se enciende sólo donde el guion pide quietud.
   */
  brake: number;
}

/** Cómo está quebrada la línea ahora: cuánto, con qué semilla y a qué ritmo. */
interface LineShatter {
  /**
   * 0 = entera · 0.5 = quebrada en reposo · 1 = rota de par en par. Sale de
   * la curva `lineBreak` —editable a mano, SEPARADA de la emisión, que fue
   * lo pedido— que la siembra dibuja desde los crujidos del track.
   */
  amount: number;
  /**
   * Sólo la violencia: lo que la curva asoma por encima del reposo (0.5),
   * reescalado a 0..1. Es lo que hace vibrar, twitchear y destellar.
   */
  kick: number;
  /** Segundos desde el último crujido: el reloj del tumbo. */
  age: number;
  /**
   * Semilla del último crujido: SU TIEMPO, no su posición en el array. Un
   * verificador lo refutó con el editor real: arrastrar un evento no reordena
   * `doc.events` pero recargar sí (`parseShowDoc` ordena), así que una
   * semilla por posición hacía que el mismo doc se viera distinto en vivo y
   * tras guardar. El tiempo del evento es contenido, no orden.
   */
  seed: number;
  /** Cuántas astillas pidió esa fractura. */
  shards: number;
  /** Sus crujidos por segundo: el ritmo del destello. */
  crackle: number;
}

export interface FluidsShowStatus {
  /** Ángulo de la línea en radianes, derivado del tiempo absoluto. */
  angle: number;
  lineLen: number;
  /** Partículas por segundo pedidas por la curva de emisión. */
  pps: number;
  emitted: number;
  /** La población tocó el techo y la emisión está frenada. */
  capped: boolean;
  emitMaterial: number;
  activeEvents: number;
  activeGestures: number;
  /**
   * Multiplicador de masa que pide `gravitySense`. La escena lo aplica con
   * `setMaterialMass` — el director no habla con el solver.
   */
  materialMassScale: number;
}

export interface FluidsShowOutput {
  physics: FluidsShowPhysics;
  render: Record<string, number>;
  interactions: FluidsShowInteraction[];
  geometry: GeoInstance[];
  resetParticles: number[] | null;
  /** Un `reset-fluid` cruzado pide además vaciar el campo de radiancia. */
  resetRadiance: boolean;
  status: FluidsShowStatus;
}

const clamp = (value: number, min = 0, max = 1): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

const ease = (x: number): number => {
  const v = clamp(x);
  return v * v * (3 - 2 * v);
};

const approach = (from: number, to: number, speed: number, dt: number): number => (
  from + (to - from) * (1 - Math.exp(-speed * clamp(dt, 0.001, 0.1)))
);

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));

/** HSV -> 0xRRGGBB. Con V = 1 y S = 0 sale blanco puro, que es el default. */
export const hsvToHex = (hue: number, saturation: number, value = 1): number => {
  const h = ((hue % 1) + 1) % 1;
  const s = clamp(saturation);
  const v = clamp(value, 0, 1);
  const sector = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = sector === 0 ? [v, t, p]
    : sector === 1 ? [q, v, p]
    : sector === 2 ? [p, v, t]
    : sector === 3 ? [p, q, v]
    : sector === 4 ? [t, p, v]
    : [v, p, q];
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
};

interface LinePose {
  x: number;
  y: number;
  angle: number;
  len: number;
  beamSign: number;
  /** Brillo del blade, 0 = la línea desaparece. */
  glow: number;
}

interface EventEffects {
  /** Multiplicador de exposición: flashes y apagones se componen acá. */
  exposureScale: number;
  /** Pico aditivo de exposición, el "castigo" de los estrobos. */
  exposureKick: number;
  blackOutput: boolean;
  /** Partículas nacidas de un `emit-burst` en este frame. */
  emitted: number;
}

/** Lo que los eventos `emit-burst` se reservan del techo de población. */
export const reservedByBursts = (doc: ShowDoc): number => {
  let total = 0;
  for (const event of doc.events) {
    if (event.type !== 'emit-burst') continue;
    total += Math.max(0, eventParam(event, 'count'));
  }
  return Math.min(FLUIDS_SHOW_PARTICLE_CAP, total);
};

/**
 * Cuántas partículas por segundo vale un `emission` de 1, para este documento.
 *
 * No es una constante y ésa es la idea: se calcula de modo que la curva de
 * emisión entera, integrada, escupa el techo de población menos lo que se
 * reservan los chorros. Así, dibuje el operador el chorro que dibuje y donde lo
 * dibuje, todas las partículas del show salen dentro de lo que él marcó — y
 * cuando la curva se apaga ya no queda nada por emitir, en vez de seguir
 * goteando hasta el final del track.
 *
 * La reserva es lo que hace que un `emit-burst` salga siempre: si la curva se
 * quedara con el techo entero, el chorro que el show necesita sí o sí llegaría
 * tarde y no nacería ni una partícula.
 *
 * Se integra el **cuadrado** de la curva porque el ritmo es cuadrático en la
 * emisión. No rompe la regla de oro: es una constante derivada del documento,
 * no un acumulado de frames.
 */
export const rateForDoc = (doc: ShowDoc): number => {
  const span = Math.max(1, doc.duration);
  const step = 1 / 60;
  let area = 0;
  for (let t = 0; t < span; t += step) {
    const value = clamp(sampleCurveId(doc, 'emission', t));
    area += value * value * step;
  }
  if (area <= 1e-4) return 0;
  const budget = Math.max(0, FLUIDS_SHOW_PARTICLE_CAP - reservedByBursts(doc));
  return Math.min(EMISSION_PPS_MAX, budget / area);
};

export class FluidsShowDirector {
  private doc: ShowDoc = emptyDoc();
  /** Fracción de lote pendiente; se limpia en cada seek. */
  private emitAcc = 0;
  private emitSerial = 0;
  /** Partículas por segundo con `emission` en 1, derivado del documento. */
  private emissionRate = rateForDoc(emptyDoc());
  private lastTime = 0;
  private pendingReset: number[] | null = null;
  private pendingRadianceReset = false;
  private epoch = 1;
  /** Ids de `reset-fluid` ya disparados; un reset es una acción, no un estado. */
  private firedResets = new Set<string>();
  /** Fracción de lote pendiente de cada `emit-burst`; se limpia en cada seek. */
  private burstAcc = new Map<string, number>();
  private readonly physics: FluidsShowPhysics = {
    sameRestDensity: 5,
    differentRestDensity: 5,
    stiffness: 0.2,
    nearStiffness: 0.08,
    gravity: 0,
    drag: 0.01,
    brake: 0,
  };

  setDoc(doc: ShowDoc): void {
    this.doc = doc;
    this.emissionRate = rateForDoc(doc);
  }

  get document(): ShowDoc {
    return this.doc;
  }

  /**
   * Salto de timeline: soltar el acumulador de emisión y volver a habilitar
   * los resets que quedaron atrás, para que ensayar un tramo dos veces los
   * vuelva a disparar.
   */
  seek(time: number): void {
    this.emitAcc = 0;
    this.burstAcc.clear();
    this.lastTime = time;
    this.firedResets.clear();
  }

  /** Punto de sincronización duro: vacía el campo en el próximo frame. */
  requestReset(): void {
    this.pendingReset = [0, 0, 0, 0];
    this.pendingRadianceReset = true;
    this.epoch += 1;
    this.emitAcc = 0;
    this.burstAcc.clear();
  }

  update(context: FluidsShowContext): FluidsShowOutput {
    const dt = clamp(context.dt, 0.001, 0.1);
    const aspect = Math.max(0.4, Number.isFinite(context.aspect) ? context.aspect : 8 / 3);
    const time = Math.max(0, Number.isFinite(context.time) ? context.time : 0);
    const particleCount = Math.max(0, Math.round(context.particleCount));
    // Un salto grande de tiempo es un seek aunque nadie lo haya anunciado:
    // arrastrar el playhead no pasa por seek().
    if (Math.abs(time - this.lastTime) > SEEK_THRESHOLD) {
      this.emitAcc = 0;
      this.burstAcc.clear();
      this.firedResets.clear();
    }
    this.lastTime = time;

    const interactions: FluidsShowInteraction[] = [];
    const geometry: GeoInstance[] = [];
    const events = eventsAt(this.doc, time);
    const emitMaterial = emitMaterialAt(this.doc, time);
    const viscosity = clamp(sampleCurveId(this.doc, 'viscosity', time));

    const shatter = this.lineShatterAt(time);
    const line = this.lineAt(time, shatter);
    this.pushLine(line, geometry, aspect, time, shatter);
    this.pushLineCollision(line, aspect, interactions);
    const emission = this.updateEmission(
      line, time, dt, context.playing, particleCount, aspect, emitMaterial, viscosity, interactions,
    );
    const effects = this.applyEvents(
      events, time, dt, context.playing, particleCount + emission.emitted,
      line, aspect, emitMaterial, viscosity, geometry, interactions,
    );
    const activeGestures = this.applyGestures(time, dt, aspect, viscosity, interactions);

    const target = this.physicsTargetFor(time, viscosity);
    const keys = Object.keys(this.physics) as Array<keyof FluidsShowPhysics>;
    for (const key of keys) {
      this.physics[key] = approach(this.physics[key], target[key], 2.6, dt);
    }

    const render = this.renderAt(time, emitMaterial, effects);
    const resetParticles = this.pendingReset;
    const resetRadiance = this.pendingRadianceReset;
    this.pendingReset = null;
    this.pendingRadianceReset = false;

    return {
      physics: { ...this.physics },
      render,
      interactions,
      geometry,
      resetParticles,
      resetRadiance,
      status: {
        angle: line.angle,
        lineLen: line.len,
        pps: emission.pps,
        emitted: emission.emitted + effects.emitted,
        capped: emission.capped,
        emitMaterial,
        activeEvents: events.length,
        activeGestures,
        materialMassScale: this.massScaleAt(time),
      },
    };
  }

  // -------------------------------------------------------------- la línea

  /**
   * Pose de la línea en `time`, cerrada en forma analítica: el ángulo es la
   * integral de `lineSpin` desde 0, no un acumulado.
   */
  private lineAt(time: number, shatter: LineShatter): LinePose {
    const spin = integrateCurveId(this.doc, 'lineSpin', time) * SPIN_SCALE;
    // La línea acusa cada emisión: se encoge rápido con el chorro y vuelve a
    // su largo suavemente mientras la emisión se apaga. PERO una vez que se
    // quebró, deja de respirar: en ese tramo lo que se ve tiene que ser el
    // quiebre —astillas apuntando a distintos lados, cada una con su brillo—
    // y no una línea entera achicándose y agrandándose con cada chorro. Las
    // dos cosas juntas se leían como un acordeón. El factor va por DOS: el
    // piso del quiebre es 0.5, así que desde la primera fractura el achique
    // queda en cero clavado, no a la mitad.
    const len = mix(LINE_LEN_MIN, LINE_LEN_MAX, clamp(sampleCurveId(this.doc, 'lineSize', time)))
      * (1 - LINE_SHRINK * this.emissionShrink(time) * (1 - clamp(shatter.amount * 2)));
    return {
      x: clamp(sampleCurveId(this.doc, 'lineX', time)),
      y: clamp(sampleCurveId(this.doc, 'lineY', time)),
      angle: spin,
      len,
      beamSign: 1,
      // El brillo del blade es independiente de la emisión de partículas: la
      // línea se puede apagar y seguir escupiendo, o quedar encendida y muda.
      // En el show se apagan juntas, pero son dos controles.
      glow: clamp(sampleCurveId(this.doc, 'lineEmit', time)),
    };
  }

  /**
   * Cuánto está encogida la línea en `time` por la emisión reciente, 0..1.
   *
   * Derivado del tiempo absoluto, como todo: el encogido es el máximo de la
   * curva de emisión del último segundo, pesado por una recuperación
   * cuadrática — cae de golpe con el chorro y vuelve suave, rápido primero y
   * asentándose al final. Nada que acumular, nada que se rompa al saltar.
   */
  private emissionShrink(time: number): number {
    let shrink = 0;
    for (let tau = 0; tau <= LINE_RECOVER_SECONDS; tau += 0.09) {
      const weight = 1 - tau / LINE_RECOVER_SECONDS;
      const emission = clamp(sampleCurveId(this.doc, 'emission', time - tau));
      shrink = Math.max(shrink, emission * weight * weight);
    }
    return clamp(shrink);
  }

  /**
   * La línea también es materia: una fila de círculos de colisión a lo largo
   * del blade, para que el fluido rebote en ella en vez de atravesarla como si
   * no estuviera. Sólo mientras la línea se ve — apagada deja de ser un
   * objeto en la escena, aunque siga emitiendo.
   */
  private pushLineCollision(
    line: LinePose,
    aspect: number,
    interactions: FluidsShowInteraction[],
  ): void {
    if (line.len <= 0.003 || line.glow <= 0.02) return;
    const halfLen = (line.len * aspect) / 2;
    const radius = 0.014;
    const count = Math.min(13, Math.max(3, Math.round(halfLen / radius)));
    const tangent = { x: Math.cos(line.angle), y: Math.sin(line.angle) };
    for (let index = 0; index < count; index += 1) {
      const along = (index / (count - 1) - 0.5) * 2 * halfLen * 0.92;
      interactions.push({
        mode: 'collide',
        x: line.x + (tangent.x * along) / aspect,
        y: line.y + tangent.y * along,
        vx: 0, vy: 0,
        radius, strength: 1, materialId: 0, emitCount: 0,
      });
    }
  }

  /**
   * Blade emisivo + oclusor de respaldo, el mismo par que usa el faro de Tres
   * Masas: el respaldo bloquea el medio plano opuesto, y eso es lo que vuelve
   * unilateral la emisión dentro del transporte de radiancia real.
   */
  /**
   * Cuánto está quebrada la línea ahora mismo, y desde cuándo.
   *
   * Sale de los eventos `fracture` que estén vivos: la rama se raja de golpe
   * y después se va cerrando. Se calcula antes de dibujarla porque el quiebre
   * ES la línea, no algo que se le pinte encima.
   */
  private lineShatterAt(time: number): LineShatter {
    // CUÁNTO manda la CURVA `lineBreak`, no los eventos: es la perilla que se
    // pidió poder editar a mano, separada de la emisión. La siembra la dibuja
    // desde los crujidos del track (piso 0.5 desde el primero, un pico por
    // golpe), y de ahí en adelante lo que diga la curva ES el quiebre: en 0
    // la línea está entera aunque haya fracturas sonando, en 1 está rota de
    // par en par.
    const amount = clamp(sampleCurveId(this.doc, 'lineBreak', time));
    // La violencia es lo que asoma por encima del reposo: con la curva en
    // 0.5 la rama está quebrada y QUIETA, y todo lo que suba de ahí vibra,
    // twitchea y destella en proporción.
    const kick = clamp((amount - LINE_SHARD_REST) / (1 - LINE_SHARD_REST));
    // Los eventos `fracture` siguen poniendo el RITMO: la semilla del último
    // crujido (su TIEMPO, no su posición en el array — así el orden del
    // array no cambia nada), el reloj del tumbo, y las astillas y el
    // `crackle` de ese quiebre.
    let last = Number.NEGATIVE_INFINITY;
    let seed = 0;
    let shards = 3;
    let crackle = LINE_FLICKER_HZ;
    for (const event of this.doc.events) {
      if (event.type !== 'fracture') continue;
      if (event.t > time) continue;
      if (event.t >= last) {
        last = event.t;
        seed = event.t;
        shards = Math.round(clamp(eventParam(event, 'shards'), 1, 6));
        crackle = Math.max(2, eventParam(event, 'crackle'));
      }
    }
    return {
      amount,
      kick,
      age: Number.isFinite(last) ? Math.max(0, time - last) : 0,
      seed,
      shards,
      crackle,
    };
  }

  private pushLine(
    line: LinePose,
    geometry: GeoInstance[],
    aspect: number,
    time: number,
    shatter: LineShatter,
  ): void {
    if (line.len <= 0.003 || line.glow <= 0.02) return;
    // len es fracción de ancho; los semiejes viven en unidades de alto.
    const halfLen = (line.len * aspect) / 2;
    const normal = { x: -Math.sin(line.angle), y: Math.cos(line.angle) };
    const tangent = { x: Math.cos(line.angle), y: Math.sin(line.angle) };
    const offset = 0.008 * line.beamSign;
    /** Un pedazo de línea con su oclusor de respaldo detrás. */
    const blade = (
      x: number, y: number, half: number, rot: number, glow: number,
    ): void => {
      geometry.push({
        x, y, w: half, h: 0.0035,
        rot, color: 0xffffff,
        emit: 1.15 * glow, absorb: 0.25,
        shade: 1.1 * glow, shape: 0, wideFeather: true,
      });
      geometry.push({
        x: x - (normal.x * offset) / aspect,
        y: y - normal.y * offset,
        w: half * 1.04, h: 0.005,
        rot, color: 0x000000,
        emit: 0, absorb: 1.0,
        shade: 0.05 * glow, shape: 0, wideFeather: true,
      });
    };
    if (shatter.amount <= 0.01) {
      blade(line.x, line.y, halfLen, line.angle, line.glow);
      return;
    }
    // QUEBRADA, Y ASÍ SE QUEDA. La línea deja de ser un rectángulo: se parte
    // en astillas que se acortan (así se abren los huecos) y se desparraman
    // del eje, y lo que las mueve es la rama quebrándose:
    //
    // - CADA UNA APUNTA A CUALQUIER LADO (360°), resorteado en CADA crujido
    //   real del track (los eventos de fuerza cero que siembra el análisis).
    // - TUMBAN: después de cada crujido siguen girando solas y se frenan.
    // - VIBRAN a saltos cuantizados —glitch, no flotación— SOLO con el
    //   ruido (`kick`: la curva por encima del reposo), y en el silencio
    //   quietas (la nota grave constante no es ruido).
    // - TWITCHEAN con el ruido: en cada paso del `crackle`, un puñado
    //   (escalado por `kick`) suelta la puntería, mira a cualquier otro lado
    //   un paso, destella (`FLASH`) y tartamudea el largo.
    // - Y CADA UNA ARDE DISTINTO, con el promedio normalizado en 1.
    //
    // Todo sale del tiempo absoluto y de un ruido determinista por astilla,
    // así que el scrub cae siempre igual. Hay lugar de sobra: la geometría
    // admite 160 instancias y el show entero nunca pasó de 6.
    const shards = Math.min(8, Math.max(4, shatter.shards + 2));
    const flickerStep = Math.floor(time * shatter.crackle);
    const vibStep = Math.floor(time * LINE_SHARD_VIB_HZ);
    // La rotura es binaria una vez que pasó: `grip` sólo rampa el primer
    // chasquido (amount 0 -> piso en 42 ms) y después queda clavado en 1.
    const grip = clamp(shatter.amount / LINE_SHARD_REST);
    // Los niveles primero, para poder normalizarlos: la línea es la única luz
    // del cuadro en este tramo, así que las intensidades se separan pero el
    // promedio se mantiene en 1.
    const levels: number[] = [];
    let sum = 0;
    for (let index = 0; index < shards; index += 1) {
      const level = LINE_SHARD_LEVEL_MIN + fractureNoise(index * 23.9 + shatter.seed * 11.7)
        * (LINE_SHARD_LEVEL_MAX - LINE_SHARD_LEVEL_MIN);
      levels.push(level);
      sum += level;
    }
    const norm = shards / Math.max(1e-6, sum);
    const flicker = (LINE_SHARD_FLICKER_EMBER + LINE_SHARD_FLICKER * shatter.kick)
      * shatter.amount;
    // El tumbo comparte reloj: giro acumulado desde el último crujido. Entre
    // golpe y golpe no es vibración: es la pieza asentándose, cada vez más
    // despacio.
    const tumble = (shatter.age / (1 + 1.6 * shatter.age)) * grip;
    const vib = LINE_SHARD_VIB_KICK * shatter.kick * grip;
    for (let index = 0; index < shards; index += 1) {
      const from = -1 + (2 * index) / shards;
      const to = -1 + (2 * (index + 1)) / shards;
      const middle = (from + to) / 2;
      const snapped = fractureNoise(index * 3.3 + flickerStep * 1.7)
        < LINE_SHARD_SNAP * shatter.kick;
      // Cada astilla se acorta: lo que pierde es el hueco de la rajadura. Y
      // ninguna mide lo mismo que otra — más el tartamudeo del twitch.
      let half = ((to - from) / 2) * halfLen * (1 - LINE_SHARD_GAP * shatter.amount)
        * (0.7 + 0.6 * fractureNoise(index * 29.3 + shatter.seed * 6.1));
      if (snapped) half *= 0.65 + 0.7 * fractureNoise(index * 11.3 + flickerStep * 5.9);
      if (half <= 0.0005) continue;
      // La PUNTERÍA: cualquier lado del círculo, resorteada por crujido; el
      // tumbo la sigue girando; y el twitch la suelta un paso entero.
      let aim = LINE_SHARD_AIM * (fractureNoise(index * 13.7 + shatter.seed * 5.3) - 0.5)
        * grip;
      aim += (fractureNoise(index * 7.9 + shatter.seed * 3.1) - 0.5) * 2
        * LINE_SHARD_SPIN * tumble;
      if (snapped) {
        // El +17.9 desacopla este canal del ruido del destello: sin él, la
        // astilla 2 en el paso 5 (y toda la familia paso = 2.5·astilla)
        // sorteaba puntería y brillo con EL MISMO número.
        aim = LINE_SHARD_AIM
          * (fractureNoise(index * 9.1 + flickerStep * 2.9 + 17.9) - 0.5) * grip;
      }
      // Se desparrama del eje, más las de las puntas que las del medio, y el
      // crujido las escupe un poco más lejos. El reparto a lo largo tampoco
      // es parejo: los huecos quedan desiguales, como se astilla una rama.
      const wobble = (fractureNoise(index * 17.3 + shatter.seed * 4.1) - 0.5) * 2;
      const apart = wobble * LINE_SHARD_APART * grip * (0.35 + Math.abs(middle))
        + (fractureNoise(index * 19.1 + shatter.seed * 8.3) - 0.5) * 2 * 0.05 * shatter.kick;
      const along = (middle + (fractureNoise(index * 5.9 + shatter.seed * 7.7) - 0.5)
        * (0.6 / shards)) * halfLen;
      // La vibración: saltos discretos por astilla, nunca el mismo salto.
      const vibX = (fractureNoise(index * 41.3 + vibStep * 13.7) - 0.5) * 2 * vib;
      const vibY = (fractureNoise(index * 37.1 + vibStep * 17.9 + 7.3) - 0.5) * 2 * vib;
      let glow = line.glow * levels[index] * norm
        * (1 - flicker * fractureNoise(index * 7.1 + flickerStep * 3.7));
      if (snapped) glow *= LINE_SHARD_FLASH;
      glow = Math.max(LINE_SHARD_GLOW_FLOOR * line.glow, glow);
      blade(
        line.x + (tangent.x * along + normal.x * apart + vibX) / aspect,
        line.y + tangent.y * along + normal.y * apart + vibY,
        half,
        line.angle + aim,
        glow,
      );
    }
  }

  // --------------------------------------------------------------- emisión

  /**
   * Emisión desde el blade, con el patrón de 3B: lotes en un punto
   * pseudoaleatorio pero determinista de la línea, desplazados al costado del
   * haz, más un empujón por la normal para que los recién nacidos salgan
   * disparados por el lado iluminado.
   *
   * El acumulador sólo corre con el transporte en play: con el audio pausado
   * el cuadro se congela en vez de irse llenando solo.
   */
  private updateEmission(
    line: LinePose,
    time: number,
    dt: number,
    playing: boolean,
    particleCount: number,
    aspect: number,
    material: number,
    viscosity: number,
    interactions: FluidsShowInteraction[],
  ): { pps: number; emitted: number; capped: boolean } {
    const emission = clamp(sampleCurveId(this.doc, 'emission', time));
    // Cuadrático: fino abajo, denso arriba.
    const pps = emission * emission * this.emissionRate;
    const capped = particleCount >= FLUIDS_SHOW_PARTICLE_CAP;
    if (!playing || pps <= 0) return { pps, emitted: 0, capped };
    if (capped) {
      this.emitAcc = 0;
      return { pps, emitted: 0, capped };
    }
    this.emitAcc += pps * dt;
    const batches = Math.min(
      Math.floor(this.emitAcc / EMIT_BATCH),
      MAX_BATCHES_PER_FRAME,
    );
    this.emitAcc -= batches * EMIT_BATCH;
    // Si el frame se comió el tope, no vale la pena guardar el resto.
    if (batches >= MAX_BATCHES_PER_FRAME) this.emitAcc = 0;
    const emitted = this.pushEmitBatches(
      batches, time, line, aspect, material, viscosity, interactions,
    );
    return { pps, emitted, capped };
  }

  /**
   * La boca de la línea: `batches` lotes de a seis nacidos a lo largo del
   * blade, cada uno con su empujón por la normal para que salgan disparados
   * por el lado iluminado. La comparten la curva de emisión y los chorros de
   * evento — nacen todos del mismo lugar y de la misma forma.
   */
  private pushEmitBatches(
    batches: number,
    time: number,
    line: LinePose,
    aspect: number,
    material: number,
    viscosity: number,
    interactions: FluidsShowInteraction[],
  ): number {
    if (batches <= 0) return 0;
    const tangent = { x: Math.cos(line.angle), y: Math.sin(line.angle) };
    const normal = { x: -Math.sin(line.angle), y: Math.cos(line.angle) };
    const halfLen = (line.len * aspect) / 2;
    // Lo viscoso también se siente en el nacimiento: salen más despacio.
    const beamPush = 0.005 * line.beamSign * (1 - 0.45 * viscosity);
    let emitted = 0;
    for (let batch = 0; batch < batches; batch += 1) {
      this.emitSerial += 1;
      const seed = Math.floor(time * 37) + this.emitSerial;
      const along = (hash(seed * 1.71) - 0.5) * 2 * halfLen * 0.85;
      const side = 0.03 * line.beamSign;
      const x = line.x + (tangent.x * along + normal.x * side) / aspect;
      const y = line.y + tangent.y * along + normal.y * side;
      interactions.push({
        mode: 'emit',
        x, y, vx: 0, vy: 0,
        radius: 0.02, strength: 0.5, materialId: material, emitCount: EMIT_BATCH,
      });
      interactions.push({
        mode: 'drag',
        x, y,
        vx: normal.x * beamPush,
        vy: normal.y * beamPush,
        radius: 0.05, strength: 1, materialId: material, emitCount: 0,
      });
      emitted += EMIT_BATCH;
    }
    return emitted;
  }

  // --------------------------------------------------------------- eventos

  private applyEvents(
    events: ShowEvent[],
    time: number,
    dt: number,
    playing: boolean,
    particleCount: number,
    line: LinePose,
    aspect: number,
    emitMaterial: number,
    viscosity: number,
    geometry: GeoInstance[],
    interactions: FluidsShowInteraction[],
  ): EventEffects {
    const effects: EventEffects = {
      exposureScale: 1, exposureKick: 0, blackOutput: false, emitted: 0,
    };
    for (const event of events) {
      const intensity = clamp(event.intensity);
      switch (event.type) {
        case 'flash': {
          // Golpe instantáneo que decae; la fase sale del tiempo absoluto.
          const local = Math.max(0, time - event.t);
          const decay = Math.max(0.01, eventParam(event, 'decay'));
          const gain = eventParam(event, 'gain');
          effects.exposureScale *= 1 + (gain - 1) * intensity * Math.exp(-local / decay);
          break;
        }
        case 'blackout': {
          effects.exposureScale *= 1 - intensity * this.blackoutAmount(event, time);
          if (intensity >= 1 && this.blackoutAmount(event, time) >= 1) effects.blackOutput = true;
          break;
        }
        case 'strobe-lines':
          effects.exposureKick += this.pushStrobes(event, time, line, aspect, geometry);
          break;
        case 'shadow-bar':
          this.pushShadowBar(event, time, aspect, geometry);
          break;
        case 'burst': {
          if (time - event.t > BURST_WINDOW) break;
          interactions.push({
            mode: 'repel',
            x: eventParam(event, 'x'),
            y: eventParam(event, 'y'),
            vx: 0, vy: 0,
            radius: eventParam(event, 'radius'),
            strength: 0.4 + intensity * 0.9,
            materialId: emitMaterial,
            emitCount: 0,
          });
          break;
        }
        case 'emit-burst': {
          // Un chorro que no pasa por la curva de emisión: nace de la línea
          // igual, pero su caudal lo fija el evento. Es lo que garantiza que
          // el blanco de 0:50 salga aunque la curva se haya redibujado a mano.
          // Contra el techo duro, no el blando: si la curva ya gastó el techo,
          // el chorro pasa igual — sin él el show se queda sin su luz.
          if (!playing || particleCount >= FLUIDS_SHOW_PARTICLE_HARD_CAP) break;
          const count = Math.max(0, eventParam(event, 'count')) * intensity;
          const dur = Math.max(MIN_BURST_DUR, event.dur);
          const pending = (this.burstAcc.get(event.id) ?? 0) + (count / dur) * dt;
          const batches = Math.min(
            Math.floor(pending / EMIT_BATCH),
            MAX_BATCHES_PER_FRAME,
          );
          this.burstAcc.set(event.id, pending - batches * EMIT_BATCH);
          effects.emitted += this.pushEmitBatches(
            batches, time, line, aspect,
            Math.round(clamp(eventParam(event, 'material'), 0, 3)),
            viscosity, interactions,
          );
          break;
        }
        case 'attractor': {
          // Pega como el golpe que lo dispara: ataque casi instantáneo (70 ms)
          // y caída cuadrática durante el evento. Con la campana anterior la
          // fuerza pico llegaba recién a la mitad del evento — un atractor de
          // dos segundos tironeaba un segundo tarde y se sentía fuera de
          // sincro con el sonido. `sustain` levanta la cola: un atractor largo
          // mantiene la fuerza en vez de morir a la mitad, y un fundido de
          // 0.3 s al final evita el corte seco.
          const local = Math.max(0, time - event.t);
          const phase = clamp(eventPhase(event, time));
          const release = 1 - phase;
          const sustain = clamp(eventParam(event, 'sustain'));
          const body = sustain + (1 - sustain) * release * release;
          const fade = clamp((event.dur - local) / 0.3);
          const punch = Math.min(1, local / 0.07) * body * fade;
          // `soft` cambia la pegada por una respiración: la fuerza entra y
          // sale en una campana lenta — inhala, junta, exhala y suelta — sin
          // acelerar el fluido de golpe.
          const breath = Math.sin(phase * Math.PI);
          const envelope = eventParam(event, 'soft') > 0.5 ? breath : punch;
          const force = eventParam(event, 'force') * intensity * envelope;
          if (force <= 0.001) break;
          // `wander` hace pasear el punto en un óvalo alrededor de su centro,
          // derivado del tiempo absoluto: el atractor barre en vez de quedarse
          // clavado donde quizás no hay nada. A 0.24 Hz recorre el óvalo
          // entero en ~4 s — con el 0.07 anterior un evento corto no llegaba
          // a moverse y capturaba poco. El agarre (`mode` 4) pasea a la mitad
          // de velocidad: agarra un círculo de fluido y lo lleva consigo,
          // despacio, y la parte agarrada se despega suave del resto.
          const mode = ATTRACTOR_MODES[
            Math.round(clamp(eventParam(event, 'mode'), 0, ATTRACTOR_MODES.length - 1))
          ];
          const wander = clamp(eventParam(event, 'wander'), 0, 0.3);
          const hz = mode === 'drag' ? DRAG_WANDER_HZ : WANDER_HZ;
          const omega = 2 * Math.PI * hz;
          const drift = (time - event.t) * omega;
          // Velocidad del paseo (derivada analítica del óvalo), sólo para el
          // agarre: el drag del solver lleva el fluido a esa velocidad.
          const dragScale = mode === 'drag' ? envelope * force : 0;
          interactions.push({
            mode,
            x: clamp(eventParam(event, 'x') + Math.sin(drift) * wander),
            y: clamp(eventParam(event, 'y') + Math.cos(drift * 0.77) * wander * 0.7),
            vx: Math.cos(drift) * wander * omega * dragScale * aspect * dt,
            vy: -Math.sin(drift * 0.77) * 0.77 * wander * 0.7 * omega * dragScale * dt,
            // Hasta 2.5 del lado corto. El radio se mide en el LADO CORTO,
            // así que "toda la pantalla" en un cuadro de 2100x847 es 1.34 (la
            // media diagonal) y en uno de 32:9 es 1.8. Con el tope viejo de
            // 1.5 no había forma de escribir un atractor que llegara a las
            // cuatro esquinas de cualquier monitor.
            radius: clamp(eventParam(event, 'radius'), 0.02, 2.5),
            // Lo viscoso también frena a los atractores, como a los gestos.
            strength: force * (1 - 0.45 * viscosity),
            materialId: emitMaterial,
            emitCount: 0,
          });
          break;
        }
        case 'unite': {
          // EL MALACATE: junta UN material hacia un punto, por posiciones y
          // no por fuerza — es lo único que puede filtrar por material
          // (trampa 9ter: los atractores pegan a todo lo que entra en el
          // radio). Se usa para la garantía del cierre: las blancas SÍ O SÍ
          // juntas de 2:10 en adelante, sin resetear. Entra en rampa de
          // segundo y medio para que no se vea un tirón seco.
          const ramp = Math.min(1, Math.max(0, time - event.t) / 1.5);
          const speed = Math.max(0, eventParam(event, 'speed')) * intensity * ramp;
          if (speed <= 0 || !playing) break;
          interactions.push({
            mode: 'herd',
            x: clamp(eventParam(event, 'x')),
            y: clamp(eventParam(event, 'y')),
            // El paso viaja en vx como el drag: fracción de alto POR FRAME
            // (la escena lo multiplica por la altura en píxeles).
            vx: speed * dt,
            vy: 0,
            radius: clamp(eventParam(event, 'radius'), 0.02, 1),
            // La purga viaja en strength = PERMUTAS por frame: un ajeno de
            // adentro del núcleo y una blanca de afuera se cambian de lugar
            // (la ocupación del espacio no cambia — cero respuesta de
            // presión). Sin purga las blancas quedan en una bola pero
            // MEZCLADAS, en grumos separados por masa invisible (medido: el
            // racimo conexo más grande se clava en 52 %); y empujando a los
            // ajenos en vez de permutarlos, todo hierve y el núcleo queda
            // mezclado igual.
            // 5 -> 2 canjes por subpaso (360/s): el nucleo converge en ~7 s
            // (80 % unidas justo en 2:10, medido) y el mantenimiento repone
            // lo que los agarres del cierre se llevan.
            strength: eventParam(event, 'purge') > 0.5 ? 5 : 0,
            materialId: Math.round(clamp(eventParam(event, 'material'), 0, 3)),
            emitCount: 0,
          });
          break;
        }
        case 'fracture': {
          // LA GRIETA. Una cuña DURA (`collide`, lo mismo con lo que rebota
          // la línea) recorre una recta partiendo la masa, y a cada lado del
          // frente un empujón tira lo que abre. Es lo que suena entre 0:14 y
          // 0:34: un tronco rajándose.
          //
          // Todo sale del tiempo ABSOLUTO, nunca de un acumulador: la punta
          // avanza a saltos discretos (`crackle` por segundo) para que cruja
          // en vez de deslizar, y el salto lo decide un hash del número de
          // paso, así que el scrub cae siempre en el mismo lugar.
          const phase = clamp(eventPhase(event, time));
          const angle = eventParam(event, 'angle');
          const length = clamp(eventParam(event, 'length'), 0.1, 1.6);
          const force = Math.max(0, eventParam(event, 'force')) * intensity;
          const shards = Math.round(clamp(eventParam(event, 'shards'), 1, 6));
          const crackle = Math.max(2, eventParam(event, 'crackle'));
          // El paso: la punta se queda quieta y salta, se queda y salta.
          const step = Math.floor(Math.max(0, time - event.t) * crackle);
          const stepPhase = clamp(step / Math.max(1, Math.floor(event.dur * crackle)));
          // El frente arranca fuerte y se va gastando, como una rajadura que
          // pierde impulso.
          const bite = (1 - phase) * (1 - phase);
          if (bite <= 0.01 || force <= 0.001) break;
          const tangentX = Math.cos(angle) / Math.max(0.2, aspect);
          const tangentY = Math.sin(angle);
          // La normal, para tirar a los dos lados del corte.
          const normalX = -Math.sin(angle) / Math.max(0.2, aspect);
          const normalY = Math.cos(angle);
          const along = (stepPhase - 0.5) * length;
          for (let shard = 0; shard < shards; shard += 1) {
            // Las astillas se reparten DETRÁS de la punta: la grieta deja
            // esquirlas por donde ya pasó.
            const lag = (shard / shards) * 0.28;
            const wobble = (fractureNoise(step * 7 + shard * 13) - 0.5) * 0.09;
            const at = along - lag * length;
            const px = clamp(eventParam(event, 'x') + tangentX * at + normalX * wobble);
            const py = clamp(eventParam(event, 'y') + tangentY * at + normalY * wobble);
            const fade = bite * (1 - shard / (shards + 1));
            // La cuña dura: el fluido no la atraviesa, la rodea. Es lo que
            // hace que se GOLPEEN en vez de sólo apartarse.
            interactions.push({
              mode: 'collide',
              x: px, y: py, vx: 0, vy: 0,
              radius: FRACTURE_WEDGE_RADIUS * (0.6 + fade * 0.6),
              strength: 0,
              materialId: emitMaterial,
              emitCount: 0,
            });
            // Y el par de empujones que abre el corte para los dos lados.
            for (const side of [-1, 1]) {
              interactions.push({
                mode: 'repel',
                x: clamp(px + normalX * FRACTURE_OPEN * side),
                y: clamp(py + normalY * FRACTURE_OPEN * side),
                vx: 0, vy: 0,
                radius: FRACTURE_OPEN_RADIUS,
                // Lo viscoso también frena a la fractura, como a todo.
                strength: force * fade * (1 - 0.45 * viscosity),
                materialId: emitMaterial,
                emitCount: 0,
              });
            }
          }
          break;
        }
        case 'reset-fluid': {
          // La única cosa del show que es una acción y no un estado: se
          // dispara al cruzarla, no en cada frame que cae adentro.
          if (this.firedResets.has(event.id)) break;
          this.firedResets.add(event.id);
          this.pendingReset = [0, 0, 0, 0];
          this.pendingRadianceReset = true;
          this.epoch += 1;
          this.emitAcc = 0;
          break;
        }
        case 'set-material':
        default:
          break;
      }
    }
    return effects;
  }

  /** 0 = luz normal, 1 = apagón pleno. Baja en `attack` y vuelve en `release`. */
  private blackoutAmount(event: ShowEvent, time: number): number {
    const dur = Math.max(0.02, event.dur);
    const local = clamp(time - event.t, 0, dur);
    const attack = Math.max(0.01, eventParam(event, 'attack'));
    const release = Math.max(0.01, eventParam(event, 'release'));
    const down = clamp(local / attack);
    const upStart = Math.max(attack, dur - release);
    const up = local <= upStart ? 0 : clamp((local - upStart) / release);
    return Math.max(0, Math.min(down, 1 - up));
  }

  /**
   * Las "líneas bien estroboscópicas": una onda cuadrada cuya fase es
   * `(t - evento) * freq`, nunca un timer. Devuelve el pico de exposición que
   * el evento le suma al frame mientras está encendido.
   */
  private pushStrobes(
    event: ShowEvent,
    time: number,
    line: LinePose,
    aspect: number,
    geometry: GeoInstance[],
  ): number {
    const phase = (time - event.t) * eventParam(event, 'freqHz');
    const duty = eventParam(event, 'duty');
    if (phase - Math.floor(phase) >= duty) return 0;
    const intensity = clamp(event.intensity);
    const count = Math.max(1, Math.round(eventParam(event, 'count')));
    const orient = Math.round(eventParam(event, 'orient'));
    const half = Math.max(0.001, eventParam(event, 'thickness') / 2);
    const hue = eventParam(event, 'hue');
    // Matiz 0 es blanco: el estrobo por default no tiñe la escena.
    const color = hue <= 0 ? 0xffffff : hsvToHex(hue, 1, 1);
    const emit = 2.5 * intensity;
    const normal = { x: -Math.sin(line.angle), y: Math.cos(line.angle) };
    for (let index = 0; index < count; index += 1) {
      const fraction = (index + 0.5) / count;
      if (orient === 1) {
        // Verticales: rotadas un cuarto de vuelta, el semieje largo cruza el alto.
        geometry.push({
          x: fraction, y: 0.5, w: 0.5, h: half,
          rot: Math.PI / 2, color, emit, absorb: 0.1, shade: 1, shape: 0,
        });
      } else if (orient === 2) {
        // Paralelas a la línea, repartidas por su normal.
        const offset = (fraction - 0.5) * 1.05;
        geometry.push({
          x: 0.5 + (normal.x * offset) / aspect,
          y: 0.5 + normal.y * offset,
          w: aspect / 2, h: half,
          rot: line.angle, color, emit, absorb: 0.1, shade: 1, shape: 0,
        });
      } else {
        geometry.push({
          x: 0.5, y: fraction, w: aspect / 2, h: half,
          rot: 0, color, emit, absorb: 0.1, shade: 1, shape: 0,
        });
      }
    }
    return eventParam(event, 'kick') * intensity;
  }

  /** Oclusor que barre la escena: sombra violenta que cruza de lado a lado. */
  private pushShadowBar(
    event: ShowEvent,
    time: number,
    aspect: number,
    geometry: GeoInstance[],
  ): void {
    const k = ease(eventPhase(event, time));
    const x = mix(eventParam(event, 'x0'), eventParam(event, 'x1'), k);
    const width = eventParam(event, 'width');
    geometry.push({
      x, y: 0.5,
      w: (width * aspect) / 2,
      // Alto de sobra para que el barrido siga tapando cuando va inclinado.
      h: 0.8,
      rot: eventParam(event, 'angle'),
      color: 0x000000,
      emit: 0,
      absorb: 1.05 * clamp(event.intensity, 0.05, 1),
      shade: 0.06,
      shape: 0,
    });
  }

  // ---------------------------------------------------------------- gestos

  /**
   * Reproducción de gestos grabados. Entran por la misma ruta que el gesto en
   * vivo, y con el mismo escalado por viscosidad, así que lo que se grabó es
   * exactamente lo que después suena.
   *
   * `sampleGesture` devuelve velocidad en fracción de eje por segundo; el
   * solver la quiere como desplazamiento por paso en unidades de alto.
   */
  private applyGestures(
    time: number,
    dt: number,
    aspect: number,
    viscosity: number,
    interactions: FluidsShowInteraction[],
  ): number {
    const clips = gesturesAt(this.doc, time);
    const slow = 1 - 0.45 * viscosity;
    for (const clip of clips) {
      const pose = sampleGesture(clip, time);
      if (!pose) continue;
      interactions.push({
        mode: clip.mode,
        x: clamp(pose.x),
        y: clamp(pose.y),
        vx: pose.vx * aspect * dt,
        vy: pose.vy * dt,
        radius: clamp(clip.radius, 0.01, 0.5),
        strength: clamp(clip.strength, 0, 4) * slow,
        materialId: 0,
        emitCount: 0,
      });
    }
    return clips.length;
  }

  // --------------------------------------------------------------- targets

  /** Multiplicador de masa que pide `gravitySense`; 0.302 lo deja en 1.00x. */
  private massScaleAt(time: number): number {
    return 0.35 + clamp(sampleCurveId(this.doc, 'gravitySense', time)) * 2.15;
  }

  private physicsTargetFor(time: number, viscosity: number): FluidsShowPhysics {
    const cohesion = clamp(sampleCurveId(this.doc, 'cohesion', time));
    const gravity = clamp(sampleCurveId(this.doc, 'gravity', time), -1, 1);
    return {
      sameRestDensity: mix(
        COHESION_LOOSE.sameRestDensity, COHESION_JAMMED.sameRestDensity, cohesion,
      ),
      differentRestDensity: mix(
        COHESION_LOOSE.differentRestDensity, COHESION_JAMMED.differentRestDensity, cohesion,
      ),
      stiffness: mix(COHESION_LOOSE.stiffness, COHESION_JAMMED.stiffness, cohesion),
      nearStiffness: mix(COHESION_LOOSE.nearStiffness, COHESION_JAMMED.nearStiffness, cohesion),
      // Negativa suave: subir tiene que ser un flote, no un vuelo.
      gravity: gravity < 0 ? gravity * 0.3 : gravity * 1.2,
      // Freno de base bien arriba del viejo 0.002: el gradiente de emisión
      // por velocidad sólo se ve si las partículas FRENAN — el tirón las
      // enciende y el freno las va apagando en un degradé. Sin esto quedaban
      // deslizando a velocidad casi constante, siempre igual de prendidas.
      // El techo (viscosidad 1) deja el fluido casi quieto: el cierre.
      drag: 0.014 + viscosity * 0.185,
      // Arriba de 0.8 el freno deja de ser decorativo: 0.012 por subpaso son
      // ~0.46 s de vida para un empujón. Es lo que hace que en el cierre una
      // partícula que se toca se encienda y se APAGUE en vez de quedar
      // derivando iluminada para siempre. Debajo de 0.8 va en cero, para no
      // tocar nada de lo que ya está ajustado a ojo en el resto del show.
      brake: Math.max(0, viscosity - 0.8) * 0.06,
    };
  }

  private renderAt(
    time: number,
    emitMaterial: number,
    effects: EventEffects,
  ): Record<string, number> {
    const bodies = clamp(sampleCurveId(this.doc, 'bodies', time));
    // Qué material ilumina. Sin `set-lamp` sigue al que nace; con él, el show
    // puede emitir de un color y prender otro — y prender dos a la vez, que es
    // la única forma de que se vean el rojo y el azul juntos.
    const lamp = lampAt(this.doc, time);
    const lampFade = lampFadeAt(this.doc, time);
    const secondaryActive = lamp.secondary >= 0
      && lamp.secondary !== lamp.primary
      && lamp.mix > 0.001;
    const light = clamp(sampleCurveId(this.doc, 'lightEmission', time));
    const exposureCurve = clamp(sampleCurveId(this.doc, 'exposure', time), 0, 2);
    const exposure = clamp(
      0.38 * exposureCurve * effects.exposureScale + 0.25 * effects.exposureKick,
      0,
      2,
    );
    // La paleta del documento manda: el operador elige de qué color emite
    // cada material. Las curvas de matiz y saturación sólo pisan al material
    // emisor, y sólo si tienen keys — si no, un `set-material` a rojo se
    // vería blanco, que era exactamente lo que pasaba.
    const palette = this.doc.materialColors ?? DEFAULT_MATERIAL_COLORS;
    const colors = DEFAULT_MATERIAL_COLORS.map(
      (fallback, index) => palette[index] ?? fallback,
    );
    const animatedColor = (this.doc.curves.emitHue?.keys.length ?? 0) > 0
      || (this.doc.curves.emitSat?.keys.length ?? 0) > 0;
    if (animatedColor) {
      const hue = sampleCurveId(this.doc, 'emitHue', time);
      const saturation = clamp(sampleCurveId(this.doc, 'emitSat', time));
      colors[emitMaterial] = hsvToHex(hue, saturation, 1);
    }

    return {
      particleSize: 4.2,
      // Con pocas blancas cada una arde, pero sin lavar el cuadro: tope 1.9.
      // El brillo grande viene del movimiento (velocityEmissionRange), no de
      // subir la luz de base — así lo quieto es tenue y lo que corre flamea.
      radiance: 0.4 + light * 1.5,
      // Menos rebote interno: con 0.95 la luz se difundía tanto que el campo
      // quedaba parejo y la variación por velocidad no se leía. Más apretado,
      // la luz cae con la distancia y se ven pulsos y sombras.
      radianceSpread: 0.86,
      radianceAbsorption: 1.32,
      radianceExposure: exposure,
      gradeHue: 0,
      gradeSaturation: 1.02,
      gradeContrast: 1.5,
      gradeBrightness: 0,
      gradeBlackPoint: 0.06,
      emissiveMaterial: lamp.primary,
      reactiveSecondaryMaterial: secondaryActive ? lamp.secondary : -1,
      reactiveSecondaryStrength: secondaryActive ? lamp.mix : 0,
      reactiveSecondaryFraction: 1,
      allEmitters: 1,
      velocityEmission: 1,
      // El emisivo tiene que respirar con la velocidad, no quedarse plano.
      // La sensibilidad va BAJA a propósito: el rango de velocidad del motor
      // es (2.8 px/frame · alto/1008) / sensibilidad, así que con 10 el rango
      // quedaba en 0.28 px/frame y CUALQUIER deriva lo saturaba — todo
      // brillaba constante al máximo, que es exactamente "no cambia con la
      // velocidad". Con ~1.4 el rango son ~2 px/frame: la deriva lenta queda
      // a mitad de curva, lo quieto cae al piso 0.05 y el tirón de un
      // atractor llega al techo. El contraste lo ponen piso y techo, no la
      // sensibilidad.
      // Piso 0.12: una partícula emisora completamente quieta conserva un
      // toquecito mínimo de emisión — con 0.05 desaparecía en negro.
      velocityEmissionFloor: 0.12,
      velocityEmissionRange: mix(1.6, 3.4, light),
      velocityEmissionSensitivity: mix(2.2, 1.4, light),
      // Se mide transporte, no agitación: el jitter de las colisiones dentro
      // de un blob denso vibra en el lugar y con 0.16 queda suprimido ~6x,
      // mientras que una partícula que de verdad viaja mide exacto. Sin esto
      // los blobs quietos se iluminaban por su hervor interno.
      velocityEmissionSmoothing: 0.16,
      ambientVelocityEmission: 0,
      ambientEmissionScale: 1,
      // `bodies` es cuánto pigmento propio muestra un cuerpo que no emite y no
      // recibe luz. En 0 desaparece del todo (sólo se ve lo iluminado); apenas
      // por encima se ve negro, opaco y haciendo sombra, y toma su color sólo
      // donde la luz le pega — que es como se ve algo que no tiene luz propia.
      lightOnly: bodies <= BODY_VISIBLE_MIN ? 1 : 0,
      bodyAmbient: bodies * BODY_AMBIENT_FULL,
      // Cortito: el cambio de material emisor (el rojo de 1:20.90) tiene que
      // caer JUSTO en su hora, no fundirse casi un segundo. Y nunca más largo
      // que el propio cambio: dos `set-lamp` pegados son un ESTROBO de
      // iluminación (1:11 y 1:31), y con el cruce fijo se volvían un gris.
      // Salvo que el cambio pida su propio fundido: el pase de las rojas a
      // las blancas del cierre es lento a pedido, y eso lo dice el evento.
      emitterCrossfadeSeconds: lampFade > 0
        ? clamp(lampFade, 0.1, 5)
        : clamp(lampGapAt(this.doc, time) * 0.4, 0.02, 0.35),
      emitterVisualScale: 1,
      emitterFluxScale: 1,
      motionEpoch: this.epoch,
      backgroundBlack: 1,
      blackOutput: effects.blackOutput ? 1 : 0,
      instantEmissionRole: 0,
      displaySharpness: 0.2,
      materialColor0: colors[0],
      materialColor1: colors[1],
      materialColor2: colors[2],
      materialColor3: colors[3],
    };
  }
}

export default FluidsShowDirector;
