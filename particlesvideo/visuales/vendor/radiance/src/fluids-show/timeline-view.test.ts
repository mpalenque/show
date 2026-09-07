import { describe, expect, it } from 'vitest';
import {
  MIN_SPAN,
  clampView,
  nearestIndex,
  panView,
  rulerStep,
  snapTime,
  timeToX,
  xToTime,
  zoomView,
} from './timeline-view';

const DURATION = 152.694;
const WIDTH = 1200;

describe('mapeo tiempo <-> píxel', () => {
  it('lleva el borde izquierdo a 0 y el derecho al ancho', () => {
    const view = { t0: 10, t1: 20 };
    expect(timeToX(view, 10, WIDTH)).toBe(0);
    expect(timeToX(view, 20, WIDTH)).toBe(WIDTH);
    expect(timeToX(view, 15, WIDTH)).toBe(WIDTH / 2);
    expect(xToTime(view, WIDTH / 2, WIDTH)).toBe(15);
  });

  it('es reversible en cualquier punto', () => {
    const view = { t0: 3.7, t1: 41.2 };
    for (const t of [3.7, 12.4, 30, 41.2]) {
      expect(xToTime(view, timeToX(view, t, WIDTH), WIDTH)).toBeCloseTo(t, 9);
    }
  });
});

describe('clampView', () => {
  it('mantiene la ventana dentro del track', () => {
    expect(clampView({ t0: -20, t1: -10 }, DURATION).t0).toBe(0);
    const late = clampView({ t0: 200, t1: 210 }, DURATION);
    expect(late.t1).toBeCloseTo(DURATION, 6);
    expect(late.t1 - late.t0).toBeCloseTo(10, 6);
  });

  it('nunca deja banda vacía ni una ventana más chica que el mínimo', () => {
    const wide = clampView({ t0: -50, t1: 500 }, DURATION);
    expect(wide).toEqual({ t0: 0, t1: DURATION });
    const tiny = clampView({ t0: 10, t1: 10.01 }, DURATION);
    expect(tiny.t1 - tiny.t0).toBeCloseTo(MIN_SPAN, 9);
  });
});

describe('zoomView', () => {
  it('deja quieto el instante bajo el cursor', () => {
    const view = { t0: 20, t1: 40 };
    const anchor = 25;
    const before = timeToX(view, anchor, WIDTH);
    for (const factor of [0.5, 0.8, 1.6]) {
      const zoomed = zoomView(view, DURATION, anchor, factor);
      expect(timeToX(zoomed, anchor, WIDTH)).toBeCloseTo(before, 6);
    }
  });

  it('no se pasa del track ni del zoom máximo', () => {
    const zoomedOut = zoomView({ t0: 20, t1: 40 }, DURATION, 25, 100);
    expect(zoomedOut).toEqual({ t0: 0, t1: DURATION });
    const zoomedIn = zoomView({ t0: 20, t1: 40 }, DURATION, 25, 0.0001);
    expect(zoomedIn.t1 - zoomedIn.t0).toBeCloseTo(MIN_SPAN, 9);
    // El ancla se respeta también en el zoom máximo.
    expect(zoomedIn.t0).toBeLessThanOrEqual(25);
    expect(zoomedIn.t1).toBeGreaterThanOrEqual(25);
  });
});

describe('panView', () => {
  it('corre la ventana y frena en los bordes', () => {
    expect(panView({ t0: 20, t1: 40 }, DURATION, 5)).toEqual({ t0: 25, t1: 45 });
    expect(panView({ t0: 20, t1: 40 }, DURATION, -100).t0).toBe(0);
    expect(panView({ t0: 20, t1: 40 }, DURATION, 1000).t1).toBeCloseTo(DURATION, 6);
  });
});

describe('nearestIndex', () => {
  it('encuentra el más cercano en un array ordenado', () => {
    const values = [0, 1, 4, 9, 16];
    expect(nearestIndex(values, -3)).toBe(0);
    expect(nearestIndex(values, 1.4)).toBe(1);
    expect(nearestIndex(values, 3)).toBe(2);
    expect(nearestIndex(values, 100)).toBe(4);
    expect(nearestIndex([], 3)).toBe(-1);
    // Ante un empate se queda con el anterior, que es determinista.
    expect(nearestIndex([2, 4], 3)).toBe(0);
  });
});

describe('snapTime', () => {
  const onsets = [0.232, 0.592, 10, 20.5];

  it('pega al onset dentro de la tolerancia y deja pasar lo lejano', () => {
    expect(snapTime(10.03, { onsets, tolerance: 0.05 })).toBe(10);
    expect(snapTime(10.3, { onsets, tolerance: 0.05 })).toBe(10.3);
    expect(snapTime(10.03, { onsets, tolerance: 0 })).toBe(10.03);
  });

  it('usa la grilla de beat sólo si está activada', () => {
    // 96 BPM: un beat cada 0.625 s.
    expect(snapTime(1.27, { bpm: 96, tolerance: 0.05 })).toBeCloseTo(1.25, 9);
    expect(snapTime(1.27, { tolerance: 0.05 })).toBe(1.27);
  });

  it('prefiere el onset cuando compite de igual a igual con el beat', () => {
    // El onset y el beat quedan a la misma distancia: manda el onset, que es
    // la verdad del track y no una estimación.
    expect(snapTime(9.9, { onsets, bpm: 60 / 9.8, tolerance: 0.3 })).toBe(10);
    // Pero un beat claramente más cerca gana.
    expect(snapTime(9.4, { onsets, bpm: 96, tolerance: 0.7 })).toBeCloseTo(9.375, 9);
  });
});

describe('rulerStep', () => {
  it('elige un paso redondo que no amontone las marcas', () => {
    expect(rulerStep({ t0: 0, t1: 152.694 }, WIDTH)).toBe(20);
    expect(rulerStep({ t0: 0, t1: 10 }, WIDTH)).toBe(1);
    expect(rulerStep({ t0: 0, t1: 0.5 }, WIDTH)).toBeCloseTo(0.05, 9);
    // Y siempre deja al menos el mínimo de píxeles entre marcas.
    for (const span of [0.5, 3, 17, 60, 152.694]) {
      const step = rulerStep({ t0: 0, t1: span }, WIDTH);
      expect((step / span) * WIDTH).toBeGreaterThanOrEqual(90);
    }
  });
});
