import { describe, expect, it } from 'vitest';
import FluidsShowDirector, {
  FLUIDS_SHOW_MATERIALS,
  FLUIDS_SHOW_PARTICLE_CAP,
  hsvToHex,
  rateForDoc,
} from './FluidsShowDirector';
import {
  emptyDoc,
  makeEvent,
  withKey,
  type CurveId,
  type GestureClip,
  type ShowDoc,
  type ShowEventType,
} from '../../fluids-show/show-doc';

const ASPECT = 2688 / 1008;
const DT = 1 / 60;

/** Reproduce desde 0 hasta `seconds`, como haría la página con el audio. */
const play = (
  director: FluidsShowDirector,
  seconds: number,
  particleCount = 0,
) => {
  const steps = Math.max(1, Math.round(seconds / DT));
  let output = director.update({ time: 0, dt: DT, playing: true, aspect: ASPECT, particleCount });
  for (let step = 1; step <= steps; step += 1) {
    output = director.update({
      time: step * DT, dt: DT, playing: true, aspect: ASPECT, particleCount,
    });
  }
  return output;
};

const at = (director: FluidsShowDirector, time: number, playing = false) => director.update({
  time, dt: DT, playing, aspect: ASPECT, particleCount: 0,
});

/** Documento con una curva constante, para leer un mapeo aislado. */
const flat = (id: CurveId, value: number): ShowDoc => {
  const doc = emptyDoc();
  doc.curves[id] = withKey(doc.curves[id], { t: 0, v: value, shape: 'hold' });
  return doc;
};

const directorWith = (doc: ShowDoc): FluidsShowDirector => {
  const director = new FluidsShowDirector();
  director.setDoc(doc);
  return director;
};

/** Deja la física convergida en su target: approach 2.6 tarda ~2 s. */
const settled = (doc: ShowDoc, seconds = 6) => play(directorWith(doc), seconds);

const event = (type: ShowEventType, t: number, patch: Partial<ReturnType<typeof makeEvent>> = {}) => ({
  ...makeEvent(type, t),
  ...patch,
  params: { ...makeEvent(type, t).params, ...(patch.params ?? {}) },
});

describe('FluidsShowDirector · línea y emisión', () => {
  it('declara los materiales y el techo de población del show', () => {
    expect(FLUIDS_SHOW_MATERIALS.colors[0]).toBe(0xffffff);
    expect(FLUIDS_SHOW_MATERIALS.masses).toHaveLength(4);
    expect(FLUIDS_SHOW_PARTICLE_CAP).toBeLessThan(40_000);
  });

  it('pone la línea en el centro con el largo y el giro del documento vacío', () => {
    const out = at(new FluidsShowDirector(), 0);
    // Blade emisivo + oclusor de respaldo: la emisión unilateral de 3B.
    expect(out.geometry).toHaveLength(2);
    const [blade, backing] = out.geometry;
    expect(blade.x).toBeCloseTo(0.5, 6);
    expect(blade.y).toBeCloseTo(0.5, 6);
    expect(blade.emit).toBeGreaterThan(0);
    expect(backing.emit).toBe(0);
    expect(backing.absorb).toBeGreaterThan(blade.absorb);
    // len 0.12 de ancho, en semiejes de alto, menos el encogido por emisión:
    // el default de la curva es 0.35 y el achique llega al 78%, así que la
    // línea vive un 27% más corta mientras emite parejo.
    const len = 0.12 * (1 - 0.78 * 0.35);
    expect(blade.w).toBeCloseTo((len * ASPECT) / 2, 4);
    expect(out.status.lineLen).toBeCloseTo(len, 6);
  });

  it('la línea se encoge rápido con cada chorro y vuelve suave', () => {
    const doc = emptyDoc();
    // Silencio, un golpe en t=10, silencio: la forma de la curva del show.
    doc.curves.emission = { keys: [
      { t: 0, v: 0, shape: 'linear' },
      { t: 9.98, v: 0, shape: 'linear' },
      { t: 10, v: 1, shape: 'linear' },
      { t: 10.45, v: 0, shape: 'linear' },
    ] };
    const director = directorWith(doc);
    const lenAt = (time: number): number => at(director, time).status.lineLen;
    const rest = lenAt(9.5);
    // En el golpe se achica DE GOLPE y mucho (78%: queda a un cuarto), y la
    // vuelta es larga y suave: al segundo todavía no está entera, y pasado el
    // ciclo de recuperación (1.7 s) sí.
    expect(lenAt(10)).toBeCloseTo(rest * 0.22, 3);
    expect(lenAt(11)).toBeGreaterThan(rest * 0.22);
    expect(lenAt(11)).toBeLessThan(rest * 0.95);
    expect(lenAt(11.8)).toBeCloseTo(rest, 3);
    // Y es tiempo absoluto: saltar directo a 10.2 da el mismo largo que
    // llegar reproduciendo.
    const fresh = directorWith(doc);
    expect(at(fresh, 10.2).status.lineLen).toBeCloseTo(lenAt(10.2), 9);
  });

  it('deriva el ángulo del tiempo absoluto: saltar da la misma pose que llegar', () => {
    const played = play(new FluidsShowDirector(), 60);
    const jumped = at(new FluidsShowDirector(), Math.round(60 / DT) * DT);
    expect(jumped.status.angle).toBeCloseTo(played.status.angle, 9);
    expect(jumped.geometry[0].rot).toBeCloseTo(played.geometry[0].rot, 9);
    // Giro por default: 0.286 x 0.35 = 0.1001 rad/s, por 60 s de track.
    expect(jumped.status.angle).toBeCloseTo(60 * 0.1001, 2);
  });

  it('integra la curva de giro por tramos al saltar', () => {
    const doc = emptyDoc();
    // Quieta 10 s, después a fondo: en t=20 el ángulo es sólo el segundo tramo.
    doc.curves.lineSpin = withKey(doc.curves.lineSpin, { t: 0, v: 0, shape: 'hold' });
    doc.curves.lineSpin = withKey(doc.curves.lineSpin, { t: 10, v: 1, shape: 'hold' });
    const director = directorWith(doc);
    expect(at(director, 10).status.angle).toBeCloseTo(0, 9);
    expect(at(director, 20).status.angle).toBeCloseTo(10 * 0.35, 9);
    expect(play(directorWith(doc), 20).status.angle)
      .toBeCloseTo(at(director, Math.round(20 / DT) * DT).status.angle, 6);
  });

  it('emite en lotes desde el blade sólo mientras el transporte reproduce', () => {
    const paused = at(new FluidsShowDirector(), 4, false);
    // En pausa no nace nada, pero la línea sigue siendo materia: sus anillos
    // de colisión están siempre que la línea se vea.
    expect(paused.interactions.filter((i) => i.mode !== 'collide')).toHaveLength(0);
    expect(paused.interactions.filter((i) => i.mode === 'collide').length).toBeGreaterThan(2);
    // El caudal no es una constante: sale del documento, de modo que la curva
    // entera escupa el techo de población. Con la curva por default —plana en
    // 0.35— eso es repartir el techo a lo largo de todo el track.
    const rate = rateForDoc(emptyDoc());
    expect(paused.status.pps).toBeCloseTo(0.35 * 0.35 * rate, 6);
    expect(paused.status.pps).toBeGreaterThan(0);

    let emitted = 0;
    const running = new FluidsShowDirector();
    for (let step = 0; step <= Math.round(4 / DT); step += 1) {
      const out = running.update({
        time: step * DT, dt: DT, playing: true, aspect: ASPECT, particleCount: 0,
      });
      emitted += out.status.emitted;
      for (const interaction of out.interactions) {
        expect(['emit', 'drag', 'collide']).toContain(interaction.mode);
        expect(Number.isFinite(interaction.x)).toBe(true);
        expect(Number.isFinite(interaction.y)).toBe(true);
      }
    }
    // Lo emitido en 4 s tiene que ser el caudal por el tiempo, redondeado al
    // lote de 6.
    const expected = 0.35 * 0.35 * rate * 4;
    expect(emitted).toBeGreaterThan(expected - 12);
    expect(emitted).toBeLessThanOrEqual(expected + 12);
  });

  it('reparte el techo de población dentro de la curva de emisión', () => {
    // El caudal se deriva del documento: la curva entera, integrada, tiene
    // que escupir el techo. Es lo que hace que dibujar la emisión hasta 0:50
    // y apagarla ahí no signifique quedarse con la mitad de las partículas —
    // salen todas, dentro de lo que marca la curva, y después no nace nada.
    const doc = emptyDoc();
    doc.curves.emission = withKey(doc.curves.emission, { t: 0, v: 1, shape: 'hold' });
    doc.curves.emission = withKey(doc.curves.emission, { t: 50, v: 0, shape: 'hold' });
    const director = directorWith(doc);
    let population = 0;
    let afterTheCurve = 0;
    for (let step = 0; step <= Math.round(70 / DT); step += 1) {
      const time = step * DT;
      const out = director.update({
        time, dt: DT, playing: true, aspect: ASPECT, particleCount: population,
      });
      population += out.status.emitted;
      if (time > 50.1) afterTheCurve += out.status.emitted;
    }
    expect(population).toBeGreaterThan(FLUIDS_SHOW_PARTICLE_CAP * 0.9);
    expect(population).toBeLessThanOrEqual(FLUIDS_SHOW_PARTICLE_CAP + 120);
    expect(afterTheCurve).toBe(0);
  });

  it('frena la emisión al tocar el techo de población', () => {
    const out = play(new FluidsShowDirector(), 3, FLUIDS_SHOW_PARTICLE_CAP);
    expect(out.status.capped).toBe(true);
    expect(out.interactions.filter((i) => i.mode === 'emit')).toHaveLength(0);
  });

  it('un atractor pega en el golpe: fuerza plena enseguida, y decae', () => {
    const doc = emptyDoc();
    doc.events = [{
      ...makeEvent('attractor', 10),
      dur: 2,
      params: { mode: 0, x: 0.5, y: 0.5, radius: 0.2, force: 2, wander: 0 },
    }];
    const director = directorWith(doc);
    const forceAt = (time: number): number => (
      at(director, time).interactions.find((i) => i.mode === 'attract')?.strength ?? 0
    );
    // A 80 ms del golpe ya está casi a fondo: es lo que lo deja en sincro.
    // La campana anterior recién llegaba al pico a mitad del evento.
    expect(forceAt(10.08)).toBeGreaterThan(1.5);
    // Y decae: al final del evento no queda casi nada.
    expect(forceAt(11)).toBeLessThan(forceAt(10.2));
    expect(forceAt(11.9)).toBeLessThan(0.05);
    // El paseo (`wander`) corre la posición con el tiempo absoluto.
    doc.events = [{
      ...makeEvent('attractor', 10),
      dur: 8,
      params: { mode: 0, x: 0.5, y: 0.5, radius: 0.2, force: 2, wander: 0.1 },
    }];
    const wanderer = directorWith(doc);
    const posAt = (time: number) => {
      const hit = at(wanderer, time).interactions.find((i) => i.mode === 'attract')!;
      return { x: hit.x, y: hit.y };
    };
    const a = posAt(11);
    const b = posAt(14);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.02);
  });

  it('el agarre (modo 4) lleva un círculo de fluido por su paseo', () => {
    const doc = emptyDoc();
    doc.events = [{
      ...makeEvent('attractor', 10),
      dur: 6,
      params: { mode: 4, x: 0.5, y: 0.5, radius: 0.3, force: 1.9, wander: 0.13, sustain: 0, soft: 1 },
    }];
    const director = directorWith(doc);
    const grabAt = (time: number) => at(director, time).interactions.find((i) => i.mode === 'drag');
    // En el medio del evento el agarre existe y se está moviendo: velocidad
    // no nula, que es lo que arrastra el círculo agarrado.
    const grab = grabAt(13)!;
    expect(grab).toBeDefined();
    expect(Math.hypot(grab.vx, grab.vy)).toBeGreaterThan(0);
    expect(grab.radius).toBeCloseTo(0.3, 6);
    // Y pasea despacio: entre dos momentos el punto se movió.
    const later = grabAt(14.5)!;
    expect(Math.hypot(later.x - grab.x, later.y - grab.y)).toBeGreaterThan(0.01);
    // Fuera del evento no queda nada agarrando.
    expect(grabAt(17)).toBeUndefined();
  });

  it('la línea rebota: anillos de colisión mientras se ve, ninguno apagada', () => {
    const lit = at(new FluidsShowDirector(), 2);
    const rings = lit.interactions.filter((i) => i.mode === 'collide');
    expect(rings.length).toBeGreaterThan(2);
    for (const ring of rings) {
      expect(ring.radius).toBeGreaterThan(0.005);
      expect(ring.emitCount).toBe(0);
    }
    // Con la línea apagada deja de ser un objeto: nada de colisión.
    const doc = flat('lineEmit', 0);
    const dark = at(directorWith(doc), 2);
    expect(dark.interactions.filter((i) => i.mode === 'collide')).toHaveLength(0);
  });

  it('no arrastra el acumulador de emisión a través de un salto', () => {
    const director = new FluidsShowDirector();
    director.update({ time: 0, dt: DT, playing: true, aspect: ASPECT, particleCount: 0 });
    director.update({ time: 0.07, dt: 0.07, playing: true, aspect: ASPECT, particleCount: 0 });
    const jumped = director.update({
      time: 90, dt: DT, playing: true, aspect: ASPECT, particleCount: 0,
    });
    expect(jumped.status.emitted).toBe(0);
  });
});

describe('FluidsShowDirector · mapeo de curvas', () => {
  it('lleva la luz a radiancia y al piso de emisión por velocidad', () => {
    const dark = at(directorWith(flat('lightEmission', 0)), 3);
    const bright = at(directorWith(flat('lightEmission', 1)), 3);
    expect(dark.render.radiance).toBeCloseTo(0.4, 6);
    // Tope 1.9: cada blanca arde pero sin lavar el cuadro; el brillo grande
    // lo pone el movimiento, no la luz de base.
    expect(bright.render.radiance).toBeCloseTo(1.9, 6);
    // Piso 0.12, fijo: una emisora completamente quieta conserva un toquecito
    // mínimo de emisión (con 0.05 desaparecía en negro), y aún así el techo
    // queda a 28x — subir la luz no aplasta el emisivo contra el techo.
    expect(dark.render.velocityEmissionFloor).toBeCloseTo(0.12, 6);
    expect(bright.render.velocityEmissionFloor).toBeCloseTo(0.12, 6);
    expect(dark.render.velocityEmissionRange).toBeCloseTo(1.6, 6);
    expect(bright.render.velocityEmissionRange).toBeCloseTo(3.4, 6);
    // Sensibilidad BAJA a propósito: con 10 el rango de velocidad quedaba en
    // 0.28 px/frame y cualquier deriva saturaba el emisivo — brillo constante,
    // que es justo "no cambia con la velocidad". Con ~1.4 la deriva lenta
    // queda a mitad de curva y el contraste lo ponen el piso y el techo.
    expect(dark.render.velocityEmissionSensitivity).toBeCloseTo(2.2, 6);
    expect(bright.render.velocityEmissionSensitivity).toBeCloseTo(1.4, 6);
    const swing = bright.render.velocityEmissionRange / bright.render.velocityEmissionFloor;
    expect(swing).toBeGreaterThan(25);
    // Y se mide transporte, no agitación: sin el suavizado, el jitter de las
    // colisiones dentro de un blob quieto contaba como velocidad y lo prendía.
    expect(bright.render.velocityEmissionSmoothing).toBeLessThan(0.3);
    expect(bright.render.velocityEmissionSmoothing).toBeGreaterThan(0.05);
    // Lo que el show mantiene fijo, como Tres Masas.
    expect(bright.render.velocityEmission).toBe(1);
    expect(bright.render.lightOnly).toBe(1);
  });

  it('escala la exposición sobre 0.38', () => {
    expect(at(directorWith(flat('exposure', 1)), 3).render.radianceExposure).toBeCloseTo(0.38, 6);
    expect(at(directorWith(flat('exposure', 0)), 3).render.radianceExposure).toBeCloseTo(0, 6);
    expect(at(directorWith(flat('exposure', 2)), 3).render.radianceExposure).toBeCloseTo(0.76, 6);
  });

  it('usa la paleta del documento y respeta el material que se está emitiendo', () => {
    const doc = emptyDoc();
    doc.materialColors = [0x123456, 0x00ff00, 0xffaa00, 0x8a8894];
    const out = at(directorWith(doc), 3);
    expect(out.render.materialColor0).toBe(0x123456);
    expect(out.render.materialColor1).toBe(0x00ff00);
    expect(out.render.materialColor2).toBe(0xffaa00);

    // Con un set-material, lo que nace es de ese material y conserva SU color
    // de paleta. Antes las curvas vacías lo pintaban blanco igual: elegir
    // rojo daba blanco.
    doc.events = [event('set-material', 5, { params: { material: 1 } })];
    const switched = at(directorWith(doc), 10);
    expect(switched.status.emitMaterial).toBe(1);
    expect(switched.render.emissiveMaterial).toBe(1);
    expect(switched.render.materialColor1).toBe(0x00ff00);
    expect(switched.render.materialColor0).toBe(0x123456);
  });

  it('deja que las curvas de color pisen al material emisor cuando tienen keys', () => {
    const doc = flat('emitHue', 1 / 3);
    doc.materialColors = [0x123456, 0xff0000, 0x0000ff, 0x8a8894];
    doc.curves.emitSat = withKey(doc.curves.emitSat, { t: 0, v: 1, shape: 'hold' });
    const out = at(directorWith(doc), 3);
    expect(out.render.materialColor0).toBe(0x00ff00);
    // Sólo al emisor: los otros tres siguen en su color de paleta.
    expect(out.render.materialColor1).toBe(0xff0000);
    expect(out.render.materialColor2).toBe(0x0000ff);
    expect(hsvToHex(0.5, 1, 1)).toBe(0x00ffff);
  });

  it('mapea la gravedad con la mitad negativa suave', () => {
    expect(settled(flat('gravity', 1)).physics.gravity).toBeCloseTo(1.2, 3);
    expect(settled(flat('gravity', -1)).physics.gravity).toBeCloseTo(-0.3, 3);
    expect(settled(flat('gravity', 0)).physics.gravity).toBeCloseTo(0, 3);
  });

  it('convierte la sensibilidad a la gravedad en un multiplicador de masa', () => {
    // El default 0.302 es el neutro: no toca las masas base.
    expect(at(new FluidsShowDirector(), 3).status.materialMassScale).toBeCloseTo(1, 2);
    expect(at(directorWith(flat('gravitySense', 0)), 3).status.materialMassScale).toBeCloseTo(0.35, 6);
    expect(at(directorWith(flat('gravitySense', 1)), 3).status.materialMassScale).toBeCloseTo(2.5, 6);
  });

  it('interpola el atasco entre suelto y blobs orgánicos', () => {
    const loose = settled(flat('cohesion', 0)).physics;
    const jammed = settled(flat('cohesion', 1)).physics;
    expect(loose.sameRestDensity).toBeCloseTo(3.2, 2);
    expect(loose.differentRestDensity).toBeCloseTo(5.5, 2);
    expect(loose.nearStiffness).toBeCloseTo(0.08, 2);
    expect(jammed.sameRestDensity).toBeCloseTo(11.2, 2);
    expect(jammed.differentRestDensity).toBeCloseTo(1.3, 2);
    expect(jammed.nearStiffness).toBeCloseTo(1.45, 2);
    expect(jammed.stiffness).toBeCloseTo(0.3, 2);
  });

  it('lleva la viscosidad al drag y también a la mano', () => {
    // El freno de base va bien arriba del viejo 0.002: el gradiente de
    // emisión por velocidad sólo se ve si las partículas frenan. El techo
    // (viscosidad 1) deja el fluido casi quieto: es el cierre del show.
    expect(settled(flat('viscosity', 0)).physics.drag).toBeCloseTo(0.014, 4);
    expect(settled(flat('viscosity', 1)).physics.drag).toBeCloseTo(0.199, 4);

    // Un gesto en un fluido lento empuja menos: 1 - 0.45.
    const clip: GestureClip = {
      id: 'g', t0: 0, t1: 10, mode: 'attract', radius: 0.1, strength: 2,
      samples: [{ t: 0, x: 0.2, y: 0.5 }, { t: 10, x: 0.8, y: 0.5 }],
    };
    const agile = flat('viscosity', 0);
    agile.gestures = [clip];
    const slow = flat('viscosity', 1);
    slow.gestures = [clip];
    const agileGesture = at(directorWith(agile), 5).interactions.find((i) => i.mode === 'attract')!;
    const slowGesture = at(directorWith(slow), 5).interactions.find((i) => i.mode === 'attract')!;
    expect(agileGesture.strength).toBeCloseTo(2, 6);
    expect(slowGesture.strength).toBeCloseTo(2 * 0.55, 6);
  });
});

describe('FluidsShowDirector · eventos', () => {
  it('multiplica la exposición con el flash y la deja caer', () => {
    const doc = emptyDoc();
    doc.events = [event('flash', 10, { dur: 1, intensity: 1, params: { decay: 0.5, gain: 3 } })];
    const director = directorWith(doc);
    const base = at(director, 9).render.radianceExposure;
    const peak = at(director, 10).render.radianceExposure;
    const later = at(director, 10.5).render.radianceExposure;
    expect(peak).toBeCloseTo(base * 3, 5);
    expect(later).toBeCloseTo(base * (1 + 2 * Math.exp(-1)), 5);
    expect(at(director, 11.5).render.radianceExposure).toBeCloseTo(base, 5);
  });

  it('apaga y devuelve la luz con las rampas del evento', () => {
    const doc = emptyDoc();
    doc.events = [event('blackout', 20, {
      dur: 1, intensity: 1, params: { attack: 0.2, release: 0.2 },
    })];
    const director = directorWith(doc);
    const base = at(director, 19).render.radianceExposure;
    expect(at(director, 20.1).render.radianceExposure).toBeCloseTo(base * 0.5, 5);
    expect(at(director, 20.5).render.radianceExposure).toBeCloseTo(0, 6);
    expect(at(director, 20.5).render.blackOutput).toBe(1);
    expect(at(director, 20.9).render.radianceExposure).toBeCloseTo(base * 0.5, 5);
    expect(at(director, 21.1).render.radianceExposure).toBeCloseTo(base, 5);
    // Con intensidad parcial nunca llega a negro absoluto.
    doc.events = [event('blackout', 20, { dur: 1, intensity: 0.5, params: { attack: 0.2, release: 0.2 } })];
    expect(at(directorWith(doc), 20.5).render.blackOutput).toBe(0);
  });

  it('dibuja las líneas estroboscópicas con la fase del tiempo absoluto', () => {
    const doc = emptyDoc();
    doc.events = [event('strobe-lines', 30, {
      dur: 1, intensity: 1, params: { count: 4, freqHz: 10, duty: 0.5, orient: 0, kick: 1 },
    })];
    const director = directorWith(doc);
    // Ciclo de 0.1 s con duty 0.5: encendido en la primera mitad.
    const on = at(director, 30.02);
    const off = at(director, 30.07);
    expect(on.geometry).toHaveLength(2 + 4);
    expect(off.geometry).toHaveLength(2);
    for (const bar of on.geometry.slice(2)) {
      expect(bar.emit).toBeCloseTo(2.5, 6);
      expect(bar.color).toBe(0xffffff);
      expect(bar.rot).toBe(0);
      expect(bar.w).toBeCloseTo(ASPECT / 2, 6);
    }
    expect(on.geometry.slice(2).map((bar) => bar.y)).toEqual([0.125, 0.375, 0.625, 0.875]);
    // El golpe suma exposición sólo mientras están encendidas.
    expect(on.render.radianceExposure).toBeGreaterThan(off.render.radianceExposure);
    // Y la fase no depende de cómo se llegó a ese instante.
    expect(play(directorWith(doc), 30.02).geometry.length).toBe(on.geometry.length);
  });

  it('orienta los estrobos vertical y paralelo a la línea', () => {
    const doc = emptyDoc();
    doc.events = [event('strobe-lines', 0, {
      dur: 1, params: { count: 2, freqHz: 4, duty: 0.5, orient: 1 },
    })];
    const vertical = at(directorWith(doc), 0.01).geometry.slice(2);
    expect(vertical).toHaveLength(2);
    for (const bar of vertical) expect(bar.rot).toBeCloseTo(Math.PI / 2, 6);
    expect(vertical.map((bar) => bar.x)).toEqual([0.25, 0.75]);

    doc.events = [event('strobe-lines', 0, {
      dur: 1, params: { count: 3, freqHz: 4, duty: 0.5, orient: 2 },
    })];
    const followed = at(directorWith(doc), 5);
    for (const bar of followed.geometry.slice(2)) {
      expect(bar.rot).toBeCloseTo(followed.status.angle, 9);
    }
  });

  it('barre la sombra de x0 a x1 durante el evento', () => {
    const doc = emptyDoc();
    doc.events = [event('shadow-bar', 40, {
      dur: 2, intensity: 1, params: { x0: 0, x1: 1, angle: 0, width: 0.1 },
    })];
    const director = directorWith(doc);
    const start = at(director, 40).geometry[2];
    const middle = at(director, 41).geometry[2];
    const end = at(director, 41.99).geometry[2];
    expect(start.x).toBeCloseTo(0, 3);
    expect(middle.x).toBeCloseTo(0.5, 3);
    expect(end.x).toBeGreaterThan(0.97);
    expect(middle.emit).toBe(0);
    expect(middle.absorb).toBeGreaterThan(1);
    expect(at(director, 42).geometry).toHaveLength(2);
  });

  it('empuja el estallido sólo en su ventana inicial', () => {
    const doc = emptyDoc();
    doc.events = [event('burst', 50, {
      dur: 0.5, intensity: 1, params: { x: 0.3, y: 0.6, radius: 0.4 },
    })];
    const director = directorWith(doc);
    const pulse = at(director, 50.05).interactions.filter((i) => i.mode === 'repel');
    expect(pulse).toHaveLength(1);
    expect(pulse[0].x).toBeCloseTo(0.3, 6);
    expect(pulse[0].y).toBeCloseTo(0.6, 6);
    expect(pulse[0].radius).toBeCloseTo(0.4, 6);
    expect(pulse[0].strength).toBeCloseTo(1.3, 6);
    expect(at(director, 50.2).interactions.filter((i) => i.mode === 'repel')).toHaveLength(0);
  });

  it('resuelve el material emisor por el último set-material que quedó atrás', () => {
    const doc = emptyDoc();
    doc.events = [
      event('set-material', 10, { params: { material: 1 } }),
      event('set-material', 20, { params: { material: 2 } }),
    ];
    const director = directorWith(doc);
    expect(at(director, 5).status.emitMaterial).toBe(0);
    expect(at(director, 15).status.emitMaterial).toBe(1);
    expect(at(director, 25).status.emitMaterial).toBe(2);
    expect(at(director, 25).render.emissiveMaterial).toBe(2);
    // Las partículas nuevas nacen de ese material.
    const emitting = directorWith(doc);
    const out = play(emitting, 25);
    const emit = out.interactions.find((i) => i.mode === 'emit');
    if (emit) expect(emit.materialId).toBe(2);
  });

  it('dispara reset-fluid al cruzarlo, una sola vez', () => {
    const doc = emptyDoc();
    doc.events = [event('reset-fluid', 60, { dur: 0.5 })];
    const director = directorWith(doc);
    expect(at(director, 59.9).resetParticles).toBeNull();
    const fired = at(director, 60.1);
    expect(fired.resetParticles).toEqual([0, 0, 0, 0]);
    expect(fired.resetRadiance).toBe(true);
    // Seguir dentro del evento no vuelve a vaciar el campo.
    expect(at(director, 60.2).resetParticles).toBeNull();
    // Pero rebobinar y volver a pasar, sí: es el punto de ensayar un tramo.
    director.seek(0);
    expect(at(director, 60.1).resetParticles).toEqual([0, 0, 0, 0]);
  });

  it('pide el vaciado del campo sólo una vez por reset manual', () => {
    const director = new FluidsShowDirector();
    expect(at(director, 0).resetParticles).toBeNull();
    director.requestReset();
    expect(at(director, 1).resetParticles).toEqual([0, 0, 0, 0]);
    expect(at(director, 2).resetParticles).toBeNull();
  });
});

describe('FluidsShowDirector · gestos', () => {
  it('reproduce el clip con su modo, su radio y su velocidad derivada', () => {
    const doc = emptyDoc();
    doc.gestures = [{
      id: 'g', t0: 10, t1: 12, mode: 'vortex', radius: 0.12, strength: 1.5,
      samples: [{ t: 0, x: 0.2, y: 0.5 }, { t: 2, x: 0.8, y: 0.5 }],
    }];
    const director = directorWith(doc);
    expect(at(director, 9).status.activeGestures).toBe(0);
    const out = at(director, 11);
    expect(out.status.activeGestures).toBe(1);
    const gesture = out.interactions.find((i) => i.mode === 'vortex')!;
    expect(gesture.x).toBeCloseTo(0.5, 6);
    expect(gesture.y).toBeCloseTo(0.5, 6);
    expect(gesture.radius).toBeCloseTo(0.12, 6);
    // 0.3 de ancho por segundo, pasado a unidades de alto por paso.
    expect(gesture.vx).toBeCloseTo(0.3 * ASPECT * DT, 9);
    expect(gesture.vy).toBeCloseTo(0, 9);
    expect(at(director, 12).status.activeGestures).toBe(0);
  });
});

describe('FluidsShowDirector · determinismo', () => {
  /** Un documento que toca todo lo que el director sabe hacer. */
  const fullDoc = (): ShowDoc => {
    const doc = emptyDoc();
    const keys: Array<[CurveId, number, number]> = [
      ['emission', 0.2, 0.9],
      ['emitHue', 0.05, 0.7],
      ['emitSat', 0, 1],
      ['lightEmission', 0.2, 0.95],
      ['exposure', 0.6, 1.5],
      ['gravity', -0.6, 0.8],
      ['gravitySense', 0.1, 0.9],
      ['cohesion', 0.05, 0.95],
      ['viscosity', 0, 0.8],
      ['lineSize', 0.2, 0.9],
      ['lineSpin', -0.5, 1],
    ];
    for (const [id, from, to] of keys) {
      doc.curves[id] = withKey(doc.curves[id], { t: 0, v: from, shape: 'smooth' });
      doc.curves[id] = withKey(doc.curves[id], { t: 45, v: to, shape: 'linear' });
      doc.curves[id] = withKey(doc.curves[id], { t: 120, v: from, shape: 'hold' });
    }
    doc.events = [
      event('set-material', 12, { params: { material: 1 } }),
      event('flash', 30, { dur: 0.6, intensity: 0.8 }),
      event('strobe-lines', 55, { dur: 4, intensity: 1, params: { count: 5, freqHz: 9 } }),
      event('shadow-bar', 58, { dur: 3, intensity: 0.9 }),
      event('burst', 62, { dur: 0.3 }),
    ];
    doc.gestures = [{
      id: 'g', t0: 40, t1: 70, mode: 'attract', radius: 0.14, strength: 1.2,
      samples: Array.from({ length: 31 }, (_, index) => ({
        t: index, x: 0.3 + 0.4 * Math.sin(index * 0.3), y: 0.5 + 0.2 * Math.cos(index * 0.2),
      })),
    }];
    return doc;
  };

  it('dos directores con el mismo documento dan la misma salida frame a frame', () => {
    const doc = fullDoc();
    const a = directorWith(doc);
    const b = directorWith(doc);
    for (let step = 0; step <= Math.round(70 / DT); step += 1) {
      const context = {
        time: step * DT, dt: DT, playing: true, aspect: ASPECT, particleCount: 1200,
      };
      const left = a.update(context);
      const right = b.update(context);
      expect(right.geometry).toEqual(left.geometry);
      expect(right.render).toEqual(left.render);
      expect(right.physics).toEqual(left.physics);
      expect(right.interactions).toEqual(left.interactions);
    }
  });

  it('saltar a t=60 da la misma imagen que llegar reproduciendo', () => {
    const doc = fullDoc();
    const target = Math.round(60 / DT) * DT;
    const played = directorWith(doc);
    for (let step = 0; step <= Math.round(60 / DT); step += 1) {
      played.update({ time: step * DT, dt: DT, playing: true, aspect: ASPECT, particleCount: 1200 });
    }
    const context = {
      time: target + DT, dt: DT, playing: true, aspect: ASPECT, particleCount: 1200,
    };
    const arriving = played.update(context);
    const jumping = directorWith(doc).update(context);
    // La imagen — línea, estrobos, sombras, color, exposición — es idéntica.
    expect(jumping.geometry).toEqual(arriving.geometry);
    expect(jumping.render).toEqual(arriving.render);
    expect(jumping.status.emitMaterial).toBe(arriving.status.emitMaterial);
    // Los gestos también: son función del tiempo, no del camino.
    const gestureOf = (out: typeof arriving) => out.interactions.find((i) => i.mode === 'attract');
    expect(gestureOf(jumping)).toEqual(gestureOf(arriving));
  });

  it('mantiene física, render y geometría finitos con las curvas al máximo', () => {
    const doc = emptyDoc();
    for (const id of ['emission', 'lightEmission', 'lineSize', 'cohesion', 'viscosity'] as CurveId[]) {
      doc.curves[id] = withKey(doc.curves[id], { t: 0, v: 1, shape: 'hold' });
    }
    doc.curves.exposure = withKey(doc.curves.exposure, { t: 0, v: 2, shape: 'hold' });
    doc.events = [event('strobe-lines', 0, { dur: 30, params: { count: 12, freqHz: 30 } })];
    const out = play(directorWith(doc), 5, 500);
    for (const value of Object.values(out.physics)) expect(Number.isFinite(value)).toBe(true);
    for (const value of Object.values(out.render)) expect(Number.isFinite(value)).toBe(true);
    expect(out.render.radianceExposure).toBeLessThanOrEqual(2);
    // El overlay tiene capacidad 160 instancias y el show no puede pasarse.
    expect(out.geometry.length).toBeLessThan(160);
  });
});

describe('FluidsShowDirector · línea y lámpara controlables', () => {
  it('mueve la línea con las curvas de X e Y', () => {
    const doc = emptyDoc();
    doc.curves.lineX = withKey(doc.curves.lineX, { t: 0, v: 0.2, shape: 'hold' });
    doc.curves.lineY = withKey(doc.curves.lineY, { t: 0, v: 0.8, shape: 'hold' });
    const blade = at(directorWith(doc), 3).geometry[0];
    expect(blade.x).toBeCloseTo(0.2, 6);
    expect(blade.y).toBeCloseTo(0.8, 6);
  });

  it('apaga la línea con su brillo sin dejar de emitir', () => {
    const doc = flat('lineEmit', 0);
    const dark = play(directorWith(doc), 3);
    // La línea desaparece de la geometría…
    expect(dark.geometry).toHaveLength(0);
    // …pero el emisor sigue escupiendo: son dos controles distintos.
    expect(dark.status.pps).toBeGreaterThan(0);

    const dim = at(directorWith(flat('lineEmit', 0.4)), 3);
    expect(dim.geometry[0].emit).toBeCloseTo(1.15 * 0.4, 6);
  });

  it('deja que set-lamp prenda un material distinto del que nace', () => {
    const doc = emptyDoc();
    doc.events = [
      event('set-material', 1, { params: { material: 2 } }),
      event('set-lamp', 2, { params: { primary: 1, secondary: 4, mix: 0.85 } }),
    ];
    const out = at(directorWith(doc), 5);
    // Nace azul, ilumina rojo.
    expect(out.status.emitMaterial).toBe(2);
    expect(out.render.emissiveMaterial).toBe(1);
    expect(out.render.reactiveSecondaryMaterial).toBe(-1);
  });

  it('prende dos materiales a la vez con el emisor secundario', () => {
    const doc = emptyDoc();
    doc.events = [event('set-lamp', 0, { params: { primary: 1, secondary: 2, mix: 0.85 } })];
    const out = at(directorWith(doc), 5);
    expect(out.render.emissiveMaterial).toBe(1);
    expect(out.render.reactiveSecondaryMaterial).toBe(2);
    expect(out.render.reactiveSecondaryStrength).toBeCloseTo(0.85, 6);

    // Un secundario igual al principal no tiene sentido y se ignora.
    doc.events = [event('set-lamp', 0, { params: { primary: 1, secondary: 1, mix: 0.85 } })];
    expect(at(directorWith(doc), 5).render.reactiveSecondaryMaterial).toBe(-1);
  });

  it('sin set-lamp la lámpara sigue al material que nace', () => {
    const doc = emptyDoc();
    doc.events = [event('set-material', 1, { params: { material: 2 } })];
    expect(at(directorWith(doc), 0.5).render.emissiveMaterial).toBe(0);
    expect(at(directorWith(doc), 5).render.emissiveMaterial).toBe(2);
  });
});

describe('el quiebre de la línea', () => {
  it('no depende del orden del array de eventos, sólo de su contenido', () => {
    // Un verificador lo refutó con el flujo real del editor: arrastrar un
    // evento no reordena `doc.events` (patch pisa el t y listo), pero
    // recargar sí (`parseShowDoc` ordena). Con la semilla vieja —la POSICIÓN
    // del evento en el array— el mismo doc se veía de una manera en vivo y
    // de otra tras guardar. La semilla es ahora el TIEMPO del último
    // crujido: contenido, no orden.
    const base = emptyDoc();
    // El CUÁNTO ahora lo pone la curva `lineBreak` (editable a mano); los
    // eventos ponen el ritmo. Sin curva no hay quiebre visual.
    base.curves.lineBreak = {
      keys: [
        { t: 0.95, v: 0, shape: 'linear' },
        { t: 1.05, v: 1, shape: 'linear' },
        { t: 2.2, v: 0.5, shape: 'linear' },
        { t: 2.4, v: 0.9, shape: 'linear' },
        { t: 9.5, v: 0.5, shape: 'hold' },
      ],
    };
    const cracks = [
      event('fracture', 1, {
        params: { x: 0.5, y: 0.5, angle: 0.4, length: 0.8, force: 2, shards: 4, crackle: 20 },
      }),
      event('fracture', 2.2, {
        dur: 0.35,
        params: { x: 0.5, y: 0.5, angle: 0.4, length: 0.1, force: 0, shards: 4, crackle: 20 },
      }),
      event('fracture', 2.6, {
        dur: 0.35,
        params: { x: 0.5, y: 0.5, angle: 0.4, length: 0.1, force: 0, shards: 4, crackle: 20 },
      }),
    ];
    const geoAt = (events: typeof cracks, time: number): string => (
      JSON.stringify(at(directorWith({ ...base, events }), time).geometry)
    );
    for (const time of [1.1, 2.3, 2.7, 4]) {
      expect(geoAt([...cracks].reverse(), time)).toBe(geoAt(cracks, time));
      expect(geoAt([cracks[1], cracks[2], cracks[0]], time)).toBe(geoAt(cracks, time));
    }
    // Y queda quebrada: mucho después del último crujido siguen las astillas.
    expect(at(directorWith({ ...base, events: cracks }), 9).geometry.length).toBeGreaterThan(6);
  });
});
