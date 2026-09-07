import type { DetectedNote } from '../../core/types';

const clamp = (value: number, min = 0, max = 1): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const smoothstep = (value: number): number => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

const approach = (from: number, to: number, speed: number, dt: number): number => (
  from + (to - from) * (1 - Math.exp(-speed * clamp(dt, 0.001, 0.1)))
);

const median = (values: readonly number[]): number => {
  if (!values.length) return 0.5;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
};

const foldBeatPeriod = (interval: number): number => {
  let period = interval;
  while (period < 0.34) period *= 2;
  while (period > 0.86) period *= 0.5;
  return clamp(period, 0.34, 0.86);
};

export interface ReactiveFluidMusic {
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  onset: number;
  flux: number;
  centroid: number;
  harmonicCenter: number;
  harmonicConfidence: number;
  harmonicSpread: number;
}

export interface ReactiveFluidMoment {
  id: 'float' | 'cluster' | 'mix' | 'fall' | 'viscous' | 'burst' | 'orbit';
  name: string;
  same: number;
  cross: number;
  pressure: number;
  tension: number;
  gravity: number;
  drag: number;
  size: number;
  light: number;
  exposure: number;
  contrast: number;
  impulse: number;
  duration: readonly [number, number];
}

interface BlendedMoment extends Omit<ReactiveFluidMoment, 'duration'> {
  transition: number;
  duration: readonly [number, number];
}

export const REACTIVE_FLUID_MOMENTS: readonly ReactiveFluidMoment[] = Object.freeze([
  Object.freeze({
    id: 'float', name: 'INGRAVIDEZ', same: 3.6, cross: 3.0, pressure: 0.14,
    tension: 0.05, gravity: 0, drag: 0.002, size: -0.1, light: -0.06,
    exposure: -0.015, contrast: 0.08, impulse: 0.65, duration: [7, 12] as const,
  }),
  Object.freeze({
    id: 'cluster', name: 'ATRACCIÓN PROPIA', same: 11.2, cross: 1.3, pressure: 0.34,
    tension: 1.45, gravity: 0, drag: 0.012, size: 0.2, light: 0.06,
    exposure: 0.025, contrast: 0.12, impulse: 0.8, duration: [6, 10] as const,
  }),
  Object.freeze({
    id: 'mix', name: 'MEZCLA CRUZADA', same: 2.1, cross: 10.9, pressure: 0.55,
    tension: 0.18, gravity: 0, drag: 0.004, size: 0.35, light: 0.1,
    exposure: 0.035, contrast: -0.04, impulse: 1.15, duration: [6, 10] as const,
  }),
  Object.freeze({
    id: 'fall', name: 'CAÍDA GRAVITATORIA', same: 6.3, cross: 5.4, pressure: 0.32,
    tension: 0.24, gravity: 0.72, drag: 0.006, size: 0.12, light: 0.03,
    exposure: 0.02, contrast: 0.04, impulse: 0.75, duration: [5, 9] as const,
  }),
  Object.freeze({
    id: 'viscous', name: 'TENSIÓN VISCOSA', same: 8.7, cross: 7.6, pressure: 0.12,
    tension: 1.8, gravity: 0.14, drag: 0.085, size: 0.45, light: -0.04,
    exposure: -0.01, contrast: 0.16, impulse: 0.48, duration: [7, 11] as const,
  }),
  Object.freeze({
    id: 'burst', name: 'EXPANSIÓN', same: 1.0, cross: 1.0, pressure: 1.45,
    tension: 0.05, gravity: 0, drag: 0, size: 0.75, light: 0.22,
    exposure: 0.075, contrast: -0.08, impulse: 1.5, duration: [3, 4.8] as const,
  }),
  Object.freeze({
    id: 'orbit', name: 'ÓRBITA', same: 5.0, cross: 8.8, pressure: 0.66,
    tension: 0.4, gravity: 0, drag: 0.006, size: 0.28, light: 0.14,
    exposure: 0.045, contrast: 0.02, impulse: 1.3, duration: [6, 10] as const,
  }),
]);

const blendMoment = (
  from: Omit<ReactiveFluidMoment, 'duration'>,
  to: ReactiveFluidMoment,
  amount: number,
): BlendedMoment => {
  const blend = smoothstep(amount);
  return {
    id: to.id,
    name: to.name,
    transition: blend,
    duration: to.duration,
    same: from.same + (to.same - from.same) * blend,
    cross: from.cross + (to.cross - from.cross) * blend,
    pressure: from.pressure + (to.pressure - from.pressure) * blend,
    tension: from.tension + (to.tension - from.tension) * blend,
    gravity: from.gravity + (to.gravity - from.gravity) * blend,
    drag: from.drag + (to.drag - from.drag) * blend,
    size: from.size + (to.size - from.size) * blend,
    light: from.light + (to.light - from.light) * blend,
    exposure: from.exposure + (to.exposure - from.exposure) * blend,
    contrast: from.contrast + (to.contrast - from.contrast) * blend,
    impulse: from.impulse + (to.impulse - from.impulse) * blend,
  };
};

export interface ReactiveFluidInteraction {
  mode: 'attract' | 'repel' | 'vortex' | 'vortex-reverse';
  x: number;
  y: number;
  radius: number;
  strength: number;
}

export interface ReactiveFluidOutput {
  physics: {
    sameRestDensity: number;
    differentRestDensity: number;
    stiffness: number;
    nearStiffness: number;
    gravity: number;
    drag: number;
  };
  render: {
    particleSize: number;
    radiance: number;
    radianceSpread: number;
    radianceAbsorption: number;
    radianceExposure: number;
    gradeHue: number;
    gradeSaturation: number;
    gradeContrast: number;
    gradeBrightness: number;
    gradeBlackPoint: number;
    emissiveMaterial: number;
    allEmitters: number;
    velocityEmission: number;
    lightOnly: number;
    reactiveSecondaryMaterial: number;
    reactiveSecondaryStrength: number;
    reactiveSecondaryFraction: number;
  };
  interactions: ReactiveFluidInteraction[];
  telemetry: {
    rms: number;
    bass: number;
    mid: number;
    treble: number;
    onset: number;
    flux: number;
    centroid: number;
    bpm: number;
    rhythmDensity: number;
    beatPulse: number;
    climax: number;
    noteDensity: number;
    chordWidth: number;
    momentId: ReactiveFluidMoment['id'];
    momentName: string;
    momentTransition: number;
    momentRemaining: number;
    sameRestDensity: number;
    differentRestDensity: number;
    stiffness: number;
    nearStiffness: number;
    gravity: number;
    drag: number;
    primaryMaterial: number;
    secondaryMaterial: number;
    secondaryStrength: number;
    secondaryFraction: number;
  };
}

interface DirectorFeatures {
  time: number;
  bass: number;
  mid: number;
  treble: number;
  flux: number;
  harmonicConfidence: number;
  harmonicSpread: number;
  climax: number;
  spectralEnergy: number;
}

interface SecondaryEvent {
  material: number;
  startedAt: number;
  duration: number;
  fraction: number;
  strength: number;
}

interface NoteSummary {
  density: number;
  center: number;
  chordWidth: number;
}

/** Exact state machine and constants from `/reactive/`'s ReactiveDirector. */
export class ReactiveFluidDirector {
  private seed: number;
  private clockInitialized = false;
  private elapsed = 0;
  private previousOnset = 0;
  private lastOnsetAt = -Infinity;
  private onsetTimes: number[] = [];
  private beatPeriod = 0.5;
  private primaryMaterial = 3;
  private nextPrimarySwitchAt = 2.5;
  private nextSecondaryOpportunityAt = 3.5;
  private secondaryEvent: SecondaryEvent | null = null;
  private fastEnergy = 0;
  private slowEnergy = 0;
  private transientEnvelope = 0;
  private momentIndex = 0;
  private momentStartedAt = 0;
  private momentEndsAt = 8;
  private momentTransitionStartedAt = 0;
  private momentTransitionDuration = 1.8;
  private momentFrom: Omit<ReactiveFluidMoment, 'duration'> = { ...REACTIVE_FLUID_MOMENTS[0] };
  private momentTarget: ReactiveFluidMoment = REACTIVE_FLUID_MOMENTS[0];
  private smoothedPhysics = {
    sameRestDensity: 6.5,
    differentRestDensity: 6.1,
    stiffness: 0.2,
    nearStiffness: 0.05,
    gravity: 0,
    drag: 0,
  };

  constructor(seed = 0x52414354) {
    this.seed = seed >>> 0;
  }

  update(
    music: ReactiveFluidMusic,
    notes: readonly DetectedNote[] = [],
    dt = 1 / 60,
    now: number | null = null,
  ): ReactiveFluidOutput {
    const safeDt = clamp(dt, 0.001, 0.1);
    this.elapsed = Number.isFinite(now) ? Number(now) : this.elapsed + safeDt;
    const time = this.elapsed;
    if (!this.clockInitialized) {
      this.clockInitialized = true;
      this.momentStartedAt = time;
      this.momentEndsAt = time + 7.5;
      this.momentTransitionStartedAt = time;
      this.nextPrimarySwitchAt = time + 2.5;
      this.nextSecondaryOpportunityAt = time + 3.5;
    }

    const rms = clamp(music.rms);
    const bass = clamp(music.bass);
    const mid = clamp(music.mid);
    const treble = clamp(music.treble);
    const onset = clamp(music.onset);
    const flux = clamp(music.flux);
    const centroid = clamp(music.centroid);
    const harmonicCenter = clamp(music.harmonicCenter);
    const harmonicConfidence = clamp(music.harmonicConfidence);
    const harmonicSpread = clamp(music.harmonicSpread);
    const spectralEnergy = clamp(rms * 0.52 + bass * 0.2 + mid * 0.17 + treble * 0.11);

    this.fastEnergy = approach(
      this.fastEnergy,
      spectralEnergy,
      spectralEnergy > this.fastEnergy ? 14 : 4.2,
      safeDt,
    );
    this.slowEnergy = approach(
      this.slowEnergy,
      spectralEnergy,
      spectralEnergy > this.slowEnergy ? 2.2 : 0.65,
      safeDt,
    );
    this.transientEnvelope = Math.max(
      onset,
      approach(this.transientEnvelope, 0, 7.5, safeDt),
    );

    const onsetEvent = onset > 0.18
      && time - this.lastOnsetAt > 0.12
      && (this.previousOnset <= 0.18 || onset > this.previousOnset + 0.11);
    this.previousOnset = onset;
    if (onsetEvent) this.registerOnset(time);

    const beatPhase = Number.isFinite(this.lastOnsetAt)
      ? ((time - this.lastOnsetAt) / this.beatPeriod) % 1
      : 1;
    const beatPulse = Math.exp(-Math.max(0, beatPhase) * 8.5) * clamp(onset * 1.2 + flux * 0.55);
    const recentOnsets = this.onsetTimes.filter((value) => time - value <= 4).length;
    const rhythmDensity = clamp(recentOnsets / 10);
    const bpm = 60 / this.beatPeriod;
    const noteSummary = this.summarizeNotes(notes);
    const climax = clamp(
      this.fastEnergy * 0.36
      + onset * 0.24
      + flux * 0.16
      + harmonicSpread * 0.12
      + rhythmDensity * 0.12,
    );

    this.maybeChangeMoment({
      time,
      bass,
      mid,
      treble,
      flux,
      harmonicConfidence,
      harmonicSpread,
      climax,
      spectralEnergy,
    }, onsetEvent);
    const moment = this.readMoment(time);

    if (onsetEvent) {
      this.maybeSwitchPrimary({
        time,
        centroid,
        harmonicCenter,
        harmonicConfidence,
        bass,
        mid,
        treble,
        climax,
      });
      this.maybeStartSecondary({
        time,
        onset,
        flux,
        rms,
        treble,
        harmonicSpread,
        climax,
      });
    }

    const secondary = this.readSecondary(time);
    const phraseMotion = Math.sin(
      time * (0.22 + rhythmDensity * 0.26) + harmonicCenter * Math.PI * 2,
    );
    const physicsTargets = {
      sameRestDensity: clamp(
        moment.same + bass * 0.75 + beatPulse * 0.55 - harmonicSpread * 0.28
          + phraseMotion * this.slowEnergy * 0.35,
        0,
        12,
      ),
      differentRestDensity: clamp(
        moment.cross + mid * 0.7 + harmonicSpread * 0.45 - bass * 0.2
          - phraseMotion * this.slowEnergy * 0.32,
        0,
        12,
      ),
      stiffness: clamp(moment.pressure + bass * 0.14 + this.transientEnvelope * 0.18, 0.05, 2),
      nearStiffness: clamp(
        moment.tension + mid * 0.16 + harmonicConfidence * 0.12 + noteSummary.chordWidth * 0.12,
        0.05,
        3,
      ),
      gravity: moment.gravity <= 0.0001
        ? 0
        : clamp(moment.gravity * (0.58 + bass * 0.34 + this.slowEnergy * 0.2), 0, 1.5),
      drag: clamp(moment.drag + treble * 0.008 + harmonicSpread * this.slowEnergy * 0.007, 0, 0.3),
    };

    this.smoothedPhysics.sameRestDensity = approach(
      this.smoothedPhysics.sameRestDensity,
      physicsTargets.sameRestDensity,
      2.4,
      safeDt,
    );
    this.smoothedPhysics.differentRestDensity = approach(
      this.smoothedPhysics.differentRestDensity,
      physicsTargets.differentRestDensity,
      2.4,
      safeDt,
    );
    this.smoothedPhysics.stiffness = approach(
      this.smoothedPhysics.stiffness,
      physicsTargets.stiffness,
      6.5,
      safeDt,
    );
    this.smoothedPhysics.nearStiffness = approach(
      this.smoothedPhysics.nearStiffness,
      physicsTargets.nearStiffness,
      4.2,
      safeDt,
    );
    this.smoothedPhysics.drag = approach(
      this.smoothedPhysics.drag,
      physicsTargets.drag,
      4,
      safeDt,
    );
    // Preserve the original zero-gravity invariant: no exponential tail.
    this.smoothedPhysics.gravity = physicsTargets.gravity;

    const brightnessMotion = (centroid - 0.5) * 2;
    const render = {
      particleSize: clamp(
        2 + moment.size + rms * 1.05 + this.transientEnvelope * 0.55 + noteSummary.density * 0.35,
        2,
        5.2,
      ),
      radiance: clamp(1.03 + moment.light + this.fastEnergy * 0.4 + this.transientEnvelope * 0.2, 0.75, 1.6),
      radianceSpread: clamp(0.9 + (1 - flux) * 0.1, 0.82, 1),
      radianceAbsorption: clamp(1.5 - rms * 0.31 + bass * 0.16, 1.12, 1.5),
      radianceExposure: clamp(
        0.15 + moment.exposure + this.fastEnergy * 0.15 + bass * 0.045 + beatPulse * 0.035,
        0.1,
        0.46,
      ),
      gradeHue: clamp(-3 + (harmonicCenter - 0.5) * 13 + brightnessMotion * 2, -14, 10),
      gradeSaturation: clamp(0.93 + centroid * 0.18 + harmonicConfidence * 0.11, 0.9, 1.22),
      gradeContrast: clamp(
        1.55 + moment.contrast + flux * 0.2 + (1 - this.slowEnergy) * 0.08 - rms * 0.1,
        1.32,
        1.95,
      ),
      gradeBrightness: clamp(0.002 + this.fastEnergy * 0.045 + beatPulse * 0.012, 0, 0.075),
      gradeBlackPoint: clamp(0.085 - this.slowEnergy * 0.027 + harmonicSpread * 0.008, 0.052, 0.095),
      emissiveMaterial: this.primaryMaterial,
      allEmitters: 1,
      velocityEmission: 1,
      lightOnly: 0,
      reactiveSecondaryMaterial: secondary.material,
      reactiveSecondaryStrength: secondary.strength,
      reactiveSecondaryFraction: secondary.fraction,
    };

    return {
      physics: { ...this.smoothedPhysics },
      render,
      interactions: onsetEvent
        ? this.makeMusicalInteractions({
          bass,
          mid,
          treble,
          harmonicCenter,
          onset,
          flux,
          noteSummary,
          impulse: moment.impulse,
        })
        : [],
      telemetry: {
        rms,
        bass,
        mid,
        treble,
        onset,
        flux,
        centroid,
        bpm,
        rhythmDensity,
        beatPulse,
        climax,
        noteDensity: noteSummary.density,
        chordWidth: noteSummary.chordWidth,
        momentId: moment.id,
        momentName: moment.name,
        momentTransition: moment.transition,
        momentRemaining: Math.max(0, this.momentEndsAt - time),
        sameRestDensity: this.smoothedPhysics.sameRestDensity,
        differentRestDensity: this.smoothedPhysics.differentRestDensity,
        stiffness: this.smoothedPhysics.stiffness,
        nearStiffness: this.smoothedPhysics.nearStiffness,
        gravity: this.smoothedPhysics.gravity,
        drag: this.smoothedPhysics.drag,
        primaryMaterial: this.primaryMaterial,
        secondaryMaterial: secondary.material,
        secondaryStrength: secondary.strength,
        secondaryFraction: secondary.fraction,
      },
    };
  }

  private maybeChangeMoment(features: DirectorFeatures, onsetEvent: boolean): void {
    const livedFor = features.time - this.momentStartedAt;
    const musicalBreak = onsetEvent && features.climax > 0.72 && livedFor > 3.2;
    if (!musicalBreak && features.time < this.momentEndsAt) return;

    let nextId: ReactiveFluidMoment['id'];
    if (musicalBreak) {
      nextId = features.flux > 0.56 ? 'burst' : 'mix';
    } else if (features.spectralEnergy < 0.12) {
      nextId = this.momentTarget.id === 'float' ? 'cluster' : 'float';
    } else if (features.bass > 0.64 && features.bass > features.mid) {
      nextId = 'fall';
    } else if (features.harmonicSpread > 0.62) {
      nextId = 'mix';
    } else if (features.harmonicConfidence > 0.62) {
      nextId = 'cluster';
    } else if (features.treble > 0.58 || features.flux > 0.48) {
      nextId = 'orbit';
    } else {
      const pool = (['float', 'cluster', 'mix', 'fall', 'viscous', 'orbit'] as const)
        .filter((id) => id !== this.momentTarget.id);
      nextId = pool[Math.floor(this.random() * pool.length)];
    }
    if (nextId === this.momentTarget.id) {
      const fallback = (['float', 'mix', 'fall', 'viscous', 'orbit'] as const)
        .filter((id) => id !== nextId);
      nextId = fallback[Math.floor(this.random() * fallback.length)];
    }

    const currentBlend = this.readMoment(features.time);
    const nextIndex = Math.max(0, REACTIVE_FLUID_MOMENTS.findIndex((moment) => moment.id === nextId));
    const target = REACTIVE_FLUID_MOMENTS[nextIndex];
    this.momentFrom = { ...currentBlend };
    this.momentTarget = target;
    this.momentIndex = nextIndex;
    this.momentTransitionStartedAt = features.time;
    this.momentTransitionDuration = target.id === 'burst' ? 0.7 : 1.6;
    this.momentStartedAt = features.time;
    const [minimumDuration, maximumDuration] = target.duration;
    const rhythmicCompression = clamp(features.climax * 0.9 + features.flux * 0.35);
    const duration = minimumDuration
      + (maximumDuration - minimumDuration) * this.random() * (1 - rhythmicCompression * 0.28);
    this.momentEndsAt = features.time + duration;
  }

  private readMoment(time: number): BlendedMoment {
    const transition = clamp(
      (time - this.momentTransitionStartedAt) / this.momentTransitionDuration,
    );
    return blendMoment(this.momentFrom, this.momentTarget, transition);
  }

  private registerOnset(time: number): void {
    if (Number.isFinite(this.lastOnsetAt)) {
      const interval = time - this.lastOnsetAt;
      if (interval >= 0.12 && interval <= 1.8) {
        const folded = foldBeatPeriod(interval);
        const recentIntervals: number[] = [];
        for (let index = 1; index < this.onsetTimes.length; index += 1) {
          const difference = this.onsetTimes[index] - this.onsetTimes[index - 1];
          if (difference >= 0.12 && difference <= 1.8) {
            recentIntervals.push(foldBeatPeriod(difference));
          }
        }
        recentIntervals.push(folded);
        this.beatPeriod = approach(
          this.beatPeriod,
          median(recentIntervals.slice(-8)),
          4.5,
          0.1,
        );
      }
    }
    this.lastOnsetAt = time;
    this.onsetTimes.push(time);
    this.onsetTimes = this.onsetTimes.filter((value) => time - value <= 8).slice(-24);
  }

  private summarizeNotes(notes: readonly DetectedNote[]): NoteSummary {
    if (!notes.length) return { density: 0, center: 0.5, chordWidth: 0 };
    let weightedMidi = 0;
    let weight = 0;
    let minimum = 108;
    let maximum = 21;
    for (const note of notes) {
      const strength = clamp(Number(note.strength) || 0, 0.05, 1);
      const midi = clamp(Number(note.midi) || 60, 21, 108);
      weightedMidi += midi * strength;
      weight += strength;
      minimum = Math.min(minimum, midi);
      maximum = Math.max(maximum, midi);
    }
    return {
      density: clamp(notes.length / 8),
      center: clamp(((weightedMidi / Math.max(weight, 1e-6)) - 21) / 87),
      chordWidth: clamp((maximum - minimum) / 36),
    };
  }

  private maybeSwitchPrimary(features: {
    time: number;
    centroid: number;
    harmonicCenter: number;
    harmonicConfidence: number;
    bass: number;
    mid: number;
    treble: number;
    climax: number;
  }): void {
    if (features.time < this.nextPrimarySwitchAt || features.climax < 0.25) return;
    let candidate: number;
    if (features.harmonicConfidence > 0.16) {
      candidate = Math.min(
        3,
        Math.floor((features.harmonicCenter * 0.78 + features.centroid * 0.22) * 4),
      );
    } else if (features.bass >= features.mid && features.bass >= features.treble) {
      candidate = 3;
    } else if (features.treble > features.mid) {
      candidate = 2;
    } else {
      candidate = 0;
    }
    if (candidate === this.primaryMaterial && features.climax > 0.48) {
      candidate = (candidate + 1 + Math.floor(this.random() * 2)) % 4;
    }
    if (candidate !== this.primaryMaterial) this.primaryMaterial = candidate;
    this.nextPrimarySwitchAt = features.time + 3.2 + (1 - features.climax) * 3.2;
  }

  private maybeStartSecondary(features: {
    time: number;
    onset: number;
    flux: number;
    rms: number;
    treble: number;
    harmonicSpread: number;
    climax: number;
  }): void {
    if (this.secondaryEvent || features.time < this.nextSecondaryOpportunityAt) return;
    const trigger = clamp(
      (features.climax - 0.26) * 1.55
      + features.onset * 0.22
      + features.flux * 0.15,
    );
    if (trigger < 0.2 || this.random() > trigger * 0.62) return;
    const denseMaterials = [0, 1, 2].filter((material) => material !== this.primaryMaterial);
    const spectralIndex = Math.min(
      denseMaterials.length - 1,
      Math.floor(features.treble * denseMaterials.length),
    );
    const material = denseMaterials[Math.max(0, spectralIndex)] ?? ((this.primaryMaterial + 1) % 4);
    this.secondaryEvent = {
      material,
      startedAt: features.time,
      duration: 0.85 + features.harmonicSpread * 1.25 + this.random() * 0.45,
      fraction: clamp(0.07 + features.treble * 0.17 + features.flux * 0.12, 0.07, 0.34),
      strength: clamp(
        0.22 + features.onset * 0.28 + features.climax * 0.22,
        0.22,
        0.66,
      ),
    };
    this.nextSecondaryOpportunityAt = features.time + 4.5 + this.random() * 5;
  }

  private readSecondary(time: number): { material: number; strength: number; fraction: number } {
    if (!this.secondaryEvent) return { material: -1, strength: 0, fraction: 0 };
    const progress = (time - this.secondaryEvent.startedAt) / this.secondaryEvent.duration;
    if (progress >= 1) {
      this.secondaryEvent = null;
      return { material: -1, strength: 0, fraction: 0 };
    }
    const attack = smoothstep(progress / 0.18);
    const release = 1 - smoothstep((progress - 0.45) / 0.55);
    return {
      material: this.secondaryEvent.material,
      strength: this.secondaryEvent.strength * attack * release,
      fraction: this.secondaryEvent.fraction,
    };
  }

  private makeMusicalInteractions(input: {
    bass: number;
    mid: number;
    treble: number;
    harmonicCenter: number;
    onset: number;
    flux: number;
    noteSummary: NoteSummary;
    impulse: number;
  }): ReactiveFluidInteraction[] {
    const horizontal = clamp(0.12 + input.harmonicCenter * 0.76);
    if (input.bass >= input.mid && input.bass >= input.treble) {
      return [{
        mode: 'repel',
        x: horizontal,
        y: 0.66,
        radius: 0.1 + input.bass * 0.08,
        strength: (0.28 + input.onset * 0.38) * input.impulse,
      }];
    }
    if (input.mid >= input.treble) {
      return [{
        mode: input.harmonicCenter > 0.5 ? 'vortex' : 'vortex-reverse',
        x: horizontal,
        y: 0.52,
        radius: 0.11 + input.mid * 0.07,
        strength: (0.22 + input.flux * 0.34) * input.impulse,
      }];
    }
    return [{
      mode: 'attract',
      x: input.noteSummary.density > 0 ? input.noteSummary.center : horizontal,
      y: 0.28,
      radius: 0.08 + input.treble * 0.06,
      strength: (0.2 + input.onset * 0.3) * input.impulse,
    }];
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x1_0000_0000;
  }
}

export default ReactiveFluidDirector;
