import {
  FLUIDS_AUDIO_PATH,
  LAMP_NONE,
  MIN_EVENT_DUR,
  emptyDoc,
  sortEvents,
  type Curve,
  type CurveKey,
  type ShowDoc,
  type ShowEvent,
} from './show-doc';


/**
 * Siembra del documento desde el análisis offline de `fluids.wav`.
 *
 * El análisis (tools/analyze-fluids.mjs) ya está hecho y no se rehace acá: se
 * consume. Lo que sale de esta siembra es un punto de partida **editable** —
 * curvas que ya siguen la forma del track y eventos parados en los golpes —
 * no un show terminado. Por eso simplifica agresivamente: 48 keys se pueden
 * arrastrar a mano, 6 574 no.
 */

export type EnvelopeId = 'rms' | 'bass' | 'mid' | 'high' | 'air' | 'flux' | 'centroid';

export interface AnalysisOnset {
  t: number;
  strength: number;
  band: 'low' | 'mid' | 'high';
  shares: { low: number; mid: number; high: number };
}

export interface AnalysisSection {
  t: number;
  score?: number;
}

export interface FluidsAnalysis {
  version: number;
  source: string;
  sampleRate: number;
  duration: number;
  /** Muestras por segundo de las envolventes (43.07 Hz con hop 512). */
  envelopeRate: number;
  tempo: number;
  envelopes: Record<EnvelopeId, number[]>;
  onsets: AnalysisOnset[];
  sections: AnalysisSection[];
}

const ENVELOPE_IDS: EnvelopeId[] = ['rms', 'bass', 'mid', 'high', 'air', 'flux', 'centroid'];

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const numbers = (raw: unknown): number[] => (
  Array.isArray(raw) ? raw.map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0)) : []
);

/** Lectura defensiva: sin análisis utilizable, la siembra queda deshabilitada. */
export const parseAnalysis = (raw: unknown): FluidsAnalysis | null => {
  let source: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (raw && typeof raw === 'object') {
    source = raw as Record<string, unknown>;
  }
  if (!source) return null;

  const envelopesRaw = (source.envelopes ?? {}) as Record<string, unknown>;
  const envelopes = Object.fromEntries(
    ENVELOPE_IDS.map((id) => [id, numbers(envelopesRaw[id])]),
  ) as Record<EnvelopeId, number[]>;
  if (envelopes.rms.length === 0) return null;

  const onsets: AnalysisOnset[] = [];
  if (Array.isArray(source.onsets)) {
    for (const item of source.onsets as AnalysisOnset[]) {
      const t = Number(item?.t);
      if (!Number.isFinite(t)) continue;
      const band = item?.band === 'mid' || item?.band === 'high' ? item.band : 'low';
      onsets.push({
        t,
        strength: clamp(Number(item?.strength), 0, 1),
        band,
        shares: {
          low: clamp(Number(item?.shares?.low), 0, 1),
          mid: clamp(Number(item?.shares?.mid), 0, 1),
          high: clamp(Number(item?.shares?.high), 0, 1),
        },
      });
    }
  }

  const sections: AnalysisSection[] = Array.isArray(source.sections)
    ? (source.sections as AnalysisSection[])
      .filter((item) => Number.isFinite(Number(item?.t)))
      .map((item) => ({ t: Number(item.t), score: Number(item.score) || undefined }))
    : [];

  const envelopeRate = Number(source.envelopeRate);
  return {
    version: Number(source.version) || 1,
    source: String(source.source ?? FLUIDS_AUDIO_PATH),
    sampleRate: Number(source.sampleRate) || 44100,
    duration: Number(source.duration) || envelopes.rms.length / (envelopeRate || 43.066),
    envelopeRate: envelopeRate > 0 ? envelopeRate : 43.066,
    tempo: Number(source.tempo) || 0,
    envelopes,
    onsets: onsets.sort((a, b) => a.t - b.t),
    sections: sections.sort((a, b) => a.t - b.t),
  };
};

/** Media móvil centrada; `seconds` es el ancho total de la ventana. */
export const smoothEnvelope = (values: number[], rate: number, seconds: number): number[] => {
  const half = Math.max(0, Math.floor((seconds * rate) / 2));
  if (half === 0 || values.length === 0) return [...values];
  // Suma acumulada: el suavizado corre sobre 6 574 muestras en cada siembra y
  // la ventana de un segundo son 43 — O(n) en vez de O(n·w).
  const prefix = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index += 1) {
    prefix[index + 1] = prefix[index] + values[index];
  }
  const out = new Array<number>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const from = Math.max(0, index - half);
    const to = Math.min(values.length, index + half + 1);
    out[index] = (prefix[to] - prefix[from]) / (to - from);
  }
  return out;
};

/** Percentil sobre una copia ordenada; usado para normalizar sin que un pico mande. */
const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round(fraction * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index];
};

/**
 * Douglas-Peucker sobre (t, v): conserva los quiebres que dan la forma y tira
 * los puntos que caen sobre la recta que los une.
 */
const douglasPeucker = (points: CurveKey[], epsilon: number): CurveKey[] => {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    if (to - from < 2) continue;
    const a = points[from];
    const b = points[to];
    const dt = b.t - a.t;
    const dv = b.v - a.v;
    const length = Math.hypot(dt, dv) || 1;
    let worst = -1;
    let worstIndex = -1;
    for (let index = from + 1; index < to; index += 1) {
      const point = points[index];
      const distance = Math.abs(dv * (point.t - a.t) - dt * (point.v - a.v)) / length;
      if (distance > worst) {
        worst = distance;
        worstIndex = index;
      }
    }
    if (worst > epsilon && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([from, worstIndex], [worstIndex, to]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
};

/**
 * Simplifica hasta entrar en `maxKeys`. La tolerancia sube geométricamente:
 * en la práctica converge en menos de veinte pasadas y evita tener que elegir
 * a mano un epsilon distinto por curva.
 */
export const simplifyCurve = (points: CurveKey[], maxKeys: number): CurveKey[] => {
  if (points.length <= maxKeys) return [...points];
  let epsilon = 0.002;
  let result = douglasPeucker(points, epsilon);
  for (let attempt = 0; attempt < 24 && result.length > maxKeys; attempt += 1) {
    epsilon *= 1.6;
    result = douglasPeucker(points, epsilon);
  }
  return result;
};

interface EnvelopeCurveOptions {
  envelope: number[];
  rate: number;
  smoothSeconds: number;
  lo: number;
  hi: number;
  maxKeys: number;
}

/** Envolvente -> curva editable: suavizar, normalizar, remapear, simplificar. */
export const envelopeCurve = (options: EnvelopeCurveOptions): Curve => {
  const { envelope, rate, smoothSeconds, lo, hi, maxKeys } = options;
  if (envelope.length === 0) return { keys: [] };
  const smoothed = smoothEnvelope(envelope, rate, smoothSeconds);
  // El percentil 98 en vez del máximo: un solo pico no puede aplastar el
  // resto de la curva contra el piso.
  const ceiling = Math.max(1e-6, percentile(smoothed, 0.98));
  const points: CurveKey[] = smoothed.map((value, index) => ({
    t: index / rate,
    v: lo + (hi - lo) * clamp(value / ceiling, 0, 1),
    shape: 'smooth' as const,
  }));
  return { keys: simplifyCurve(points, maxKeys) };
};

/**
 * Selección de impulsos: los golpes que se escuchan, no todos los onsets.
 *
 * El detector marca 874 onsets, de los cuales la mayoría son el piso de ruido
 * del análisis. Dos pasadas los reducen a los que se oyen:
 *
 * 1. Supresión de no-máximos: dentro de una ventana corta sobrevive sólo el
 *    más fuerte, así un golpe con flam cuenta como uno y no como tres.
 * 2. Umbral RELATIVO al vecindario, no absoluto. Un umbral fijo dejaba la
 *    sección de 1:40 a 2:20 casi sin impulsos —ahí el track es más suave— y
 *    el show se moría justo en el cierre. Relativo, cada tramo aporta sus
 *    propios golpes.
 */
export interface ImpulseOptions {
  /** Ventana de supresión de no-máximos, en segundos. */
  nms?: number;
  /** Fracción del pico del vecindario que hay que superar. */
  relative?: number;
  /** Piso absoluto, para que el silencio no invente golpes. */
  floor?: number;
  /** Radio del vecindario que define el pico local, en segundos. */
  context?: number;
}

export interface SeedOptions {
  /** Tope de keys por curva; el editor tiene que poder arrastrarlas a mano. */
  maxKeys?: number;
  impulses?: ImpulseOptions;
  /**
   * La curva de emisión que se va a usar de verdad, cuando el operador ya la
   * dibujó a mano y resiembra con "SIN TOCAR EMISIÓN".
   *
   * Entra ACÁ y no después, pisando el resultado, porque hay cosas del guion
   * que se derivan de dónde escupe la línea —sobre todo de qué color nace
   * cada chorro— y sembrarlas contra una curva que después se descarta las
   * deja corridas de lo que se ve. Manuel dibujó la primera parte a mano:
   * los chorros caen donde él los puso, no donde los pondría el análisis.
   */
  keepEmission?: Curve;
  /** Forma del pico de emisión de cada impulso. */
  emission?: {
    /** Chorrito entre golpes: la línea no queda muerta. */
    floor?: number;
    /** Altura mínima de un impulso, sumada a su fuerza. */
    peakBase?: number;
    peakScale?: number;
    attack?: number;
    decay?: number;
  };
}

export const pickImpulses = (
  onsets: AnalysisOnset[],
  options: ImpulseOptions = {},
): AnalysisOnset[] => {
  // NMS 0.1: un redoble (golpes cada ~0.11 s, como el de 0:29) tiene que
  // emitir como redoble — con 0.18 sobrevivía un solo golpe de cada ráfaga y
  // el tramo de 0:25 a 0:35 no emitía con lo que se escuchaba. Las caídas se
  // recortan contra el ataque siguiente, así que la ráfaga encadena en un
  // chorro sostenido en vez de picotear.
  const nms = options.nms ?? 0.1;
  const relative = options.relative ?? 0.26;
  const floor = options.floor ?? 0.12;
  const context = options.context ?? 5;
  const picked: AnalysisOnset[] = [];
  // Los onsets vienen ordenados por t, así que el vecindario se recorre con
  // dos punteros en vez de barrer los 874 por cada candidato.
  let contextFrom = 0;
  let contextTo = 0;
  for (let index = 0; index < onsets.length; index += 1) {
    const onset = onsets[index];
    let isPeak = true;
    for (let k = index - 1; k >= 0 && onset.t - onsets[k].t <= nms; k -= 1) {
      if (onsets[k].strength > onset.strength) { isPeak = false; break; }
    }
    if (isPeak) {
      for (let k = index + 1; k < onsets.length && onsets[k].t - onset.t <= nms; k += 1) {
        if (onsets[k].strength >= onset.strength) { isPeak = false; break; }
      }
    }
    while (contextFrom < onsets.length && onsets[contextFrom].t < onset.t - context) contextFrom += 1;
    while (contextTo < onsets.length && onsets[contextTo].t <= onset.t + context) contextTo += 1;
    if (!isPeak) continue;
    let localPeak = 0;
    for (let k = contextFrom; k < contextTo; k += 1) {
      if (onsets[k].strength > localPeak) localPeak = onsets[k].strength;
    }
    if (onset.strength >= Math.max(floor, relative * localPeak)) picked.push(onset);
  }
  return picked;
};

/**
 * Emisión por impulsos: cada golpe del track escupe su chorro y la línea
 * vuelve al chorrito de base.
 *
 * Reemplaza a la envolvente suave de rms, que emitía parejo y no dejaba
 * reconocer los golpes. La caída se recorta contra el ataque del impulso
 * siguiente: dos golpes pegados encadenan sin volver al piso en el medio.
 *
 * **La altura de cada chorro es la `strength` del impulso, tal cual.** Estuvo
 * calculada contra el vecindario ±5 s —para que el golpe más fuerte de un
 * pasaje suave tirara el chorro grande igual— y el resultado fue el contrario
 * del buscado: los primeros segundos, donde casi no suena, escupían chorros
 * de tamaño completo y se gastaban la población antes de que arrancara la
 * música. Quien llama pesa la fuerza como quiera (ver `weighImpulses`); acá
 * ya no se mira más que el número que llega.
 */
export const emissionImpulseCurve = (
  impulses: AnalysisOnset[],
  options: SeedOptions['emission'] = {},
  /** Escala del tramo del show en el que cae cada impulso; 0 = no emite. */
  scaleFor: (t: number) => number = () => 1,
): Curve => {
  // Piso casi nulo y caída larga: entre golpe y golpe la línea calla, y cada
  // golpe se reconoce como golpe. Un piso alto emitía parejo desde el
  // segundo cero y no se escuchaba nada en la imagen.
  const floor = options.floor ?? 0.02;
  // Piso BAJO y escala alta: la altura del chorro tiene que separar de verdad
  // un golpe fuerte de un golpecito. Con 0.5/0.5 el más débil de todos ya
  // salía a media altura —y como el caudal es cuadrático, se llevaba un
  // cuarto de lo que se lleva un golpe pleno— así que los golpecitos del
  // arranque se comían la población antes de que empezara la música.
  const peakBase = options.peakBase ?? 0.15;
  const peakScale = options.peakScale ?? 0.85;
  const attack = options.attack ?? 0.02;
  const decay = options.decay ?? 0.45;
  const keys: CurveKey[] = [];
  /**
   * Los tiempos tienen que quedar estrictamente crecientes: dos keys en el
   * mismo instante hacen que el sampleo devuelva la primera y se pierda el
   * golpe, y en el editor se superponen en el mismo píxel. Ante un empate
   * gana el valor más alto, que es el pico.
   */
  const pushKey = (t: number, v: number): void => {
    const last = keys[keys.length - 1];
    if (last && t <= last.t + 1e-4) {
      if (v > last.v) last.v = v;
      return;
    }
    keys.push({ t, v, shape: 'linear' });
  };

  pushKey(0, floor * Math.max(0, scaleFor(0)));
  for (let index = 0; index < impulses.length; index += 1) {
    const impulse = impulses[index];
    // La escala multiplica todo el impulso, piso incluido: un tramo con
    // escala 0 deja de emitir del todo en vez de gotear.
    const scale = Math.max(0, scaleFor(impulse.t));
    const rest = floor * scale;
    const peak = clamp(peakBase + peakScale * impulse.strength, 0, 1) * scale;
    pushKey(Math.max(0, impulse.t - attack), rest);
    pushKey(impulse.t, peak);
    const nextRise = index + 1 < impulses.length
      ? Math.max(0, impulses[index + 1].t - attack)
      : Number.POSITIVE_INFINITY;
    pushKey(Math.min(impulse.t + decay, nextRise), rest);
  }
  return { keys };
};

/**
 * Documento inicial desde el análisis. Los umbrales vienen del plan: flashes
 * en los golpes graves fuertes, estrobos en los agudos — la densidad que dan
 * (unas decenas de eventos, no cientos) es la que deja el track legible.
 */
/**
 * Guion del show, en tramos. Cada uno arranca en el golpe más cercano a `at`
 * y decide de qué material nacen las partículas, cuánto se emite, qué
 * ilumina la escena y cómo se comporta el fluido.
 *
 * Esto es una siembra, no la última palabra: sale como keys y eventos
 * normales sobre la timeline, y de ahí se ajusta a mano.
 */
export interface SeedStage {
  /** El tramo se engancha al golpe más cercano a esta hora. */
  at: number;
  /** Corrimiento sobre ese golpe, para caer justo después de él. */
  offset?: number;
  /**
   * `false` = el tramo va en su hora exacta, sin buscar golpe. El cierre no
   * es una reacción a un ataque sino una hora del guion: enganchado al golpe
   * más cercano se corría hasta dos segundos y medio.
   */
  snap?: boolean;
  name: string;
  /** Multiplica el pico de cada impulso del tramo; 0 = no emite. */
  emissionScale: number;
  /** Materiales que se van rotando impulso a impulso. */
  materials: number[];
  /** Qué ilumina: principal, secundario (-1 = ninguno) y mezcla. */
  lamp: { primary: number; secondary: number; mix: number };
  /** 0 = fluye suelto - 1 = se cierra en blobs. */
  cohesion: number;
  viscosity: number;
  /**
   * Cuánto pigmento propio muestra un cuerpo al que no le llega luz. En 0
   * desaparece; apenas por encima se ve negro, opaco y haciendo sombra, y
   * toma color sólo donde lo iluminan.
   */
  bodies: number;
  lineEmit: number;
  exposure: number;
  /**
   * Pisa `lightEmission` con un valor sostenido. La envolvente de flujo del
   * track sirve mientras la luz la pone la línea, pero cuando el guion dice
   * "acá arde el rojo" el brillo lo manda el guion, no el track.
   */
  light?: number;
}

/** Blanco, rojo, azul: los índices de material del show. */
const WHITE = 0;
const RED = 1;
const BLUE = 2;

/**
 * Nadie emite luz hasta que aparece el blanco. Antes de eso el rojo y el azul
 * se ven por lo que la línea les tira encima, con la lámpara apuntada al hueco
 * (el material 3, del que nunca nace nada). El rojo recién se vuelve emisivo
 * en el último tramo, y ahí deja de serlo el blanco.
 */
const LAMP_OFF = { primary: LAMP_NONE, secondary: -1, mix: 0 };

/**
 * Los tres momentos blancos del show. En 0:40 salen unos pocos blanquitos y la
 * línea apaga su luz (pero sigue emitiendo, invisible). En 0:50 sale el chorro
 * grande, que además atrae al resto y pasea despacio. En 0:59 el sonido
 * explota: el blob repele todo y salen unos blancos más. Pocos blancos y
 * ardiendo fuerte, no una masa blanca.
 */
export const FIRST_WHITE_AT = 42;
export const WHITE_BURST_AT = 50;
export const EXPLOSION_AT = 59;
const FIRST_WHITE_COUNT = 150;
const WHITE_BURST_COUNT = 600;
const EXPLOSION_WHITE_COUNT = 250;
/**
 * Desde acá (1:35) el show entra en calma: los blobs se alentan —el freno es
 * lo que deja leer el cambio de intensidad de la luz—, los tirones se vuelven
 * suaves y lentos, y por encima corre la respiración: un pulso lento que
 * junta a todos y los suelta, como respirar.
 */
const CALM_FROM = 95;
/** El ciclo de la respiración: cada cuánto inhala, y cuánto dura cada una. */
const BREATH_EVERY = 9;
const BREATH_SECONDS = 5.5;
/**
 * El cierre. Desde 1:52 una juntada larga y suave pega a todos entre sí, y a
 * partir de 2:03 quedan así: pegados, casi quietos, sin un solo atractor más
 * — ahí es donde el detalle del cambio de luz por velocidad se puede mirar.
 */
const GATHER_FROM = 112;
/**
 * El radio de esa juntada, en unidades del lado corto. Tiene que abarcar el
 * cuadro entero: el show corre en pantallas muy anchas y un atractor sólo
 * mueve lo que le entra en el radio.
 */
const GATHER_RADIUS = 2;
/**
 * Y LA JUNTADA NO SE SUELTA. Medido sobre la cadena real del director contra
 * el solver: a 1:58 la juntada tiene a las blancas perfectas —ninguna a más
 * de 300 px del grueso, máximo 279— y en cuanto la fuerza se va, a las 2:04
 * la bola REBOTA: p90 salta de 324 a 667 px y se queda ahí hasta el final
 * (1 192 de 1 608 blancas sueltas, máximo 979 px). Eso es exactamente la
 * captura de las 2:32: grumos por todos lados. No es la cohesión —congelarla
 * no cambia nada—, es la presión de la bola comprimida cuando la soltás.
 *
 * Así que desde que termina la juntada hasta el final del show corre un
 * agarre de CUADRO ENTERO, débil y constante, que no junta (ya están juntas):
 * sólo impide el rebote. Medido con él: p90 se queda en ~300 px, máximo 319,
 * 129 sueltas de 1 608 — y el brillo del cierre no se mueve del piso (0.14 de
 * mediana entre 2:06 y 2:15), porque una bola densa en equilibrio con una
 * fuerza constante no se mueve: la presión la compensa.
 */
const STILL_HOLD_RADIUS = 2;
const STILL_HOLD_FORCE = 0.2;
const STICK_FROM = 123;
/** Los agarres del final: cada cuánto, y cuánto dura cada uno. */
const FINAL_GRAB_EVERY = 9.5;
const FINAL_GRAB_SECONDS = 6.5;
/**
 * Y el agarre agarra UN PUÑADO. Con radio 0.3 (254 px) sobre la masa junta
 * —que mide unos 310 px de punta a punta— el agarre se llevaba todo el
 * cierre de una vez: medido, la mediana del brillo saltaba a 3.4 durante los
 * seis segundos del agarre. Con 0.13 se lleva un pedazo, deja el reguero
 * encendido detrás que es lo que se quiere ver, y el resto se queda quieto.
 */
const FINAL_GRAB_RADIUS = 0.13;
const FINAL_GRAB_FORCE = 1.2;
/**
 * 2:03 — vuelve el blanco. La luz roja se corta a negro y lo que se prende
 * son otra vez las blancas, con la intensidad con la que ardían cuando
 * nacieron, sobre un fluido que ya no se mueve solo: el freno del solver
 * arriba, cero atractores, la masa pegada y casi quieta. Ahí una partícula
 * quieta es un puntito tenue y una que se mueve arde — que es todo el
 * gradiente de emisión por velocidad, mirado de cerca y sin nada encima.
 * Es el lienzo para tocar en vivo: un toque enciende, y se apaga solo.
 */
const WHITE_STILL_FROM = STICK_FROM;
/** Cuánto dura esa quietud antes de que vuelvan los agarres del final. */
const STILL_SECONDS = 12;
/**
 * La cohesión del cierre. NO va al mango: con 1 el fluido queda atascado
 * (densidad de reposo 11.2, rigidez de contacto 1.45) y la masa HIERVE — las
 * partículas se rebotan entre ellas en el lugar y quedan iluminadas para
 * siempre, aunque nadie las mueva. Medido contra el solver: con cohesión 1 el
 * 10 % más agitado se queda en 0.90 de brillo (el piso es 0.12) y no baja
 * nunca; con 0.62 la masa entera cae al piso en tres segundos y ahí se queda.
 * Sigue siendo un pegote —densidad propia 8.0 contra 3.0 con los otros
 * materiales—, pero uno que se puede quedar quieto.
 */
const STILL_COHESION = 0.62;
/**
 * El cierre no queda MUERTO: quieto no es lo mismo que congelado. Por encima
 * de la masa corre una respiración lenta —una atracción suave y ancha que
 * cada siete segundos inhala cinco y suelta— que la va juntando de a poco
 * (medido: la mediana del brillo se queda clavada en el piso 0.12 y sólo el
 * décimo que migra sube a 0.2-0.5), y cada tres segundos cae un TOQUECITO:
 * un tirón chiquito y corto, del tamaño del pincel del mouse, que enciende un
 * puñado de partículas y las deja apagarse. Es lo mismo que hacer click, pero
 * programado, para que el cuadro no se muera si nadie toca.
 */
const STILL_BREATH_EVERY = 5;
const STILL_BREATH_SECONDS = 2.6;
/**
 * La respiración va MUY por debajo de lo que iba (0.7), y no por gusto: con
 * el agarre permanente la masa quedó junta y densa, y ahí una inhalación que
 * antes movía a media docena de grumos sueltos ahora mueve TODO —medido, la
 * mediana del brillo se clavaba en 3.4, el techo— y vuelve el cuadro
 * encendido con estela que ya se rechazó una vez. Medido sobre la cadena
 * real: en los tramos quietos la mediana del brillo va 0.13-0.80 sin
 * respiración, 0.14-0.79 con 0.15, y 0.15-1.32 con 0.25. O sea que a 0.15 el
 * latido sale gratis y a 0.25 ya cuesta el doble.
 */
const STILL_BREATH_FORCE = 0.15;
/**
 * El radio de la respiración del cierre vuelve a ser CORTO. Ensancharlo a
 * cuadro entero junta un poco más, sí, pero mantiene toda la masa en marcha
 * los treinta segundos y las blancas quedan encendidas con estela — medido,
 * el brillo mediano pasa de 0.62 a 1.14. La juntada de 1:52 ya llega con el
 * trabajo hecho; acá lo que hace falta es quietud.
 */
const STILL_BREATH_RADIUS = 0.45;
/** Nunca dos toquecitos a menos de esto: es un cierre, no una pelea. */
const STILL_POKE_SPACING = 0.9;
const STILL_POKE_SECONDS = 0.3;
/** Radio y fuerza del toquecito medio: los del pincel del operador. */
const STILL_POKE_RADIUS = 0.08;
const STILL_POKE_FORCE = 1.6;
/**
 * El repertorio. Cada toquecito es un gesto distinto sobre la masa quieta:
 * 0 lo junta (un click), 1 lo revienta (tirarle algo), 2 y 3 lo revuelven
 * para un lado y para el otro, y 4 AGARRA un puñado y se lo lleva — deja un
 * reguero encendido detrás, que es lo que mejor se ve con el freno arriba.
 */
const POKE_MODES = [0, 1, 2, 4, 1, 3, 0, 4] as const;
/** El agarre necesita tiempo y paseo; el resto son golpes secos. */
const POKE_GRAB_SECONDS = 1.2;
const POKE_GRAB_WANDER = 0.12;
/** El pulso de gravedad de un golpe fuerte: sube en el golpe y se va. */
const GRAVITY_PULSE_SECONDS = 1.6;
/** Cuánto dura el bloque de sonido de 0:50 (el flux cae recién en ~0:53). */
const WHITE_BLOCK_SECONDS = 3;
/**
 * 1:10 — las partículas se unen todas rápidamente y la luz se concentra ahí;
 * hacia 1:20 esa atracción pierde fuerza y suelta. (El solver no sabe atraer
 * a un solo material, así que junta a todos: las blancas van adentro y la luz
 * se concentra igual.)
 */
const LIGHT_GATHER_AT = 70;
/**
 * El rojo se prende JUSTO en 1:20.90. Va en su hora exacta (`snap: false`),
 * no en el golpe más cercano: se pidió esta hora dos veces y engancharla a un
 * impulso la corría medio segundo para un lado o un segundo y medio para el
 * otro (el golpe anterior cae en 80.78 y el siguiente en 81.37).
 */
const RED_AT = 80.9;
/** 1:35 — el sonido distinto: la luz se apaga y se prende otra un instante. */
const BLINK_AT = 94.9;
/**
 * Y ese blanco termina JUSTO en 1:36.27, no un segundo después: es la hora
 * exacta en la que el sonido lo devuelve al rojo.
 */
const BLINK_WHITE_UNTIL = 96.27;
/** Otros golpes donde la luz se corta a negro un instante (hora aproximada). */
const DARK_BLINKS = [66.5, 86];
/**
 * Los dos sonidos que piden un ESTROBO de iluminación. Lo que estrobea es el
 * blanco —prende y apaga— y al terminar la luz se apaga hacia lo que manda el
 * guion en esa hora: blanco en 1:11, donde el rojo todavía no existe, y rojo
 * en 1:31. El de 1:11 es LARGO, de 1:11 a 1:14: ahí el sonido sostiene y el
 * de un segundo pasaba desapercibido.
 *
 * **El estrobo va CON EL SONIDO, no a un ritmo fijo.** Cada prendida cae en
 * un ataque del track dentro de la ventana; a 9 Hz de metrónomo era una luz
 * de discoteca corriendo por su cuenta al lado de la música.
 */
const LAMP_STROBES = [
  { at: 71, seconds: 3 },
  { at: 91, seconds: 0.9 },
] as const;
/** Cuánto queda prendida cada chispa, como mucho. */
const LAMP_STROBE_FLASH = 0.075;
/** Y qué tan fuerte tiene que ser el ataque, contra el más fuerte de su ventana. */
const LAMP_STROBE_GATE = 0.22;
/** Cuánto dura cada chorro blanco. */
const WHITE_BURST_SECONDS = 1.2;
/**
 * 1:23.09 — un tick seco y brillante de 23 ms, el único golpe de banda alta
 * en un hueco de 11.6 s, encima de un bajón de volumen. Hoy no pasa NADA ahí:
 * hay tres segundos sin una sola fuerza y las quince curvas planas. Se marca
 * con una chispa blanca de la lámpara —el mismo gesto que los estrobos de
 * 1:11 y 1:31— y no con un `blackout`: ese evento sólo escala la irradiancia,
 * y a esta altura, con `bodies` en 0, el cuadro son las caras emisivas y el
 * campo, que no la miran. Por eso los cuatro apagones del show son `set-lamp`.
 */
const HIGH_TICK_AT = 83.093;
const HIGH_TICK_SECONDS = 0.07;
/**
 * 2:02 — un 22 % más de blancas, que son las que después trabajan todo el
 * cierre. Sobre las ~996 que hay hoy son 220; se piden 225 porque el emisor
 * sale de a lotes de 6 y el evento no vive su último cuadro, así que con 220
 * salen 216 y con 225 salen 222. El chorro se frena contra el techo DURO
 * (36 000), no contra el blando, así que sale aunque la población ya esté
 * clavada en 13 992.
 *
 * Y encima de todo eso, UN 10 % MÁS pedido a mano sobre el total del final:
 * los tres refuerzos se escalan por 1.26 (620 -> 780 partículas repartidas
 * igual que antes), así que el cierre pasa de ~1 608 blancas a ~1 769. El
 * techo no es problema: el blando (14 000) sólo frena la curva de emisión,
 * que a esta altura está en cero hace un minuto, y contra el duro (36 000)
 * el show entero llega con la mitad.
 */
const WHITE_TOPUP_AT = 122;
const WHITE_TOPUP_COUNT = 283;
/**
 * Y un 20 % más justo en 2:00, para el final: de ahí en adelante las blancas
 * son lo ÚNICO visible y se pasan treinta segundos trabajando. Sobre las
 * ~996 que hay cuando entra son 199; se piden 258 con el 10 % de más.
 */
const WHITE_FINAL_AT = 120;
const WHITE_FINAL_COUNT = 258;
/**
 * Y LA ÚLTIMA emisión de blancas, en 2:27.9 — el golpe pleno donde el track
 * revienta para cerrar. Un 15 % más sobre las ~1218 que hay para entonces son
 * 183; se piden 190 por el mismo redondeo de lotes que el refuerzo de 2:02.
 */
const WHITE_LAST_AT = 147.9;
const WHITE_LAST_COUNT = 239;
/**
 * La última sale REPARTIDA en dos segundos y medio en vez de en uno. No es
 * capricho: 239 blancas apareciendo de golpe en la boca de la línea, dentro
 * de una masa ya densa, son una bomba de presión —medido, la mediana del
 * brillo se va al techo los últimos cinco segundos— y lo que se ve es todo
 * el cierre prendido justo en el cuadro final. Repartida, entra como una
 * crecida.
 */
const WHITE_LAST_SECONDS = 2.5;
/**
 * De 0:14 a 0:34 el fluido no hacía NADA: los cambios de comportamiento por
 * golpe fuerte recién arrancan en 0:30 (`STRONG_FROM`) y los juegos cortos
 * después del chorro blanco, así que en todo ese tramo sonaban los chorros de
 * Manuel y las partículas seguían de largo. Ahora cada uno de sus chorros de
 * ahí se lleva un gesto: el fluido se abre, se revuelve o se junta con el
 * sonido. Van pegados (sin `soft`) para que caigan EN el golpe.
 */
const FIRST_PART_GESTURES_FROM = 14;
const FIRST_PART_GESTURES_UNTIL = 34.5;
/** 1 expande · 2 revuelve · 0 junta · 3 revuelve al revés. */
const FIRST_PART_MODES = [1, 2, 0, 3, 1] as const;
/**
 * LAS FRACTURAS. El sonido de ese tramo es un árbol quebrándose, así que cada
 * chorro se lleva una grieta que parte la masa: una cuña dura recorriendo una
 * recta y dos empujones abriéndola a los costados.
 *
 * Cada una está medida contra su golpe, que no son iguales:
 * - 14.04 — 8 ataques, 4 plenos, y el rms se muere en 0.135 a los 15.0.
 *   Crujido SECO: corto, violento, y silencio.
 * - 19.31 — cola larga (la mitad de la energía recién a 1.05 s) y 29 % de
 *   graves: más golpe que quiebre. Grieta larga y lenta.
 * - 24.23 — astillado limpio (agudos altos) pero el volumen no sube: astilla
 *   sin tronco. Grieta chica, muchas astillas.
 * - 29.09 — EL QUIEBRE: 10 ataques, 4 plenos, máximos de flujo, agudo y aire
 *   de los cinco. Y son CINCO crestas separadas, no una meseta: la grieta más
 *   larga y la que más cruje.
 * - 32.73 — un tick de 46 ms sobre una hinchazón de graves; el pico real del
 *   pasaje cae recién en 33.9. Grieta floja, casi un chasquido.
 */
const FRACTURES = [
  { at: 14.04, dur: 0.55, angle: 0.5, length: 0.8, force: 2.3, shards: 4, crackle: 26 },
  { at: 19.31, dur: 1.1, angle: -0.35, length: 1.1, force: 1.5, shards: 3, crackle: 11 },
  { at: 24.23, dur: 0.6, angle: 1.1, length: 0.45, force: 1.7, shards: 6, crackle: 22 },
  { at: 29.09, dur: 1.25, angle: -0.9, length: 1.5, force: 2.6, shards: 5, crackle: 30 },
  { at: 32.73, dur: 0.5, angle: 0.2, length: 0.4, force: 1.2, shards: 2, crackle: 14 },
] as const;
/**
 * Y el pase de las rojas a las blancas es LENTO: dos segundos de cruce, con
 * las dos masas encendidas a la vez mientras la roja se apaga y los grumos
 * blancos prenden. Antes había un corte a negro en el medio; alargar el cruce
 * sin sacarlo no da una transición de color, estira el pozo negro.
 */
const WHITE_STILL_FADE = 2;
/** Un chorro cada 0.6 s como mucho: lo demás es una cerca de picos. */
const EMIT_SPACING = 0.6;
/**
 * LOS CHORROS DE LA PRIMERA PARTE, dictados por Manuel.
 *
 * Los dibujó a mano sobre la timeline y mandó la captura: "acá te muestro
 * exacto dónde tiene que emitir partículas la primera parte". Son DIEZ, y esa
 * cantidad es el punto: cualquier regla automática metía veinticuatro entre
 * 0:00 y 0:35 —los diez suyos y catorce de más— y ningún corte por altura los
 * separa, porque su chorro de 0:01.5 mide 0.36 y un intruso de 0:12 mide 0.65.
 *
 * Las horas son estimadas sobre los píxeles de la captura, así que cada una se
 * engancha al golpe más fuerte que tenga a menos de `FIRST_PART_SNAP`: la
 * lectura puede errar medio segundo, el golpe no.
 *
 * NO se regeneran con una heurística. Si hay que cambiarlas, se cambian acá.
 */
const FIRST_PART_HITS = [0.7, 1.5, 4.4, 6.8, 9.6, 13.7, 18.8, 23.6, 28.4, 32.8];
const FIRST_PART_UNTIL = 35;
const FIRST_PART_SNAP = 0.9;
/**
 * Cuánto tarda un chorro en cambiar de color. Cada chorro nace de DOS
 * materiales: arranca de uno y a los 0.13 s pasa al otro, y el siguiente
 * chorro los invierte. Así en cada golpe salen rojas Y negras —pedido
 * explícito— en vez de un color por chorro, que era lo que hacía la rotación
 * vieja. Se puede porque el material se resuelve por cuadro contra el tiempo
 * absoluto (`emitMaterialAt`), no se congela al arrancar el chorro.
 */
const MATERIAL_SPLIT = 0.16;

/**
 * Golpes BLANDOS: los sonidos que el detector de onsets no marca. Hay pasajes
 * (0:02-0:13, 0:34-0:37) donde algo suena —la envolvente sube y baja— pero no
 * hay ataques que detectar, y ahí la línea no emitía nada. Se buscan los
 * máximos locales del flujo suavizado, con prominencia real sobre su
 * vecindario y lejos de los impulsos ya elegidos, y se suman como impulsos de
 * fuerza moderada: puffs sueltos donde suena algo, y silencio entre medio.
 * NO es un piso continuo — eso se probó y emitía parejo siempre.
 */
export const swellImpulses = (
  analysis: FluidsAnalysis,
  impulses: AnalysisOnset[],
): AnalysisOnset[] => {
  const rate = analysis.envelopeRate;
  const env = smoothEnvelope(analysis.envelopes.flux, rate, 0.35);
  const out: AnalysisOnset[] = [];
  const peakWindow = Math.round(rate * 0.7);
  const baseWindow = Math.round(rate * 1.4);
  for (let index = peakWindow; index < env.length - peakWindow; index += 1) {
    const value = env[index];
    if (value < 0.08) continue;
    let isPeak = true;
    for (let k = index - peakWindow; k <= index + peakWindow; k += 1) {
      if (env[k] > value) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    // Prominencia: tiene que sobresalir de su piso cercano, no ser meseta.
    let base = value;
    for (let k = Math.max(0, index - baseWindow); k < Math.min(env.length, index + baseWindow); k += 1) {
      base = Math.min(base, env[k]);
    }
    if (value < base * 1.25) continue;
    const t = index / rate;
    if (impulses.some((impulse) => Math.abs(impulse.t - t) < 1)) continue;
    if (out.some((impulse) => Math.abs(impulse.t - t) < 1)) continue;
    out.push({
      t,
      strength: clamp(value * 2, 0, 0.55),
      band: 'mid',
      shares: { low: 0, mid: 1, high: 0 },
    });
  }
  return out;
};

/**
 * Golpes RESCATADOS: lo que suena en los huecos donde la línea quedaba muda.
 *
 * De 0:20 a 0:50 el track no calla nunca —el rms no baja de 0.16 y tiene
 * lomos claros en 0:21, 0:23, 0:26, 0:36 y 0:40— y sin embargo la curva se
 * quedaba en el piso hasta cuatro segundos y medio seguidos. Son dos causas
 * distintas y ninguna de las dos se arregla bajando un umbral:
 *
 * - `pickImpulses` mide cada golpe contra el pico de su vecindario ±5 s, así
 *   que un pasaje al lado de un bombazo se queda sin nada aunque tenga
 *   ataques propios (hay 194 onsets crudos en ese tramo).
 * - En 0:34-0:40 directamente NO hay ataques: los onsets crudos valen 0.02 y
 *   la envolvente es una meseta, así que tampoco los agarra `swellImpulses`,
 *   que pide prominencia.
 *
 * Por eso el rescate no filtra por fuerza: filtra por HUECO. Se miran los
 * espacios de más de `gap` segundos sin un solo impulso y se reparten adentro
 * puffs cada `slot` segundos, cada uno parado en el máximo de flujo de su
 * ventana — o sea en lo más parecido a un ataque que haya ahí. Si en ese
 * instante el rms no llega al piso del pasaje, no entra: un silencio de
 * verdad sigue siendo silencio. Fuerza recortada a 0.45: acompañan el
 * pasaje, no compiten con los golpes de verdad.
 */
export const gapImpulses = (
  analysis: FluidsAnalysis,
  taken: AnalysisOnset[],
  from: number,
  to: number,
  options: { gap?: number; slot?: number } = {},
): AnalysisOnset[] => {
  const gap = options.gap ?? 1.4;
  const slot = options.slot ?? 0.9;
  const rate = analysis.envelopeRate;
  const rms = smoothEnvelope(analysis.envelopes.rms, rate, 0.4);
  const flux = smoothEnvelope(analysis.envelopes.flux, rate, 0.25);
  const at = (values: number[], t: number): number => (
    values[Math.max(0, Math.min(values.length - 1, Math.round(t * rate)))] ?? 0
  );
  const window = rms.slice(Math.round(from * rate), Math.round(to * rate));
  if (window.length === 0) return [];
  // "Acá suena" se mide contra el propio pasaje, no contra un número fijo.
  const floor = percentile(window, 0.2);
  const loud = percentile(window, 0.9) || 1;
  const edges = [
    from,
    ...taken.filter((onset) => onset.t > from && onset.t < to).map((onset) => onset.t),
    to,
  ];
  const out: AnalysisOnset[] = [];
  for (let index = 1; index < edges.length; index += 1) {
    const span = edges[index] - edges[index - 1];
    if (span < gap) continue;
    const count = Math.max(1, Math.round(span / slot) - 1);
    for (let k = 1; k <= count; k += 1) {
      const centre = edges[index - 1] + (span * k) / (count + 1);
      // Parado en el máximo de flujo de su ventana: el puff cae en lo que
      // más se parece a un ataque, no en un instante de reloj.
      let t = centre;
      for (let probe = centre - 0.35; probe <= centre + 0.35; probe += 1 / rate) {
        if (at(flux, probe) > at(flux, t)) t = probe;
      }
      if (at(rms, t) < floor) continue;
      out.push({
        t,
        // Con el volumen del instante, para que el pasaje respire en vez de
        // tirar trece puffs iguales.
        strength: clamp(0.55 * (at(rms, t) / loud), 0.12, 0.45),
        band: 'mid',
        shares: { low: 0, mid: 1, high: 0 },
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
};

/** Desde acá se rescatan los golpes que el umbral relativo se comió (0:19.5). */
export const GAP_FILL_FROM = 19.5;

/**
 * Adelgaza los impulsos a uno cada `spacing` segundos, quedándose con el más
 * fuerte de cada ventana. Entre 0:00 y 0:50 la curva llegó a tener SETENTA Y
 * CUATRO picos: una cerca de estacas donde no se distingue un golpe de otro y
 * donde cada golpecito se lleva su cuota de población.
 */
export const thinImpulses = (
  impulses: AnalysisOnset[],
  spacing: number,
): AnalysisOnset[] => {
  const out: AnalysisOnset[] = [];
  for (const impulse of impulses) {
    const last = out[out.length - 1];
    if (last && impulse.t - last.t < spacing) {
      if (impulse.strength > last.strength) out[out.length - 1] = impulse;
      continue;
    }
    out.push(impulse);
  }
  return out;
};

/**
 * Los LOMOS del volumen: dónde el track suena fuerte, haya ataque o no.
 *
 * El detector de onsets marca ATAQUES, y hay pasajes que pegan fuerte sin
 * ninguno — en 0:12 el rms llega a 0.41 (percentil 88 del tramo) y entre 0:07
 * y 0:14 no hay un solo impulso elegido. Ahí la línea se quedaba muda con la
 * música arriba, que es lo que se pidió arreglar tres veces: **si suena
 * fuerte, emite**. Se buscan los máximos locales del rms suavizado, separados
 * al menos `spacing`, por encima del percentil 60 del tramo, y se paran en el
 * ataque más cercano si hay uno a menos de 0.3 s —para que el chorro salga
 * con el golpe y no en el medio del sonido—. La altura después se la pone
 * `weighImpulses` como a cualquier otro.
 */
export const loudImpulses = (
  analysis: FluidsAnalysis,
  from: number,
  to: number,
  spacing = 0.8,
): AnalysisOnset[] => {
  const rate = analysis.envelopeRate;
  const rms = smoothEnvelope(analysis.envelopes.rms, rate, 0.4);
  const fromIndex = Math.max(0, Math.round(from * rate));
  const toIndex = Math.min(rms.length, Math.round(to * rate));
  if (toIndex - fromIndex < 2) return [];
  const gate = percentile(rms.slice(fromIndex, toIndex), 0.6);
  const window = Math.max(1, Math.round(0.4 * rate));
  const out: AnalysisOnset[] = [];
  for (let index = fromIndex + window; index < toIndex - window; index += 1) {
    if (rms[index] < gate) continue;
    let isPeak = true;
    for (let k = index - window; k <= index + window; k += 1) {
      if (rms[k] > rms[index]) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    let t = index / rate;
    // Parado en el ataque más cercano, si hay uno: el chorro sale con el
    // golpe, no en el medio del sonido.
    let best: AnalysisOnset | null = null;
    for (const onset of analysis.onsets) {
      if (Math.abs(onset.t - t) > 0.3) continue;
      if (!best || onset.strength > best.strength) best = onset;
    }
    if (best) t = best.t;
    const last = out[out.length - 1];
    if (last && t - last.t < spacing) continue;
    out.push({
      t,
      // Fuerza de arranque media-alta: lo que decide el tamaño acá es el
      // volumen, no el ataque, y `weighImpulses` lo aplica después.
      strength: Math.max(0.55, best?.strength ?? 0),
      band: best?.band ?? 'mid',
      shares: best?.shares ?? { low: 0, mid: 1, high: 0 },
    });
  }
  return out;
};

/**
 * Pesa cada impulso por lo fuerte que suena el pasaje donde cae.
 *
 * El detector de onsets mide ATAQUES: un golpe seco en un pasaje callado
 * puntúa igual que el mismo golpe en el medio del quilombo, y por eso los
 * primeros segundos del track —que casi no suenan— escupían chorros de
 * tamaño completo. La altura del chorro tiene que seguir a lo que se
 * escucha, así que la fuerza se multiplica por el volumen del pasaje,
 * normalizado contra el propio tramo que emite. Queda un piso de 0.3: un
 * ataque seco en el silencio sigue saliendo, chiquito.
 */
export const weighImpulses = (
  analysis: FluidsAnalysis,
  impulses: AnalysisOnset[],
  to: number,
): AnalysisOnset[] => {
  const rate = analysis.envelopeRate;
  const rms = smoothEnvelope(analysis.envelopes.rms, rate, 0.4);
  const window = rms.slice(0, Math.max(1, Math.round(to * rate)));
  // Normalizado entre el percentil 35 y el 92 del tramo: lo que se llama
  // "bien fuerte" llega a 1 y lo normalito queda a media altura.
  const lo = percentile(window, 0.35);
  const hi = percentile(window, 0.92);
  const span = Math.max(1e-6, hi - lo);
  return impulses.map((impulse) => {
    const level = rms[Math.max(0, Math.min(rms.length - 1, Math.round(impulse.t * rate)))] ?? 0;
    const loudness = clamp((level - lo) / span, 0, 1);
    // MANDA EL VOLUMEN. El ataque sólo modula: un golpe seco en el medio de
    // un pasaje fuerte llega al tope, el mismo golpe en el silencio es un
    // puff, y un pasaje fuerte sin ataque ninguno igual escupe.
    return {
      ...impulse,
      strength: clamp(loudness * (0.55 + 0.45 * impulse.strength), 0, 1),
    };
  });
};

/**
 * Cierra la curva de emisión en el golpe del chorro blanco: recorta lo que
 * venía después y la deja en cero para siempre. De ahí en adelante lo único
 * que emite es el evento `emit-burst` del blanco, que no pasa por la curva.
 */
export const closeEmissionAt = (curve: Curve, at: number): Curve => {
  const keys = curve.keys.filter((key) => key.t < at - 0.4);
  keys.push({ t: Math.max(0, at - 0.35), v: 0.02, shape: 'linear' });
  keys.push({ t: Math.max(0.01, at - 0.05), v: 0, shape: 'hold' });
  return { keys };
};

/**
 * Cuánto pigmento muestran los cuerpos mientras la única luz es la línea:
 * apenas nada. Se ven como siluetas negras que ocluyen y hacen sombra, y sólo
 * toman su color donde les pega la luz. Con el pigmento al full se veían
 * rojos y azules planos aunque no hubiera nada iluminándolos.
 */
const BODIES_DARK = 0.12;

export const SHOW_SCRIPT: readonly SeedStage[] = Object.freeze([
  {
    // La escala va en 1 de punta a punta del tramo que emite. La crecida NO
    // la dibuja una rampa de escalas: la dibuja el track. Con 0.42 acá, los
    // pasajes bien fuertes del arranque (0:07 tiene tanto rms como 0:24)
    // salían a media altura por una decisión del guion, y lo pedido es que
    // si suena fuerte, emita — suene cuando suene.
    at: 0, name: 'ROJO Y AZUL', emissionScale: 1,
    materials: [RED, BLUE],
    lamp: LAMP_OFF,
    cohesion: 0.15, viscosity: 0.1, bodies: BODIES_DARK, lineEmit: 1, exposure: 1.2,
  },
  {
    // La crecida: el mismo golpe escupe mucho más que antes. Domina el rojo,
    // con un azul cada tantos golpes: los azules son los cuerpos que después
    // tapan la luz roja — sin ellos, cuando el rojo se prende no hay sombras.
    at: 13, name: 'CHORRO ROJO', emissionScale: 1,
    materials: [RED, RED, BLUE, RED],
    lamp: LAMP_OFF,
    cohesion: 0.12, viscosity: 0.18, bodies: BODIES_DARK, lineEmit: 1, exposure: 1.2,
  },
  {
    // 0:40 — los primeros blanquitos, bien pocos, y la primera luz emitida.
    // La línea apaga su brillo acá y desaparece del cuadro, PERO SIGUE
    // EMITIENDO: hasta 0:50 siguen naciendo azules y rojos de una boca
    // invisible, iluminados sólo por esos pocos blancos.
    at: FIRST_WHITE_AT, name: 'PRIMER BLANCO', emissionScale: 0.8,
    materials: [BLUE, RED],
    lamp: { primary: WHITE, secondary: -1, mix: 0 },
    cohesion: 0.18, viscosity: 0.12, bodies: BODIES_DARK, lineEmit: 0,
    exposure: 1.25, light: 0.9,
  },
  {
    // 0:50 — el chorro blanco grande: pocos pero ardiendo (la luz la manda
    // `light`, no la cantidad). Acá se acaba la emisión por curva; el blob
    // blanco atrae al resto y pasea despacio (evento attractor aparte).
    at: WHITE_BURST_AT, name: 'EL BLANCO', emissionScale: 0,
    materials: [BLUE, RED],
    lamp: { primary: WHITE, secondary: -1, mix: 0 },
    cohesion: 0.35, viscosity: 0.15, bodies: BODIES_DARK, lineEmit: 0,
    exposure: 1.2, light: 1,
  },
  {
    // 0:59 — el sonido explota: el blob repele todo (evento aparte) y salen
    // unos blancos más. Suelto y rápido, para que la explosión corra.
    at: EXPLOSION_AT, name: 'EXPLOSIÓN', emissionScale: 0,
    materials: [BLUE, RED],
    lamp: { primary: WHITE, secondary: -1, mix: 0 },
    cohesion: 0.12, viscosity: 0.08, bodies: BODIES_DARK, lineEmit: 0,
    exposure: 1.25, light: 1,
  },
  {
    // 1:01 — pasada la onda expansiva, los materiales se separan en grumos:
    // cohesión alta = mismo material se pega, distinto se aparta. Los blancos
    // se juntan entre ellos en vez de disolverse en la mezcla, y el cuadro
    // deja de estar TODO iluminado — la luz queda en focos, con menos brillo
    // de base, hasta que la unión de 1:10 los junta del todo.
    at: EXPLOSION_AT, offset: 2.2, name: 'GRUMOS DE LUZ', emissionScale: 0,
    materials: [BLUE, RED],
    lamp: { primary: WHITE, secondary: -1, mix: 0 },
    cohesion: 0.78, viscosity: 0.32, bodies: BODIES_DARK, lineEmit: 0,
    exposure: 1.15, light: 0.8,
  },
  {
    // El rojo se vuelve emisivo por primera vez y el blanco deja de serlo. El
    // brillo lo manda el guion: acá la envolvente del track está baja y el
    // rojo tiene que arder. Con `bodies` en 0 lo que no recibe luz desaparece,
    // así que sólo queda lo rojo, y con la cohesión arriba se juntan entre sí.
    at: RED_AT, snap: false, name: 'SÓLO LO ROJO', emissionScale: 0,
    materials: [RED],
    lamp: { primary: RED, secondary: -1, mix: 0 },
    cohesion: 0.9, viscosity: 0.25, bodies: 0, lineEmit: 0,
    exposure: 1.35, light: 0.95,
  },
  {
    // 2:03 — el cierre blanco y quieto. Va en su hora exacta (`snap: false`)
    // porque no reacciona a un golpe: es donde el show se para. La emisión ya
    // está cerrada hace rato; `materials` sólo decide de qué nace lo que se
    // emita a mano en vivo, y acá tiene que ser blanco para que lo que se le
    // tire a la masa se encienda al moverse.
    at: WHITE_STILL_FROM, snap: false, name: 'BLANCO QUIETO', emissionScale: 0,
    materials: [WHITE],
    lamp: { primary: WHITE, secondary: -1, mix: 0 },
    cohesion: STILL_COHESION, viscosity: 1, bodies: 0, lineEmit: 0,
    exposure: 1.2, light: 1,
  },
]);

/**
 * Los golpes más fuertes de la segunda mitad: los momentos en los que el track
 * pide que cambie el comportamiento del fluido, no sólo que salga otra
 * bocanada. Se toman contra el pico global —no contra el vecindario, como los
 * impulsos de emisión— porque acá se buscan los pocos que realmente pegan, y
 * separados entre sí para que cada cambio tenga tiempo de leerse.
 */
export const pickStrongMoments = (
  onsets: AnalysisOnset[],
  from: number,
  options: { spacing?: number; relative?: number } = {},
): AnalysisOnset[] => {
  const spacing = options.spacing ?? 4;
  const relative = options.relative ?? 0.5;
  const pool = onsets.filter((onset) => onset.t >= from);
  if (pool.length === 0) return [];
  const threshold = Math.max(...pool.map((onset) => onset.strength)) * relative;
  const picked: AnalysisOnset[] = [];
  for (const onset of pool) {
    if (onset.strength < threshold) continue;
    const last = picked[picked.length - 1];
    if (last && onset.t - last.t < spacing) {
      // Dentro de la ventana gana el más fuerte: el cambio cae en el golpe.
      if (onset.strength > last.strength) picked[picked.length - 1] = onset;
      continue;
    }
    picked.push(onset);
  }
  return picked;
};

/**
 * Un comportamiento del fluido: cómo se junta, cuánto le cuesta moverse, para
 * dónde cae, cuánto pesa, y qué clase de atractor lo revuelve. El show va
 * rotando entre ellos en los golpes fuertes, así el track no sólo dispara
 * partículas sino que cambia lo que las partículas hacen.
 */
export interface SeedRegime {
  name: string;
  cohesion: number;
  viscosity: number;
  gravity: number;
  /** Multiplicador de masa (`gravitySense`); 0.302 es 1x. */
  sense: number;
  /** 0 atrae · 1 repele · 2 remolino · 3 remolino al revés. */
  mode: number;
  radius: number;
  force: number;
}

export const SHOW_REGIMES: readonly SeedRegime[] = Object.freeze([
  {
    name: 'DISPERSA', cohesion: 0.08, viscosity: 0.04, gravity: 0, sense: 0.302,
    mode: 1, radius: 0.24, force: 1.7,
  },
  {
    name: 'REMOLINO', cohesion: 0.34, viscosity: 0.14, gravity: 0, sense: 0.24,
    mode: 2, radius: 0.32, force: 2,
  },
  {
    // El que pega: atrae fuerte y con la cohesión al mango, así los cuerpos
    // no sólo se acercan sino que quedan pegoteados entre ellos.
    name: 'PEGOTE', cohesion: 1, viscosity: 0.38, gravity: 0.05, sense: 0.85,
    mode: 0, radius: 0.34, force: 2.6,
  },
  {
    name: 'GRUMOS', cohesion: 0.88, viscosity: 0.3, gravity: 0.18, sense: 0.45,
    mode: 0, radius: 0.16, force: 1.5,
  },
  {
    // Rápido y suelto: un latigazo de remolino con el fluido casi sin freno.
    name: 'LÁTIGO', cohesion: 0.05, viscosity: 0.02, gravity: 0, sense: 0.15,
    mode: 2, radius: 0.42, force: 2.4,
  },
  {
    name: 'FLOTA', cohesion: 0.5, viscosity: 0.55, gravity: -0.3, sense: 0.12,
    mode: 3, radius: 0.28, force: 1.2,
  },
  {
    name: 'CAE', cohesion: 0.22, viscosity: 0.07, gravity: 0.55, sense: 0.62,
    mode: 0, radius: 0.2, force: 1.1,
  },
]);

/** Desde acá el track manda el comportamiento, no sólo la emisión. */
const STRONG_FROM = 30;
/** Los flashes blancos de pantalla entera recién desde acá (1:25 es 85). */
const FLASHES_FROM = 84;
/**
 * Giro de la línea en cada golpe fuerte, ciclando: la línea baila. El tamaño
 * NO salta con los golpes: lo que le pasa al largo es el encogido por emisión
 * que pone el director — se achica rápido con cada chorro y vuelve suave.
 */
const LINE_SPINS = [1, 0.15, 0.6, 0.85, 0.35] as const;

/**
 * Adelanta un momento al arranque de su sonido. El detector de onsets marca el
 * pico, pero un pasaje que crece —el de 1:06— se escucha desde que la
 * envolvente empieza a subir, y un cambio parado en el pico llega 1.3 s tarde.
 * Se camina el flujo hacia atrás (hasta 2 s) buscando dónde cruzó el 35 % del
 * nivel del pico: un golpe seco casi no se mueve, una subida se adelanta a su
 * comienzo. Si la envolvente nunca baja de ese umbral es un sonido sostenido,
 * no hay "arranque", y el momento se queda donde estaba.
 */
export const anchorToRise = (env: number[], rate: number, t: number): number => {
  const peakIndex = Math.max(0, Math.min(env.length - 1, Math.round(t * rate)));
  const threshold = env[peakIndex] * 0.35;
  const floorIndex = Math.max(0, Math.round((t - 2) * rate));
  let index = peakIndex;
  while (index > floorIndex && env[index - 1] >= threshold) index -= 1;
  if (index <= floorIndex) return t;
  return index / rate;
};

/** Ruido determinista 0..1: la misma siembra da siempre el mismo lugar. */
const hash = (value: number): number => {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const nearestImpulse = (impulses: AnalysisOnset[], t: number): number => {
  if (impulses.length === 0) return t;
  let best = impulses[0].t;
  for (const impulse of impulses) {
    if (Math.abs(impulse.t - t) < Math.abs(best - t)) best = impulse.t;
  }
  return best;
};

/** El primer golpe desde `t` (con una tolerancia mínima): nunca antes de `t`. */
const nextImpulseFrom = (impulses: AnalysisOnset[], t: number): number => {
  for (const impulse of impulses) {
    if (impulse.t >= t - 0.05) return impulse.t;
  }
  return t;
};

/**
 * El golpe **audible** más fuerte alrededor de una hora: grave o medio, dentro
 * de la ventana. El más cercano en tiempo puede ser un onset débil que cayó al
 * lado del boom de verdad —el chorro blanco caía en un golpecito de 0.375 a
 * 0:50.14 en vez del boom de 0.905 de 0:49.85— y un chorro que no cae en el
 * golpe que se escucha se siente fuera de sincro.
 */
const loudestImpulseAround = (
  impulses: AnalysisOnset[],
  t: number,
  window = 2,
): number => {
  let best: AnalysisOnset | null = null;
  for (const impulse of impulses) {
    if (Math.abs(impulse.t - t) > window) continue;
    if (impulse.band === 'high') continue;
    if (!best || impulse.strength > best.strength) best = impulse;
  }
  return best ? best.t : nearestImpulse(impulses, t);
};

/**
 * Los CHORROS de una curva de emisión: dónde arranca a subir cada uno y dónde
 * llega a su pico.
 *
 * Se leen de la curva y no de los impulsos del análisis porque la curva puede
 * estar dibujada a mano —la primera parte del show lo está— y todo lo que se
 * cuelga de un chorro (de qué color nace) tiene que caer donde el chorro está
 * de verdad, no donde el análisis creería que está.
 */
export const emissionBursts = (
  curve: Curve,
  minPeak = 0.18,
): Array<{ rise: number; peak: number }> => {
  const keys = curve.keys;
  const out: Array<{ rise: number; peak: number }> = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key.v < minPeak) continue;
    const before = keys[index - 1]?.v ?? 0;
    const after = keys[index + 1]?.v ?? 0;
    // El pico de un chorro: más alto que sus dos vecinos. Una meseta (dos
    // keys iguales seguidas) cuenta una sola vez, por el `>=` de la derecha.
    if (!(key.v > before && key.v >= after)) continue;
    // El arranque es la key anterior si está abajo; si no, el pico mismo.
    const rise = before < key.v * 0.6 ? (keys[index - 1]?.t ?? key.t) : key.t;
    const last = out[out.length - 1];
    if (last && key.t - last.peak < 0.2) {
      if (key.v > 0) out[out.length - 1] = { rise: last.rise, peak: key.t };
      continue;
    }
    out.push({ rise: Math.min(rise, key.t), peak: key.t });
  }
  return out;
};

/**
 * Keys sostenidas a partir de pares sueltos. Ordena y deduplica porque las
 * curvas de comportamiento reciben keys de dos fuentes —los tramos del guion y
 * los golpes fuertes— y dos keys en el mismo instante harían que el sampleo
 * devolviera la primera y se perdiera el cambio.
 */
const holdKeys = (points: Array<[number, number]>): Curve => {
  const keys: CurveKey[] = [];
  for (const [t, v] of [...points].sort((a, b) => a[0] - b[0])) {
    const last = keys[keys.length - 1];
    if (last && t <= last.t + 1e-4) {
      last.v = v;
      continue;
    }
    keys.push({ t, v, shape: 'hold' });
  }
  return { keys };
};

export const seedShowDoc = (analysis: FluidsAnalysis, options: SeedOptions = {}): ShowDoc => {
  const maxKeys = Math.max(4, Math.round(options.maxKeys ?? 48));
  const doc = emptyDoc(analysis.duration);
  // La paleta del show: el "azul" es casi negro (con un dejo azul). Son los
  // cuerpos oscuros del cuadro — ocluyen y hacen sombra — y el color pleno
  // quedaba pintado aunque nadie los iluminara. Desde la PALETA se cambia.
  doc.materialColors = [0xffffff, 0xff0000, 0x07080d, 0x8a8894];
  const rate = analysis.envelopeRate;
  const impulses = pickImpulses(analysis.onsets, options.impulses);

  // Los tres momentos blancos se enganchan a su boom audible: el impulso
  // grave/medio más fuerte del pasaje, no el onset que caiga más cerca del
  // reloj — el más cercano puede ser un golpecito y el chorro se sentiría
  // fuera de sincro.
  // El primero va JUSTO en 0:42 —el golpe más cercano, no el más fuerte del
  // pasaje, que acá caería un segundo tarde.
  const firstWhiteAt = nearestImpulse(impulses, FIRST_WHITE_AT);
  const whiteBurstAt = loudestImpulseAround(impulses, WHITE_BURST_AT);
  const explosionAt = loudestImpulseAround(impulses, EXPLOSION_AT);
  const lightGatherAt = nearestImpulse(impulses, LIGHT_GATHER_AT);
  const whiteSnaps = new Map<number, number>([
    [FIRST_WHITE_AT, firstWhiteAt],
    [WHITE_BURST_AT, whiteBurstAt],
    [EXPLOSION_AT, explosionAt],
  ]);

  // Cada tramo del guion arranca en el golpe más cercano a su hora: así el
  // cambio de color o el apagón caen sobre un impulso y no en el aire. Los
  // tramos blancos se enganchan a su mismo boom, o quedarían corridos de lo
  // que se escucha.
  // El rojo va en su hora exacta, no en un golpe: ver `RED_AT`.
  const redAt = RED_AT;
  const stages = SHOW_SCRIPT.map((stage, index) => ({
    ...stage,
    at: index === 0
      ? 0
      : stage.snap === false
        ? stage.at
        : (whiteSnaps.get(stage.at) ?? nearestImpulse(impulses, stage.at))
          + (stage.offset ?? 0),
  }));
  const stageAt = (t: number): typeof stages[number] => {
    let current = stages[0];
    for (const stage of stages) {
      if (stage.at <= t) current = stage;
    }
    return current;
  };

  // Emisión por impulsos: cada golpe que se escucha escupe su chorro, con la
  // altura que le da su tramo, y entre golpe y golpe la línea calla. Es lo que
  // hace que la imagen suene, en vez de emitir parejo por debajo. El chorro
  // blanco la cierra: después de eso la curva queda en cero para siempre.
  // La emisión es SOLO por impulsos: cada golpe escupe y entre golpes calla.
  // Un piso continuo que seguía al volumen se probó y era un desastre —
  // emitía parejo desde el segundo cero y se gastaba el techo temprano. Los
  // pasajes que suenan sin onsets (0:02-0:13, 0:34-0:37) entran como golpes
  // BLANDOS: máximos locales de la envolvente, sumados como impulsos sueltos.
  // Y los huecos que el umbral relativo dejó entre 0:20 y el chorro blanco se
  // rellenan con los golpes crudos que ahí quedaron afuera: ese tramo suena
  // todo el tiempo y la línea no puede estar muda tres segundos seguidos.
  const sounded = [...impulses, ...swellImpulses(analysis, impulses)]
    .sort((a, b) => a.t - b.t);
  // Y antes de dibujar la curva, dos pasadas más: adelgazar —un chorro cada
  // 0.6 s como mucho, el más fuerte de su ventana; setenta y cuatro picos en
  // cincuenta segundos no son golpes, son una cerca— y pesar cada uno por lo
  // fuerte que suena su pasaje, para que la población se vaya en los golpes
  // que se escuchan y no en los golpecitos del arranque.
  // De 0:35 en adelante la regla automática sigue mandando; de 0:00 a 0:35
  // manda la lista de Manuel y nada más.
  const automatic = weighImpulses(
    analysis,
    thinImpulses(
      [
        ...sounded,
        ...gapImpulses(analysis, sounded, GAP_FILL_FROM, whiteBurstAt),
        // Y los lomos del volumen: donde el track pega fuerte, emite, tenga
        // ataque detectable o no.
        ...loudImpulses(analysis, 0, whiteBurstAt),
      ].sort((a, b) => a.t - b.t),
      EMIT_SPACING,
    ),
    whiteBurstAt,
  );
  const emitImpulses = [
    ...FIRST_PART_HITS.map((target, index) => {
      // El golpe más fuerte cerca de la hora dibujada; entre dos igual de
      // fuertes gana el más cercano, o dos marcas vecinas se enganchan al
      // MISMO golpe y se pierde una (pasa con 0:00.7 y 0:01.5, que tienen dos
      // golpes de fuerza plena entre medio). Si no hay ninguno, la hora tal
      // cual. Y nunca antes de la marca anterior.
      const floorAt = index > 0 ? FIRST_PART_HITS[index - 1] : -Infinity;
      let best: AnalysisOnset | null = null;
      for (const onset of analysis.onsets) {
        if (Math.abs(onset.t - target) > FIRST_PART_SNAP) continue;
        if (onset.t <= floorAt) continue;
        const better = !best
          || onset.strength > best.strength + 1e-9
          || (Math.abs(onset.strength - best.strength) < 1e-9
            && Math.abs(onset.t - target) < Math.abs(best.t - target));
        if (better) best = onset;
      }
      return {
        t: best ? best.t : target,
        // Chorro pleno: los diez son los momentos del pasaje, no hay que
        // pesarlos contra nada. Son pocos y grandes, que es lo pedido.
        strength: 1,
        band: best?.band ?? 'low',
        shares: best?.shares ?? { low: 1, mid: 0, high: 0 },
      } as AnalysisOnset;
    }),
    ...automatic.filter((impulse) => impulse.t >= FIRST_PART_UNTIL),
  ].sort((a, b) => a.t - b.t);
  doc.curves.emission = options.keepEmission ?? closeEmissionAt(
    emissionImpulseCurve(emitImpulses, options.emission, (t) => stageAt(t).emissionScale),
    whiteBurstAt,
  );

  // El brillo de lo que emite lo pone el flujo del track mientras la luz es la
  // línea; desde que hay partículas emisivas lo manda el guion, porque ahí la
  // envolvente está baja y el color tiene que arder igual.
  const lightEmission = envelopeCurve({
    envelope: analysis.envelopes.flux,
    rate,
    smoothSeconds: 0.7,
    lo: 0.2,
    hi: 0.9,
    maxKeys,
  });
  const scriptedLight = stages.filter((stage) => stage.light !== undefined);
  if (scriptedLight.length > 0) {
    const from = scriptedLight[0].at;
    const fluxKeys = lightEmission.keys;
    const kept = fluxKeys.filter((key) => key.t < from);
    for (const stage of scriptedLight) {
      kept.push({ t: stage.at, v: stage.light as number, shape: 'hold' });
    }
    const lightBaseAt = (t: number): number => {
      let base = scriptedLight[0].light as number;
      for (const stage of scriptedLight) {
        if (stage.at <= t) base = stage.light as number;
      }
      return base;
    };
    // El latido: entre el chorro grande y el rojo, la luz emitida respira con
    // el flujo del track — entre el 80 % de la base del guion y el máximo. El
    // brillo late con lo que suena, sin apagar nunca a los blancos; de 1:20
    // en adelante el rojo queda firme, que fue lo pedido.
    for (const key of fluxKeys) {
      if (key.t <= whiteBurstAt + 1.2 || key.t >= 79) continue;
      if (stages.some((stage) => Math.abs(stage.at - key.t) < 0.1)) continue;
      const fluxN = clamp((key.v - 0.2) / 0.7, 0, 1);
      kept.push({
        t: key.t,
        v: clamp(lightBaseAt(key.t) * (0.8 + 0.3 * fluxN), 0, 1),
        shape: 'smooth',
      });
    }
    kept.sort((a, b) => a.t - b.t);
    lightEmission.keys = kept;
  }
  doc.curves.lightEmission = lightEmission;
  /**
   * Los golpes fuertes del track, de 0:30 en adelante, cambian el
   * comportamiento del fluido. Del rojo en adelante se limitan a los
   * regímenes que juntan, porque ahí lo pedido es que las rojas se atraigan
   * entre ellas: cambia cómo se mueven, no que dejen de juntarse. El corte se
   * mide contra el rojo y no contra el último tramo del guion, que desde el
   * cierre blanco de 2:03 cae después de que los golpes ya dejaron de mandar.
   */
  // El flujo suavizado, para anclar cada cambio al arranque de su sonido.
  const fluxSmooth = smoothEnvelope(analysis.envelopes.flux, rate, 0.25);
  // Los golpes dejan de mandar en la juntada final: de ahí en adelante el
  // cierre es un solo gesto, no una reacción por golpe.
  const rawMoments = pickStrongMoments(analysis.onsets, STRONG_FROM)
    .filter((onset) => onset.t < GATHER_FROM);
  // El golpe conserva su fuerza, pero el cambio cae donde el sonido empieza,
  // no en su pico — salvo que el adelanto lo amontone contra el cambio
  // anterior: ahí se queda en su golpe.
  const anchoredTimes: number[] = [];
  for (const onset of rawMoments) {
    let t = anchorToRise(fluxSmooth, rate, onset.t);
    const previous = anchoredTimes[anchoredTimes.length - 1];
    if (previous !== undefined && t - previous < 2.5) t = onset.t;
    anchoredTimes.push(t);
  }
  const moments = rawMoments.map((onset, index) => {
    const pool = onset.t >= redAt
      ? SHOW_REGIMES.filter((regime) => regime.cohesion >= 0.45)
      : SHOW_REGIMES;
    return {
      onset: { ...onset, t: anchoredTimes[index] },
      regime: pool[index % pool.length],
    };
  });

  // Lo que el guion dicta a saltos va como keys sostenidas: entre tramos no
  // hay rampa, el cambio es en el golpe. Las curvas de comportamiento suman
  // además las de los golpes fuertes.
  const stageKeys = (pick: (stage: typeof stages[number]) => number): Array<[number, number]> => (
    stages.map((stage) => [stage.at, pick(stage)] as [number, number])
  );
  const momentKeys = (pick: (regime: SeedRegime) => number): Array<[number, number]> => (
    moments.map(({ onset, regime }) => [onset.t, pick(regime)] as [number, number])
  );
  doc.curves.cohesion = holdKeys([
    ...stageKeys((stage) => stage.cohesion),
    ...momentKeys((regime) => regime.cohesion),
    // La juntada sube la cohesión; el cierre la BAJA. Ver `STILL_COHESION`:
    // atascada del todo, la masa hierve en el lugar y no se apaga nunca.
    [GATHER_FROM, 0.95],
    [STICK_FROM, STILL_COHESION],
  ]);
  // Desde 1:35 la viscosidad tiene piso alto: los blobs se alentan, y ese
  // freno es lo que deja leer el cambio de intensidad de la luz — moviéndose
  // demasiado, el brillo por velocidad queda clavado arriba y no se marca.
  doc.curves.viscosity = holdKeys([
    ...stageKeys((stage) => stage.viscosity),
    ...momentKeys((regime) => regime.viscosity).map(([t, v]) => (
      [t, t >= CALM_FROM ? Math.max(v, 0.55) : v] as [number, number]
    )),
    [CALM_FROM, 0.55],
    // El cierre frena casi del todo, y rápido: es donde se mira el detalle
    // de la luz. La juntada ya viene frenando fuerte.
    [GATHER_FROM, 0.75],
    [STICK_FROM, 1],
  ]);
  // La gravedad nunca queda prendida: sólo existe como pulso cuando suena un
  // golpe fuerte cuyo régimen la pide, y en segundos vuelve a cero. Una
  // escena con gravedad sostenida se vacía hacia un borde y se muere.
  const gravityKeys: CurveKey[] = [];
  for (const { onset, regime } of moments) {
    if (Math.abs(regime.gravity) < 0.01) continue;
    gravityKeys.push({ t: Math.max(0, onset.t - 0.02), v: 0, shape: 'linear' });
    gravityKeys.push({ t: onset.t, v: regime.gravity, shape: 'linear' });
    gravityKeys.push({ t: onset.t + GRAVITY_PULSE_SECONDS, v: 0, shape: 'hold' });
  }
  doc.curves.gravity = { keys: gravityKeys };
  doc.curves.gravitySense = holdKeys(momentKeys((regime) => regime.sense));
  doc.curves.bodies = holdKeys(stageKeys((stage) => stage.bodies));
  doc.curves.lineEmit = holdKeys(stageKeys((stage) => stage.lineEmit));
  // Cambios por sector: los cortes estructurales del track también se ven.
  // Entre el chorro y el rojo cada sector ajusta la exposición (alternando,
  // sutil); de 1:20 en adelante la exposición la manda el guion.
  const sectionAccents: Array<[number, number]> = analysis.sections
    .map((section) => section.t)
    .filter((t) => t > WHITE_BURST_AT + 1 && t < 79)
    .map((t, index) => [t, index % 2 === 0 ? 1.32 : 1.18]);
  doc.curves.exposure = holdKeys([
    ...stageKeys((stage) => stage.exposure),
    ...sectionAccents,
  ]);

  // La línea baila con los golpes fuertes desde el arranque: cambia el giro y
  // el largo en cada uno, ciclando, hasta que el chorro blanco la apaga. Es
  // la parte dinámica de los primeros 30 s, donde el comportamiento del
  // fluido todavía lo dicta el guion y no el track.
  const lineMoments = pickStrongMoments(analysis.onsets, 0)
    .filter((onset) => onset.t < firstWhiteAt - 0.5);
  doc.curves.lineSpin = holdKeys([
    [0, 0.286],
    ...lineMoments.map(
      (onset, index) => [onset.t, LINE_SPINS[index % LINE_SPINS.length]] as [number, number],
    ),
  ]);

  const events: ShowEvent[] = [];
  let serial = 0;
  const push = (event: Omit<ShowEvent, 'id'>): void => {
    serial += 1;
    events.push({ ...event, id: `seed-${event.type}-${serial}` });
  };

  const setLamp = (t: number, lamp: SeedStage['lamp'], fade = 0): void => push({
    t,
    dur: 0.1,
    type: 'set-lamp',
    intensity: 1,
    params: {
      primary: lamp.primary,
      // 4 es "ninguno": el motor sólo puede prender dos materiales a la vez.
      secondary: lamp.secondary < 0 ? 4 : lamp.secondary,
      mix: lamp.mix,
      // 0 = el cruce lo decide la separación entre cambios. Va escrito
      // SIEMPRE, aunque sea cero: `parseShowDoc` rellena los params que
      // falten con su default y el round-trip de persistencia falla por la
      // diferencia.
      fade,
    },
  });

  for (const stage of stages) {
    // El cierre blanco cruza lento; todo lo demás corta.
    setLamp(stage.at, stage.lamp, stage.at === WHITE_STILL_FROM ? WHITE_STILL_FADE : 0);
  }

  // 1:35 suena distinto y se ve distinto: la luz roja se corta a negro y por
  // un instante vuelven a arder las blancas, antes de devolverle el cuadro
  // al rojo. Un parpadeo largo, no un flash.
  setLamp(BLINK_AT, { primary: LAMP_NONE, secondary: -1, mix: 0 });
  setLamp(BLINK_AT + 0.45, { primary: WHITE, secondary: -1, mix: 0 });
  setLamp(BLINK_WHITE_UNTIL, { primary: RED, secondary: -1, mix: 0 });

  // Y más apagones como ése, repartidos: en golpes fuertes elegidos la luz se
  // corta a negro un instante y vuelve — el "todo más oscuro" que funciona en
  // 1:35 — siempre pegado al atractor que ya vive en ese golpe.
  for (const target of DARK_BLINKS) {
    // Sobre el momento fuerte si lo hay (ahí ya vive un atractor); si el
    // golpe cae en la juntada final —donde los momentos no corren— el
    // apagón se engancha solo al impulso.
    const moment = moments.find(({ onset }) => Math.abs(onset.t - target) < 2.5);
    const t = moment ? moment.onset.t : nearestImpulse(impulses, target);
    if (Math.abs(t - target) > 2.5) continue;
    const back = t >= redAt ? RED : WHITE;
    setLamp(t, { primary: LAMP_NONE, secondary: -1, mix: 0 });
    setLamp(t + 0.4, { primary: back, secondary: -1, mix: 0 });
  }

  // Estrobos de ILUMINACIÓN. No son los `strobe-lines` (esos rayan la
  // pantalla): acá lo que estrobea es la lámpara. El blanco prende y apaga a
  // 9 Hz durante 0.9 s y al final la luz cae en el color que manda el guion.
  // El cruce de emisor se acorta solo contra la separación de los cambios
  // (ver `lampGapAt`), así que esto se ve como estrobo y no como un fundido.
  for (const strobe of LAMP_STROBES) {
    const near = nearestImpulse(impulses, strobe.at);
    const at = Math.abs(near - strobe.at) < 1.2 ? near : strobe.at;
    const until = at + strobe.seconds;
    const back = at >= redAt ? RED : WHITE;
    // Los ataques de la ventana, medidos contra el más fuerte de la ventana
    // (no contra el track entero: adentro de un pasaje tranquilo el estrobo
    // igual tiene que seguir lo que ahí se escucha).
    const inside = analysis.onsets.filter((onset) => onset.t >= at && onset.t < until);
    const loudest = Math.max(0.001, ...inside.map((onset) => onset.strength));
    const sparks: number[] = [];
    for (const onset of inside) {
      if (onset.strength < loudest * LAMP_STROBE_GATE) continue;
      const last = sparks[sparks.length - 1];
      // Nunca dos chispas más juntas que su propio destello.
      if (last !== undefined && onset.t - last < LAMP_STROBE_FLASH * 1.3) continue;
      sparks.push(onset.t);
    }
    sparks.forEach((t, index) => {
      const next = sparks[index + 1] ?? until;
      setLamp(t, { primary: WHITE, secondary: -1, mix: 0 });
      setLamp(Math.min(t + LAMP_STROBE_FLASH, next - 0.01), LAMP_OFF);
    });
    setLamp(until, { primary: back, secondary: -1, mix: 0 });
  }

  // Antes acá había un corte a negro medio segundo antes de 2:03, para que el
  // cambio se leyera como un corte. Se pidió lo contrario: que la luz PASE de
  // las rojas a las blancas, y despacio. Así que el negro se fue y el tramo
  // cruza directo con su `fade` de dos segundos — las dos masas encendidas a
  // la vez, la roja apagándose y los grumos blancos prendiendo.

  // 1:23.09 — la chispa que marca el tick de 23 ms: la lámpara pasa al blanco
  // 70 ms y vuelve al rojo. Un solo destello, no un estrobo.
  setLamp(HIGH_TICK_AT, { primary: WHITE, secondary: -1, mix: 0 });
  setLamp(HIGH_TICK_AT + HIGH_TICK_SECONDS, { primary: RED, secondary: -1, mix: 0 });

  // Los chorros blancos son eventos y no tramos de la curva: la curva de
  // emisión se dibuja a mano, y estos chorros tienen que salir igual. El
  // caudal de la curva les reserva su cuota del techo de población. Tres, y
  // chicos: la luz la pone `light`, no la cantidad de blancas.
  push({
    t: firstWhiteAt,
    dur: 0.8,
    type: 'emit-burst',
    intensity: 1,
    params: { material: WHITE, count: FIRST_WHITE_COUNT },
  });
  push({
    t: whiteBurstAt,
    dur: WHITE_BURST_SECONDS,
    type: 'emit-burst',
    intensity: 1,
    params: { material: WHITE, count: WHITE_BURST_COUNT },
  });
  push({
    t: explosionAt,
    dur: 0.9,
    type: 'emit-burst',
    intensity: 1,
    params: { material: WHITE, count: EXPLOSION_WHITE_COUNT },
  });

  // Y el refuerzo de 2:02: más blancas para el cierre, que es donde son lo
  // único visible y se pasan treinta segundos trabajando.
  push({
    t: WHITE_TOPUP_AT,
    dur: 1,
    type: 'emit-burst',
    intensity: 1,
    params: { material: WHITE, count: WHITE_TOPUP_COUNT },
  });

  // El refuerzo de 2:00, para todo el final.
  push({
    t: WHITE_FINAL_AT,
    dur: 1,
    type: 'emit-burst',
    intensity: 1,
    params: { material: WHITE, count: WHITE_FINAL_COUNT },
  });

  // Y la última: el cierre se come blancas todo el rato y el final las pide.
  push({
    t: WHITE_LAST_AT,
    dur: WHITE_LAST_SECONDS,
    type: 'emit-burst',
    intensity: 1,
    params: { material: WHITE, count: WHITE_LAST_COUNT },
  });

  // Apenas nace, el primer blob blanco es un atractor FUERTE: junta al resto
  // alrededor de la primera luz, paseando apenas, hasta el chorro grande.
  push({
    t: firstWhiteAt + 0.1,
    dur: Math.max(1, whiteBurstAt - firstWhiteAt - 0.15),
    type: 'attractor',
    intensity: 1,
    params: { mode: 0, x: 0.5, y: 0.5, radius: 0.3, force: 2.4, wander: 0.1, sustain: 0.6, soft: 0 },
  });
  // El apagón de 0:50 es VIOLENTO mientras dura su bloque de sonido (~3 s):
  // una atracción brutal y un remolino encima, revolviendo lo que el chorro
  // acaba de escupir. Después afloja: atracción suave paseando hasta que el
  // sonido explota en 0:59 y lo repele todo.
  push({
    t: whiteBurstAt + 0.2,
    dur: WHITE_BLOCK_SECONDS,
    type: 'attractor',
    intensity: 1,
    params: { mode: 0, x: 0.5, y: 0.5, radius: 0.4, force: 2.7, wander: 0.08, sustain: 0.7, soft: 0 },
  });
  push({
    t: whiteBurstAt + 0.35,
    dur: WHITE_BLOCK_SECONDS - 0.3,
    type: 'attractor',
    intensity: 1,
    params: { mode: 2, x: 0.5, y: 0.5, radius: 0.45, force: 2.2, wander: 0.06, sustain: 0.5, soft: 0 },
  });
  push({
    t: whiteBurstAt + WHITE_BLOCK_SECONDS + 0.3,
    dur: Math.max(1, explosionAt - whiteBurstAt - WHITE_BLOCK_SECONDS - 0.4),
    type: 'attractor',
    intensity: 1,
    params: { mode: 0, x: 0.5, y: 0.5, radius: 0.34, force: 1.4, wander: 0.12, sustain: 0.6, soft: 0 },
  });
  push({
    t: explosionAt,
    dur: 1.4,
    type: 'attractor',
    intensity: 1,
    // Radio grande y un paseo mínimo: la onda expansiva alcanza al blob esté
    // donde esté de su óvalo.
    params: { mode: 1, x: 0.5, y: 0.5, radius: 0.42, force: 2.6, wander: 0.03, sustain: 0, soft: 0 },
  });

  // Y un atractor por golpe fuerte, del tipo que pida su régimen: el track no
  // sólo dispara partículas, también decide qué hacen. En los golpes que
  // realmente revientan sale un segundo atractor espejado: dos puntos
  // tirando a la vez parten el fluido en dos comportamientos visibles.
  moments.forEach(({ onset, regime }, index) => {
    const x = 0.16 + hash(onset.t * 3.7) * 0.68;
    const y = 0.22 + hash(onset.t * 9.1 + 4.2) * 0.56;
    // En la segunda mitad se alternan tirones secos con atractores LARGOS:
    // sostienen la fuerza (y pasean) durante varios segundos, para que entre
    // golpe y golpe siga pasando algo — cortos solos, la mitad quedaba muerta.
    // Y desde 1:35 todos son de la calma: lentos, suaves y respirados.
    // Adentro de la unión de la luz (1:10 - 1:20) el show es un solo gesto:
    // los tirones por golpe no corren ahí.
    if (onset.t >= lightGatherAt - 0.5 && onset.t < redAt) return;
    const calm = onset.t >= CALM_FROM;
    const long = onset.t >= 60 && index % 2 === 1;
    push({
      // Corto y fuerte como el golpe, o largo y sostenido: el ataque siempre
      // es inmediato (lo pone el director) — salvo en la calma, que respira.
      t: onset.t,
      dur: calm ? 5 + regime.viscosity * 2
        : (long ? 4.2 + regime.viscosity * 2.5 : 1.1 + regime.viscosity * 1.6),
      type: 'attractor',
      intensity: clamp(0.55 + onset.strength * 0.45, 0, 1),
      params: {
        // En la calma se alternan la atracción y un remolino suave: sigue
        // habiendo juego, pero respirado.
        mode: calm ? (index % 2 === 0 ? 0 : 2) : regime.mode, x, y,
        radius: calm ? regime.radius * 1.3 : regime.radius,
        force: calm
          ? Math.min(1, regime.force * 0.4)
          : Math.min(3, regime.force * (0.75 + onset.strength * 0.5)),
        // Todos pasean: un atractor clavado donde no hay nada no captura;
        // barriendo, cruza fluido sí o sí. Los largos barren más ancho.
        wander: long || calm ? 0.13 : 0.06,
        sustain: long && !calm ? 0.55 : 0,
        soft: calm ? 1 : 0,
      },
    });
    if (onset.strength < 0.85 || calm) return;
    push({
      t: onset.t + 0.12,
      dur: 1 + regime.viscosity * 1.4,
      type: 'attractor',
      intensity: clamp(0.45 + onset.strength * 0.4, 0, 1),
      params: {
        mode: regime.mode,
        x: clamp(1 - x, 0.16, 0.84),
        y: clamp(1 - y, 0.22, 0.78),
        radius: regime.radius * 0.85,
        force: regime.force * 0.8,
        wander: 0.06,
        sustain: 0,
        soft: 0,
      },
    });
  });

  // Los gestos de la primera parte: uno por cada chorro de Manuel entre 0:14
  // y 0:34. El fluido se abre, se revuelve o se junta con el golpe — sin
  // esto, en ese tramo sonaban los chorros y no pasaba nada más.
  emitImpulses
    .filter((impulse) => impulse.t >= FIRST_PART_GESTURES_FROM
      && impulse.t < FIRST_PART_GESTURES_UNTIL)
    // Nunca encima de un cambio de régimen que ya viva ahí (desde 0:30).
    .filter((impulse) => !moments.some(({ onset }) => Math.abs(onset.t - impulse.t) < 1.5))
    .forEach((impulse, index) => {
      const mode = FIRST_PART_MODES[index % FIRST_PART_MODES.length];
      push({
        // Justo en el golpe, con el chorro: el gesto y las partículas nuevas
        // son la misma cosa.
        t: impulse.t,
        dur: 1.3 + hash(impulse.t * 2.3) * 0.7,
        type: 'attractor',
        intensity: 1,
        params: {
          mode,
          // Alrededor de la boca de la línea, que es de donde sale el chorro.
          x: 0.34 + hash(impulse.t * 4.7) * 0.32,
          y: 0.32 + hash(impulse.t * 8.9 + 1.7) * 0.36,
          // El que junta trabaja ancho; los que abren y revuelven, apretados.
          radius: mode === 0 ? 0.42 : 0.24,
          force: mode === 0 ? 1.6 : 2.1,
          wander: 0.08,
          sustain: 0,
          soft: 0,
        },
      });
    });

  // LAS FRACTURAS: una grieta por golpe, con la forma del sonido de cada uno.
  // Cada una engancha a su chorro real (los de `FIRST_PART_HITS`, ya
  // snapeados al golpe), no a la hora de la tabla.
  const fractureTimes: number[] = [];
  // Los picos con los que después se DIBUJA la curva del quiebre: los cinco
  // golpes grandes a fuerza plena y cada crujido con la suya.
  const breakSpikes: Array<{ t: number; dur: number; jolt: number }> = [];
  for (const fracture of FRACTURES) {
    const burst = emitImpulses.reduce(
      (best, impulse) => (Math.abs(impulse.t - fracture.at) < Math.abs(best - fracture.at)
        ? impulse.t
        : best),
      Number.POSITIVE_INFINITY,
    );
    const at = Number.isFinite(burst) && Math.abs(burst - fracture.at) < 1 ? burst : fracture.at;
    fractureTimes.push(at);
    // Alrededor de la boca de la línea: la grieta sale de donde nace el
    // chorro, no de un lugar cualquiera.
    const mouthX = 0.5 + (hash(at * 5.1) - 0.5) * 0.22;
    const mouthY = 0.5 + (hash(at * 9.3 + 2.1) - 0.5) * 0.2;
    push({
      t: at,
      dur: fracture.dur,
      type: 'fracture',
      intensity: 1,
      params: {
        x: mouthX,
        y: mouthY,
        angle: fracture.angle,
        length: fracture.length,
        force: fracture.force,
        shards: fracture.shards,
        crackle: fracture.crackle,
      },
    });
    breakSpikes.push({ t: at, dur: fracture.dur, jolt: 1 });
    // LOS CRUJIDOS. Una rama no se quiebra de una: cruje en una ráfaga de
    // micro-ataques discretos, y el análisis los tiene — el quiebre de 0:29
    // son DOCE onsets en un segundo (28.83, 28.98, 29.09, 29.20, 29.32,
    // 29.42...), el de 0:14 son nueve. Cada uno entra como una fractura de
    // FUERZA CERO: al solver no le hace nada (el director corta el evento en
    // `force <= 0.001`), pero a la LÍNEA le pega — cada crujido sacude las
    // astillas y las vuelve a apuntar a cualquier lado. Es literal lo pedido:
    // "eso son los sonidos".
    const cracks = analysis.onsets
      .filter((onset) => onset.t >= at - 0.35 && onset.t <= at + fracture.dur + 0.3)
      .filter((onset) => Math.abs(onset.t - at) > 0.04)
      // Un tick de fuerza 0.07 es el gemido de la rama, no un crujido: está
      // apenas sobre el fondo y NO puede sacudir nada — se pidió explícito
      // que en el silencio (la nota grave constante) los palitos no vibren.
      // La cola de 0:19 (seis ticks de 0.01-0.10) se va entera con esto.
      .filter((onset) => onset.strength >= 0.12)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 12)
      .sort((a, b) => a.t - b.t);
    let prevCrack = Number.NEGATIVE_INFINITY;
    for (const crack of cracks) {
      // Dos crujidos a menos de 50 ms son el mismo chasquido.
      if (crack.t - prevCrack < 0.05) continue;
      prevCrack = crack.t;
      push({
        t: crack.t,
        dur: 0.35,
        type: 'fracture',
        // El golpe manda el tamaño de la sacudida, con piso: un crujido
        // chiquito también sacude, sólo que menos.
        intensity: clamp(0.2 + 0.8 * crack.strength, 0, 1),
        params: {
          x: mouthX,
          y: mouthY,
          angle: fracture.angle,
          // El mínimo del spec: sin fuerza, el largo no juega.
          length: 0.1,
          force: 0,
          // Las astillas y el crujido son los del quiebre padre: el conteo
          // de astillas y el ritmo del destello no cambian a mitad de rama.
          shards: fracture.shards,
          crackle: fracture.crackle,
        },
      });
      breakSpikes.push({ t: crack.t, dur: 0.35, jolt: clamp(0.2 + 0.8 * crack.strength, 0, 1) });
      // Y EL TIRÓN: cada crujido también AGARRA el fluido — una atracción
      // corta y PEGADA al golpe (`soft` 0: ataque de 70 ms) que junta lo de
      // alrededor hacia la rajadura, y lo SUELTA en cuanto el ruido pasa
      // (`sustain` 0: cae en cuadrática y el evento muere a los 0.5 s). En
      // el silencio entre ráfagas no queda nada tirando: se pidió explícito
      // que el fluido se mueva CON los glitches y quede libre cuando no
      // suena.
      push({
        t: crack.t,
        dur: 0.5,
        type: 'attractor',
        intensity: clamp(0.2 + 0.8 * crack.strength, 0, 1),
        params: {
          mode: 0,
          x: clamp(mouthX + (hash(crack.t * 7.7) - 0.5) * 0.1, 0, 1),
          y: clamp(mouthY + (hash(crack.t * 3.9 + 1.3) - 0.5) * 0.1, 0, 1),
          radius: 0.35,
          force: 1.5,
          wander: 0.03,
          sustain: 0,
          soft: 0,
        },
      });
    }
  }

  // LA CURVA DEL QUIEBRE (`lineBreak`): la perilla del glitch de la línea,
  // SEPARADA de la emisión y editable a mano — pedido explícito. La siembra
  // la dibuja desde los crujidos con la misma forma que antes vivía escondida
  // en el director: 0 = entera, piso 0.5 = quebrada y quieta desde el primer
  // crujido, y un pico por golpe (ataque en el 12 % y caída cuadrática, a la
  // altura de la fuerza del golpe). El director la OBEDECE tal cual: bajarla
  // a cero rearma la línea aunque las fracturas sigan sonando en el fluido,
  // y subirla clava la violencia (vibración, twitch, destello) donde se
  // dibuje. Se remuestrea a 120 Hz y se simplifica para que queden pocas
  // llaves y se pueda agarrar cualquiera.
  const BREAK_REST = 0.5;
  if (breakSpikes.length > 0) {
    breakSpikes.sort((a, b) => a.t - b.t);
    const firstSpike = breakSpikes[0].t;
    const lastEnd = breakSpikes.reduce((best, spike) => Math.max(best, spike.t + spike.dur), 0);
    const points: CurveKey[] = [{ t: firstSpike - 0.01, v: 0, shape: 'linear' }];
    for (let t = firstSpike; t <= lastEnd + 0.02; t += 1 / 120) {
      let v = BREAK_REST;
      for (const spike of breakSpikes) {
        if (t < spike.t) continue;
        const local = clamp((t - spike.t) / Math.max(0.05, spike.dur), 0, 1);
        const open = Math.min(1, local / 0.12) * (1 - local) * (1 - local);
        v = Math.max(v, BREAK_REST + open * spike.jolt * (1 - BREAK_REST));
      }
      points.push({ t, v, shape: 'linear' });
    }
    // Pasado el último crujido la rama queda quebrada y quieta, y recién se
    // suelta cuando la línea ya se apagó (0:40): nadie ve el rearme.
    points.push({ t: FIRST_WHITE_AT + 1, v: BREAK_REST, shape: 'linear' });
    points.push({ t: FIRST_WHITE_AT + 1.4, v: 0, shape: 'hold' });
    doc.curves.lineBreak = { keys: simplifyCurve(points, 320) };
  }

  // La línea se quiebra con cada fractura, pero eso NO se dibuja acá: lo hace
  // el director partiendo el blade en astillas (ver `pushLine`). Se probó con
  // curvas —tartamudear `lineEmit`, `lineSize`, `lineX` y `lineY`— y lo único
  // que se conseguía era que la línea se ACHIQUE y parpadee, que no es
  // quebrarse. Además, entre 0:13.8 y 0:42 la lámpara apunta al hueco y la
  // línea es la única luz del cuadro, así que cada corte de `lineEmit` era un
  // apagón de pantalla entera en vez de un destello.

  // Juegos extra desde que muere la emisión: golpes que no llegan a cambiar
  // el régimen pero sí merecen un tirón corto. Alternan modo, son chicos y
  // breves — condimento, no estructura.
  const playful = pickStrongMoments(analysis.onsets, WHITE_BURST_AT + 2, { relative: 0.35, spacing: 3 })
    .filter((onset) => onset.t < GATHER_FROM)
    .filter((onset) => onset.t < lightGatherAt - 0.5 || onset.t >= redAt)
    .filter((onset) => !moments.some(({ onset: other }) => Math.abs(other.t - onset.t) < 1.5));
  // Vórtice y repel mandan en los juegos: el jugueteo es revolver y empujar
  // (lo de juntar ya lo hacen los blobs y la respiración).
  const PLAY_MODES = [2, 1, 3, 2];
  playful.forEach((onset, index) => {
    const calm = onset.t >= CALM_FROM;
    push({
      t: onset.t,
      dur: calm ? 3.2 : 1.3,
      type: 'attractor',
      intensity: clamp(0.4 + onset.strength * 0.5, 0, 1),
      params: {
        mode: calm ? 0 : PLAY_MODES[index % PLAY_MODES.length],
        x: 0.2 + hash(onset.t * 5.3 + 1.1) * 0.6,
        y: 0.25 + hash(onset.t * 7.9 + 2.6) * 0.5,
        radius: calm ? 0.24 : 0.14,
        force: calm ? 0.6 : 1.4 + onset.strength * 0.8,
        wander: 0.07,
        sustain: 0,
        soft: calm ? 1 : 0,
      },
    });
  });

  // Cada corte de sector sin atractor cerca recibe un tirón corto y fuerte:
  // el cambio de sección se siente en el fluido, no sólo en la exposición.
  const attractorTimes = events
    .filter((event) => event.type === 'attractor')
    .map((event) => event.t);
  const SECTION_MODES = [0, 2, 1, 3];
  analysis.sections
    .map((section) => section.t)
    .filter((t) => t > WHITE_BURST_AT + 1 && t < GATHER_FROM)
    // Adentro de la unión de la luz tampoco: ahí el show es un solo gesto.
    .filter((t) => t < lightGatherAt - 0.5 || t >= redAt)
    .forEach((t, index) => {
      if (attractorTimes.some((other) => Math.abs(other - t) < 1.5)) return;
      const calm = t >= CALM_FROM;
      push({
        t,
        dur: calm ? 3.5 : 1.1,
        type: 'attractor',
        intensity: 1,
        params: {
          mode: calm ? 0 : SECTION_MODES[index % SECTION_MODES.length],
          x: 0.3 + hash(t * 2.9) * 0.4,
          y: 0.3 + hash(t * 6.1 + 3) * 0.4,
          radius: calm ? 0.3 : 0.2,
          force: calm ? 0.7 : 2.2,
          wander: 0.06,
          sustain: 0,
          soft: calm ? 1 : 0,
        },
      });
    });

  // 1:10: todo se une rápido alrededor de la luz — ataque inmediato, fuerza
  // grande, radio enorme — y la atracción va perdiendo fuerza hasta soltar en
  // 1:20, donde se prende el rojo. Los tirones por golpe no corren adentro.
  push({
    t: lightGatherAt,
    dur: Math.max(1, redAt - lightGatherAt),
    type: 'attractor',
    intensity: 1,
    params: { mode: 0, x: 0.5, y: 0.5, radius: 0.5, force: 2.3, wander: 0.05, sustain: 0.45, soft: 0 },
  });

  // La respiración: de 1:35 al final, un pulso lento y suave en el centro que
  // junta a todos y los suelta — inhala 5.5 s, descansa, vuelve a inhalar —
  // sin acelerar el fluido, para que la luz respire con él en vez de
  // dispararse. Corre por encima de los tirones de los golpes.
  for (let t = CALM_FROM; t + BREATH_SECONDS < GATHER_FROM; t += BREATH_EVERY) {
    push({
      t,
      dur: BREATH_SECONDS,
      type: 'attractor',
      intensity: 1,
      params: {
        mode: 0,
        x: 0.5, y: 0.5,
        radius: 0.45,
        force: 0.75,
        wander: 0.05,
        sustain: 0,
        soft: 1,
      },
    });
  }

  // La juntada final: una sola atracción larga, suave y amplia que pega a
  // todos entre sí antes del minuto 2. Y desde 2:03, nada: ni un atractor
  // más en todo lo que queda — quedan pegados, la cohesión al mango y el
  // fluido casi quieto, mirando cómo respira la luz.
  push({
    t: GATHER_FROM,
    dur: STICK_FROM - GATHER_FROM - 0.4,
    type: 'attractor',
    intensity: 1,
    params: {
      mode: 0, x: 0.5, y: 0.5,
      // Radio de CUADRO ENTERO, no de medio cuadro. Con 0.5 (= 424 px en una
      // pantalla de 2100x847) la juntada no llegaba a los bordes y dejaba
      // grumos blancos sueltos por todos lados hasta el final del show.
      // Medido: la dispersión de las blancas pasaba de 882 a 1017 px —los
      // desparramaba más— y con 1.3 termina en 79 px. Ahora va en 2, que es
      // lo que tapa las cuatro esquinas de cualquier monitor: el radio se
      // mide en el lado corto y la media diagonal de 2100x847 ya es 1.34.
      radius: GATHER_RADIUS, force: 0.9, wander: 0.04, sustain: 0, soft: 1,
    },
  });

  // Y LA GARANTÍA, POR OTRO MÉTODO: el MALACATE (`unite`). Los atractores
  // empujan pero no prometen — pegan a todo material, y un empujón del
  // cierre (un agarre, un toquecito) puede dejar un grumo blanco lejos. El
  // malacate junta SOLO las blancas, por posiciones y no por fuerza, a
  // velocidad constante hacia el centro, y no suelta hasta el final: lo
  // pedido es que de 2:10 en adelante el 80 % de las blancas esté SÍ O SÍ
  // unido, sin resetear. Con 0.14 de alto por segundo (~119 px/s en una
  // pantalla de 847 de alto), lo que quede a 900 px llega en ~7 s: arranca
  // en 2:03 y a 2:10 ya está. Y PURGA: además de juntar las blancas, echa
  // del radio a los otros materiales — sin eso quedan en una bola pero
  // MEZCLADAS, en grumos separados por masa invisible (medido: el racimo
  // conexo más grande se clava en 52 %). El radio casa es 0.36 porque 1 764
  // blancas puras ocupan ~285 px de radio: más chico es una pulseada
  // permanente contra la presión, todo encendido.
  push({
    t: WHITE_STILL_FROM,
    dur: doc.duration - WHITE_STILL_FROM,
    type: 'unite',
    intensity: 1,
    params: { material: WHITE, x: 0.5, y: 0.5, radius: 0.36, speed: 0.14, purge: 1 },
  });

  // Y NO SE SUELTA. Desde que la juntada termina hasta el final del show, un
  // agarre de cuadro entero, débil y CONSTANTE (`soft` 0 con `sustain` 1: la
  // fuerza entra en 70 ms y se queda, sin campana), que no junta nada porque
  // ya están juntas — lo único que hace es que la bola no rebote cuando la
  // juntada la suelta. Ver `STILL_HOLD_RADIUS` para la medición.
  push({
    t: STICK_FROM - 0.4,
    dur: doc.duration - (STICK_FROM - 0.4),
    type: 'attractor',
    intensity: 1,
    params: {
      mode: 0, x: 0.5, y: 0.5,
      radius: STILL_HOLD_RADIUS, force: STILL_HOLD_FORCE,
      wander: 0, sustain: 1, soft: 0,
    },
  });

  // El cierre respira: una atracción suave y ancha CADA CINCO segundos que
  // los va juntando sin acelerarlos. Es lo que hace que la masa "vaya
  // buscando atraerse" en vez de quedar congelada — con el freno arriba, una
  // fuerza suave sostenida da una migración lenta, no un tirón.
  //
  // MÁS SEGUIDO pero no más fuerte. Eran 4 inhalaciones de 5 s cada 7 con
  // fuerza 0.7; se probó subirlas a 6 de 3.4 s con fuerza 0.95 y el resultado
  // fue el que se gritó: vibración de más y las blancas encendidas con estela
  // todo el cierre. La fuerza vuelve a 0.7 y cada inhalación se acorta a 2.6,
  // así que quedan SEIS intentos y 2.4 s de silencio limpio entre uno y otro
  // — el freno tiene una constante de 0.46 s, o sea cinco, de sobra para que
  // el brillo vuelva al piso antes de la siguiente. Es lo que hace que se lea
  // como un latido y no como una meseta prendida.
  for (
    let t = WHITE_STILL_FROM;
    t + STILL_BREATH_SECONDS < doc.duration;
    t += STILL_BREATH_EVERY
  ) {
    push({
      t,
      dur: STILL_BREATH_SECONDS,
      type: 'attractor',
      intensity: 1,
      params: {
        mode: 0, x: 0.5, y: 0.5,
        // Radio CORTO, y ahora sí con motivo: de juntar se encarga el agarre
        // permanente, que es de cuadro entero. Esto es un latido encima.
        radius: STILL_BREATH_RADIUS, force: STILL_BREATH_FORCE, wander: 0.04, sustain: 0, soft: 1,
      },
    });
  }

  // Y los toquecitos, que son lo que de verdad se mira en el cierre: tirones
  // chiquitos —del tamaño del pincel del mouse— sobre la masa quieta, que
  // encienden un puñado de partículas y las dejan apagarse solas gracias al
  // freno. Van CON EL SONIDO, uno por golpe, y cada uno es un gesto distinto
  // del repertorio: click, empujón, remolino para un lado, para el otro, y
  // agarre. El tamaño y la fuerza los pone el golpe: uno flojo es un
  // toquecito, uno pleno es un empujón de verdad.
  // Y donde el track se queda callado más de dos segundos, un toquecito
  // igual: el cierre no puede tener huecos de seis segundos sin que pase
  // nada, y hay tramos (2:23-2:28) sin un solo golpe.
  const pokeFrom = WHITE_STILL_FROM + 1.2;
  const pokeImpulses = thinImpulses(
    [
      ...impulses.filter((impulse) => impulse.t >= pokeFrom),
      ...gapImpulses(analysis, impulses, pokeFrom, doc.duration, { gap: 2.2, slot: 1.5 }),
    ].sort((a, b) => a.t - b.t),
    STILL_POKE_SPACING,
  );
  let pokeSerial = 0;
  let lastPoke = Number.NEGATIVE_INFINITY;
  for (const impulse of pokeImpulses) {
    if (impulse.t < pokeFrom) continue;
    if (impulse.t - lastPoke < STILL_POKE_SPACING) continue;
    const mode = POKE_MODES[pokeSerial % POKE_MODES.length];
    const grab = mode === 4;
    const dur = grab ? POKE_GRAB_SECONDS : STILL_POKE_SECONDS + impulse.strength * 0.25;
    if (impulse.t + dur >= doc.duration) continue;
    lastPoke = impulse.t;
    pokeSerial += 1;
    const punch = clamp(0.25 + impulse.strength * 0.75, 0, 1);
    push({
      t: impulse.t,
      dur,
      type: 'attractor',
      intensity: 1,
      params: {
        mode,
        x: 0.34 + hash(impulse.t * 3.1 + pokeSerial) * 0.32,
        y: 0.34 + hash(impulse.t * 7.3 + pokeSerial * 3) * 0.32,
        radius: STILL_POKE_RADIUS * (0.6 + punch * 0.9),
        force: STILL_POKE_FORCE * (0.65 + punch * 0.85),
        // El agarre pasea —si no, no arrastra nada—; los golpes secos apenas.
        wander: grab ? POKE_GRAB_WANDER : 0.02,
        sustain: 0,
        soft: 0,
      },
    });
  }

  // La programación del final: pasada la quietud (2:17), agarres lentos de
  // radio grande.
  // Cada uno agarra un círculo de la masa roja y lo lleva despacio por un
  // óvalo: esa parte se despega suave del resto y, moviéndose apenas con la
  // masa casi quieta, se ve más oscura que lo que queda vibrando alrededor.
  // Envolvente de respiración: agarra, lleva, y suelta sin tirón.
  let grabSerial = 0;
  for (
    let t = WHITE_STILL_FROM + STILL_SECONDS;
    t + FINAL_GRAB_SECONDS < doc.duration;
    t += FINAL_GRAB_EVERY
  ) {
    grabSerial += 1;
    push({
      t,
      dur: FINAL_GRAB_SECONDS,
      type: 'attractor',
      intensity: 1,
      params: {
        mode: 4,
        x: 0.32 + hash(t * 4.3 + grabSerial) * 0.36,
        y: 0.36 + hash(t * 8.7 + grabSerial * 2) * 0.28,
        radius: FINAL_GRAB_RADIUS,
        force: FINAL_GRAB_FORCE,
        wander: 0.13,
        sustain: 0,
        soft: 1,
      },
    });
  }

  // Arrancar el show desde el principio limpia el cuadro. Sin esto, la
  // segunda pasada empezaba con las 20 000 partículas de la anterior, el
  // techo ya estaba gastado y no se emitía nada — ni las blancas del chorro.
  push({
    t: 0.05,
    dur: 0.05,
    type: 'reset-fluid',
    intensity: 1,
    params: {},
  });

  // De qué material nace cada impulso. Sólo se deja un evento cuando el
  // material cambia: si no, la lane quedaría con ciento treinta y seis
  // bloques iguales y sería ilegible.
  // El primer tramo se declara en t=0, no en su primer golpe: antes de eso el
  // material caía en el default —blanco— y el show arrancaba escupiendo
  // justo el color que no tiene que aparecer al principio.
  let previousMaterial = stages[0].materials[0];
  push({
    t: 0,
    dur: 0.1,
    type: 'set-material',
    intensity: 1,
    params: { material: previousMaterial },
  });
  // Cada CHORRO de la curva escupe los dos colores: arranca de uno y a los
  // 0.13 s pasa al otro, y el chorro siguiente los invierte. Es el pedido —en
  // todos los golpes tienen que salir rojas y negras— y sale gratis porque el
  // material se resuelve por cuadro, así que un `set-material` en el medio de
  // un chorro lo parte en dos colores.
  //
  // Los chorros se leen de la CURVA, no de los impulsos del análisis: la
  // primera parte está dibujada a mano y los colores tienen que caer donde
  // están los chorros de verdad.
  const setMaterial = (t: number, material: number): void => {
    if (material === previousMaterial) return;
    previousMaterial = material;
    push({
      t: Math.max(0, t),
      dur: 0.1,
      type: 'set-material',
      intensity: 1,
      params: { material },
    });
  };
  for (const burst of emissionBursts(doc.curves.emission)) {
    const stage = stageAt(burst.peak);
    // Los dos colores del tramo, en el orden que declara el guion. Casi
    // siempre son el rojo y el negro; en los tramos que declaran uno solo, el
    // chorro entero sale de ése.
    const palette = [...new Set(stage.materials)];
    if (palette.length === 0) continue;
    const [first, second = first] = palette;
    // El primero se lleva el ataque y el segundo la cola. NO se alternan: la
    // cola de un chorro escupe bastante menos que su ataque (el caudal es
    // cuadrático, así que el reparto es ~64/36), y eso es justo lo que hace
    // falta — los negros son los CUERPOS que después tapan la luz roja, y si
    // fueran la mitad de la población el cuadro se llenaría de sombras.
    setMaterial(burst.rise - 0.04, first);
    if (second !== first) setMaterial(burst.peak + MATERIAL_SPLIT, second);
  }

  // Ni un flash ni un estrobo antes de 1:25: los dos son blancos, y hasta el
  // chorro la única luz blanca permitida es el propio chorro. El primer flash
  // cae en el golpe de 1:26, que es el que lo pide.
  // Y ninguno adentro de la quietud del cierre: un flash de pantalla entera
  // sobre una masa quieta y tenue la revienta, y es justo lo que ahí hay que
  // poder mirar.
  const still = (t: number): boolean => (
    t >= WHITE_STILL_FROM - 0.6 && t < WHITE_STILL_FROM + STILL_SECONDS
  );
  for (const onset of analysis.onsets) {
    if (onset.t < FLASHES_FROM) continue;
    if (still(onset.t)) continue;
    if (onset.band === 'low' && onset.strength > 0.5) {
      push({
        t: onset.t,
        dur: 0.4,
        type: 'flash',
        intensity: clamp(onset.strength, 0, 1),
        params: { decay: 0.35, gain: 2.4 },
      });
    } else if (onset.band === 'high' && onset.strength > 0.55) {
      push({
        t: onset.t,
        dur: 0.25,
        type: 'strobe-lines',
        intensity: clamp(onset.strength, 0, 1),
        params: { count: 3, freqHz: 14, orient: 0, hue: 0, thickness: 0.006, duty: 0.35, kick: 0.5 },
      });
    }
  }
  doc.events = sortEvents(events.filter((event) => event.dur >= MIN_EVENT_DUR));
  return doc;
};
