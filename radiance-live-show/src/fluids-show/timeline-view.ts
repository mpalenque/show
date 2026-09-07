/**
 * Mapeo tiempo <-> píxel de la timeline, y el imán de la edición.
 *
 * Todas las lanes comparten esta ventana: el waveform, cada curva, los
 * eventos y los gestos dibujan contra el mismo `TimelineView`, y por eso el
 * playhead cae en la misma columna en todas. Es puro a propósito — el zoom
 * anclado al cursor y el snap son justo el tipo de aritmética que conviene
 * poder verificar sin un navegador.
 */

export interface TimelineView {
  t0: number;
  t1: number;
}

/** Ventana mínima: medio segundo de track ocupando toda la pantalla. */
export const MIN_SPAN = 0.5;

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

export const viewSpan = (view: TimelineView): number => Math.max(MIN_SPAN, view.t1 - view.t0);

export const timeToX = (view: TimelineView, t: number, width: number): number => (
  ((t - view.t0) / viewSpan(view)) * Math.max(1, width)
);

export const xToTime = (view: TimelineView, x: number, width: number): number => (
  view.t0 + (x / Math.max(1, width)) * viewSpan(view)
);

/** Segundos por píxel: la tolerancia del imán se expresa en píxeles. */
export const secondsPerPixel = (view: TimelineView, width: number): number => (
  viewSpan(view) / Math.max(1, width)
);

/**
 * Encierra la ventana dentro del track. Si el zoom pide más de lo que dura el
 * track, se muestra el track entero: nunca hay banda vacía a los costados.
 */
export const clampView = (view: TimelineView, duration: number): TimelineView => {
  const total = Math.max(MIN_SPAN, duration);
  const span = Math.min(Math.max(MIN_SPAN, view.t1 - view.t0), total);
  const t0 = clamp(view.t0, 0, total - span);
  return { t0, t1: t0 + span };
};

/**
 * Zoom anclado: el instante que está bajo el cursor se queda bajo el cursor.
 * `factor` < 1 acerca.
 */
export const zoomView = (
  view: TimelineView,
  duration: number,
  anchorT: number,
  factor: number,
): TimelineView => {
  const total = Math.max(MIN_SPAN, duration);
  const span = clamp(viewSpan(view) * factor, MIN_SPAN, total);
  const anchor = clamp(anchorT, view.t0, view.t1);
  const fraction = (anchor - view.t0) / viewSpan(view);
  return clampView({ t0: anchor - fraction * span, t1: anchor - fraction * span + span }, total);
};

export const panView = (
  view: TimelineView,
  duration: number,
  deltaSeconds: number,
): TimelineView => clampView(
  { t0: view.t0 + deltaSeconds, t1: view.t1 + deltaSeconds },
  duration,
);

/** Índice del valor más cercano a `t` en un array ordenado, o -1 si está vacío. */
export const nearestIndex = (sorted: number[], t: number): number => {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  // `lo` es el primero >= t; el más cercano es ése o el anterior.
  if (lo > 0 && Math.abs(sorted[lo - 1] - t) <= Math.abs(sorted[lo] - t)) return lo - 1;
  return lo;
};

export interface SnapOptions {
  /** Tiempos de onset del análisis, ordenados. */
  onsets?: number[];
  /** Grilla de beat, o null para no usarla. */
  bpm?: number | null;
  /** Radio del imán, en segundos (la UI lo calcula desde píxeles). */
  tolerance: number;
}

/**
 * Pega `t` al onset o al beat más cercano dentro de la tolerancia. Gana el que
 * esté más cerca; los onsets son la verdad del track y el beat es sólo una
 * estimación, así que ante un empate manda el onset.
 */
export const snapTime = (t: number, options: SnapOptions): number => {
  const { onsets, bpm, tolerance } = options;
  if (!(tolerance > 0)) return t;
  let best = t;
  let bestDistance = tolerance;
  if (onsets && onsets.length > 0) {
    const index = nearestIndex(onsets, t);
    if (index >= 0) {
      const distance = Math.abs(onsets[index] - t);
      if (distance <= bestDistance) {
        best = onsets[index];
        bestDistance = distance;
      }
    }
  }
  if (bpm && bpm > 0) {
    const period = 60 / bpm;
    const beat = Math.round(t / period) * period;
    if (Math.abs(beat - t) < bestDistance) best = beat;
  }
  return best;
};

/**
 * Marcas de la regla: un paso "redondo" (1-2-5) que deje al menos `minPx`
 * entre marcas, para que la regla no se llene de números ilegibles.
 */
export const rulerStep = (view: TimelineView, width: number, minPx = 90): number => {
  const target = secondsPerPixel(view, width) * minPx;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1e-3, target)));
  for (const multiple of [1, 2, 5, 10]) {
    if (magnitude * multiple >= target) return magnitude * multiple;
  }
  return magnitude * 10;
};
