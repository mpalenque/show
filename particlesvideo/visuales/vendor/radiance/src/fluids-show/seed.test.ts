import { describe, expect, it } from 'vitest';
import FluidsShowDirector, {
  FLUIDS_SHOW_PARTICLE_CAP,
} from '../scenes/fluid/FluidsShowDirector';
import {
  emissionBursts,
  emissionImpulseCurve,
  envelopeCurve,
  parseAnalysis,
  pickImpulses,
  seedShowDoc,
  simplifyCurve,
  EXPLOSION_AT,
  FIRST_WHITE_AT,
  WHITE_BURST_AT,
  smoothEnvelope,
} from './seed';
import {
  DEFAULT_MATERIAL_COLORS,
  LAMP_NONE,
  emitMaterialAt,
  eventsAt,
  lampAt,
  lampGapAt,
  sampleCurve,
  sampleCurveId,
  type CurveKey,
} from './show-doc';
// El análisis real del track, no un fixture: la siembra tiene que sostenerse
// contra los 874 onsets y las 6 574 muestras de envolvente que va a comer.
import analysisJson from '../../../../public/radiance/show/fluids.analysis.json';

const analysis = parseAnalysis(analysisJson)!;

describe('parseAnalysis', () => {
  it('lee el análisis real de fluids.wav', () => {
    expect(analysis).not.toBeNull();
    expect(analysis.duration).toBeCloseTo(152.694, 3);
    expect(analysis.envelopes.rms.length).toBeGreaterThan(6000);
    expect(analysis.onsets.length).toBeGreaterThan(500);
    expect(analysis.sections[0].t).toBe(0);
    // Las envolventes cubren el track entero al ritmo declarado.
    expect(analysis.envelopes.rms.length / analysis.envelopeRate).toBeCloseTo(analysis.duration, 0);
  });

  it('rechaza lo que no es un análisis utilizable', () => {
    expect(parseAnalysis('{roto')).toBeNull();
    expect(parseAnalysis(null)).toBeNull();
    expect(parseAnalysis({ envelopes: {} })).toBeNull();
  });
});

describe('smoothEnvelope', () => {
  it('promedia dentro de la ventana y conserva el largo', () => {
    const spike = [0, 0, 0, 1, 0, 0, 0];
    const smoothed = smoothEnvelope(spike, 1, 2);
    expect(smoothed).toHaveLength(spike.length);
    expect(smoothed[3]).toBeCloseTo(1 / 3, 6);
    expect(smoothed[2]).toBeCloseTo(1 / 3, 6);
    // Con ventana menor a una muestra no toca nada.
    expect(smoothEnvelope(spike, 1, 0)).toEqual(spike);
  });
});

describe('simplifyCurve', () => {
  it('conserva los quiebres y descarta los puntos colineales', () => {
    const points: CurveKey[] = Array.from({ length: 101 }, (_, index) => ({
      t: index / 10,
      v: index <= 50 ? index / 50 : (100 - index) / 50,
      shape: 'linear',
    }));
    const simplified = simplifyCurve(points, 8);
    expect(simplified.length).toBeLessThanOrEqual(8);
    expect(simplified[0].t).toBe(0);
    expect(simplified[simplified.length - 1].t).toBeCloseTo(10, 6);
    // El pico sigue ahí y la forma se reconstruye con error chico.
    const peak = simplified.find((key) => Math.abs(key.t - 5) < 1e-6);
    expect(peak?.v).toBeCloseTo(1, 6);
    for (const point of points) {
      expect(Math.abs(sampleCurve({ keys: simplified }, point.t, 0) - point.v)).toBeLessThan(0.05);
    }
  });
});

describe('envelopeCurve', () => {
  it('remapea al rango pedido sin salirse', () => {
    const curve = envelopeCurve({
      envelope: analysis.envelopes.rms,
      rate: analysis.envelopeRate,
      smoothSeconds: 1,
      lo: 0.15,
      hi: 0.8,
      maxKeys: 48,
    });
    expect(curve.keys.length).toBeGreaterThan(4);
    expect(curve.keys.length).toBeLessThanOrEqual(48);
    for (const key of curve.keys) {
      expect(key.v).toBeGreaterThanOrEqual(0.15);
      expect(key.v).toBeLessThanOrEqual(0.8);
      expect(key.shape).toBe('smooth');
    }
    // Ordenadas y dentro del track.
    for (let index = 1; index < curve.keys.length; index += 1) {
      expect(curve.keys[index].t).toBeGreaterThan(curve.keys[index - 1].t);
    }
    expect(curve.keys[curve.keys.length - 1].t).toBeLessThanOrEqual(analysis.duration);
  });
});

describe('pickImpulses', () => {
  const impulses = pickImpulses(analysis.onsets);

  it('se queda con los golpes que se escuchan, no con los 874 onsets', () => {
    expect(impulses.length).toBeGreaterThan(80);
    expect(impulses.length).toBeLessThan(analysis.onsets.length / 4);
    // Todos salen del análisis y quedan ordenados.
    const times = new Set(analysis.onsets.map((onset) => onset.t));
    for (let index = 0; index < impulses.length; index += 1) {
      expect(times.has(impulses[index].t)).toBe(true);
      if (index > 0) expect(impulses[index].t).toBeGreaterThan(impulses[index - 1].t);
    }
  });

  it('separa los impulsos al menos por la ventana de supresión', () => {
    // La ventana es 0.1: lo justo para que un redoble (golpes cada ~0.11 s)
    // sobreviva como redoble y el tramo de 0:25 a 0:35 emita con lo que suena.
    for (let index = 1; index < impulses.length; index += 1) {
      expect(impulses[index].t - impulses[index - 1].t).toBeGreaterThan(0.1);
    }
  });

  it('reparte impulsos por todo el track, también donde el track afloja', () => {
    // El umbral relativo existe por esto: con uno fijo, de 1:40 a 2:20
    // quedaban tres golpes en total y el cierre del show se moría.
    const per20 = new Map<number, number>();
    for (const impulse of impulses) {
      const bucket = Math.floor(impulse.t / 20) * 20;
      per20.set(bucket, (per20.get(bucket) ?? 0) + 1);
    }
    for (let bucket = 0; bucket < 140; bucket += 20) {
      expect(per20.get(bucket) ?? 0).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('emissionImpulseCurve', () => {
  it('sube en cada golpe y vuelve al chorrito de base', () => {
    const impulses = [
      { t: 10, strength: 1, band: 'mid' as const, shares: { low: 0, mid: 1, high: 0 } },
      { t: 30, strength: 0, band: 'low' as const, shares: { low: 1, mid: 0, high: 0 } },
    ];
    const curve = emissionImpulseCurve(impulses);
    // Antes del golpe, el piso; en el golpe, el pico; después, otra vez el
    // piso. El piso es casi cero a propósito: entre golpe y golpe la línea
    // tiene que callarse, o la emisión se vuelve un chorro constante en el
    // que no se reconoce ningún golpe.
    expect(sampleCurve(curve, 5, 0)).toBeCloseTo(0.02, 6);
    expect(sampleCurve(curve, 10, 0)).toBeCloseTo(1, 6);
    expect(sampleCurve(curve, 10.5, 0)).toBeCloseTo(0.02, 6);
    // La fuerza del golpe manda en la altura, y manda de verdad: el piso del
    // pico es 0.15, no 0.5. Como el caudal es cuadrático, con 0.5 el golpe
    // más débil ya se llevaba un cuarto de lo que se lleva uno pleno.
    expect(sampleCurve(curve, 30, 0)).toBeCloseTo(0.15, 6);
    expect(sampleCurve(curve, 152, 0)).toBeCloseTo(0.02, 6);
  });

  it('recorta la caída contra el golpe siguiente sin perder ningún pico', () => {
    const close = [0, 0.1].map((t) => ({
      t, strength: 1, band: 'mid' as const, shares: { low: 0, mid: 1, high: 0 },
    }));
    const curve = emissionImpulseCurve(close);
    // Dos golpes a 0.1 s son dos golpes: cada uno conserva su pico.
    expect(sampleCurve(curve, 0, 0)).toBeCloseTo(1, 6);
    expect(sampleCurve(curve, 0.1, 0)).toBeCloseTo(1, 6);
    // La caída del primero se corta justo donde arranca el ataque del
    // segundo, así que el valle es corto y nunca baja del piso.
    const trough = sampleCurve(curve, 0.08, 0);
    expect(trough).toBeCloseTo(0.02, 6);
    for (let t = 0; t <= 0.12; t += 0.005) {
      expect(sampleCurve(curve, t, 0)).toBeGreaterThanOrEqual(0.02 - 1e-9);
    }
    // Y las keys quedan ordenadas: recortar no puede desordenar la curva.
    for (let index = 1; index < curve.keys.length; index += 1) {
      expect(curve.keys[index].t).toBeGreaterThan(curve.keys[index - 1].t);
    }
  });

  it('no emite nada antes de tiempo con la lista vacía', () => {
    expect(emissionImpulseCurve([]).keys).toEqual([{ t: 0, v: 0.02, shape: 'linear' }]);
  });
});

describe('seedShowDoc', () => {
  it('siembra la emisión por impulsos, uno por golpe audible', () => {
    const doc = seedShowDoc(analysis);
    const impulses = pickImpulses(analysis.onsets);
    // La emisión vive sólo hasta el chorro blanco, así que se cuenta contra
    // los golpes de ese tramo: tres keys por impulso como mucho —subida, pico
    // y caída— y más de una por golpe.
    const emitting = impulses.filter((impulse) => impulse.t < WHITE_BURST_AT - 1);
    expect(doc.curves.emission.keys.length).toBeLessThanOrEqual(emitting.length * 3 + 8);
    expect(doc.curves.emission.keys.length).toBeGreaterThan(emitting.length);
    // Cada pico de la curva cae en un golpe del track y pega más fuerte que
    // el silencio que lo precede: es lo que hace que la imagen suene en vez
    // de emitir parejo por debajo. Se mira contra los picos y no contra los
    // golpes porque la curva se adelgaza —un chorro cada 0.6 s como mucho—,
    // así que hay golpes que a propósito no tienen pico propio.
    const peaks = doc.curves.emission.keys.filter(
      (key, index, keys) => key.v > 0.1
        && (keys[index - 1]?.v ?? 0) < key.v
        && (keys[index + 1]?.v ?? 0) < key.v,
    );
    expect(peaks.length).toBeGreaterThan(20);
    for (const peak of peaks) {
      expect(peak.v).toBeGreaterThan(sampleCurve(doc.curves.emission, peak.t - 0.05, 0));
    }
    // Ningún par de picos más cerca que el adelgazado: la curva son chorros
    // que se distinguen, no una cerca de estacas.
    for (let index = 1; index < peaks.length; index += 1) {
      expect(peaks[index].t - peaks[index - 1].t).toBeGreaterThan(0.55);
    }
    // Y la mayoría cae en un golpe del track. Los pocos que no son los
    // rescatados: puffs parados en el máximo de flujo de un hueco, donde por
    // definición no hay ataque que detectar.
    const onBeat = peaks.filter(
      (peak) => impulses.some((impulse) => Math.abs(impulse.t - peak.t) < 0.7),
    );
    expect(onBeat.length / peaks.length).toBeGreaterThan(0.6);
    // La emisión es por impulsos, NUNCA continua: la mayor parte del tiempo
    // la línea calla, y los golpes (duros o blandos) escupen por encima. Un
    // piso continuo que seguía al volumen se probó y emitía parejo desde el
    // segundo cero hasta gastar el techo — exactamente lo que no va.
    const share = (from: number, to: number, test: (value: number) => boolean): number => {
      let hits = 0;
      let frames = 0;
      for (let t = from; t < to; t += 0.05) {
        frames += 1;
        if (test(sampleCurve(doc.curves.emission, t, 0))) hits += 1;
      }
      return hits / frames;
    };
    expect(share(0, 40, (value) => value < 0.06)).toBeGreaterThan(0.45);
    // Los chorros grandes están donde el track pega. La altura la manda el
    // VOLUMEN del pasaje, así que un ataque seco en el silencio sale
    // chiquito: la curva pasa de la mitad en una fracción chica del tiempo,
    // no en cualquier lado.
    expect(share(0, 45, (value) => value > 0.5)).toBeLessThan(0.15);
    expect(share(20, 45, (value) => value > 0.5)).toBeGreaterThan(0.03);
    // Menos tiempo por encima que antes: de 0:00 a 0:35 son DIEZ chorros
    // grandes y silencio entre medio, no una sucesión. Es lo dibujado.
    expect(share(20, 45, (value) => value > 0.3)).toBeGreaterThan(0.07);
    expect(share(20, 45, (value) => value > 0.3)).toBeLessThan(0.45);
    // Los pasajes que suenan sin onsets (0:02-0:13) tienen sus chorros: los
    // golpes blandos y los lomos del volumen, no silencio total.
    let puffs = 0;
    let wasHigh = false;
    for (let t = 2; t < 13; t += 0.05) {
      const high = sampleCurve(doc.curves.emission, t, 0) > 0.1;
      if (high && !wasHigh) puffs += 1;
      wasHigh = high;
    }
    // Tres, que son los que Manuel dibujó ahí (0:04.4, 0:07 y 0:09.9).
    expect(puffs).toBeGreaterThanOrEqual(3);
    // En los primeros 35 s se escuchan golpes sueltos: ni uno pegado al otro
    // ni un desierto.
    const early = impulses.filter((impulse) => impulse.t <= 35);
    expect(early.length).toBeGreaterThan(15);
    expect(early.length).toBeLessThan(60);
  });

  it('los tres momentos blancos: pocos, de evento, y la línea se apaga en el primero', () => {
    const doc = seedShowDoc(analysis);
    const allBursts = doc.events.filter((event) => event.type === 'emit-burst');
    // Cinco chorros, todos blancos: los TRES de la historia (0:40, 0:50 y
    // 0:59) más los dos refuerzos del final —2:02 y 2:27.9—, que no cuentan
    // como momentos del guion. El primero nace con el rojo prendido y nadie
    // lo ve hasta que la luz cruza al blanco; el segundo cae en el golpe
    // pleno con el que el track cierra. Los dos están para que el cierre
    // tenga con qué trabajar: ahí las blancas son lo único visible.
    expect(allBursts).toHaveLength(6);
    for (const burst of allBursts) expect(burst.params.material).toBe(0);
    const topUp = allBursts.filter((burst) => burst.t > 100);
    expect(topUp).toHaveLength(3);
    const bursts = allBursts.filter((burst) => burst.t <= 100);
    // Los tres de la historia siguen siendo pocos y chicos: la luz la pone la
    // curva de luz, no la cantidad de blancas.
    expect(bursts).toHaveLength(3);
    let total = 0;
    for (const burst of bursts) total += burst.params.count;
    expect(total).toBeLessThanOrEqual(1000);
    // Los tres refuerzos del final, cada uno sobre lo que hay cuando entra:
    // 20 % en 2:00, 22 % en 2:02 y 15 % en 2:27.9, Y ENCIMA UN 10 % MÁS
    // pedido a mano sobre el total del final: los tres se escalan por 1.26 y
    // el cierre pasa de 1 618 blancas a 1 780. El techo no estorba — el
    // blando (14 000) sólo frena la curva de emisión, que a esta altura está
    // en cero hace un minuto, y contra el duro (36 000) sobra la mitad.
    let running = total;
    for (const [burst, share] of [
      [topUp[0], 0.258], [topUp[1], 0.225], [topUp[2], 0.155],
    ] as const) {
      expect(burst.params.count / running).toBeGreaterThan(share - 0.02);
      expect(burst.params.count / running).toBeLessThan(share + 0.02);
      running += burst.params.count;
    }
    expect(running).toBe(1780);
    // Y la última entra REPARTIDA: 239 blancas de golpe en la boca de la
    // línea, dentro de una masa ya densa, son una bomba de presión y lo que
    // se ve es el cierre entero prendido justo en el último cuadro.
    expect(topUp[2].dur).toBeGreaterThanOrEqual(2.5);
    const [first, big, explosion] = bursts;
    // Cada uno sobre su boom: 0:40, 0:50 y 0:59, no en el aire.
    expect(Math.abs(first.t - FIRST_WHITE_AT)).toBeLessThan(2);
    expect(Math.abs(big.t - WHITE_BURST_AT)).toBeLessThan(2);
    expect(Math.abs(explosion.t - EXPLOSION_AT)).toBeLessThan(2);
    // El de 0:40 es el chiquito; el de 0:50, el grande.
    expect(first.params.count).toBeLessThan(big.params.count * 0.4);
    // Son eventos y no tramos de la curva para que sobrevivan a que la
    // emisión se redibuje a mano: la curva en 0:50 ya está en cero.
    for (let t = big.t; t < doc.duration; t += 0.25) {
      expect(sampleCurve(doc.curves.emission, t, 1)).toBe(0);
    }
    // La línea apaga su luz en el primer blanco PERO SIGUE EMITIENDO: la
    // curva de emisión sigue viva entre 0:40 y 0:50.
    expect(sampleCurveId(doc, 'lineEmit', first.t - 1)).toBe(1);
    expect(sampleCurveId(doc, 'lineEmit', first.t + 0.2)).toBe(0);
    expect(sampleCurveId(doc, 'lineEmit', doc.duration - 1)).toBe(0);
    const alive = [];
    for (let t = first.t + 1; t < big.t - 1; t += 0.05) {
      alive.push(sampleCurve(doc.curves.emission, t, 0));
    }
    expect(Math.max(...alive)).toBeGreaterThan(0.3);

    // El blob de 0:50 atrae al resto mientras pasea, y en la explosión de
    // 0:59 los repele.
    const blob = doc.events.find(
      (event) => event.type === 'attractor' && event.t > big.t && event.t < big.t + 1,
    )!;
    expect(blob.params.mode).toBe(0);
    expect(blob.params.wander).toBeGreaterThan(0);
    expect(blob.t + blob.dur).toBeLessThanOrEqual(explosion.t + 0.1);
    const repel = doc.events.find(
      (event) => event.type === 'attractor' && Math.abs(event.t - explosion.t) < 0.01,
    )!;
    expect(repel.params.mode).toBe(1);

    // Y la lámpara pasa a blanco en el primer blanco, no antes.
    expect(lampAt(doc, first.t - 0.5).primary).toBe(LAMP_NONE);
    expect(lampAt(doc, first.t + 0.5).primary).toBe(0);
    // Con la luz al mango desde el chorro grande: pocos blancos que arden.
    expect(sampleCurveId(doc, 'lightEmission', big.t + 1)).toBe(1);
  });

  it('los cambios caen donde el sonido empieza, no en su pico', () => {
    const doc = seedShowDoc(analysis);
    // El caso que se escuchaba atrasado: el pasaje de 1:06 crece desde ~66.3
    // y el detector marca el pico en 67.8. El cambio tiene que caer al
    // comienzo de la subida.
    const anchored = doc.curves.gravitySense.keys.map((key) => key.t);
    const nearSixtySix = anchored.find((t) => t > 65 && t < 67.5);
    expect(nearSixtySix).toBeDefined();
    expect(anchored.some((t) => Math.abs(t - 67.84) < 0.2)).toBe(false);
    // Y un golpe seco no se mueve: el de 1:31 sigue en su golpe.
    expect(anchored.some((t) => t > 91 && t < 92.2)).toBe(true);
  });

  it('en la segunda mitad se alternan tirones secos con atractores largos', () => {
    const doc = seedShowDoc(analysis);
    const regime = doc.events.filter((event) => (
      event.type === 'attractor'
      && doc.curves.gravitySense.keys.some((key) => Math.abs(key.t - event.t) < 1e-6)
    ));
    // Entre 1:00 y 1:35 (después empieza la calma, que es otra cosa).
    const late = regime.filter((event) => event.t >= 60 && event.t < 95);
    const long = late.filter((event) => event.dur > 3.5);
    const short = late.filter((event) => event.dur < 3);
    // Hay de los dos: el golpe seco y el clima que sostiene y pasea. Sin los
    // largos, entre golpe y golpe de la segunda mitad no pasaba nada.
    expect(long.length).toBeGreaterThan(0);
    expect(short.length).toBeGreaterThan(0);
    for (const event of long) {
      expect(event.params.sustain).toBeGreaterThan(0.3);
      expect(event.params.wander).toBeGreaterThan(0);
    }
  });

  it('desde 1:35 respira, antes de 2:00 se juntan, y desde 2:03 quedan pegados', () => {
    const doc = seedShowDoc(analysis);
    // La calma va de 1:35 al cierre; lo que pasa de 2:03 en adelante es otra
    // cosa y se mira aparte, más abajo.
    const calm = doc.events.filter(
      (event) => event.type === 'attractor' && event.t >= 95 && event.t < 123,
    );
    // En la calma no hay un solo atractor violento: todos suaves (envolvente
    // de respiración), lentos y de fuerza contenida — atracciones y algún
    // remolino respirado, salvo los agarres del final, que van aparte.
    expect(calm.length).toBeGreaterThan(3);
    // EL AGARRE PERMANENTE es la excepción y se mira aparte: fuerza
    // constante (`sustain` 1 con `soft` 0), clavado en el centro y de cuadro
    // entero. Es lo único que impide que la bola rebote cuando la juntada la
    // suelta — medido sobre la cadena real contra el solver, sin él la
    // dispersión salta de 324 a 667 px a los dos segundos de soltarla y se
    // queda ahí hasta el final (1 192 blancas sueltas de 1 608).
    const hold = calm.filter((event) => event.params.sustain === 1);
    expect(hold).toHaveLength(1);
    expect(hold[0].params.radius).toBeGreaterThanOrEqual(2);
    expect(hold[0].params.soft).toBe(0);
    // Débil: no tiene que juntar nada (ya están juntas), sólo no soltarlas.
    expect(hold[0].params.force).toBeLessThanOrEqual(0.25);
    // Y CLAVADO: si paseara, se llevaría la masa entera con él.
    expect(hold[0].params.wander).toBe(0);
    // Dura hasta el último cuadro del show.
    expect(hold[0].t + hold[0].dur).toBeCloseTo(doc.duration, 3);
    for (const event of calm) {
      if (event.params.sustain === 1) continue;
      expect(event.params.soft).toBe(1);
      if (event.params.mode === 4) continue;
      expect(event.params.force).toBeLessThanOrEqual(1);
      expect(event.dur).toBeGreaterThan(2.5);
      expect([0, 2]).toContain(event.params.mode);
    }
    // La respiración de fondo: pulsos regulares hasta la juntada.
    const breaths = calm.filter((event) => event.params.radius === 0.45);
    expect(breaths.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < breaths.length; index += 1) {
      expect(breaths[index].t - breaths[index - 1].t).toBeCloseTo(9, 5);
    }
    // La juntada: una sola atracción larga y amplia que termina antes de 2:03.
    const gather = calm.find((event) => event.t === 112)!;
    // Radio de CUADRO ENTERO, no de medio cuadro. El radio se mide en el
    // LADO CORTO, así que la media diagonal de una pantalla de 2100x847 ya
    // es 1.34 y la de una 32:9 es 1.8: con 0.5 no llegaba ni a los bordes
    // (medido: la dispersión de las blancas pasaba de 882 a 1017 px) y con
    // 1.3 tapaba la pantalla de Manuel pero no cualquiera. Va en 2.
    expect(gather.params.radius).toBeCloseTo(2, 6);
    expect(gather.t + gather.dur).toBeLessThanOrEqual(123);
    // Y desde 2:03 el cierre: quieto NO es congelado. Ni un flash ni un
    // estrobo en los primeros doce segundos —eso reventaría una masa tenue—,
    // pero sí dos cosas que la mantienen viva: la respiración (atracción
    // ancha y suave que la va juntando) y los toquecitos (tirones chiquitos
    // del tamaño del pincel del mouse, que encienden un puñado y las dejan
    // apagarse). Los agarres grandes recién a los doce segundos.
    const stillFlashes = doc.events.filter(
      (event) => event.t >= 123 && event.t < 135
        && (event.type === 'flash' || event.type === 'strobe-lines'),
    );
    expect(stillFlashes).toEqual([]);
    const closing = doc.events.filter(
      (event) => event.type === 'attractor' && event.t >= 123,
    );
    const closingBreaths = closing.filter((event) => event.params.radius === 0.45);
    // Los agarres ya no se separan por radio sino por DURACIÓN: ahora agarran
    // un puñado (0.13) y no la masa entera (0.3), así que miden lo mismo que
    // un toquecito. Lo que los distingue es que duran seis segundos y medio.
    const grabs = closing.filter((event) => event.dur >= 5 && event.params.radius !== 0.45);
    const pokes = closing.filter((event) => event.dur < 5 && event.params.radius < 0.2);
    expect(closing).toEqual(
      [...closingBreaths, ...pokes, ...grabs].sort((a, b) => a.t - b.t),
    );
    // La respiración: suave (soft), corta, sin tirón, cada cinco segundos.
    // El radio se queda CORTO y ahora con motivo: de juntar se encarga el
    // agarre permanente, que es de cuadro entero. Esto es un latido encima.
    expect(closingBreaths.length).toBeGreaterThanOrEqual(6);
    // Entre inhalación e inhalación tiene que quedar SILENCIO LIMPIO: al
    // menos tres constantes del freno (0.46 s cada una), o el brillo no llega
    // a apagarse y el latido se vuelve una meseta encendida. Es lo que pasó
    // cuando la respiración se hizo más larga y más fuerte a la vez.
    const silence = (breath: typeof closingBreaths[number]): number => 5 - breath.dur;
    for (const breath of closingBreaths) {
      expect(breath.params.soft).toBe(1);
      expect(breath.params.mode).toBe(0);
      // Y la fuerza BAJA a un cuarto. Con el agarre permanente la masa quedó
      // junta y densa, y ahí una inhalación que antes movía media docena de
      // grumos sueltos mueve TODO: medido sobre la cadena real, con 0.25 la
      // mediana del brillo en los tramos quietos va 0.15-1.32 y con 0.15 va
      // 0.14-0.79 — o sea, lo mismo que sin respiración (0.13-0.80). El
      // latido sale gratis a 0.15 y cuesta el doble a 0.25.
      expect(breath.params.force).toBeCloseTo(0.15, 6);
      expect(silence(breath)).toBeGreaterThan(0.46 * 3);
    }
    for (let index = 1; index < closingBreaths.length; index += 1) {
      const gap = closingBreaths[index].t - closingBreaths[index - 1].t;
      expect(gap).toBeCloseTo(5, 5);
      // Y entre inhalación e inhalación queda silencio limpio: el freno tarda
      // 0.46 s en devolver la masa al piso, así que hacen falta más de tres
      // constantes o el brillo no se apaga y el latido se vuelve meseta.
      expect(gap - closingBreaths[index].dur).toBeGreaterThan(1.4);
    }
    // Los toquecitos: cortos, chicos, pegados (no soft), y TODO el repertorio
    // —click, empujón, remolino para los dos lados y agarre— porque es lo que
    // se pidió que hubiera más. Van con el sonido: uno por golpe, con el
    // tamaño y la fuerza que le da el golpe.
    expect(pokes.length).toBeGreaterThanOrEqual(12);
    for (const poke of pokes) {
      expect(poke.params.soft).toBe(0);
      expect(poke.dur).toBeLessThanOrEqual(1.25);
      expect(poke.params.radius).toBeLessThan(0.15);
      expect([0, 1, 2, 3, 4]).toContain(poke.params.mode);
    }
    expect(new Set(pokes.map((poke) => poke.params.mode)).size).toBeGreaterThanOrEqual(4);
    // Nunca dos encimados, y ningún hueco largo sin que pase nada.
    for (let index = 1; index < pokes.length; index += 1) {
      const gap = pokes[index].t - pokes[index - 1].t;
      expect(gap).toBeGreaterThanOrEqual(0.9);
      expect(gap).toBeLessThan(2.6);
    }
    // Y el tamaño lo pone el golpe: los del final, donde el track revienta,
    // son los grandes.
    const last = pokes.filter((poke) => poke.t > 147);
    expect(Math.max(...last.map((poke) => Number(poke.params.force))))
      .toBeGreaterThan(Math.min(...pokes.map((poke) => Number(poke.params.force))) * 1.4);
    // Y los agarres, que son los únicos grandes del cierre.
    expect(grabs.length).toBeGreaterThanOrEqual(2);
    expect(grabs.every((grab) => grab.params.mode === 4)).toBe(true);
    expect(grabs[0].t).toBeCloseTo(135, 6);
    const finalEvents = grabs;
    for (const event of finalEvents) {
      expect(event.params.mode).toBe(4);
      expect(event.params.soft).toBe(1);
      // El agarre agarra UN PUÑADO, no la masa entera. Con el agarre
      // permanente la masa queda junta en unos 310 px de punta a punta, y un
      // radio de 0.3 (254 px) se la llevaba toda: medido sobre la cadena
      // real, la mediana del brillo se iba al techo (3.4) los seis segundos
      // del agarre. Con 0.13 se lleva un pedazo y deja el reguero encendido
      // detrás, que es lo que se quiere ver.
      expect(event.params.radius).toBeCloseTo(0.13, 6);
      expect(event.dur).toBeGreaterThan(5);
      expect(event.params.wander).toBeGreaterThan(0.1);
    }
    // Pegados pero NO atascados: con la cohesión al mango la masa hierve en
    // el lugar —las partículas se rebotan entre ellas y quedan iluminadas
    // para siempre— y el cierre es justamente donde eso no puede pasar.
    for (let t = 123.5; t < doc.duration; t += 2) {
      const cohesion = sampleCurveId(doc, 'cohesion', t);
      expect(cohesion).toBeGreaterThan(0.5);
      expect(cohesion).toBeLessThan(0.75);
      expect(sampleCurveId(doc, 'viscosity', t)).toBeGreaterThanOrEqual(0.85);
    }
    // Y los blobs se alentan desde 1:35: el freno es lo que deja leer el
    // cambio de intensidad de la luz.
    for (let t = 95.5; t < doc.duration; t += 2) {
      expect(sampleCurveId(doc, 'viscosity', t)).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('la luz late con el track entre el chorro y el rojo', () => {
    const doc = seedShowDoc(analysis);
    // El latido: entre 0:52 y 1:19 la luz emitida no es una meseta — respira
    // con el flujo del track, sin bajar nunca del 75 % de la base.
    const seen: number[] = [];
    for (let t = 52; t < 79; t += 0.4) {
      seen.push(sampleCurveId(doc, 'lightEmission', t));
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.1);
    // El piso baja en los grumos de luz (base 0.8 tras la explosión): la
    // mezcla iluminaba todo demasiado y ese tramo ahora es más oscuro.
    expect(Math.min(...seen)).toBeGreaterThan(0.6);
    // Y de 1:20 en adelante el rojo queda firme, que fue lo pedido.
    for (const t of [82, 110, 150]) {
      expect(sampleCurveId(doc, 'lightEmission', t)).toBeGreaterThan(0.9);
    }
    // Los barridos de sombra se probaron y se sacaron: no interactúan con el
    // fluido, sólo lo tapan. La siembra no deja ninguno.
    expect(doc.events.filter((event) => event.type === 'shadow-bar')).toHaveLength(0);
    // Y todo atractor pasea: clavado donde no hay nada, no captura. La única
    // excepción es el agarre permanente del cierre, que es de cuadro entero
    // —le entra todo, no necesita buscar— y que si paseara se llevaría la
    // masa entera con él en vez de sostenerla.
    for (const event of doc.events) {
      if (event.type !== 'attractor') continue;
      if (event.params.sustain === 1 && event.params.radius >= 2) continue;
      expect(event.params.wander).toBeGreaterThan(0);
    }
  });

  it('el redoble de 0:29 emite como redoble, y 0:25-0:35 acompaña al sonido', () => {
    const doc = seedShowDoc(analysis);
    const impulses = pickImpulses(analysis.onsets);
    // La ráfaga alrededor de 0:29 sobrevive a la supresión: varios golpes, no
    // uno solo — con la ventana vieja quedaba un golpe por ráfaga y el tramo
    // no emitía con lo que se escuchaba.
    const roll = impulses.filter((i) => i.t >= 28.9 && i.t <= 29.9);
    expect(roll.length).toBeGreaterThanOrEqual(3);
    // La emisión de 25-35 son los chorros que Manuel dibujó ahí: DOS, grandes
    // (0:29 y 0:32.7), no cinco. El redoble sigue existiendo en el análisis
    // —es lo que se comprueba arriba— pero de 0:00 a 0:35 la curva la dictó
    // él, no el detector.
    let bursts = 0;
    let wasHigh = false;
    for (let t = 25; t <= 35; t += 0.05) {
      const high = sampleCurve(doc.curves.emission, t, 0) > 0.4;
      if (high && !wasHigh) bursts += 1;
      wasHigh = high;
    }
    expect(bursts).toBeGreaterThanOrEqual(2);
    // Y son grandes: cada uno llega al tope.
    let peak = 0;
    for (let t = 25; t <= 35; t += 0.05) {
      peak = Math.max(peak, sampleCurve(doc.curves.emission, t, 0));
    }
    expect(peak).toBeGreaterThan(0.9);
  });

  it('en 1:10 todo se une rápido alrededor de la luz, y suelta hacia 1:20', () => {
    const doc = seedShowDoc(analysis);
    const gather = doc.events.find(
      (event) => event.type === 'attractor' && event.t > 68 && event.t < 72,
    )!;
    // Ataque inmediato (sin envolvente suave), fuerza grande, radio enorme, y
    // dura justo hasta 1:20, perdiendo fuerza por el camino (sostén parcial).
    expect(gather.params.soft).toBe(0);
    expect(gather.params.mode).toBe(0);
    expect(gather.params.radius).toBeGreaterThanOrEqual(0.5);
    expect(gather.params.force).toBeGreaterThan(2);
    // Suelta justo donde se prende el rojo: 1:20.90 CLAVADO, que es la hora
    // que se pidió. No se engancha a ningún golpe — el anterior cae en 80.78
    // y el siguiente en 81.37, y las dos veces quedaba corrida.
    const redOn = doc.events.find(
      (event) => event.type === 'set-lamp' && event.params.primary === 1,
    )!;
    expect(gather.t + gather.dur).toBeCloseTo(redOn.t, 1);
    expect(redOn.t).toBe(80.9);
    // Adentro de la unión no corre ningún otro tirón que compita.
    const inside = doc.events.filter(
      (event) => event.type === 'attractor' && event.id !== gather.id
        && event.t >= gather.t && event.t < 80,
    );
    expect(inside).toHaveLength(0);
  });

  it('en 1:35 la luz parpadea: negro, blancas un instante, y vuelve el rojo', () => {
    const doc = seedShowDoc(analysis);
    expect(lampAt(doc, 94.7).primary).toBe(1);
    expect(lampAt(doc, 95.1).primary).toBe(LAMP_NONE);
    expect(lampAt(doc, 96).primary).toBe(0);
    // Y ese blanco termina JUSTO en 1:36.27, ni un cuadro más: se pidió la
    // hora exacta porque con 1.8 s de blanco se estiraba hasta casi 1:37.
    expect(lampAt(doc, 96.2).primary).toBe(0);
    expect(lampAt(doc, 96.3).primary).toBe(1);
    expect(lampAt(doc, 97.2).primary).toBe(1);
    expect(lampAt(doc, 120).primary).toBe(1);
  });

  it('de 0:20 al chorro blanco la línea no se queda muda: suena y emite', () => {
    const doc = seedShowDoc(analysis);
    // Ese tramo suena todo el tiempo (el rms no baja de 0.16) y quedaba con
    // huecos de hasta cuatro segundos y medio sin un solo golpe: el umbral
    // relativo se come lo que está al lado de un bombazo, y de 0:34 a 0:40 no
    // hay ni ataques que detectar. El rescate por hueco los llena.
    const keys = doc.curves.emission.keys.filter((key) => key.t >= 19.5 && key.t <= 49.85);
    // Cualquier chorro por encima del chorrito de base cuenta: desde que la
    // altura la manda el volumen del pasaje, un golpe en un tramo tranquilo
    // sale chico A PROPÓSITO — pero sale.
    const hits = keys.filter((key) => key.v > 0.1).map((key) => key.t);
    let worst = 0;
    for (let index = 1; index < hits.length; index += 1) {
      worst = Math.max(worst, hits[index] - hits[index - 1]);
    }
    // De 0:35 en adelante manda la regla automática y ahí no hay huecos
    // largos. Antes de 0:35 los huecos son los que dibujó Manuel: diez
    // chorros grandes bien separados, hasta cinco segundos entre uno y otro.
    expect(worst).toBeLessThan(5.2);
    const afterHis = hits.filter((t) => t >= 35);
    let worstAuto = 0;
    for (let index = 1; index < afterHis.length; index += 1) {
      worstAuto = Math.max(worstAuto, afterHis[index] - afterHis[index - 1]);
    }
    expect(worstAuto).toBeLessThan(2.6);
    // Y la curva pasa la mayor parte del tramo por encima del piso: emite con
    // lo que suena, no una vez cada tres segundos.
    let sounding = 0;
    let total = 0;
    for (let t = 19.5; t <= 49.8; t += 0.05) {
      total += 1;
      if (sampleCurve(doc.curves.emission, t, 0) > 0.06) sounding += 1;
    }
    expect(sounding / total).toBeGreaterThan(0.18);
  });

  it('en 1:11 y en 1:31 la iluminación estrobea CON EL SONIDO', () => {
    const doc = seedShowDoc(analysis);
    // El de 1:11 es largo —hasta 1:14, porque ahí el sonido sostiene— y el de
    // 1:31 es corto. Los dos estrobean el BLANCO y al final la luz cae en lo
    // que manda el guion en esa hora: blanco en 1:11, donde el rojo todavía
    // no existe, y rojo en 1:31.
    for (const [target, seconds, back] of [[71, 3, 0], [91, 0.9, 1]] as const) {
      const lamps = doc.events.filter(
        (event) => event.type === 'set-lamp'
          && event.t >= target - 1.2 && event.t <= target + seconds + 0.4,
      );
      expect(lamps.length).toBeGreaterThanOrEqual(7);
      // Prende blanco, apaga, prende blanco, apaga... y el último cambio es
      // el color de vuelta.
      lamps.slice(0, -1).forEach((event, index) => {
        expect(event.params.primary).toBe(index % 2 === 0 ? 0 : LAMP_NONE);
      });
      expect(lamps[lamps.length - 1].params.primary).toBe(back);
      // Y NO es un metrónomo: cada prendida cae en un ataque del track. A 9 Hz
      // fijos era una luz de discoteca corriendo por su cuenta al lado de la
      // música.
      const sparks = lamps.slice(0, -1).filter((_, index) => index % 2 === 0);
      for (const spark of sparks) {
        expect(analysis.onsets.some((onset) => Math.abs(onset.t - spark.t) < 0.02)).toBe(true);
      }
      // Con separaciones desparejas: si fueran todas iguales, sería el
      // metrónomo de nuevo.
      const gaps = sparks.slice(1).map((spark, index) => spark.t - sparks[index].t);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.05);
      // Y bien pegadas: el destello dura menos de 80 ms.
      for (let index = 0; index < lamps.length - 2; index += 2) {
        expect(lamps[index + 1].t - lamps[index].t).toBeLessThanOrEqual(0.076);
      }
      expect(lampGapAt(doc, sparks[1].t) * 0.4).toBeLessThan(0.09);
    }
  });

  it('si suena fuerte, emite: la altura del chorro sigue al volumen', () => {
    // Lo pedido, tres veces y a los gritos: de 0:00 a 0:35, cuando el track
    // pega BIEN fuerte, la línea tiene que estar escupiendo. El detector de
    // onsets mide ataques, no volumen, y hay pasajes que pegan sin ninguno
    // (0:12 llega al percentil 88 del rms y no tenía un solo impulso), así
    // que la curva se arma también con los LOMOS del volumen.
    const doc = seedShowDoc(analysis);
    const rate = analysis.envelopeRate;
    const rms = smoothEnvelope(analysis.envelopes.rms, rate, 0.4);
    const level = (t: number): number => rms[Math.round(t * rate)] ?? 0;
    const window = rms.slice(0, Math.round(50 * rate)).slice().sort((a, b) => a - b);
    const loudGate = window[Math.floor(0.85 * (window.length - 1))];
    const quietGate = window[Math.floor(0.25 * (window.length - 1))];
    // Dentro de un segundo: el chorro sale con el ataque del pasaje fuerte,
    // que no cae exactamente en el pico del volumen.
    const highest = (t: number, half = 0.9): number => {
      let best = 0;
      for (let probe = t - half; probe <= t + half; probe += 0.05) {
        best = Math.max(best, sampleCurve(doc.curves.emission, probe, 0));
      }
      return best;
    };
    // En cada lomo del volumen de 0:00 a 0:35 hay un chorro de verdad cerca, y
    // el tamaño va con lo fuerte que pega: en el percentil 85 sale un chorro
    // mediano y en el 95 —lo BIEN fuerte— sale el grande.
    const veryLoud = window[Math.floor(0.95 * (window.length - 1))];
    // De 0:00 a 0:35 la curva la dibujó Manuel y su lista manda: hay lomos
    // fuertes que él decidió NO marcar, y eso no es un defecto. La regla del
    // volumen se comprueba donde sigue corriendo, de 0:35 al chorro blanco.
    let loudMoments = 0;
    let veryLoudMoments = 0;
    for (let t = 35.5; t <= 49; t += 0.5) {
      if (level(t) < loudGate) continue;
      loudMoments += 1;
      expect(highest(t)).toBeGreaterThan(0.35);
      if (level(t) < veryLoud) continue;
      veryLoudMoments += 1;
      // 0:42-0:43 es lo más fuerte del track pero no tiene ataques secos, así
      // que sale grande sin llegar al tope: la altura la manda el volumen y
      // el ataque modula.
      expect(highest(t)).toBeGreaterThan(0.6);
    }
    expect(loudMoments).toBeGreaterThan(3);
    expect(veryLoudMoments).toBeGreaterThan(0);
    // Y en los pozos, la línea calla: no es un chorro constante. Se mira
    // pegado al instante, no a un segundo: a un segundo ya se toca la caída
    // del chorro del pasaje fuerte de al lado, que es justamente lo que tiene
    // que pasar.
    for (let t = 35.5; t <= 49; t += 0.5) {
      if (level(t) > quietGate) continue;
      expect(highest(t, 0.15)).toBeLessThan(0.6);
    }
    // La población no se agota antes de 0:35: a esa altura todavía queda por
    // salir, y para el chorro blanco ya salió casi toda.
    const director = new FluidsShowDirector();
    director.setDoc(doc);
    const dt = 1 / 60;
    let population = 0;
    const at: Record<number, number> = {};
    for (let step = 0; step <= Math.round(50 / dt); step += 1) {
      const time = step * dt;
      const out = director.update({
        time, dt, playing: true, aspect: 2688 / 1008, particleCount: population,
      });
      for (const interaction of out.interactions) {
        if (interaction.mode === 'emit') population += interaction.emitCount;
      }
      for (const mark of [20, 35, 50]) {
        if (Math.abs(time - mark) < dt / 2) at[mark] = population;
      }
    }
    expect(at[35] / FLUIDS_SHOW_PARTICLE_CAP).toBeLessThan(0.85);
    expect(at[35] / FLUIDS_SHOW_PARTICLE_CAP).toBeGreaterThan(0.5);
    // Un poco menos que antes: los tres refuerzos del final se reservan su
    // cuota del techo, así que a la curva le queda menos para repartir.
    expect(at[50] / FLUIDS_SHOW_PARTICLE_CAP).toBeGreaterThan(0.85);
  });

  it('la primera parte son los DIEZ chorros que dibujó Manuel, ni uno más', () => {
    // Manuel dibujó a mano la curva de 0:00 a 0:35 y mandó la captura: diez
    // chorros grandes y silencio entre medio. Cualquier regla automática metía
    // veinticuatro ahí —los diez suyos y catorce de más— y NINGÚN corte por
    // altura los separa: su chorro de 0:01.5 mide menos que un intruso de
    // 0:12. Por eso las horas están escritas en `FIRST_PART_HITS` y no se
    // regeneran. Este test es el que impide volver a pisárselas.
    const doc = seedShowDoc(analysis);
    const dibujados = [0.7, 1.5, 4.4, 6.8, 9.6, 13.7, 18.8, 23.6, 28.4, 32.8];
    const bursts = emissionBursts(doc.curves.emission).filter((burst) => burst.peak <= 35);
    expect(bursts).toHaveLength(dibujados.length);
    bursts.forEach((burst, index) => {
      // Cada uno enganchado al golpe más fuerte cerca de la hora dibujada: la
      // lectura de la captura puede errar medio segundo, el golpe no.
      expect(Math.abs(burst.peak - dibujados[index])).toBeLessThan(0.9);
      // Y todos plenos: son pocos y grandes, que es lo que se pidió.
      const peak = doc.curves.emission.keys.find((key) => key.t === burst.peak)!;
      expect(peak.v).toBeGreaterThan(0.9);
    });
    // Cada uno escupe los DOS colores, rojas y negras, como se pidió.
    const director = new FluidsShowDirector();
    director.setDoc(doc);
    const dt = 1 / 60;
    let population = 0;
    const perBurst = bursts.map(() => ({ rojo: 0, negro: 0 }));
    for (let step = 0; step <= Math.round(36 / dt); step += 1) {
      const time = step * dt;
      const out = director.update({
        time, dt, playing: true, aspect: 2688 / 1008, particleCount: population,
      });
      for (const interaction of out.interactions) {
        if (interaction.mode !== 'emit') continue;
        population += interaction.emitCount;
        const index = bursts.findIndex(
          (burst) => time >= burst.rise - 0.1 && time <= burst.peak + 0.6,
        );
        if (index < 0) continue;
        if (interaction.materialId === 1) perBurst[index].rojo += interaction.emitCount;
        if (interaction.materialId === 2) perBurst[index].negro += interaction.emitCount;
      }
    }
    for (const burst of perBurst) {
      expect(burst.rojo).toBeGreaterThan(0);
      expect(burst.negro).toBeGreaterThan(0);
    }
  });

  it('de 0:14 a 0:34 el fluido se QUIEBRA, y la línea con él', () => {
    // El sonido de ese tramo es un árbol quebrándose. Cada chorro se lleva una
    // grieta: una cuña DURA que recorre una recta partiendo la masa, y dos
    // empujones que abren el corte a los costados.
    const doc = seedShowDoc(analysis);
    const fractures = doc.events.filter((event) => event.type === 'fracture');
    const mains = fractures.filter((event) => event.params.force > 0);
    const cracks = fractures.filter((event) => event.params.force === 0);
    expect(mains).toHaveLength(5);
    for (const fracture of fractures) {
      expect(fracture.t).toBeGreaterThanOrEqual(13.5);
      expect(fracture.t).toBeLessThan(34);
    }
    // LOS CRUJIDOS: una rama no se quiebra de una, cruje en una ráfaga de
    // micro-ataques, y el análisis los tiene (el quiebre de 0:29 son DOCE
    // onsets en un segundo). Cada fractura trae los suyos como eventos de
    // FUERZA CERO: al fluido no le hacen nada, a la línea la sacuden.
    expect(cracks.length).toBeGreaterThanOrEqual(20);
    for (const main of mains) {
      const propios = cracks.filter((crack) => (
        crack.t >= main.t - 0.35 && crack.t <= main.t + main.dur + 0.3
      ));
      // La grieta de 0:19 queda en tres: su cola son seis ticks de fondo
      // (fuerza 0.01-0.10) que el corte de 0.12 descarta a propósito.
      expect(propios.length).toBeGreaterThanOrEqual(3);
    }
    for (const crack of cracks) {
      // Cada crujido ES un onset real del track, no un tick inventado.
      expect(analysis.onsets.some((onset) => Math.abs(onset.t - crack.t) < 1e-9)).toBe(true);
      // El golpe manda la sacudida, con piso — y ningún tick de fondo entra
      // (corte de fuerza 0.12: intensity minima 0.2 + 0.8*0.12).
      expect(crack.intensity).toBeGreaterThanOrEqual(0.29);
      expect(crack.intensity).toBeLessThanOrEqual(1);
      expect(crack.dur).toBeCloseTo(0.35, 6);
    }
    // La de 0:29 es la más grande: ahí el track tiene diez ataques, cuatro
    // plenos, y los máximos de flujo, agudo y aire de los cinco chorros.
    const biggest = mains.reduce(
      (best, event) => (event.params.length > best.params.length ? event : best),
    );
    expect(Math.abs(biggest.t - 29.09)).toBeLessThan(0.5);

    // Y llega al fluido: cuñas duras (que hacen REBOTAR, no sólo apartar) más
    // los empujones de los dos lados, todo a la vez.
    const director = new FluidsShowDirector();
    director.setDoc(doc);
    const dt = 1 / 60;
    let wedges = 0;
    let pushes = 0;
    for (let time = biggest.t; time < biggest.t + biggest.dur; time += dt) {
      const out = director.update({
        time, dt, playing: true, aspect: 2100 / 847, particleCount: 9000,
      });
      pushes = Math.max(pushes, out.interactions.filter((i) => i.mode === 'repel').length);
      // Las cuñas de la fractura son más gordas que los anillos de la línea.
      wedges = Math.max(wedges, out.interactions.filter(
        (i) => i.mode === 'collide' && i.radius > 0.02,
      ).length);
    }
    expect(wedges).toBeGreaterThanOrEqual(Number(biggest.params.shards));
    expect(pushes).toBeGreaterThanOrEqual(Number(biggest.params.shards) * 2);

    // LA LÍNEA se quiebra con cada una, y eso se mide en la GEOMETRÍA, no en
    // curvas: el director parte el blade en astillas que se apartan, se
    // tuercen y destellan cada una a su ritmo. Con curvas lo único que se
    // conseguía era que la línea se ACHIQUE, que no es quebrarse.
    const geometryAt = (time: number): ReturnType<typeof director.update>['geometry'] => (
      director.update({
        time, dt, playing: true, aspect: 2100 / 847, particleCount: 9000,
      }).geometry
    );
    // Entera son DOS instancias: el blade y su oclusor de respaldo.
    expect(geometryAt(13.5)).toHaveLength(2);
    // Quebrada son muchas más, y ninguna se apaga del todo: destella.
    const broken = geometryAt(biggest.t + 0.1);
    expect(broken.length).toBeGreaterThan(6);
    const blades = broken.filter((piece) => piece.color === 0xffffff);
    expect(blades.length).toBeGreaterThanOrEqual(4);
    for (const blade of blades) expect(blade.emit).toBeGreaterThan(0);
    // CADA ASTILLA APUNTA A OTRO LADO: no es un temblor alrededor del eje,
    // es un abanico. Entre la que más se abre y la que menos hay más de un
    // radián — con los ±31° de antes las astillas seguían leyéndose como una
    // línea con juntas.
    const rots = blades.map((blade) => blade.rot);
    expect(Math.max(...rots) - Math.min(...rots)).toBeGreaterThan(1);
    // Y CADA UNA ARDE DISTINTO, pero el promedio se mantiene: la línea es la
    // única luz del cuadro en este tramo, así que las intensidades se separan
    // sin que se apague ni se queme.
    const emits = blades.map((blade) => blade.emit);
    expect(Math.max(...emits) / Math.min(...emits)).toBeGreaterThan(2);
    const whole = geometryAt(13.5).filter((piece) => piece.color === 0xffffff)[0];
    const mean = emits.reduce((a, b) => a + b, 0) / emits.length;
    expect(mean).toBeGreaterThan(whole.emit * 0.55);
    expect(mean).toBeLessThan(whole.emit * 1.05);
    expect(new Set(blades.map((blade) => blade.y.toFixed(4))).size).toBeGreaterThan(2);
    // Y QUEDA QUEBRADA. Pasada la fractura la línea NO se rearma: una rama
    // rota no vuelve a ser una rama. Sigue astillada hasta que se apaga.
    expect(geometryAt(biggest.t + biggest.dur + 0.2).length).toBeGreaterThan(6);
    expect(geometryAt(34).length).toBeGreaterThan(6);
    // CADA CRUJIDO vuelve a repartir punterías: dos crujidos seguidos no
    // dejan a las astillas mirando lo mismo.
    const aimsAt = (time: number): string => geometryAt(time)
      .filter((piece) => piece.color === 0xffffff)
      .map((piece) => piece.rot.toFixed(3)).join();
    expect(aimsAt(cracks[1].t + 0.02)).not.toBe(aimsAt(cracks[2].t + 0.02));
    // Y ENTRE crujido y crujido no se congela: tumba (cada astilla sigue
    // girando sola y se frena) y vibra a saltos — dos cuadros cercanos no
    // son iguales ni en ángulo ni en posición.
    const quietA = geometryAt(16.2).filter((piece) => piece.color === 0xffffff);
    const quietB = geometryAt(16.35).filter((piece) => piece.color === 0xffffff);
    expect(quietA.length).toBe(quietB.length);
    expect(quietA.map((piece) => piece.rot.toFixed(4)).join())
      .not.toBe(quietB.map((piece) => piece.rot.toFixed(4)).join());
    expect(quietA.map((piece) => `${piece.x.toFixed(5)},${piece.y.toFixed(5)}`).join())
      .not.toBe(quietB.map((piece) => `${piece.x.toFixed(5)},${piece.y.toFixed(5)}`).join());
    // Y es DETERMINISTA: el mismo instante da exactamente el mismo cuadro,
    // pase lo que pase entre medio — el scrub cae siempre igual.
    expect(JSON.stringify(geometryAt(29.5))).toBe(JSON.stringify(geometryAt(29.5)));
    // LA CURVA `lineBreak` ES LA PERILLA, separada de la emisión y editable
    // a mano — pedido explícito. La siembra la dibuja desde los crujidos: 0
    // antes del primero, piso 0.5 (quebrada y quieta) entre golpe y golpe,
    // picos a la altura de cada golpe, y 0 recién después de que la línea se
    // apagó.
    expect(sampleCurveId(doc, 'lineBreak', 10)).toBe(0);
    expect(sampleCurveId(doc, 'lineBreak', 16.5)).toBeCloseTo(0.5, 1);
    expect(sampleCurveId(doc, 'lineBreak', biggest.t + 0.1)).toBeGreaterThan(0.7);
    expect(sampleCurveId(doc, 'lineBreak', 39)).toBeCloseTo(0.5, 1);
    // La línea se apaga en 0:42 (FIRST_WHITE_AT); la curva se suelta después,
    // cuando ya nadie la ve.
    expect(sampleCurveId(doc, 'lineBreak', 44)).toBe(0);
    // Pocas llaves: tiene que poderse agarrar y editar una, no ser una nube.
    expect(doc.curves.lineBreak.keys.length).toBeLessThanOrEqual(320);
    // Y EL DIRECTOR LA OBEDECE: con la curva en cero la línea queda ENTERA
    // aunque la fractura siga sonando en el fluido — es la garantía de que
    // editarla cambia lo que se ve.
    const muted = new FluidsShowDirector();
    muted.setDoc({ ...doc, curves: { ...doc.curves, lineBreak: { keys: [] } } });
    expect(muted.update({
      time: biggest.t + 0.1, dt, playing: true, aspect: 2100 / 847, particleCount: 9000,
    }).geometry).toHaveLength(2);

    // Y DEJA DE ACHICARSE Y AGRANDARSE. La línea respira con la emisión
    // —se encoge con el chorro y se rearma despacio— pero mientras está
    // quebrada eso se apaga: las dos cosas juntas se leían como un acordeón,
    // y lo que se pidió ver ahí es el quiebre, no el fuelle.
    const largos: number[] = [];
    for (let t = 14.5; t < 34; t += 0.25) {
      largos.push(director.update({
        time: t, dt, playing: true, aspect: 2100 / 847, particleCount: 9000,
      }).status.lineLen);
    }
    expect(Math.max(...largos) - Math.min(...largos)).toBeLessThan(1e-9);
    // Antes de la primera fractura sí respira: ahí el fuelle es lo que hay.
    const antes: number[] = [];
    for (let t = 0.5; t < 13.5; t += 0.25) {
      antes.push(director.update({
        time: t, dt, playing: true, aspect: 2100 / 847, particleCount: 9000,
      }).status.lineLen);
    }
    expect(Math.max(...antes) - Math.min(...antes)).toBeGreaterThan(0.02);

    // El giro NUNCA se toca: el ángulo es la integral de `lineSpin`, así que
    // un tirón ahí correría la línea para siempre (medido: 7.42° que no
    // vuelven nunca). Sus keys son las del baile, ninguna dentro de una
    // fractura.
    const spinAt = doc.curves.lineSpin.keys.map((key) => key.t);
    for (const fracture of mains) {
      expect(spinAt.some((t) => t > fracture.t + 0.001 && t < fracture.t + 0.3)).toBe(false);
    }
  });

  it('el malacate: de 2:10 en adelante las blancas estan SI O SI unidas', () => {
    // Pedido explicito, POR OTRO METODO que los atractores (que empujan a
    // todo material y no prometen nada): el evento `unite` junta SOLO las
    // blancas hacia el centro escribiendo posiciones, y PURGA el nucleo por
    // PERMUTA (un ajeno de adentro y una blanca de afuera se cambian de
    // lugar: la ocupacion del espacio no cambia y la presion ni se entera).
    // Medido contra el solver real con la cadena del director: el racimo
    // conexo mas grande de blancas llega al 100 % a las 2:07 y termina el
    // show en 99 % con un diametro de ~330 px. Sin purga se clava en 52 %
    // (bola unida pero mezclada); purgando por empuje, hierve todo y queda
    // mezclado igual.
    const doc = seedShowDoc(analysis);
    const unites = doc.events.filter((event) => event.type === 'unite');
    expect(unites).toHaveLength(1);
    const [unite] = unites;
    expect(unite.t).toBe(123);
    expect(unite.t + unite.dur).toBeCloseTo(doc.duration, 3);
    expect(unite.params.material).toBe(0);
    expect(unite.params.x).toBe(0.5);
    expect(unite.params.y).toBe(0.5);
    // El radio casa: 0.36 del lado corto. El nucleo purgado es el 55 % de
    // eso (~0.2), que es lo que 1 764 blancas puras pueden llenar — purgar
    // un disco mas grande que la poblacion se queda sin blancas que traer.
    expect(unite.params.radius).toBeCloseTo(0.36, 6);
    expect(unite.params.speed).toBeCloseTo(0.14, 6);
    expect(unite.params.purge).toBe(1);

    // Y el director lo baja al worker: una interaccion `herd` con el
    // material filtrado (lo unico de todo el motor que filtra por material),
    // el paso en vx (fraccion de alto POR FRAME) y los canjes en strength.
    const director = new FluidsShowDirector();
    director.setDoc(doc);
    const dt = 1 / 60;
    const at = (time: number, playing: boolean) => director.update({
      time, dt, playing, aspect: 2100 / 847, particleCount: 16000,
    }).interactions.filter((i) => i.mode === 'herd');
    expect(at(100, true)).toHaveLength(0);
    const herd = at(130, true);
    expect(herd).toHaveLength(1);
    expect(herd[0].materialId).toBe(0);
    expect(herd[0].radius).toBeCloseTo(0.36, 6);
    expect(herd[0].strength).toBe(5);
    // Pasada la rampa de 1.5 s: velocidad plena, 0.14 de alto por segundo.
    expect(herd[0].vx).toBeCloseTo(0.14 * dt, 9);
    // Con el transporte parado no junta: scrubear no reacomoda la masa.
    expect(at(130, false)).toHaveLength(0);
    // Y en la rampa entra suave.
    const early = at(123.3, true);
    expect(early).toHaveLength(1);
    expect(early[0].vx).toBeLessThan(0.14 * dt * 0.5);
  });

  it('en 1:23 una chispa blanca marca el tick de 23 ms', () => {
    // El onset t=83.093 es el ÚNICO de banda alta en un hueco de 11.6 s: un
    // tick seco y brillante encima de un bajón de volumen. Ahí no pasaba
    // nada — tres segundos sin una sola fuerza y las quince curvas planas.
    const doc = seedShowDoc(analysis);
    expect(analysis.onsets.some(
      (onset) => Math.abs(onset.t - 83.093) < 0.01 && onset.band === 'high',
    )).toBe(true);
    expect(lampAt(doc, 83.05).primary).toBe(1);
    expect(lampAt(doc, 83.12).primary).toBe(0);
    expect(lampAt(doc, 83.2).primary).toBe(1);
    // Una chispa, no un estrobo: dos cambios y se acabó.
    const spark = doc.events.filter(
      (event) => event.type === 'set-lamp' && event.t >= 83 && event.t <= 83.3,
    );
    expect(spark).toHaveLength(2);
    expect(spark[1].t - spark[0].t).toBeLessThan(0.1);
    // Y NO es un `blackout`: ese evento sólo escala la irradiancia, y a esta
    // altura (bodies en 0) el cuadro son las caras emisivas y el campo, que
    // no la miran. Por eso todos los apagones del show son set-lamp.
    expect(doc.events.filter((event) => event.type === 'blackout')).toHaveLength(0);
  });

  it('la gravedad sólo existe como pulso: suena el golpe, tira, y se va', () => {
    const doc = seedShowDoc(analysis);
    const keys = doc.curves.gravity.keys;
    expect(keys.length).toBeGreaterThan(3);
    // Ningún valor queda sostenido: cada pulso termina en una key en cero con
    // shape hold, así que entre golpes la gravedad es exactamente cero.
    const last = keys[keys.length - 1];
    expect(last.v).toBe(0);
    expect(last.shape).toBe('hold');
    // Muestreada a lo largo del track, la gravedad pasa la mayoría del tiempo
    // apagada: es un golpe, no un clima.
    let onFrames = 0;
    let frames = 0;
    for (let t = 0; t < doc.duration; t += 0.1) {
      frames += 1;
      if (Math.abs(sampleCurveId(doc, 'gravity', t)) > 0.01) onFrames += 1;
    }
    expect(onFrames / frames).toBeLessThan(0.2);
    // Y justo después de un pulso, cero de verdad.
    for (let index = 2; index < keys.length; index += 3) {
      expect(sampleCurveId(doc, 'gravity', keys[index].t + 0.05)).toBe(0);
    }
  });

  it('la línea baila el giro con los golpes; el tamaño no salta', () => {
    const doc = seedShowDoc(analysis);
    const spinKeys = doc.curves.lineSpin.keys;
    // Varios cambios de giro, ninguno después del chorro blanco.
    const burst = doc.events.find((event) => event.type === 'emit-burst')!;
    expect(spinKeys.length).toBeGreaterThan(6);
    for (const key of spinKeys) {
      expect(key.t).toBeLessThan(burst.t);
    }
    // Arranca en el default: el baile empieza con el primer golpe fuerte.
    expect(spinKeys[0]).toEqual({ t: 0, v: 0.286, shape: 'hold' });
    // Y de verdad cambia: hay giros lentos y rápidos.
    expect(new Set(spinKeys.map((key) => key.v)).size).toBeGreaterThanOrEqual(4);
    // El tamaño NO salta con los golpes: la curva queda para el operador. El
    // encogido por emisión lo pone el director, y el QUIEBRE de las fracturas
    // también — partiendo la geometría, no escribiendo keys.
    expect(doc.curves.lineSize.keys).toEqual([]);
  });

  it('ni un flash ni un estrobo antes de 1:25, y un reset al arrancar', () => {
    const doc = seedShowDoc(analysis);
    // Los flashes de pantalla entera son blancos: hasta 1:25, nada. El
    // primero cae en el golpe que lo pide, cerca de 1:26.
    const flashes = doc.events.filter((event) => event.type === 'flash');
    const strobes = doc.events.filter((event) => event.type === 'strobe-lines');
    expect(flashes.length).toBeGreaterThan(3);
    expect(strobes.length).toBeGreaterThan(3);
    for (const event of [...flashes, ...strobes]) {
      expect(event.t).toBeGreaterThanOrEqual(84);
    }
    expect(flashes[0].t).toBeGreaterThan(85);
    expect(flashes[0].t).toBeLessThan(88);
    // Y arrancar desde cero limpia el cuadro: sin esto la segunda pasada
    // empezaba con la población de la anterior y no se emitía nada.
    const resets = doc.events.filter((event) => event.type === 'reset-fluid');
    expect(resets).toHaveLength(1);
    expect(resets[0].t).toBeLessThan(0.1);
  });

  it('cambia el comportamiento en los golpes fuertes, de 0:30 en adelante', () => {
    const doc = seedShowDoc(analysis);
    const attractors = doc.events.filter((event) => event.type === 'attractor');
    // Espaciados pero abundantes: cambios de comportamiento en los golpes
    // fuertes, con un segundo atractor espejado en los que revientan. Y
    // ninguno antes de 0:30. El cierre tiene su propio vocabulario —muchos
    // gestos chiquitos— y se cuenta aparte: acá se mira el cuerpo del show.
    // LOS TIRONES de los crujidos van aparte: uno por micro-crujido de las
    // fracturas, cortos (0.5 s), pegados al golpe (`soft` 0) y sin sostener
    // (`sustain` 0) — el fluido se mueve CON el glitch y queda libre en
    // cuanto el ruido pasa. Cada uno cae EXACTO donde su crujido.
    const cracksAt = new Set(
      doc.events
        .filter((event) => event.type === 'fracture' && event.params.force === 0)
        .map((event) => event.t),
    );
    const pulls = attractors.filter(
      (event) => event.params.radius === 0.35 && event.dur === 0.5,
    );
    expect(pulls.length).toBe(cracksAt.size);
    for (const pull of pulls) {
      expect(cracksAt.has(pull.t)).toBe(true);
      expect(pull.params.mode).toBe(0);
      expect(pull.params.soft).toBe(0);
      expect(pull.params.sustain).toBe(0);
      expect(pull.intensity).toBeGreaterThanOrEqual(0.2);
    }
    const body = attractors.filter((event) => !pulls.includes(event));
    const beforeClosing = body.filter((event) => event.t < 123);
    expect(beforeClosing.length).toBeGreaterThan(10);
    expect(beforeClosing.length).toBeLessThan(56);
    // Los cambios por golpe fuerte siguen empezando en 0:30. Antes de eso lo
    // único que hay son los GESTOS de la primera parte, uno por cada chorro
    // de Manuel entre 0:14 y 0:34: sin ellos, en ese tramo sonaban los
    // chorros y el fluido no hacía nada.
    const gestures = beforeClosing.filter((event) => event.t < 30);
    expect(gestures.length).toBeGreaterThanOrEqual(3);
    for (const gesture of gestures) {
      expect(gesture.t).toBeGreaterThanOrEqual(14);
      expect(gesture.params.soft).toBe(0);
      expect([0, 1, 2, 3]).toContain(gesture.params.mode);
    }
    // Y hay variedad: no son todos el mismo gesto.
    expect(new Set(gestures.map((gesture) => gesture.params.mode)).size).toBeGreaterThan(1);
    for (const event of attractors) {
      // Los tirones arrancan con el primer crujido (13.71); el resto en 0:14.
      expect(event.t).toBeGreaterThanOrEqual(13.5);
      expect(event.params.x).toBeGreaterThan(0.1);
      expect(event.params.x).toBeLessThan(0.9);
      expect(event.params.force).toBeGreaterThan(0);
    }
    // Los cambios de régimen quedan separados entre sí (encima conviven el
    // blob del blanco, la explosión y los juegos cortos, que van aparte).
    // Los cambios de régimen se reconocen por su key de `gravitySense`, que
    // sólo escriben ellos (los tramos del guion escriben cohesión pero no
    // masa, y la explosión de 0:59 cae justo en un tramo). El Set colapsa
    // empates.
    const regimeTimes = [...new Set(attractors
      .filter((event) => (
        doc.curves.gravitySense.keys.some((key) => Math.abs(key.t - event.t) < 1e-6)
      ))
      .map((event) => event.t))];
    for (let index = 1; index < regimeTimes.length; index += 1) {
      expect(regimeTimes[index] - regimeTimes[index - 1]).toBeGreaterThan(2.5);
    }
    // Y hay más atractores que cambios de régimen: espejados y juegos.
    expect(attractors.length).toBeGreaterThan(regimeTimes.length);
    // Los cuatro modos aparecen: si fuera siempre el mismo no habría
    // comportamientos distintos, que es lo que se pidió.
    const modes = new Set(attractors.map((event) => event.params.mode));
    expect(modes.size).toBeGreaterThanOrEqual(3);

    // Y cada golpe viene con su cambio de propiedades. Se mira por golpe y no
    // por atractor: el espejado sale corrido 0.12 s y no lleva keys propias.
    const primaries = attractors.filter((event) => (
      doc.curves.gravitySense.keys.some((key) => Math.abs(key.t - event.t) < 1e-6)
    ));
    expect(primaries.length).toBeGreaterThanOrEqual(8);
    // La gravedad no está en la lista: es un pulso y sólo aparece en los
    // regímenes que la piden (tiene su propio test).
    for (const event of primaries) {
      for (const id of ['viscosity', 'gravitySense'] as const) {
        expect(doc.curves[id].keys.some((key) => Math.abs(key.t - event.t) < 1e-6)).toBe(true);
      }
    }
    // El fluido de verdad cambia de un régimen a otro, no queda siempre igual.
    const seen = new Set(attractors.map((event) => sampleCurveId(doc, 'cohesion', event.t)));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    // Antes de 0:30 sigue mandando el guion y nada más.
    expect(doc.curves.gravity.keys.every((key) => key.t >= 30)).toBe(true);
  });

  it('siembra curvas editables y eventos parados en los golpes', () => {
    const doc = seedShowDoc(analysis);
    expect(doc.duration).toBeCloseTo(analysis.duration, 3);
    expect(doc.curves.lightEmission.keys.length).toBeLessThanOrEqual(48);
    // La siembra fija la paleta del show: el "azul" es casi negro (un dejo
    // azul) — cuerpos oscuros que ocluyen y hacen sombra, no color pleno.
    // Desde la PALETA el operador la cambia cuando quiera.
    expect(doc.materialColors).toEqual([0xffffff, 0xff0000, 0x07080d, 0x8a8894]);
    // Las curvas que el guion no toca quedan vacías: el operador las escribe
    // a mano. La línea es una de ellas — se siembra su brillo, no su recorrido.
    expect(doc.curves.lineX.keys).toEqual([]);
    expect(doc.curves.lineY.keys).toEqual([]);
    expect(doc.curves.emitHue.keys).toEqual([]);
    expect(doc.gestures).toEqual([]);

    const flashes = doc.events.filter((event) => event.type === 'flash');
    const strobes = doc.events.filter((event) => event.type === 'strobe-lines');
    expect(flashes.length).toBeGreaterThan(0);
    expect(strobes.length).toBeGreaterThan(0);
    // Ordenados por t, con ids únicos y cada uno sobre un onset del análisis.
    const times = new Set(analysis.onsets.map((onset) => onset.t));
    const ids = new Set<string>();
    for (let index = 0; index < doc.events.length; index += 1) {
      const event = doc.events[index];
      // Los eventos de luz caen sobre un onset; los del guion (material y
      // lámpara) caen justo antes de un golpe o en el corte del tramo.
      if (event.type === 'flash' || event.type === 'strobe-lines') {
        expect(times.has(event.t)).toBe(true);
      }
      expect(ids.has(event.id)).toBe(false);
      ids.add(event.id);
      if (index > 0) expect(event.t).toBeGreaterThanOrEqual(doc.events[index - 1].t);
    }
    // Y son consultables por tiempo como cualquier evento a mano.
    expect(eventsAt(doc, flashes[0].t + 0.1).some((event) => event.id === flashes[0].id)).toBe(true);
  });

  it('sigue el guion: nadie emite hasta el blanco, y el rojo recién al final', () => {
    const doc = seedShowDoc(analysis);
    const impulses = pickImpulses(analysis.onsets);
    const materialsIn = (from: number, to: number): Set<number> => new Set(
      impulses.filter((i) => i.t >= from && i.t < to).map((i) => emitMaterialAt(doc, i.t)),
    );

    // Al principio nace rojo y azul, nunca blanco. El arranque cuenta: antes
    // del primer golpe el material caía en el default —blanco— y el show
    // empezaba escupiendo justo lo que no tenía que salir.
    expect([...materialsIn(0, 12)].sort()).toEqual([1, 2]);
    for (const t of [0, 0.1, 0.5, 0.79]) expect(emitMaterialAt(doc, t)).toBe(1);
    // Y nadie emite luz: la lámpara apunta al hueco. Los cuerpos se ven casi
    // negros —opacos, haciendo sombra— y toman su color sólo donde les pega
    // lo que tira la línea, que es la única luz que hay.
    for (const t of [0, 5, 12, 25, 36]) {
      expect(lampAt(doc, t).primary).toBe(LAMP_NONE);
      expect(lampAt(doc, t).secondary).toBe(-1);
      const bodies = sampleCurveId(doc, 'bodies', t);
      expect(bodies).toBeGreaterThan(0.02);
      expect(bodies).toBeLessThan(0.2);
    }

    // Desde 0:13 sale mucho más fluido. Domina el rojo, con negros mezclados:
    // son los cuerpos que después tapan la luz roja y arman las sombras.
    expect([...materialsIn(14, 45)].sort()).toEqual([1, 2]);
    // Se cuentan PARTÍCULAS, no el material muestreado en los golpes: cada
    // chorro escupe los dos colores —el rojo en el ataque y el negro en la
    // cola— así que un muestreo por instante dice cualquier cosa. Lo que
    // importa es cuánto sale de cada uno.
    const director = new FluidsShowDirector();
    director.setDoc(doc);
    const dt = 1 / 60;
    let population = 0;
    const byMaterial = [0, 0, 0, 0];
    for (let step = 0; step <= Math.round(45 / dt); step += 1) {
      const time = step * dt;
      const out = director.update({
        time, dt, playing: true, aspect: 2688 / 1008, particleCount: population,
      });
      for (const interaction of out.interactions) {
        if (interaction.mode !== 'emit') continue;
        population += interaction.emitCount;
        if (time >= 14) byMaterial[interaction.materialId] += interaction.emitCount;
      }
    }
    // El rojo se lleva el ataque de cada chorro, que es donde está el caudal
    // (es cuadrático), y el negro la cola: alrededor de 3 a 2, no mitad y
    // mitad. Con la mitad de la población negra el cuadro se llenaría de
    // sombras.
    expect(byMaterial[1]).toBeGreaterThan(byMaterial[2] * 1.45);
    expect(byMaterial[2]).toBeGreaterThan(population * 0.15);
    const early = impulses.filter((i) => i.t > 2 && i.t < 12);
    const later = impulses.filter((i) => i.t > 14 && i.t < 45);
    const peakOf = (list: typeof impulses): number => Math.max(
      ...list.map((i) => sampleCurve(doc.curves.emission, i.t, 0)),
    );
    // Los dos tramos escupen chorros de verdad. La CRECIDA ya no la dibuja el
    // reloj —una rampa de escalas por tramo— sino el track: si un pasaje del
    // arranque suena tan fuerte como uno del medio, escupe igual. Ver el test
    // del volumen más abajo.
    expect(peakOf(later)).toBeGreaterThan(0.8);
    expect(peakOf(early)).toBeGreaterThan(0.3);
    // Suelto, no atascado: el chorro corre, no se cierra en blobs.
    expect(sampleCurveId(doc, 'cohesion', 25)).toBeLessThan(0.2);

    // Y en ningún momento del arranque el blanco es el material que nace.
    expect(doc.events.filter((event) => event.type === 'set-material')[0].t).toBe(0);
    for (const i of impulses.filter((i) => i.t < WHITE_BURST_AT - 2)) {
      expect(emitMaterialAt(doc, i.t)).not.toBe(0);
    }

    // El blanco nunca es el material de la curva mientras el show emite: sale
    // sólo de los chorros de evento. Recién en el cierre quieto de 2:03 —con
    // la emisión cerrada hace un minuto— lo que nace vuelve a ser blanco, que
    // es lo que hace que lo que se tire a mano en vivo se encienda al moverse.
    for (const event of doc.events) {
      if (event.type !== 'set-material') continue;
      if (event.t < 123) expect(event.params.material).not.toBe(0);
    }
    for (const t of [FIRST_WHITE_AT + 2, WHITE_BURST_AT + 2, 60, 79]) {
      expect(lampAt(doc, t)).toEqual({ primary: 0, secondary: -1, mix: 0 });
    }

    // En 1:20 se apaga la línea, se corta la emisión, sólo arde lo rojo y
    // las rojas se atraen entre ellas.
    for (const t of [82, 110, 122]) {
      expect(sampleCurveId(doc, 'lineEmit', t)).toBe(0);
      expect(sampleCurve(doc.curves.emission, t, 1)).toBe(0);
      // El rojo emite por primera vez acá, y el blanco deja de emitir.
      expect(lampAt(doc, t)).toEqual({ primary: 1, secondary: -1, mix: 0 });
      // Las rojas siguen juntándose, aunque el track las pasee por regímenes
      // distintos: el piso del tramo final no baja de ahí.
      expect(sampleCurveId(doc, 'cohesion', t)).toBeGreaterThan(0.45);
      // Y lo que no recibe luz desaparece: sólo arde lo rojo.
      expect(sampleCurveId(doc, 'bodies', t)).toBe(0);
      // Con brillo dictado por el guion: ahí la envolvente del track está
      // baja y el rojo tiene que arder igual.
      expect(sampleCurveId(doc, 'lightEmission', t)).toBeGreaterThan(0.9);
    }
    // 2:03: el cierre blanco y quieto. La luz roja se corta a negro y lo que
    // se prende son otra vez las blancas, con la intensidad con la que
    // nacieron — para que una partícula quieta sea un puntito tenue y una que
    // se toca arda.
    // Ya NO hay corte a negro antes del cierre: se pidió que la luz PASE de
    // las rojas a las blancas, así que el rojo llega prendido hasta 2:03 y de
    // ahí cruza en dos segundos. Alargar el cruce sin sacar el negro habría
    // estirado el pozo negro, no la transición de color.
    expect(lampAt(doc, 122.8).primary).toBe(1);
    const cross = doc.events.find(
      (event) => event.type === 'set-lamp' && event.t === 123 && event.params.primary === 0,
    )!;
    expect(cross.params.fade).toBe(2);
    for (const t of [123.5, 140, 150]) {
      expect(lampAt(doc, t)).toEqual({ primary: 0, secondary: -1, mix: 0 });
      expect(sampleCurveId(doc, 'lightEmission', t)).toBe(1);
      expect(sampleCurveId(doc, 'bodies', t)).toBe(0);
      expect(sampleCurve(doc.curves.emission, t, 1)).toBe(0);
    }
    // Antes de 1:20 el rojo nunca fue el que ilumina.
    for (let t = 0; t < 79; t += 0.5) expect(lampAt(doc, t).primary).not.toBe(1);
    // Y desde el chorro blanco la línea ya estaba apagada y muda: lo que se
    // ve de 0:50 en adelante es lo que quedó en el cuadro.
    expect(sampleCurveId(doc, 'lineEmit', 70)).toBe(0);
    expect(sampleCurve(doc.curves.emission, 70, 1)).toBe(0);
  });

  it('saca todas las partículas antes de apagar la línea, y las blancas en el chorro', () => {
    // De punta a punta: el director corriendo sobre el documento sembrado.
    // Es la prueba de lo que se pidió — que para cuando la línea se apaga ya
    // haya salido toda la población, con las blancas saliendo en el chorro de
    // 0:50 y nada más después.
    const doc = seedShowDoc(analysis);
    const director = new FluidsShowDirector();
    director.setDoc(doc);
    const dt = 1 / 60;
    const curveEndsAt = doc.curves.emission.keys[doc.curves.emission.keys.length - 1].t;
    let population = 0;
    let whites = 0;
    let whitesFromBursts = 0;
    let afterTheLine = 0;
    let afterTheCurve = 0;
    for (let step = 0; step <= Math.round(70 / dt); step += 1) {
      const time = step * dt;
      const out = director.update({
        time, dt, playing: true, aspect: 2688 / 1008, particleCount: population,
      });
      // Contadas por interacción, que es lo que llega al solver: la curva y
      // los chorros nacen todos de la misma boca.
      for (const interaction of out.interactions) {
        if (interaction.mode !== 'emit') continue;
        population += interaction.emitCount;
        if (interaction.materialId === 0) {
          whites += interaction.emitCount;
          whitesFromBursts += interaction.emitCount;
        }
        if (sampleCurveId(doc, 'lineEmit', time) <= 0) afterTheLine += interaction.emitCount;
        if (time > curveEndsAt + 0.1) afterTheCurve += interaction.emitCount;
      }
    }
    // La población entera sale dentro de la curva que dibuja la emisión.
    expect(population).toBeGreaterThan(FLUIDS_SHOW_PARTICLE_CAP * 0.93);
    // La línea apaga su luz en 0:40 pero SIGUE EMITIENDO hasta 0:50: nace
    // fluido con la línea ya invisible. `afterTheLine` lo confirma.
    expect(afterTheLine).toBeGreaterThan(1000);
    // Después del corte de la curva (0:50) lo único que nace son los chorros
    // blancos de evento, nada más.
    expect(afterTheCurve).toBeGreaterThan(0);
    expect(afterTheCurve).toBeLessThanOrEqual(whitesFromBursts);
    // Pocos blancos: iluminan por potencia, no por cantidad.
    expect(whites).toBeGreaterThan(850);
    expect(whites).toBeLessThan(1100);
    expect(whites).toBeLessThan(population * 0.35);
  });

  it('deja un set-material sólo cuando el material cambia', () => {
    const doc = seedShowDoc(analysis);
    const changes = doc.events.filter((event) => event.type === 'set-material');
    // Si repitiera el material en cada impulso, la lane sería ilegible.
    expect(changes.length).toBeLessThan(pickImpulses(analysis.onsets).length);
    for (let index = 1; index < changes.length; index += 1) {
      expect(changes[index].params.material).not.toBe(changes[index - 1].params.material);
    }
  });

  it('es determinista: la misma entrada da el mismo documento', () => {
    expect(JSON.stringify(seedShowDoc(analysis))).toBe(JSON.stringify(seedShowDoc(analysis)));
  });
});
