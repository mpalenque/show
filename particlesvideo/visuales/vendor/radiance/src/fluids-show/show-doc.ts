/**
 * Fluids — modelo del documento de show.
 *
 * Todo lo editable del show vive acá: curvas de automatización, eventos de
 * luz/sombra y clips de gesto. Es JSON serializable y puro — sin DOM, sin
 * audio, sin solver — para que el director y el editor lo compartan y para
 * que el sampleo sea testeable a mano.
 *
 * Regla que ordena el archivo: nada guarda estado de reproducción. Todo se
 * evalúa contra un tiempo absoluto de timeline, que es lo que permite saltar
 * a cualquier punto del track y que la imagen caiga exacta.
 */

import { radianceAssetPath } from '../integration/assets';

export type KeyShape = 'linear' | 'smooth' | 'hold';

export interface CurveKey {
  t: number;
  v: number;
  shape: KeyShape;
}

export interface Curve {
  /** Siempre ordenadas por t; las funciones de este módulo lo garantizan. */
  keys: CurveKey[];
}

export type CurveId =
  | 'emission'
  | 'emitHue'
  | 'emitSat'
  | 'lightEmission'
  | 'exposure'
  | 'bodies'
  | 'gravity'
  | 'gravitySense'
  | 'cohesion'
  | 'viscosity'
  | 'lineX'
  | 'lineY'
  | 'lineEmit'
  | 'lineSize'
  | 'lineSpin'
  | 'lineBreak';

export interface CurveSpec {
  id: CurveId;
  /** Rótulo de la lane, en español como el resto de la UI del repo. */
  label: string;
  min: number;
  max: number;
  def: number;
  /** El matiz vive en un círculo: interpola por el arco corto y envuelve. */
  wrap?: boolean;
  /** Lanes secundarias: arrancan plegadas en el editor. */
  collapsed?: boolean;
  hint: string;
}

/**
 * Orden de declaración = orden de las lanes en el editor.
 *
 * Los defaults están elegidos para que un documento vacío ya se vea como el
 * show quiere verse: línea chica girando lento, emisión media, gravedad cero
 * y una física parecida a la de Tres Masas (drag ~0.011, masas ~1x).
 */
export const CURVE_SPECS: readonly CurveSpec[] = Object.freeze([
  { id: 'emission', label: 'EMISIÓN', min: 0, max: 1, def: 0.35, hint: 'partículas por segundo desde la línea' },
  // Vacías, el material emisor usa su color de la paleta. Con keys, la
  // curva lo pisa y el color se anima.
  { id: 'emitHue', label: 'COLOR (MATIZ)', min: 0, max: 1, def: 0, wrap: true, hint: 'anima el color; vacía usa la paleta' },
  { id: 'emitSat', label: 'COLOR (SATURACIÓN)', min: 0, max: 1, def: 0, hint: '0 = blanco; vacía usa la paleta' },
  { id: 'lightEmission', label: 'LUZ', min: 0, max: 1, def: 0.5, hint: 'cuánta luz emiten las partículas' },
  { id: 'exposure', label: 'EXPOSICIÓN', min: 0, max: 2, def: 1, hint: 'master de exposición' },
  /**
   * 0 = sólo luz: una partícula que no emite es invisible salvo donde le
   * pega la luz. 1 = se ven los cuerpos en su propio color aunque no emitan.
   * Es un interruptor, así que conviene usarlo con keys sostenidas.
   */
  { id: 'bodies', label: 'CUERPOS', min: 0, max: 1, def: 0, hint: '0 = sólo luz · 1 = se ven sin emitir' },
  { id: 'gravity', label: 'GRAVEDAD', min: -1, max: 1, def: 0, hint: 'negativo = sube' },
  // 0.302 deja el multiplicador de masa en 1.0x: el neutro es no tocar nada.
  { id: 'gravitySense', label: 'SENSIB. GRAVEDAD', min: 0, max: 1, def: 0.302, hint: 'masa de las partículas' },
  { id: 'cohesion', label: 'ATASCO', min: 0, max: 1, def: 0.3, hint: '0 = fluye suelto · 1 = blobs orgánicos' },
  { id: 'viscosity', label: 'VISCOSIDAD', min: 0, max: 1, def: 0.1, hint: '0 = ágil · 1 = lento' },
  // El grupo de la línea: `collapsed` lo agrupa detrás del botón LÍNEA del
  // editor, que arranca abierto porque son controles de uso corriente.
  { id: 'lineX', label: 'LÍNEA · X', min: 0, max: 1, def: 0.5, collapsed: true, hint: 'posición horizontal del emisor' },
  { id: 'lineY', label: 'LÍNEA · Y', min: 0, max: 1, def: 0.5, collapsed: true, hint: 'posición vertical del emisor' },
  // Apaga el blade sin apagar la emisión: son dos cosas distintas.
  { id: 'lineEmit', label: 'LÍNEA · BRILLO', min: 0, max: 1, def: 1, collapsed: true, hint: '0 = la línea desaparece' },
  // 0.375 da len 0.12: la línea de 1C (0.16) "un poco más chica".
  { id: 'lineSize', label: 'LÍNEA · TAMAÑO', min: 0, max: 1, def: 0.375, collapsed: true, hint: 'largo del blade emisor' },
  // 0.286 x 0.35 = 0.10 rad/s, el giro lento del reloj de sol.
  { id: 'lineSpin', label: 'LÍNEA · GIRO', min: -1, max: 1, def: 0.286, collapsed: true, hint: 'velocidad de giro' },
  { id: 'lineBreak', label: 'LÍNEA · QUIEBRE', min: 0, max: 1, def: 0, collapsed: true, hint: '0 = entera · 0.5 = quebrada quieta · 1 = glitch a fondo' },
]);

export const CURVE_IDS: readonly CurveId[] = CURVE_SPECS.map((spec) => spec.id);

const CURVE_BY_ID = new Map<CurveId, CurveSpec>(CURVE_SPECS.map((spec) => [spec.id, spec]));

export const curveSpec = (id: CurveId): CurveSpec => CURVE_BY_ID.get(id)!;

export const curveDefault = (id: CurveId): number => CURVE_BY_ID.get(id)?.def ?? 0;

export type ShowEventType =
  | 'strobe-lines'
  | 'flash'
  | 'blackout'
  | 'shadow-bar'
  | 'burst'
  | 'emit-burst'
  | 'attractor'
  | 'fracture'
  | 'unite'
  | 'set-material'
  | 'set-lamp'
  | 'reset-fluid';

export interface ShowEvent {
  id: string;
  t: number;
  dur: number;
  type: ShowEventType;
  /** 0..1; su significado lo fija el tipo. */
  intensity: number;
  params: Record<string, number>;
}

export interface EventParamSpec {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

export interface EventSpec {
  type: ShowEventType;
  label: string;
  defaultDur: number;
  /** Color del bloque en la lane de eventos. */
  color: string;
  params: readonly EventParamSpec[];
}

/** Duración mínima: un evento de dur 0 nunca estaría activo en ningún frame. */
export const MIN_EVENT_DUR = 0.02;

export const EVENT_SPECS: readonly EventSpec[] = Object.freeze([
  {
    type: 'strobe-lines',
    label: 'LÍNEAS ESTROBO',
    defaultDur: 0.25,
    color: '#e8e6ff',
    params: [
      { id: 'count', label: 'CANTIDAD', min: 1, max: 12, step: 1, def: 3 },
      { id: 'freqHz', label: 'FRECUENCIA', min: 1, max: 30, step: 0.5, def: 14 },
      { id: 'orient', label: 'ORIENTACIÓN', min: 0, max: 2, step: 1, def: 0 },
      { id: 'hue', label: 'MATIZ', min: 0, max: 1, step: 0.01, def: 0 },
      { id: 'thickness', label: 'GROSOR', min: 0.002, max: 0.02, step: 0.001, def: 0.006 },
      { id: 'duty', label: 'CICLO', min: 0.1, max: 0.6, step: 0.01, def: 0.35 },
      { id: 'kick', label: 'GOLPE', min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  {
    type: 'flash',
    label: 'FLASH',
    defaultDur: 0.4,
    color: '#fff3b0',
    params: [
      { id: 'decay', label: 'CAÍDA', min: 0.1, max: 1.5, step: 0.01, def: 0.35 },
      { id: 'gain', label: 'GANANCIA', min: 1, max: 4, step: 0.05, def: 2.4 },
    ],
  },
  {
    type: 'blackout',
    label: 'APAGÓN',
    defaultDur: 0.6,
    color: '#4b4b58',
    params: [
      { id: 'attack', label: 'ATAQUE', min: 0.01, max: 1, step: 0.01, def: 0.06 },
      { id: 'release', label: 'REGRESO', min: 0.01, max: 2, step: 0.01, def: 0.4 },
    ],
  },
  {
    type: 'shadow-bar',
    label: 'BARRIDO DE SOMBRA',
    defaultDur: 0.8,
    color: '#7a6cff',
    params: [
      { id: 'x0', label: 'DESDE X', min: -0.3, max: 1.3, step: 0.01, def: -0.15 },
      { id: 'x1', label: 'HASTA X', min: -0.3, max: 1.3, step: 0.01, def: 1.15 },
      { id: 'angle', label: 'ÁNGULO', min: -1.57, max: 1.57, step: 0.01, def: 0 },
      { id: 'width', label: 'ANCHO', min: 0.02, max: 0.6, step: 0.01, def: 0.12 },
    ],
  },
  {
    type: 'burst',
    label: 'ESTALLIDO',
    defaultDur: 0.2,
    color: '#ff7a6c',
    params: [
      { id: 'x', label: 'X', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'y', label: 'Y', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'radius', label: 'RADIO', min: 0.1, max: 0.6, step: 0.01, def: 0.3 },
    ],
  },
  {
    /**
     * Un chorro de partículas que no depende de la curva de emisión: nace de
     * la línea, del material que se le pida y en la cantidad que se le pida.
     * Existe porque hay chorros que el show necesita sí o sí —el blanco de
     * 0:50— y la curva de emisión se dibuja a mano: si el chorro viviera en la
     * curva, redibujarla lo borraría. El caudal de la curva le reserva su
     * cuota del techo de población (ver `rateForDoc`), así que no se pisan.
     */
    type: 'emit-burst',
    label: 'CHORRO',
    defaultDur: 1.2,
    color: '#9ad9ff',
    params: [
      { id: 'material', label: 'MATERIAL', min: 0, max: 3, step: 1, def: 0 },
      { id: 'count', label: 'CANTIDAD', min: 0, max: 12000, step: 50, def: 4000 },
    ],
  },
  {
    /**
     * Un punto que tira, empuja o revuelve durante lo que dura el evento. La
     * fuerza entra y sale con una campana sobre la fase, así que no aparece de
     * golpe. Es lo que da comportamientos distintos sin tener que grabar un
     * gesto a mano por cada uno.
     */
    type: 'attractor',
    label: 'ATRACTOR',
    defaultDur: 2.5,
    color: '#c86cff',
    params: [
      // 0 atrae · 1 repele · 2 remolino · 3 remolino al revés · 4 agarra:
      // el punto agarra un círculo de fluido y lo lleva consigo por su paseo.
      { id: 'mode', label: 'MODO', min: 0, max: 4, step: 1, def: 0 },
      { id: 'x', label: 'X', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'y', label: 'Y', min: 0, max: 1, step: 0.01, def: 0.5 },
      /**
       * En unidades del lado CORTO del cuadro. El tope era 0.6 y no alcanzaba:
       * en una pantalla de 2100x847 eso son 508 px desde el centro, y las
       * partículas de los bordes están a 900. Un atractor que tiene que
       * juntar todo el cuadro necesita pasar de 1.
       */
      { id: 'radius', label: 'RADIO', min: 0.04, max: 2.5, step: 0.01, def: 0.18 },
      { id: 'force', label: 'FUERZA', min: 0, max: 3, step: 0.05, def: 1.2 },
      // El punto pasea en un óvalo suave de este radio: 0 = quieto.
      { id: 'wander', label: 'PASEO', min: 0, max: 0.3, step: 0.01, def: 0 },
      // 0 = golpe seco (pega y decae) · 1 = sostiene la fuerza todo el evento.
      { id: 'sustain', label: 'SOSTÉN', min: 0, max: 1, step: 0.01, def: 0 },
      // 1 = respiración: la fuerza entra y sale en una campana lenta, sin
      // pegada — para tirones suaves que no aceleran el fluido de golpe.
      { id: 'soft', label: 'SUAVE', min: 0, max: 1, step: 1, def: 0 },
    ],
  },
  {
    /**
     * FRACTURA: una grieta que VIAJA por el fluido.
     *
     * No es un atractor más. Una cuña dura (`collide`) recorre una línea y va
     * partiendo la masa en dos mientras dos empujones a los costados tiran lo
     * que abre para cada lado — como un tronco que se raja. La punta avanza a
     * los saltos, no liso: el sonido es un crujido, no un barrido.
     */
    type: 'fracture',
    label: 'FRACTURA',
    defaultDur: 0.7,
    color: '#c2b8ff',
    params: [
      { id: 'x', label: 'X', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'y', label: 'Y', min: 0, max: 1, step: 0.01, def: 0.5 },
      /** Por dónde corre la grieta, en radianes. */
      { id: 'angle', label: 'ÁNGULO', min: -1.57, max: 1.57, step: 0.01, def: 0 },
      /** Largo del recorrido, en unidades del lado corto. */
      { id: 'length', label: 'LARGO', min: 0.1, max: 1.6, step: 0.01, def: 0.7 },
      /** Con cuánta fuerza abre para los costados. */
      { id: 'force', label: 'FUERZA', min: 0, max: 3, step: 0.05, def: 1.8 },
      /** Cuántas astillas: puntas duras a lo largo del frente de la grieta. */
      { id: 'shards', label: 'ASTILLAS', min: 1, max: 6, step: 1, def: 3 },
      /** Cuántos crujidos discretos por segundo: la punta salta, no desliza. */
      { id: 'crackle', label: 'CRUJIDO', min: 2, max: 40, step: 1, def: 16 },
    ],
  },
  {
    type: 'unite',
    label: 'JUNTAR MATERIAL',
    defaultDur: 10,
    color: '#b8ffd9',
    params: [
      /** Qué material junta; los demás ni se enteran. */
      { id: 'material', label: 'MATERIAL', min: 0, max: 3, step: 1, def: 0 },
      { id: 'x', label: 'X', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'y', label: 'Y', min: 0, max: 1, step: 0.01, def: 0.5 },
      /** Radio "casa", en lados cortos: adentro no toca nada. */
      { id: 'radius', label: 'RADIO', min: 0.05, max: 1, step: 0.01, def: 0.3 },
      /** Velocidad del riel, en fracción de alto por segundo. */
      { id: 'speed', label: 'VELOCIDAD', min: 0.01, max: 0.6, step: 0.01, def: 0.12 },
      /** 1 = además ECHA del radio a los otros materiales: núcleo puro. */
      { id: 'purge', label: 'PURGAR', min: 0, max: 1, step: 1, def: 0 },
    ],
  },
  {
    type: 'set-material',
    label: 'MATERIAL EMISOR',
    defaultDur: 0.1,
    color: '#6cffc8',
    params: [
      { id: 'material', label: 'MATERIAL', min: 0, max: 3, step: 1, def: 0 },
    ],
  },
  {
    type: 'set-lamp',
    label: 'LÁMPARA',
    defaultDur: 0.1,
    color: '#ffd166',
    params: [
      { id: 'primary', label: 'PRINCIPAL', min: 0, max: 3, step: 1, def: 0 },
      // 4 = ninguno. El motor sólo puede prender dos materiales a la vez.
      { id: 'secondary', label: 'SECUNDARIO', min: 0, max: 4, step: 1, def: 4 },
      { id: 'mix', label: 'MEZCLA', min: 0, max: 0.85, step: 0.01, def: 0.85 },
      /**
       * Cuánto tarda el cambio de emisor, en segundos. 0 = automático (el
       * cruce sale de lo pegados que estén los cambios; ver `lampGapAt`).
       * Con un valor propio, ESE cambio se funde a su ritmo: el pase de las
       * rojas a las blancas del cierre se pidió lento y el automático lo
       * resolvía como un corte de 0.22 s.
       */
      { id: 'fade', label: 'FUNDIDO', min: 0, max: 5, step: 0.05, def: 0 },
    ],
  },
  {
    type: 'reset-fluid',
    label: 'RESET FLUIDO',
    defaultDur: 0.05,
    color: '#ff4d6d',
    params: [],
  },
]);

const EVENT_BY_TYPE = new Map<ShowEventType, EventSpec>(EVENT_SPECS.map((spec) => [spec.type, spec]));

export const eventSpec = (type: ShowEventType): EventSpec => (
  EVENT_BY_TYPE.get(type) ?? EVENT_BY_TYPE.get('flash')!
);

export type GestureMode = 'drag' | 'attract' | 'repel' | 'vortex';

export const GESTURE_MODES: readonly { id: GestureMode; label: string }[] = Object.freeze([
  { id: 'drag', label: 'AGARRAR' },
  { id: 'attract', label: 'ATRAER' },
  { id: 'repel', label: 'REPELER' },
  { id: 'vortex', label: 'VÓRTICE' },
]);

/** `t` es relativo a `clip.t0`; `x`/`y` son fracciones 0..1 del frame lógico. */
export interface GestureSample {
  t: number;
  x: number;
  y: number;
}

export interface GestureClip {
  id: string;
  t0: number;
  t1: number;
  mode: GestureMode;
  /** Fracción de la dimensión menor de la escena. */
  radius: number;
  strength: number;
  samples: GestureSample[];
}

export interface ShowDoc {
  version: 1;
  audioPath: string;
  duration: number;
  curves: Record<CurveId, Curve>;
  events: ShowEvent[];
  gestures: GestureClip[];
  /**
   * Color de cada uno de los cuatro materiales, elegido por el operador.
   *
   * El material decide QUÉ se emite y el color decide de qué color sale. Son
   * cuatro porque el color vive en el material, no en la partícula: cambiar
   * el color del material 0 repinta todo lo que ya se emitió con él. Para
   * dejar una masa quieta en su color y seguir emitiendo en otro hay que
   * cambiar de material con un evento `set-material`.
   */
  materialColors: number[];
}

/** Blanco, rojo, azul y gris: el punto de partida, todos editables. */
export const DEFAULT_MATERIAL_COLORS: readonly number[] = Object.freeze([
  0xffffff, 0xff0000, 0x0000ff, 0x8a8894,
]);

export const FLUIDS_AUDIO_PATH = radianceAssetPath('audio/fluids.wav');
export const FLUIDS_ANALYSIS_PATH = radianceAssetPath('show/fluids.analysis.json');
export const FLUIDS_DURATION = 152.694;

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const finite = (value: unknown, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

let idCounter = 0;

/** Ids locales del documento: sólo tienen que ser únicos dentro del doc. */
export const createId = (prefix: string): string => {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
};

export const emptyDoc = (duration = FLUIDS_DURATION): ShowDoc => {
  const curves = {} as Record<CurveId, Curve>;
  for (const id of CURVE_IDS) curves[id] = { keys: [] };
  return {
    version: 1,
    audioPath: FLUIDS_AUDIO_PATH,
    duration: Math.max(1, duration),
    curves,
    events: [],
    gestures: [],
    materialColors: [...DEFAULT_MATERIAL_COLORS],
  };
};

/** 0xRRGGBB -> '#rrggbb', que es lo que quiere un `<input type="color">`. */
export const hexToCss = (hex: number): string => (
  `#${Math.max(0, Math.min(0xffffff, Math.round(hex))).toString(16).padStart(6, '0')}`
);

export const cssToHex = (css: string): number => {
  const parsed = Number.parseInt(css.replace('#', ''), 16);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(0xffffff, parsed)) : 0xffffff;
};

export const cloneDoc = (doc: ShowDoc): ShowDoc => JSON.parse(JSON.stringify(doc)) as ShowDoc;

// ------------------------------------------------------------------- curvas

/** Índice del último key con `t <= time`, o -1 si `time` precede a todos. */
const findKey = (keys: CurveKey[], time: number): number => {
  let lo = 0;
  let hi = keys.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/**
 * Valor de la curva en `t`. Fuera del rango de keys sostiene el extremo: una
 * curva nunca "vuelve" a su default a mitad del show, porque eso serían saltos
 * invisibles en la timeline.
 */
export const sampleCurve = (
  curve: Curve | undefined,
  t: number,
  fallback: number,
  wrap = false,
): number => {
  const keys = curve?.keys;
  if (!keys || keys.length === 0) return fallback;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  const index = findKey(keys, t);
  const a = keys[index];
  const b = keys[index + 1];
  if (a.shape === 'hold') return a.v;
  const span = b.t - a.t;
  const raw = span <= 0 ? 1 : (t - a.t) / span;
  const k = a.shape === 'smooth' ? smoothstep(raw) : raw;
  if (!wrap) return a.v + (b.v - a.v) * k;
  // Matiz: tomar el arco corto del círculo, para que 0.95 -> 0.05 pase por el
  // rojo y no recorra todo el espectro al revés.
  let delta = b.v - a.v;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  const value = a.v + delta * k;
  return value - Math.floor(value);
};

/**
 * Integral definida de la curva entre 0 y `t`.
 *
 * Existe por el giro de la línea: acumular `angle += spin * dt` frame a frame
 * ata la pose al historial de reproducción, y entonces saltar en la timeline
 * deja la línea en cualquier lado. Como la curva es lineal a trozos, su
 * integral es exacta y barata, y `angle = angle0 + k * integrateCurve(...)`
 * da la misma pose se haya llegado reproduciendo o saltando.
 *
 * Por tramo: `hold` es un rectángulo; `linear` y `smooth` completos son el
 * mismo trapecio (smoothstep integra 0.5 en el tramo, por simétrica). Sólo el
 * tramo parcial distingue: `u²/2` contra `u³ - u⁴/2`.
 */
export const integrateCurve = (
  curve: Curve | undefined,
  t: number,
  fallback: number,
): number => {
  if (!(t > 0)) return 0;
  const keys = curve?.keys;
  if (!keys || keys.length === 0) return fallback * t;
  // Antes de la primera key la curva sostiene su primer valor.
  let total = keys[0].v * Math.min(t, Math.max(0, keys[0].t));
  if (t <= keys[0].t) return total;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const a = keys[index];
    const b = keys[index + 1];
    if (t <= a.t) break;
    const span = b.t - a.t;
    if (span <= 0) continue;
    if (t >= b.t) {
      total += a.shape === 'hold' ? a.v * span : ((a.v + b.v) / 2) * span;
      continue;
    }
    const u = (t - a.t) / span;
    if (a.shape === 'hold') {
      total += a.v * (t - a.t);
    } else if (a.shape === 'smooth') {
      total += span * (a.v * u + (b.v - a.v) * (u * u * u - (u * u * u * u) / 2));
    } else {
      total += span * (a.v * u + ((b.v - a.v) * u * u) / 2);
    }
    return total;
  }
  const last = keys[keys.length - 1];
  if (t > last.t) total += last.v * (t - last.t);
  return total;
};

/** Sampleo por id, aplicando el default y el wrap de la spec. */
export const sampleCurveId = (doc: ShowDoc, id: CurveId, t: number): number => {
  const spec = curveSpec(id);
  return sampleCurve(doc.curves[id], t, spec.def, spec.wrap === true);
};

/** Integral por id, con el default de la spec como valor sostenido. */
export const integrateCurveId = (doc: ShowDoc, id: CurveId, t: number): number => (
  integrateCurve(doc.curves[id], t, curveSpec(id).def)
);

const sortKeys = (keys: CurveKey[]): CurveKey[] => [...keys].sort((a, b) => a.t - b.t);

/** Inserta un key manteniendo el orden; si ya hay uno en ese t, lo reemplaza. */
export const withKey = (curve: Curve, key: CurveKey): Curve => {
  const keys = curve.keys.filter((existing) => Math.abs(existing.t - key.t) > 1e-4);
  keys.push(key);
  return { keys: sortKeys(keys) };
};

export const withoutKey = (curve: Curve, index: number): Curve => ({
  keys: curve.keys.filter((_, position) => position !== index),
});

// ------------------------------------------------------------------ eventos

const eventDur = (event: ShowEvent): number => Math.max(MIN_EVENT_DUR, event.dur);

export const eventsAt = (doc: ShowDoc, t: number): ShowEvent[] => (
  doc.events.filter((event) => t >= event.t && t < event.t + eventDur(event))
);

/** 0 al empezar el evento, 1 al terminarlo. */
export const eventPhase = (event: ShowEvent, t: number): number => (
  clamp((t - event.t) / eventDur(event), 0, 1)
);

export const eventParam = (event: ShowEvent, id: string): number => {
  const spec = eventSpec(event.type).params.find((param) => param.id === id);
  const fallback = spec?.def ?? 0;
  const value = finite(event.params?.[id], fallback);
  return spec ? clamp(value, spec.min, spec.max) : value;
};

export const makeEvent = (type: ShowEventType, t: number): ShowEvent => {
  const spec = eventSpec(type);
  return {
    id: createId(type),
    t: Math.max(0, t),
    dur: spec.defaultDur,
    type,
    intensity: 1,
    params: Object.fromEntries(spec.params.map((param) => [param.id, param.def])),
  };
};

/**
 * Material del que nacen las partículas en `t`: el del último `set-material`
 * que quedó atrás. Es un estado derivado del tiempo, no un flag que se
 * prende, y por eso saltar a cualquier punto del track lo resuelve bien.
 * Lo comparten el director y el editor para que muestren siempre lo mismo.
 */
export const emitMaterialAt = (doc: ShowDoc, t: number): number => {
  let material = 0;
  for (const event of doc.events) {
    if (event.t > t) break;
    if (event.type === 'set-material') {
      material = Math.round(clamp(eventParam(event, 'material'), 0, 3));
    }
  }
  return material;
};

/**
 * Lámpara "ninguno".
 *
 * El motor siempre tiene un material emisor: no hay apagado. El material 3 es
 * el hueco — el show emite 0, 1 y 2, y nunca nace uno de 3, así que apuntar
 * la lámpara ahí deja la escena sin nada que emita. Es el mismo truco que usa
 * Tres Masas para su "materia oscura".
 */
export const LAMP_NONE = 3;

export interface LampState {
  /** Material que brilla. */
  primary: number;
  /** Segundo material encendido, o -1 si no hay. */
  secondary: number;
  mix: number;
}

/**
 * Qué material ilumina la escena en `t`.
 *
 * Es distinto de qué material NACE: el motor enciende un material a la vez
 * (más un segundo por el emisor secundario), así que "emitir rojo y azul y
 * que se vean los dos" se resuelve acá, no con el material de nacimiento.
 * Sin ningún `set-lamp`, la lámpara sigue al material que se está emitiendo,
 * que es el comportamiento natural: lo que nace, brilla.
 */
export const lampAt = (doc: ShowDoc, t: number): LampState => {
  let lamp: LampState | null = null;
  for (const event of doc.events) {
    if (event.t > t) break;
    if (event.type !== 'set-lamp') continue;
    const secondary = Math.round(clamp(eventParam(event, 'secondary'), 0, 4));
    lamp = {
      primary: Math.round(clamp(eventParam(event, 'primary'), 0, 3)),
      secondary: secondary >= 4 ? -1 : secondary,
      mix: clamp(eventParam(event, 'mix'), 0, 0.85),
    };
  }
  return lamp ?? { primary: emitMaterialAt(doc, t), secondary: -1, mix: 0 };
};

/**
 * Cuánto separa a los dos últimos cambios de lámpara hasta `t`. El cruce de
 * emisor no puede durar más que el cambio que lo dispara: dos `set-lamp`
 * pegados tienen que verse como un ESTROBO, y con el cruce fijo de 0.35 s se
 * fundían en un gris parejo. Devuelve infinito si todavía no hubo dos.
 */
export const lampGapAt = (doc: ShowDoc, t: number): number => {
  let last = Number.NEGATIVE_INFINITY;
  let previous = Number.NEGATIVE_INFINITY;
  for (const event of doc.events) {
    if (event.t > t) break;
    if (event.type !== 'set-lamp') continue;
    previous = last;
    last = event.t;
  }
  return Number.isFinite(previous) ? last - previous : Number.POSITIVE_INFINITY;
};

/**
 * El fundido que pide el último `set-lamp` hasta `t`, o 0 si no pide ninguno.
 *
 * Va aparte de `lampAt` a propósito: `LampState` es lo que ilumina —principal,
 * secundario y mezcla— y meterle una cuarta cosa rompería a todo el que lo
 * compara entero.
 */
export const lampFadeAt = (doc: ShowDoc, t: number): number => {
  let fade = 0;
  for (const event of doc.events) {
    if (event.t > t) break;
    if (event.type === 'set-lamp') fade = Math.max(0, eventParam(event, 'fade'));
  }
  return fade;
};

export const sortEvents = (events: ShowEvent[]): ShowEvent[] => (
  [...events].sort((a, b) => a.t - b.t)
);

// ------------------------------------------------------------------- gestos

export interface GesturePose {
  x: number;
  y: number;
  /** Fracción del eje por segundo; el director la convierte a unidades solver. */
  vx: number;
  vy: number;
}

export const gesturesAt = (doc: ShowDoc, t: number): GestureClip[] => (
  doc.gestures.filter((clip) => t >= clip.t0 && t < clip.t1)
);

const findSample = (samples: GestureSample[], time: number): number => {
  let lo = 0;
  let hi = samples.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

/**
 * Pose del clip en tiempo absoluto de timeline. La velocidad sale de las
 * muestras vecinas: es lo que hace que reproducir un gesto empuje el fluido
 * igual que cuando se grabó, y no sólo lo toque en el lugar correcto.
 */
export const sampleGesture = (clip: GestureClip, t: number): GesturePose | null => {
  const samples = clip.samples;
  if (samples.length === 0) return null;
  const local = t - clip.t0;
  const first = samples[0];
  if (local <= first.t) return { x: first.x, y: first.y, vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  if (local >= last.t) return { x: last.x, y: last.y, vx: 0, vy: 0 };
  const index = findSample(samples, local);
  const a = samples[index];
  const b = samples[index + 1];
  const span = b.t - a.t;
  const k = span <= 0 ? 1 : (local - a.t) / span;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    vx: span <= 0 ? 0 : (b.x - a.x) / span,
    vy: span <= 0 ? 0 : (b.y - a.y) / span,
  };
};

/**
 * Recorta un clip al rango `[from, to]`, o devuelve null si queda vacío. Las
 * muestras viven en tiempo relativo a `t0`, así que recortar por la izquierda
 * también las desplaza.
 */
const clipRange = (clip: GestureClip, from: number, to: number): GestureClip | null => {
  const t0 = Math.max(clip.t0, from);
  const t1 = Math.min(clip.t1, to);
  if (t1 - t0 <= 1e-3) return null;
  const shift = t0 - clip.t0;
  const span = t1 - t0;
  const samples = clip.samples
    .map((sample) => ({ t: sample.t - shift, x: sample.x, y: sample.y }))
    .filter((sample) => sample.t >= -1e-6 && sample.t <= span + 1e-6);
  if (samples.length === 0) return null;
  return { ...clip, id: createId(clip.mode), t0, t1, samples };
};

/**
 * Sobreescritura estilo DAW: todo lo que había entre `t0` y `t1` desaparece —
 * incluso donde el operador no tocó el mouse — y en su lugar quedan `clips`.
 * Un clip que cruza el rango entero se parte en dos.
 */
export const punchGestures = (
  doc: ShowDoc,
  t0: number,
  t1: number,
  clips: GestureClip[],
): ShowDoc => {
  const from = Math.min(t0, t1);
  const to = Math.max(t0, t1);
  const kept: GestureClip[] = [];
  for (const clip of doc.gestures) {
    if (clip.t1 <= from || clip.t0 >= to) {
      kept.push(clip);
      continue;
    }
    const left = clipRange(clip, -Infinity, from);
    if (left) kept.push(left);
    const right = clipRange(clip, to, Infinity);
    if (right) kept.push(right);
  }
  const gestures = [...kept, ...clips].sort((a, b) => a.t0 - b.t0);
  return { ...doc, gestures };
};

// -------------------------------------------------------------- persistencia

const parseShape = (value: unknown): KeyShape => (
  value === 'smooth' || value === 'hold' ? value : 'linear'
);

const parseCurve = (raw: unknown, spec: CurveSpec): Curve => {
  const keys: CurveKey[] = [];
  const source = (raw as Curve | undefined)?.keys;
  if (Array.isArray(source)) {
    for (const item of source) {
      const t = Number((item as CurveKey)?.t);
      const v = Number((item as CurveKey)?.v);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      keys.push({
        t: Math.max(0, t),
        v: clamp(v, spec.min, spec.max),
        shape: parseShape((item as CurveKey)?.shape),
      });
    }
  }
  return { keys: sortKeys(keys) };
};

const parseEvent = (raw: unknown, index: number): ShowEvent | null => {
  const source = raw as Partial<ShowEvent> | undefined;
  if (!source || !EVENT_BY_TYPE.has(source.type as ShowEventType)) return null;
  const spec = eventSpec(source.type as ShowEventType);
  const params: Record<string, number> = {};
  for (const param of spec.params) {
    params[param.id] = clamp(finite(source.params?.[param.id], param.def), param.min, param.max);
  }
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `evt-${index}`,
    t: Math.max(0, finite(source.t, 0)),
    dur: Math.max(MIN_EVENT_DUR, finite(source.dur, spec.defaultDur)),
    type: source.type as ShowEventType,
    intensity: clamp(finite(source.intensity, 1), 0, 1),
    params,
  };
};

const parseGesture = (raw: unknown, index: number): GestureClip | null => {
  const source = raw as Partial<GestureClip> | undefined;
  if (!source) return null;
  const mode = GESTURE_MODES.some((entry) => entry.id === source.mode)
    ? (source.mode as GestureMode)
    : 'drag';
  const t0 = Math.max(0, finite(source.t0, 0));
  const t1 = Math.max(t0, finite(source.t1, t0));
  const samples: GestureSample[] = [];
  if (Array.isArray(source.samples)) {
    for (const item of source.samples) {
      const t = Number((item as GestureSample)?.t);
      const x = Number((item as GestureSample)?.x);
      const y = Number((item as GestureSample)?.y);
      if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      samples.push({ t: Math.max(0, t), x: clamp(x, 0, 1), y: clamp(y, 0, 1) });
    }
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a.t - b.t);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `ges-${index}`,
    t0,
    t1,
    mode,
    radius: clamp(finite(source.radius, 0.08), 0.01, 0.5),
    strength: clamp(finite(source.strength, 1), 0, 4),
    samples,
  };
};

/**
 * Lectura defensiva: un JSON dañado nunca puede impedir que el show arranque
 * — mismo criterio que el `load()` de la página de Tres Masas. Todo lo que no
 * se entiende se descarta y el resto del documento sobrevive.
 */
export const parseShowDoc = (raw: unknown, duration = FLUIDS_DURATION): ShowDoc => {
  const doc = emptyDoc(duration);
  let source: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return doc;
    }
  } else if (raw && typeof raw === 'object') {
    source = raw as Record<string, unknown>;
  }
  if (!source) return doc;

  const parsedDuration = finite(source.duration, duration);
  doc.duration = parsedDuration > 1 ? parsedDuration : duration;
  if (typeof source.audioPath === 'string' && source.audioPath) doc.audioPath = source.audioPath;

  const curves = source.curves as Record<string, unknown> | undefined;
  for (const spec of CURVE_SPECS) {
    doc.curves[spec.id] = parseCurve(curves?.[spec.id], spec);
  }

  if (Array.isArray(source.events)) {
    const events = source.events
      .map((item, index) => parseEvent(item, index))
      .filter((event): event is ShowEvent => event !== null);
    doc.events = sortEvents(events);
  }
  if (Array.isArray(source.materialColors)) {
    doc.materialColors = DEFAULT_MATERIAL_COLORS.map((fallback, index) => {
      const value = Number((source.materialColors as unknown[])[index]);
      return Number.isFinite(value) ? clamp(Math.round(value), 0, 0xffffff) : fallback;
    });
  }
  if (Array.isArray(source.gestures)) {
    const gestures = source.gestures
      .map((item, index) => parseGesture(item, index))
      .filter((clip): clip is GestureClip => clip !== null);
    doc.gestures = gestures.sort((a, b) => a.t0 - b.t0);
  }
  return doc;
};

export const serializeShowDoc = (doc: ShowDoc): string => JSON.stringify(doc, null, 2);
