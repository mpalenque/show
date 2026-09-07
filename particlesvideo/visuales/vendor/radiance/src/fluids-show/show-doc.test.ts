import { describe, expect, it } from 'vitest';
import {
  CURVE_IDS,
  EVENT_SPECS,
  emptyDoc,
  eventParam,
  eventPhase,
  eventsAt,
  gesturesAt,
  integrateCurve,
  makeEvent,
  parseShowDoc,
  punchGestures,
  sampleCurve,
  sampleCurveId,
  sampleGesture,
  serializeShowDoc,
  withKey,
  type Curve,
  type GestureClip,
  type ShowDoc,
} from './show-doc';

const curve = (...keys: Array<[number, number, 'linear' | 'smooth' | 'hold']>): Curve => ({
  keys: keys.map(([t, v, shape]) => ({ t, v, shape })),
});

const clip = (
  id: string,
  t0: number,
  t1: number,
  samples = [{ t: 0, x: 0.1, y: 0.1 }, { t: t1 - t0, x: 0.9, y: 0.9 }],
): GestureClip => ({
  id, t0, t1, mode: 'drag', radius: 0.08, strength: 1, samples,
});

const withGestures = (clips: GestureClip[]): ShowDoc => ({ ...emptyDoc(), gestures: clips });

describe('sampleCurve', () => {
  it('sostiene los extremos fuera del rango de keys', () => {
    const c = curve([1, 0.2, 'linear'], [3, 0.8, 'linear']);
    expect(sampleCurve(c, 0, 0.5)).toBe(0.2);
    expect(sampleCurve(c, 9, 0.5)).toBe(0.8);
    expect(sampleCurve({ keys: [] }, 5, 0.42)).toBe(0.42);
    expect(sampleCurve(undefined, 5, 0.42)).toBe(0.42);
  });

  it('interpola con los tres shapes', () => {
    const linear = curve([0, 0, 'linear'], [2, 1, 'linear']);
    expect(sampleCurve(linear, 1, 0)).toBeCloseTo(0.5, 6);
    expect(sampleCurve(linear, 0.5, 0)).toBeCloseTo(0.25, 6);

    const smooth = curve([0, 0, 'smooth'], [2, 1, 'linear']);
    expect(sampleCurve(smooth, 1, 0)).toBeCloseTo(0.5, 6);
    // Smoothstep sale plano: al 25% del tramo todavía no llegó al 25% del valor.
    expect(sampleCurve(smooth, 0.5, 0)).toBeCloseTo(0.15625, 6);

    const hold = curve([0, 0.3, 'hold'], [2, 1, 'linear']);
    expect(sampleCurve(hold, 1.99, 0)).toBe(0.3);
    expect(sampleCurve(hold, 2, 0)).toBe(1);
  });

  it('toma el arco corto del círculo cuando el matiz envuelve', () => {
    const hue = curve([0, 0.9, 'linear'], [1, 0.1, 'linear']);
    // Sin wrap el camino largo pasa por el medio del espectro.
    expect(sampleCurve(hue, 0.5, 0)).toBeCloseTo(0.5, 6);
    // Con wrap cruza el 0: 0.9 -> 1.0/0.0 -> 0.1.
    expect(sampleCurve(hue, 0.5, 0, true)).toBeCloseTo(0, 6);
    expect(sampleCurve(hue, 0.25, 0, true)).toBeCloseTo(0.95, 6);
    expect(sampleCurve(hue, 0.75, 0, true)).toBeCloseTo(0.05, 6);
  });

  it('usa el default declarado de cada curva al samplear por id', () => {
    const doc = emptyDoc();
    expect(sampleCurveId(doc, 'exposure', 10)).toBe(1);
    expect(sampleCurveId(doc, 'lineSize', 10)).toBeCloseTo(0.375, 6);
    doc.curves.exposure = withKey(doc.curves.exposure, { t: 5, v: 1.7, shape: 'linear' });
    expect(sampleCurveId(doc, 'exposure', 10)).toBeCloseTo(1.7, 6);
  });

  it('reemplaza el key existente al insertar en el mismo t', () => {
    let c: Curve = { keys: [] };
    c = withKey(c, { t: 4, v: 0.2, shape: 'linear' });
    c = withKey(c, { t: 1, v: 0.9, shape: 'hold' });
    c = withKey(c, { t: 4, v: 0.55, shape: 'smooth' });
    expect(c.keys.map((key) => key.t)).toEqual([1, 4]);
    expect(c.keys[1].v).toBe(0.55);
  });
});

describe('integrateCurve', () => {
  it('integra la curva vacía como una constante', () => {
    expect(integrateCurve({ keys: [] }, 10, 0.3)).toBeCloseTo(3, 9);
    expect(integrateCurve(undefined, 10, 0.3)).toBeCloseTo(3, 9);
    expect(integrateCurve({ keys: [] }, -5, 0.3)).toBe(0);
  });

  it('sostiene el primer y el último valor fuera del rango de keys', () => {
    const c = curve([2, 0.5, 'linear'], [4, 0.5, 'linear']);
    expect(integrateCurve(c, 2, 0)).toBeCloseTo(1, 9);
    expect(integrateCurve(c, 6, 0)).toBeCloseTo(3, 9);
  });

  it('da el trapecio en tramos linear y smooth, y el rectángulo en hold', () => {
    const linear = curve([0, 0, 'linear'], [2, 1, 'linear']);
    expect(integrateCurve(linear, 2, 0)).toBeCloseTo(1, 9);
    expect(integrateCurve(linear, 1, 0)).toBeCloseTo(0.25, 9);

    // Smoothstep integra 0.5 en el tramo completo, igual que la recta.
    const smooth = curve([0, 0, 'smooth'], [2, 1, 'linear']);
    expect(integrateCurve(smooth, 2, 0)).toBeCloseTo(1, 9);
    // Pero en el tramo parcial arranca más plano: u^3 - u^4/2 con u = 0.5.
    expect(integrateCurve(smooth, 1, 0)).toBeCloseTo(2 * (0.125 - 0.03125), 9);

    const hold = curve([0, 0.4, 'hold'], [2, 1, 'linear']);
    expect(integrateCurve(hold, 2, 0)).toBeCloseTo(0.8, 9);
    expect(integrateCurve(hold, 1.5, 0)).toBeCloseTo(0.6, 9);
  });

  it('coincide con la suma de Riemann de sampleCurve', () => {
    const c = curve([0, -0.5, 'linear'], [3, 0.8, 'smooth'], [5, 0.8, 'hold'], [9, -1, 'linear']);
    for (const target of [1.3, 4.4, 6.7, 11]) {
      const steps = 200000;
      const step = target / steps;
      let sum = 0;
      for (let index = 0; index < steps; index += 1) {
        sum += sampleCurve(c, (index + 0.5) * step, 0) * step;
      }
      expect(integrateCurve(c, target, 0)).toBeCloseTo(sum, 4);
    }
  });
});

describe('eventos', () => {
  it('devuelve los eventos activos y su fase', () => {
    const doc = emptyDoc();
    const flash = { ...makeEvent('flash', 10), dur: 0.4 };
    const strobe = { ...makeEvent('strobe-lines', 10.2), dur: 1 };
    doc.events = [flash, strobe];
    expect(eventsAt(doc, 9.9)).toHaveLength(0);
    expect(eventsAt(doc, 10).map((event) => event.type)).toEqual(['flash']);
    expect(eventsAt(doc, 10.3)).toHaveLength(2);
    // El final es exclusivo: en t + dur el evento ya terminó.
    expect(eventsAt(doc, 10.4).map((event) => event.type)).toEqual(['strobe-lines']);
    expect(eventPhase(flash, 10.2)).toBeCloseTo(0.5, 6);
    expect(eventPhase(flash, 99)).toBe(1);
  });

  it('clampea los params al rango de su spec y cae al default si faltan', () => {
    const event = makeEvent('strobe-lines', 4);
    expect(eventParam(event, 'freqHz')).toBe(14);
    event.params.freqHz = 900;
    expect(eventParam(event, 'freqHz')).toBe(30);
    delete event.params.count;
    expect(eventParam(event, 'count')).toBe(3);
  });

  it('declara params con default dentro de rango para todos los tipos', () => {
    for (const spec of EVENT_SPECS) {
      const event = makeEvent(spec.type, 0);
      expect(event.dur).toBeGreaterThan(0);
      for (const param of spec.params) {
        expect(param.def).toBeGreaterThanOrEqual(param.min);
        expect(param.def).toBeLessThanOrEqual(param.max);
        expect(event.params[param.id]).toBe(param.def);
      }
    }
  });
});

describe('gestos', () => {
  it('interpola la pose y deriva la velocidad de las muestras vecinas', () => {
    const gesture = clip('a', 10, 12, [
      { t: 0, x: 0.2, y: 0.5 },
      { t: 1, x: 0.6, y: 0.5 },
      { t: 2, x: 0.6, y: 0.9 },
    ]);
    const doc = withGestures([gesture]);
    expect(gesturesAt(doc, 9.9)).toHaveLength(0);
    expect(gesturesAt(doc, 11)).toHaveLength(1);
    expect(gesturesAt(doc, 12)).toHaveLength(0);

    const mid = sampleGesture(gesture, 10.5)!;
    expect(mid.x).toBeCloseTo(0.4, 6);
    expect(mid.vx).toBeCloseTo(0.4, 6);
    expect(mid.vy).toBeCloseTo(0, 6);

    const later = sampleGesture(gesture, 11.5)!;
    expect(later.y).toBeCloseTo(0.7, 6);
    expect(later.vy).toBeCloseTo(0.4, 6);

    // Antes y después del clip la pose se sostiene, quieta.
    expect(sampleGesture(gesture, 9)!.vx).toBe(0);
    expect(sampleGesture(gesture, 99)!.x).toBeCloseTo(0.6, 6);
    expect(sampleGesture({ ...gesture, samples: [] }, 11)).toBeNull();
  });
});

describe('punchGestures', () => {
  it('deja intactos los clips sin solape', () => {
    const doc = withGestures([clip('a', 0, 2), clip('b', 20, 22)]);
    const next = punchGestures(doc, 5, 10, []);
    expect(next.gestures.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('borra el clip contenido por completo', () => {
    const doc = withGestures([clip('a', 6, 8)]);
    expect(punchGestures(doc, 5, 10, []).gestures).toHaveLength(0);
  });

  it('recorta el solape por izquierda y por derecha', () => {
    const doc = withGestures([
      clip('izq', 3, 7, [{ t: 0, x: 0.1, y: 0.1 }, { t: 1, x: 0.4, y: 0.4 }, { t: 4, x: 0.9, y: 0.9 }]),
      clip('der', 8, 13, [{ t: 0, x: 0.1, y: 0.1 }, { t: 4, x: 0.5, y: 0.5 }, { t: 5, x: 0.9, y: 0.9 }]),
    ]);
    const next = punchGestures(doc, 5, 10, []);
    expect(next.gestures).toHaveLength(2);
    const [left, right] = next.gestures;
    expect(left.t0).toBe(3);
    expect(left.t1).toBe(5);
    // Sólo sobrevive la muestra que cae dentro del recorte.
    expect(left.samples.map((sample) => sample.t)).toEqual([0, 1]);
    expect(right.t0).toBe(10);
    expect(right.t1).toBe(13);
    // Recortar por izquierda corre el origen de las muestras con el clip.
    expect(right.samples.map((sample) => sample.t)).toEqual([2, 3]);
  });

  it('parte en dos el clip que cruza el rango entero', () => {
    const samples = Array.from({ length: 21 }, (_, index) => ({ t: index, x: index / 20, y: 0.5 }));
    const doc = withGestures([clip('cruza', 0, 20, samples)]);
    const next = punchGestures(doc, 5, 10, []);
    expect(next.gestures).toHaveLength(2);
    expect(next.gestures[0].t0).toBe(0);
    expect(next.gestures[0].t1).toBe(5);
    expect(next.gestures[1].t0).toBe(10);
    expect(next.gestures[1].t1).toBe(20);
    expect(next.gestures[0].id).not.toBe(next.gestures[1].id);
  });

  it('inserta los clips nuevos ordenados por t0', () => {
    const doc = withGestures([clip('viejo', 0, 20, Array.from({ length: 21 }, (_, index) => ({ t: index, x: 0.5, y: 0.5 })))]);
    const grabado = clip('nuevo', 6, 9);
    const next = punchGestures(doc, 5, 10, [grabado]);
    expect(next.gestures.map((entry) => entry.t0)).toEqual([0, 6, 10]);
    expect(next.gestures[1].id).toBe('nuevo');
    // El doc original no se toca: el undo del editor guarda snapshots.
    expect(doc.gestures).toHaveLength(1);
  });

  it('acepta el rango invertido', () => {
    const doc = withGestures([clip('a', 6, 8)]);
    expect(punchGestures(doc, 10, 5, []).gestures).toHaveLength(0);
  });
});

describe('parseShowDoc', () => {
  it('devuelve un doc vacío ante JSON roto o basura', () => {
    for (const raw of ['{no es json', null, 42, '[]', undefined]) {
      const doc = parseShowDoc(raw);
      expect(doc.version).toBe(1);
      expect(doc.events).toEqual([]);
      expect(doc.gestures).toEqual([]);
      for (const id of CURVE_IDS) expect(doc.curves[id].keys).toEqual([]);
    }
  });

  it('descarta lo dañado y conserva el resto del documento', () => {
    const doc = parseShowDoc({
      version: 1,
      duration: 100,
      curves: {
        emission: { keys: [{ t: 5, v: 0.5 }, { t: 1, v: 9 }, { t: 'x', v: 1 }, null] },
        inventada: { keys: [{ t: 1, v: 1 }] },
      },
      events: [
        { type: 'flash', t: 3, dur: 0.4, intensity: 5, params: { gain: 99 } },
        { type: 'inventado', t: 4 },
        null,
      ],
      gestures: [
        { t0: 2, t1: 4, mode: 'vortex', samples: [{ t: 0, x: 0.5, y: 2 }] },
        { t0: 2, t1: 4, mode: 'drag', samples: [] },
      ],
    });
    expect(doc.duration).toBe(100);
    // Ordenadas por t, con el valor fuera de rango clampeado y el shape default.
    expect(doc.curves.emission.keys).toEqual([
      { t: 1, v: 1, shape: 'linear' },
      { t: 5, v: 0.5, shape: 'linear' },
    ]);
    expect(doc.events).toHaveLength(1);
    expect(doc.events[0].intensity).toBe(1);
    expect(doc.events[0].params.gain).toBe(4);
    expect(doc.events[0].params.decay).toBe(0.35);
    // El clip sin muestras no sobrevive; el otro queda con y clampeado.
    expect(doc.gestures).toHaveLength(1);
    expect(doc.gestures[0].mode).toBe('vortex');
    expect(doc.gestures[0].samples[0].y).toBe(1);
  });

  it('hace round-trip exacto de un documento editado', () => {
    const doc = emptyDoc();
    doc.curves.gravity = withKey(doc.curves.gravity, { t: 12, v: -0.4, shape: 'smooth' });
    doc.curves.emitHue = withKey(doc.curves.emitHue, { t: 3, v: 0.75, shape: 'hold' });
    doc.events = [makeEvent('shadow-bar', 20), makeEvent('reset-fluid', 44)];
    doc.gestures = [clip('g', 30, 33)];
    expect(parseShowDoc(serializeShowDoc(doc))).toEqual(doc);
  });
});
