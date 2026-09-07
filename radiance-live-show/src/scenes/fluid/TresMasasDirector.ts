import type { GeoInstance } from './TresMasasGeometry';

/**
 * Tres Masas — cue-driven show director.
 *
 * A deterministic state machine: every sub-scene (1A…5B) declares physics
 * targets, render targets, a motion-graphics choreography for the geometry
 * layer (faro line, retícula bodies, monolito, obturador) and the solver
 * interactions that stitch both worlds together (portal emission, lamp
 * attractor, light wind, dispersion pulses). Values approach their targets
 * continuously, so stepping between cues always transitions instead of
 * cutting. All coordinates are fractions of the output; the scene converts.
 */

export const TRES_MASAS_CUES = [
  { id: '1A', name: 'LÍNEA' },
  { id: '1B', name: 'ROTACIÓN' },
  { id: '1C', name: 'RELOJ DE SOL' },
  { id: '2A', name: 'SIEMBRA' },
  { id: '2B', name: 'SOMBRA' },
  { id: '2C', name: 'MOIRÉ' },
  { id: '3A', name: 'HEREDERA' },
  { id: '3B', name: 'PORTAL BLANCO' },
  { id: '3C', name: 'PORTAL ROJO+AZUL' },
  { id: '4A', name: 'LÁMPARA (ATRAE)' },
  { id: '4B', name: 'SEPARAR / UNIR' },
  { id: '4C', name: 'ENJAMBRE DE BLOBS' },
  { id: '4D', name: 'DERIVA (BLOBS)' },
  { id: '4E', name: 'MUTACIÓN (LÁMPARA CICLA)' },
  { id: '4F', name: 'REUNIÓN ROJA' },
  { id: '4G', name: 'DISPERSIÓN AZUL' },
  { id: '5A', name: 'CONVERGENCIA' },
  { id: '5B', name: 'COLAPSO' },
] as const;

export const TRES_MASAS_MATERIALS = Object.freeze({
  colors: [0xffffff, 0xff0000, 0x0000ff, 0x8a8894] as const,
  masses: [0.15, 1.0, 0.45, 0.216] as const,
});

export interface TresMasasContext {
  dt: number;
  now: number;
  /** Output width / height, to convert between width- and height-fractions. */
  aspect: number;
  particleCount: number;
}

export interface TresMasasInteraction {
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

export interface TresMasasPhysics {
  sameRestDensity: number;
  differentRestDensity: number;
  stiffness: number;
  nearStiffness: number;
  gravity: number;
  drag: number;
}

export interface TresMasasOutput {
  cueIndex: number;
  cueId: string;
  cueName: string;
  physics: TresMasasPhysics;
  render: Record<string, number>;
  interactions: TresMasasInteraction[];
  geometry: GeoInstance[];
  resetParticles: number[] | null;
}

const clamp = (value: number, min = 0, max = 1): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const ease = (x: number): number => {
  const v = clamp(x);
  return v * v * (3 - 2 * v);
};

const approach = (from: number, to: number, speed: number, dt: number): number => (
  from + (to - from) * (1 - Math.exp(-speed * clamp(dt, 0.001, 0.1)))
);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const pingPong = (t: number): number => {
  const phase = t % 2;
  return phase < 1 ? phase : 2 - phase;
};

const GRID_COLS = 8;
const GRID_ROWS = 3;
const GRID_COUNT = GRID_COLS * GRID_ROWS;
const GRID_COLOR = 0xd6d6de;
const OCCLUDER_COLOR = 0x14141a;

interface FaroState {
  x: number;
  y: number;
  angle: number;
  len: number;
  alpha: number;
  emit: number;
  beamSign: number;
}

interface FaroTarget {
  x: number;
  y: number;
  len: number;
  emit: number;
  alpha: number;
  /** 'spin' integrates angularVelocity; 'step' quantizes; 'hold' approaches angle. */
  angleMode: 'spin' | 'step' | 'hold';
  angularVelocity: number;
  stepSeconds: number;
  stepRadians: number;
  holdAngle: number;
  beamSign: number;
}

export class TresMasasDirector {
  private cueIndex = 0;
  private cueTime = 0;
  private pendingReset: number[] | null = [0, 0, 0, 0];
  private epoch = 1;

  private readonly faro: FaroState = {
    x: 0.5, y: 0.5, angle: 0, len: 0, alpha: 0, emit: 0, beamSign: 1,
  };
  private stepAccumulator = 0;
  private readonly gridPresence = new Float32Array(GRID_COUNT);
  private readonly gridIgnite = new Float32Array(GRID_COUNT);
  private readonly gridOrder: number[] = Array.from({ length: GRID_COUNT }, (_, index) => index)
    .sort((a, b) => hash(a * 7.13) - hash(b * 7.13));
  private monoPresence = 0;
  private monoX = -0.12;
  private mono2Presence = 0;
  private filamentPresence = 0;
  private lampRadius = 0;
  private lampX = 0.5;
  private lampY = 0.24;
  private readonly physics: TresMasasPhysics = {
    sameRestDensity: 5,
    differentRestDensity: 5,
    stiffness: 0.2,
    nearStiffness: 0.08,
    gravity: 0,
    drag: 0.01,
  };
  private exposure = 0.4;
  private emitTimer = 0;
  private emittedTotal = 0;
  private pumpTimer = 0;
  private pumpBaseline = -1;
  /** Brillo del chorro convertido: sube al escupir, decae en ~2 s. */
  private pumpGlow = 0;
  private pumpMaterial = -1;

  get cue(): number {
    return this.cueIndex;
  }

  get cueId(): string {
    return TRES_MASAS_CUES[this.cueIndex].id;
  }

  setCue(index: number): void {
    const next = Math.max(0, Math.min(TRES_MASAS_CUES.length - 1, Math.round(index)));
    if (next === this.cueIndex) return;
    const previous = this.cueIndex;
    this.cueIndex = next;
    this.cueTime = 0;
    this.stepAccumulator = 0;
    // Entering the beginning of an act clears the world so every sub-scene is
    // rehearsable in isolation, exactly like jumping the timeline in Ableton.
    if (next === 0 || (next === 6 && previous > 6)) {
      this.pendingReset = [0, 0, 0, 0];
      this.emittedTotal = 0;
      this.epoch += 1;
    }
    if (next === 16) {
      // La aspiradora mide su población de referencia al entrar.
      this.pumpBaseline = -1;
      this.pumpTimer = 0;
    }
  }

  next(): void {
    this.setCue(this.cueIndex + 1);
  }

  prev(): void {
    this.setCue(this.cueIndex - 1);
  }

  update(context: TresMasasContext): TresMasasOutput {
    const dt = clamp(context.dt, 0.001, 0.1);
    const aspect = Math.max(0.4, Number.isFinite(context.aspect) ? context.aspect : 8 / 3);
    this.cueTime += dt;
    const t = this.cueTime;
    const now = context.now;
    const cue = this.cueIndex;
    const born = ease(t / 1.2);

    const interactions: TresMasasInteraction[] = [];
    const geometry: GeoInstance[] = [];

    this.updateFaro(cue, t, dt);
    this.updateGrid(cue, t, dt, now, geometry);
    this.updateMonoliths(cue, t, dt, geometry);
    this.pushFaro(geometry, aspect);
    this.updateLamp(cue, t, dt, geometry, interactions);
    this.updateFilament(cue, t, dt, geometry);
    this.updateShutter(cue, t, geometry);
    this.updatePortal(cue, dt, aspect, context.particleCount, interactions);
    this.updateFluidForces(cue, t, now, dt, aspect, context.particleCount, interactions);
    this.pumpGlow = approach(this.pumpGlow, 0, 1.1, dt);

    const physicsTarget = this.physicsTargetFor(cue, t);
    const keys = Object.keys(this.physics) as Array<keyof TresMasasPhysics>;
    for (const key of keys) {
      this.physics[key] = approach(this.physics[key], physicsTarget[key], 2.6, dt);
    }

    const render = this.renderStateFor(cue, t, dt, born);
    const resetParticles = this.pendingReset;
    this.pendingReset = null;

    return {
      cueIndex: cue,
      cueId: TRES_MASAS_CUES[cue].id,
      cueName: TRES_MASAS_CUES[cue].name,
      physics: { ...this.physics },
      render,
      interactions,
      geometry,
      resetParticles,
    };
  }

  // ------------------------------------------------------------------ faro

  private faroTargetFor(cue: number, t: number): FaroTarget {
    const base: FaroTarget = {
      x: 0.5, y: 0.5, len: 0.4, emit: 1.15, alpha: 1,
      angleMode: 'spin', angularVelocity: 0, stepSeconds: 0.5, stepRadians: Math.PI / 15,
      holdAngle: 0, beamSign: 1,
    };
    switch (cue) {
      case 0:
        return { ...base, len: 0.38, angleMode: 'hold', holdAngle: 0, emit: 1.05 + 0.3 * Math.sin(t * 0.7) };
      case 1:
        return { ...base, len: mix(0.4, 0.54, ease(t / 10)), angularVelocity: 0.11 };
      case 2:
        // A short blade is a near-point source, so the grid throws long,
        // clearly directional shadow corridors. At 0.46 it was a wide area
        // light: its penumbrae swallowed each body's corridor and the shadows
        // read as small blobs around the bodies instead of cast streaks.
        return { ...base, len: 0.16, angularVelocity: 0.14 };
      case 3:
        // Traslado definido: del centro al carril izquierdo, giro continuo.
        // The rotation used to be quantized (PI/15 every 0.5 s), which read as
        // a mechanical jump rather than a move. This is the same average rate,
        // 0.419 rad/s, integrated continuously.
        return {
          ...base,
          x: mix(0.5, 0.1, ease(t / 8)),
          len: 0.17,
          angularVelocity: Math.PI / 7.5,
          emit: 1.1,
        };
      case 4:
        // Vertical en el carril izquierdo, haz hacia la derecha.
        return { ...base, x: 0.06, y: 0.5, len: 0.26, angleMode: 'hold', holdAngle: Math.PI / 2, emit: 1.2, beamSign: -1 };
      case 5:
        // Barrido H: la línea recorre el ancho en un vaivén con easing.
        return {
          ...base,
          x: mix(0.18, 0.82, ease(pingPong(t / 7))),
          y: 0.2,
          len: 0.24,
          angleMode: 'hold',
          holdAngle: 0,
          emit: 1.15,
        };
      case 6:
        return { ...base, x: 0.5, y: 0.22, len: 0.11, angularVelocity: 0.05, emit: 1.15 };
      case 7:
        return { ...base, x: 0.5, y: 0.22, len: 0.105, angularVelocity: 0.055, emit: 1.25 };
      case 8:
        return { ...base, x: 0.5, y: 0.22, len: mix(0.1, 0.085, ease(t / 14)), angularVelocity: 0.06, emit: 1.1 };
      case 9:
        // La línea colapsa: su longitud muere en el punto-lámpara.
        return { ...base, x: 0.5, y: 0.24, len: mix(0.085, 0.001, ease(t / 1.6)), angularVelocity: 0.06, emit: 1.2, alpha: 1 - ease((t - 1.2) / 0.8) };
      case 16: {
        // En modo aspiradora la línea arde un poco más: está trabajando.
        const vacuum = Math.floor(t / 8) % 2 === 1;
        return { ...base, x: 0.3, y: 0.28, len: 0.26, angularVelocity: 0.15, emit: vacuum ? 1.5 : 1.25 };
      }
      case 17:
        return {
          ...base,
          x: 0.5,
          y: 0.5,
          len: t < 10 ? mix(0.001, 0.3, ease(t / 5)) : mix(0.3, 0.001, ease((t - 10) / 6)),
          angleMode: 'hold',
          holdAngle: 0,
          emit: 1.05,
        };
      default:
        // 10..15: fluid only, the line rests dark.
        return { ...base, len: 0.001, emit: 0, alpha: 0 };
    }
  }

  private updateFaro(cue: number, t: number, dt: number): void {
    const target = this.faroTargetFor(cue, t);
    // El flip de lado es un corte seco: ese es su carácter.
    this.faro.beamSign = target.beamSign;
    this.faro.x = approach(this.faro.x, target.x, 3, dt);
    this.faro.y = approach(this.faro.y, target.y, 3, dt);
    this.faro.len = approach(this.faro.len, target.len, 3.2, dt);
    this.faro.emit = approach(this.faro.emit, target.emit, 4, dt);
    this.faro.alpha = approach(this.faro.alpha, target.alpha, 3, dt);
    if (target.angleMode === 'spin') {
      this.faro.angle += target.angularVelocity * dt;
    } else if (target.angleMode === 'step') {
      this.stepAccumulator += dt;
      if (this.stepAccumulator >= target.stepSeconds) {
        this.stepAccumulator %= target.stepSeconds;
        this.faro.angle += target.stepRadians;
      }
    } else {
      // Take the shortest arc toward the held pose.
      const twoPi = Math.PI * 2;
      let delta = (target.holdAngle - this.faro.angle) % twoPi;
      if (delta > Math.PI) delta -= twoPi;
      if (delta < -Math.PI) delta += twoPi;
      this.faro.angle += delta * (1 - Math.exp(-3 * dt));
    }
  }

  private pushFaro(geometry: GeoInstance[], aspect: number): void {
    const faro = this.faro;
    if (faro.alpha <= 0.02 || faro.len <= 0.003) return;
    // len is a width fraction; half extents live in height units.
    const halfLen = (faro.len * aspect) / 2;
    const normal = { x: -Math.sin(faro.angle), y: Math.cos(faro.angle) };
    const beam = faro.beamSign;
    // Emissive blade. The blade and its backing are the only bodies that take
    // the wide source feather: they are the long shallow diagonal whose
    // density edge has to span more than one texel for the transport to place
    // its shadow contour off the texel grid. Compact bodies keep the narrow
    // edge so their shadows stay directional instead of turning into blobs.
    geometry.push({
      x: faro.x, y: faro.y, w: halfLen, h: 0.0035,
      rot: faro.angle, color: 0xffffff,
      emit: faro.emit * faro.alpha, absorb: 0.25,
      shade: 1.1 * faro.alpha, shape: 0, wideFeather: true,
    });
    // Occluder backing: blocks the opposite half plane, making the emission
    // unilateral inside the real radiance transport.
    const offset = 0.008 * beam;
    geometry.push({
      x: faro.x - (normal.x * offset) / aspect,
      y: faro.y - normal.y * offset,
      w: halfLen * 1.04, h: 0.005,
      rot: faro.angle, color: 0x000000,
      emit: 0, absorb: 1.0,
      shade: 0.05 * faro.alpha, shape: 0, wideFeather: true,
    });
  }

  // ------------------------------------------------------------------ grid

  private gridCell(index: number): { x: number; y: number } {
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    return {
      x: 0.09 + (0.82 / (GRID_COLS - 1)) * col,
      y: 0.24 + (0.52 / (GRID_ROWS - 1)) * row,
    };
  }

  private updateGrid(
    cue: number,
    t: number,
    dt: number,
    now: number,
    geometry: GeoInstance[],
  ): void {
    // Fraction of grid cells lit in any 1.6 s window. 2C (cue 5) ran the
    // highest count on top of a full grid and the full-width filament, which
    // is why it read as an undifferentiated wash of scattered dots.
    const igniteChance = cue === 3 ? 0.1 : cue === 4 ? 0.12 : cue === 5 ? 0.06 : cue === 2 ? 0.07 : 0;
    const window = Math.floor(now / 1.6);
    const windowPhase = (now / 1.6) % 1;
    for (let index = 0; index < GRID_COUNT; index += 1) {
      let presenceTarget = 0;
      if (cue === 2) presenceTarget = hash(index * 3.1) < 0.5 ? 1 : 0;
      else if (cue === 3) presenceTarget = t > this.gridOrder.indexOf(index) * 0.22 ? 1 : 0;
      else if (cue === 4 || cue === 5) presenceTarget = 1;
      else if (cue === 16) presenceTarget = Math.floor(index / GRID_COLS) === 0 ? 1 : 0;
      this.gridPresence[index] = approach(this.gridPresence[index], presenceTarget, 5, dt);

      const igniteActive = igniteChance > 0 && hash(index * 3.7 + window * 17.3) < igniteChance;
      const igniteTarget = igniteActive ? Math.sin(Math.PI * windowPhase) : 0;
      this.gridIgnite[index] = approach(this.gridIgnite[index], igniteTarget, 8, dt);

      const presence = this.gridPresence[index];
      if (presence <= 0.02) continue;
      const cell = this.gridCell(index);
      const pulse = 1 + 0.28 * Math.sin(now * 0.8 + hash(index * 9.7) * 6.28);
      const bigBodies = cue === 2;
      const radius = (bigBodies ? 0.020 : 0.013) * pulse * presence;
      const ignite = this.gridIgnite[index];
      geometry.push({
        x: cell.x, y: cell.y, w: radius, h: radius,
        rot: bigBodies ? hash(index * 5.3) * 0.6 : 0,
        color: ignite > 0.05 ? 0xffffff : (bigBodies ? OCCLUDER_COLOR : GRID_COLOR),
        emit: ignite * 0.95,
        absorb: mix(0.6, 0.25, ignite),
        shade: mix(0.16, 1.0, ignite) * presence,
        shape: bigBodies ? 0 : 1,
      });
      // Moiré: duplicated grid, offset, fainter.
      if (cue === 5 && t > 4) {
        const moire = ease((t - 4) / 2) * presence;
        geometry.push({
          x: cell.x + 0.011, y: cell.y + 0.016, w: radius * 0.9, h: radius * 0.9,
          rot: 0, color: GRID_COLOR,
          emit: 0, absorb: 0.35, shade: 0.09 * moire, shape: 1,
        });
      }
    }
  }

  // ------------------------------------------------------------- monoliths

  private updateMonoliths(cue: number, t: number, dt: number, geometry: GeoInstance[]): void {
    const wantsMono = cue === 4 || cue === 16;
    this.monoPresence = approach(this.monoPresence, wantsMono ? 1 : 0, 3, dt);
    if (cue === 4) {
      // Quantized slide: it moves only on the step.
      const steps = Math.min(14, Math.floor(t / 0.4));
      this.monoX = approach(this.monoX, -0.08 + steps * 0.045, 6, dt);
    } else if (cue === 16) {
      this.monoX = approach(this.monoX, 0.88, 2.5, dt);
    } else {
      this.monoX = approach(this.monoX, this.monoX < 0.5 ? -0.14 : 1.14, 2.5, dt);
    }
    if (this.monoPresence > 0.03) {
      geometry.push({
        x: this.monoX, y: 0.5, w: 0.055, h: 0.42 * this.monoPresence,
        rot: 0, color: 0x000000,
        emit: 0, absorb: 1.05, shade: 0.06, shape: 0,
      });
    }
    const wantsSecond = cue === 16;
    this.mono2Presence = approach(this.mono2Presence, wantsSecond ? 1 : 0, 2.5, dt);
    if (this.mono2Presence > 0.03) {
      geometry.push({
        x: 0.62, y: 0.86, w: 0.16, h: 0.1 * this.mono2Presence,
        rot: 0, color: 0x000000,
        emit: 0, absorb: 1.0, shade: 0.05, shape: 0,
      });
    }
  }

  // ------------------------------------------------------------------ lamp

  private updateLamp(
    cue: number,
    t: number,
    dt: number,
    geometry: GeoInstance[],
    interactions: TresMasasInteraction[],
  ): void {
    const wantsLamp = cue === 9;
    const radiusTarget = wantsLamp ? mix(0.004, 0.016, ease((t - 1.2) / 1.4)) : 0;
    this.lampRadius = approach(this.lampRadius, radiusTarget, 4, dt);
    if (wantsLamp) {
      this.lampX = approach(this.lampX, 0.5, 1.2, dt);
      this.lampY = approach(this.lampY, mix(0.24, 0.46, ease(t / 7)), 1.2, dt);
    } else {
      this.lampY = approach(this.lampY, 0.24, 1.2, dt);
    }
    if (this.lampRadius > 0.002) {
      geometry.push({
        x: this.lampX, y: this.lampY, w: this.lampRadius, h: this.lampRadius,
        rot: 0, color: 0xffffff,
        emit: 1.9, absorb: 0.3, shade: 1.4, shape: 1,
      });
      // Se enciende y atrae — pero respirando: un tirón base constante y,
      // cada tanto, uno fuerte que también se traga a los cuerpos opacos
      // para que pasen frente a la luz y hagan sombra.
      const surge = (t % 4.5) < 0.6 ? 0.9 : 0.4;
      interactions.push({
        mode: 'attract',
        x: this.lampX, y: this.lampY, vx: 0, vy: 0,
        radius: 0.55, strength: surge, materialId: 0, emitCount: 0,
      });
    }
  }

  // -------------------------------------------------------------- filament

  private updateFilament(cue: number, t: number, dt: number, geometry: GeoInstance[]): void {
    const wants = cue === 5 && t > 5 ? 1 : 0;
    this.filamentPresence = approach(this.filamentPresence, wants, 3.5, dt);
    if (this.filamentPresence <= 0.03) return;
    // It spans the whole width, so its emission carries much further than its
    // thickness suggests: it was a large share of 2C's total light.
    geometry.push({
      x: 0.5, y: 0.5, w: 1.16 * this.filamentPresence, h: 0.0028,
      rot: 0, color: 0xffffff,
      emit: 0.45 * this.filamentPresence, absorb: 0.2,
      shade: 0.7 * this.filamentPresence, shape: 0, wideFeather: true,
    });
  }

  // --------------------------------------------------------------- shutter

  private updateShutter(cue: number, t: number, geometry: GeoInstance[]): void {
    if (cue !== 15) return;
    const phase = t % 4;
    if (phase > 0.5) return;
    const pattern = Math.floor(t / 4) % 2;
    for (let bar = 0; bar < 4; bar += 1) {
      if (bar % 2 !== pattern) continue;
      geometry.push({
        x: 0.125 + bar * 0.25, y: 0.5, w: 0.34, h: 0.52,
        rot: 0, color: 0x000000,
        emit: 0, absorb: 0, shade: 1, shape: 0, top: true,
      });
    }
  }

  // ---------------------------------------------------------------- portal

  private updatePortal(
    cue: number,
    dt: number,
    aspect: number,
    particleCount: number,
    interactions: TresMasasInteraction[],
  ): void {
    if (cue !== 7 && cue !== 8) return;
    this.emitTimer += dt;
    if (this.emitTimer < 0.32) return;
    this.emitTimer %= 0.32;

    let material = 0;
    if (cue === 8) material = this.cueTime < 9 ? 1 : 2;
    const cap = cue === 7 ? 3200 : material === 1 ? 5800 : 8200;
    if (particleCount >= cap) return;

    const faro = this.faro;
    const tangent = { x: Math.cos(faro.angle), y: Math.sin(faro.angle) };
    const normal = { x: -Math.sin(faro.angle), y: Math.cos(faro.angle) };
    // A pixel-space displacement d (height units) maps to (d·dir.x/aspect, d·dir.y).
    const halfLen = (faro.len * aspect) / 2;
    const along = (hash(this.emittedTotal * 1.71) - 0.5) * 2 * halfLen * 0.85;
    const side = 0.03 * faro.beamSign;
    const sideX = faro.x + (tangent.x * along + normal.x * side) / aspect;
    const sideY = faro.y + tangent.y * along + normal.y * side;
    interactions.push({
      mode: 'emit',
      x: sideX, y: sideY, vx: 0, vy: 0,
      radius: 0.02, strength: 0.5, materialId: material, emitCount: 7,
    });
    // Newborns leave the portal along the beam; weight takes over afterwards.
    const beamPush = 0.005 * faro.beamSign;
    const weightPush = material === 0 ? -0.003 : material === 1 ? 0.004 : 0;
    interactions.push({
      mode: 'drag',
      x: sideX, y: sideY,
      vx: normal.x * beamPush,
      vy: normal.y * beamPush + weightPush,
      radius: 0.05, strength: 1, materialId: material, emitCount: 0,
    });
    this.emittedTotal += 7;
  }

  // ---------------------------------------------------------- fluid forces

  private updateFluidForces(
    cue: number,
    t: number,
    now: number,
    dt: number,
    aspect: number,
    particleCount: number,
    interactions: TresMasasInteraction[],
  ): void {
    if (cue === 10) {
      // El atractor pasea la criatura mientras respira.
      interactions.push({
        mode: 'attract',
        x: 0.5 + 0.26 * Math.sin(now * 0.13),
        y: 0.46 + 0.18 * Math.sin(now * 0.09 + 1.3),
        vx: 0, vy: 0, radius: 0.5, strength: 0.32, materialId: 0, emitCount: 0,
      });
    }
    if (cue === 11 || cue === 12 || cue === 13) {
      // Enjambre: el mundo se llena hasta la densidad del acto de blobs.
      // Varios surtidores repartidos siembran cúmulos separados; con same≫cross
      // cada cúmulo se cierra en su propio blob.
      if (particleCount < 14000) {
        this.emitTimer += dt;
        if (this.emitTimer >= 0.12) {
          this.emitTimer %= 0.12;
          for (let spout = 0; spout < 4; spout += 1) {
            const seed = spout * 13.7 + Math.floor(t * 0.5) * 7.9;
            const material = spout === 3 ? 2 : spout === 2 ? 1 : 0;
            interactions.push({
              mode: 'emit',
              x: 0.14 + 0.72 * hash(seed),
              y: 0.18 + 0.64 * hash(seed + 51.3),
              vx: 0, vy: 0, radius: 0.03, strength: 0.5,
              materialId: material, emitCount: 60,
            });
          }
        }
      }
    }
    if (cue === 11) {
      // Un pulso de repulsión ocasional parte las masas grandes en blobs.
      const phase = t % 3.2;
      if (phase < 0.09) {
        interactions.push({
          mode: 'repel',
          x: 0.2 + 0.6 * hash(Math.floor(t / 3.2) * 3.1),
          y: 0.25 + 0.5 * hash(Math.floor(t / 3.2) * 5.7),
          vx: 0, vy: 0, radius: 0.3, strength: 0.55, materialId: 0, emitCount: 0,
        });
      }
    }
    if (cue === 12) {
      // Deriva: cuatro atractores en órbitas de Lissajous arrastran blobs —
      // se estiran al viajar (y destellan por velocidad), se fusionan al
      // cruzarse y vuelven a partirse al separarse los focos.
      for (let focus = 0; focus < 4; focus += 1) {
        interactions.push({
          mode: 'attract',
          x: 0.5 + 0.34 * Math.sin(now * (0.11 + 0.03 * focus) + focus * 1.7),
          y: 0.48 + 0.3 * Math.sin(now * (0.07 + 0.04 * focus) + focus * 2.4),
          vx: 0, vy: 0, radius: 0.17, strength: 0.42, materialId: 0, emitCount: 0,
        });
      }
    }
    if (cue === 13) {
      // Mutación: los focos siguen pero lentos; la cohesión respira en la
      // física y la lámpara cicla en el render — los blobs cambian de forma
      // y de iluminación sin un solo corte.
      for (let focus = 0; focus < 3; focus += 1) {
        interactions.push({
          mode: 'attract',
          x: 0.5 + 0.3 * Math.sin(now * (0.05 + 0.02 * focus) + focus * 2.1),
          y: 0.5 + 0.26 * Math.sin(now * (0.04 + 0.025 * focus) + focus * 1.3),
          vx: 0, vy: 0, radius: 0.19, strength: 0.3, materialId: 0, emitCount: 0,
        });
      }
      const phase = t % 5;
      if (phase < 0.09) {
        interactions.push({
          mode: 'repel',
          x: 0.25 + 0.5 * hash(Math.floor(t / 5) * 9.3),
          y: 0.3 + 0.4 * hash(Math.floor(t / 5) * 4.1),
          vx: 0, vy: 0, radius: 0.26, strength: 0.7, materialId: 0, emitCount: 0,
        });
      }
    }
    if (cue === 14) {
      interactions.push({
        mode: 'attract',
        x: 0.5, y: 0.5, vx: 0, vy: 0,
        radius: 0.55, strength: 0.45, materialId: 1, emitCount: 0,
      });
    }
    if (cue === 15) {
      const phase = t % 2.5;
      if (phase < 0.1) {
        interactions.push({
          mode: 'repel',
          x: 0.5, y: 0.5, vx: 0, vy: 0,
          radius: 0.48, strength: 1.25, materialId: 2, emitCount: 0,
        });
      }
    }
    if (cue === 16) {
      const faro = this.faro;
      const normal = { x: -Math.sin(faro.angle), y: Math.cos(faro.angle) };
      if (this.pumpBaseline < 0) this.pumpBaseline = particleCount;
      const vacuum = Math.floor(t / 8) % 2 === 1;
      if (!vacuum) {
        // Viento de luz: el haz del faro empuja la materia que ilumina.
        for (let sample = 1; sample <= 3; sample += 1) {
          const distance = sample * 0.14 * faro.beamSign;
          interactions.push({
            mode: 'drag',
            x: faro.x + (normal.x * distance) / aspect,
            y: faro.y + normal.y * distance,
            vx: normal.x * 0.0022 * faro.beamSign,
            vy: normal.y * 0.0022 * faro.beamSign,
            radius: 0.13, strength: 1, materialId: 0, emitCount: 0,
          });
        }
      } else {
        // Aspiradora: no un imán puntual sino un CAMPO DIRECCIONAL — la
        // materia del lado del haz fluye hacia la línea, la atraviesa por la
        // boca y sale convertida por el lado oscuro, brillando en su color
        // nuevo un par de segundos aunque la lámpara global sea otra.
        const back = -faro.beamSign;
        const tangent = { x: Math.cos(faro.angle), y: Math.sin(faro.angle) };
        const mouthX = faro.x + (normal.x * 0.01 * faro.beamSign) / aspect;
        const mouthY = faro.y + normal.y * 0.01 * faro.beamSign;
        const exhaustX = faro.x + (normal.x * 0.05 * back) / aspect;
        const exhaustY = faro.y + normal.y * 0.05 * back;
        // Flujo laminar hacia la línea: empujes a lo largo del haz, apuntando
        // a la boca, más un embudo tangencial cerca de los extremos.
        for (let sample = 1; sample <= 3; sample += 1) {
          const distance = sample * 0.12 * faro.beamSign;
          interactions.push({
            mode: 'drag',
            x: faro.x + (normal.x * distance) / aspect,
            y: faro.y + normal.y * distance,
            vx: -normal.x * 0.0035 * faro.beamSign,
            vy: -normal.y * 0.0035 * faro.beamSign,
            radius: 0.15, strength: 1, materialId: 0, emitCount: 0,
          });
        }
        const halfLen = (faro.len * aspect) / 2;
        for (const side of [-1, 1]) {
          const along = side * halfLen * 0.7;
          interactions.push({
            mode: 'drag',
            x: faro.x + (tangent.x * along + normal.x * 0.08 * faro.beamSign) / aspect,
            y: faro.y + tangent.y * along + normal.y * 0.08 * faro.beamSign,
            vx: -tangent.x * side * 0.002,
            vy: -tangent.y * side * 0.002,
            radius: 0.1, strength: 1, materialId: 0, emitCount: 0,
          });
        }
        // Flujo de un solo sentido: del lado oscuro un barrido aleja lo que
        // ya cruzó, para que nada vuelva a entrar por atrás.
        interactions.push({
          mode: 'drag',
          x: faro.x + (normal.x * 0.12 * back) / aspect,
          y: faro.y + normal.y * 0.12 * back,
          vx: normal.x * 0.004 * back,
          vy: normal.y * 0.004 * back,
          radius: 0.12, strength: 1, materialId: 0, emitCount: 0,
        });
        this.pumpTimer += dt;
        if (this.pumpTimer >= 0.55) {
          this.pumpTimer %= 0.55;
          // Bocados chicos y poco frecuentes: cada borrado corre los índices
          // del buffer y la interpolación smearea un frame — así casi no se ve.
          if (particleCount > this.pumpBaseline - 500) {
            interactions.push({
              mode: 'delete',
              x: mouthX, y: mouthY, vx: 0, vy: 0,
              radius: 0.022, strength: 0, materialId: 0, emitCount: 0,
            });
          }
          if (particleCount < this.pumpBaseline + 500) {
            const converted = [1, 2, 0][Math.floor(t / 6) % 3];
            interactions.push({
              mode: 'emit',
              x: exhaustX, y: exhaustY, vx: 0, vy: 0,
              radius: 0.02, strength: 0.5, materialId: converted, emitCount: 10,
            });
            interactions.push({
              mode: 'drag',
              x: exhaustX, y: exhaustY,
              vx: normal.x * 0.016 * back,
              vy: normal.y * 0.016 * back,
              radius: 0.06, strength: 1, materialId: converted, emitCount: 0,
            });
            // El chorro convertido se enciende en SU color y decae en ~2 s.
            this.pumpGlow = 1;
            this.pumpMaterial = converted;
          }
        }
      }
    }
  }

  // --------------------------------------------------------------- targets

  private physicsTargetFor(cue: number, t: number): TresMasasPhysics {
    switch (cue) {
      case 7:
        return { sameRestDensity: 4.2, differentRestDensity: 3.4, stiffness: 0.16, nearStiffness: 0.07, gravity: -0.05, drag: 0.012 };
      case 8:
        return { sameRestDensity: 4.6, differentRestDensity: 3.2, stiffness: 0.18, nearStiffness: 0.08, gravity: 0.16, drag: 0.01 };
      case 9: {
        // La lámpara junta, pero las materias no se licúan. El cruce respira
        // lento (periodo 14 s): con cruce bajo, los tirones meten los cuerpos
        // opacos al centro — eclipse: núcleo negro con halo emisivo alrededor;
        // con cruce alto todo se remezcla un momento, y vuelve a separarse.
        const remix = 0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 14);
        return {
          sameRestDensity: mix(9.8, 7.4, remix),
          differentRestDensity: mix(1.6, 5.8, remix),
          stiffness: 0.22,
          nearStiffness: mix(1.0, 0.5, remix),
          gravity: 0,
          drag: 0.012,
        };
      }
      case 10: {
        // Ciclo separar/unir: cross respira con periodo de 20 s. Unir es
        // apretarse en un cuerpo de lóbulos, nunca mezclarse en sopa.
        const s = 0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 20);
        return {
          sameRestDensity: mix(8.5, 10.6, s),
          differentRestDensity: mix(5.5, 0.9, s),
          stiffness: 0.3,
          nearStiffness: mix(0.6, 1.1, s),
          gravity: 0,
          drag: 0.008,
        };
      }
      case 11:
        // Enjambre: cohesión propia de cluster, cruce mínimo → blobs separados.
        return { sameRestDensity: 11.2, differentRestDensity: 1.3, stiffness: 0.3, nearStiffness: 1.4, gravity: 0, drag: 0.012 };
      case 12:
        return { sameRestDensity: 10.6, differentRestDensity: 1.2, stiffness: 0.28, nearStiffness: 1.3, gravity: 0, drag: 0.01 };
      case 13: {
        // Mutación: la cohesión respira — los blobs se aflojan, se derraman
        // y se vuelven a cerrar con otra forma.
        const s = 0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 9);
        return {
          sameRestDensity: mix(7.2, 11.4, s),
          differentRestDensity: mix(2.4, 1.0, s),
          stiffness: mix(0.24, 0.4, s),
          nearStiffness: mix(0.5, 1.5, s),
          gravity: 0,
          drag: 0.01,
        };
      }
      case 14:
        return { sameRestDensity: 5.2, differentRestDensity: 10.6, stiffness: 0.34, nearStiffness: 0.3, gravity: 0, drag: 0.008 };
      case 15:
        return { sameRestDensity: 1.2, differentRestDensity: 1.0, stiffness: 1.3, nearStiffness: 0.06, gravity: 0, drag: 0 };
      case 16:
        return { sameRestDensity: 6.5, differentRestDensity: 6.0, stiffness: 0.24, nearStiffness: 0.2, gravity: 0.12, drag: 0.006 };
      case 17:
        return { sameRestDensity: 7.2, differentRestDensity: 6.6, stiffness: 0.28, nearStiffness: 0.3, gravity: 0.95, drag: 0.02 };
      default:
        return { sameRestDensity: 5, differentRestDensity: 5, stiffness: 0.2, nearStiffness: 0.08, gravity: 0, drag: 0.01 };
    }
  }

  private renderStateFor(cue: number, t: number, dt: number, born: number): Record<string, number> {
    // Lamp per cue: 3 = nothing emits (materia oscura); the crossfade handles
    // every migration so re-lighting always reads as caused, never cut.
    // In MUTACIÓN the lamp cycles on its own: blanco → rojo → azul, 6 s each.
    const lamp = cue === 9 || cue === 10 || cue === 11 || cue === 12 || cue === 17 ? 0
      : cue === 13 ? Math.floor(t / 6) % 3
      : cue === 14 || cue === 16 ? 1
      : cue === 15 ? 2
      : 3;
    // El chorro convertido de la aspiradora brilla en SU color mediante el
    // emisor secundario, independiente de la lámpara, y decae con pumpGlow.
    const pumpActive = cue === 16
      && this.pumpMaterial >= 0
      && this.pumpMaterial !== lamp
      && this.pumpGlow > 0.02;
    const velocityFloor = cue === 15 ? 0.02
      : cue === 9 ? 0.3
      : cue === 11 ? 0.32
      : cue === 12 ? 0.18
      : cue === 13 ? 0.26
      : cue === 10 || cue === 14 ? 0.22
      : cue === 16 ? 0.16
      : cue === 17 ? 0.12
      : 0.2;
    let exposureTarget = cue <= 6 ? 0.42 : cue <= 8 ? 0.4 : cue === 15 ? 0.3 : 0.36;
    let radiance = 1.5;
    if (cue === 17) {
      const fade = 1 - ease((t - 14) / 6);
      exposureTarget *= fade;
      radiance *= Math.max(0.05, fade);
    }
    this.exposure = approach(this.exposure, exposureTarget, 2, dt);

    return {
      particleSize: cue === 7 || cue === 8 ? 3.6 : 3.4,
      radiance,
      radianceSpread: 0.95,
      radianceAbsorption: 1.32,
      radianceExposure: this.exposure,
      gradeHue: 0,
      gradeSaturation: 1.02,
      gradeContrast: 1.5,
      gradeBrightness: 0,
      gradeBlackPoint: 0.06,
      emissiveMaterial: lamp,
      allEmitters: lamp === 3 ? 0 : 1,
      velocityEmission: 1,
      velocityEmissionFloor: velocityFloor,
      ambientVelocityEmission: 0,
      ambientEmissionScale: 1,
      lightOnly: 1,
      // Fuerza máxima y fracción completa: el chorro recién convertido tiene
      // que verse encenderse en el lado oscuro, no insinuarse.
      reactiveSecondaryMaterial: pumpActive ? this.pumpMaterial : -1,
      reactiveSecondaryStrength: pumpActive ? Math.min(0.85, 0.85 * this.pumpGlow) : 0,
      reactiveSecondaryFraction: 1,
      emitterCrossfadeSeconds: 0.8,
      emitterVisualScale: 1,
      emitterFluxScale: 1,
      motionEpoch: this.epoch,
      backgroundBlack: 1,
      blackOutput: cue === 17 && t > 21 ? 1 : 0,
      instantEmissionRole: 0,
      materialColor0: TRES_MASAS_MATERIALS.colors[0],
      materialColor1: TRES_MASAS_MATERIALS.colors[1],
      materialColor2: TRES_MASAS_MATERIALS.colors[2],
      materialColor3: TRES_MASAS_MATERIALS.colors[3],
      // The overlay is part of the same show: expose its birth for the scene.
      tresMasasBorn: born,
    };
  }
}

export default TresMasasDirector;
