import type { DetectedNote } from '../../core/types';

const clamp = (value: number, minimum = 0, maximum = 1): number => (
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum))
);

const safeDt = (dt: number): number => clamp(dt, 0.001, 0.05);

const approach = (from: number, to: number, speed: number, dt: number): number => (
  from + (to - from) * (1 - Math.exp(-speed * dt))
);

export type OpeningFluidScene = 0 | 1 | 2 | 3 | 4 | 5;
export type OpeningEmitterEntry = 'top' | 'left' | 'right';

/** The compact portion of AudioSnapshot needed by the opening choreography. */
export interface OpeningFluidAudio {
  sequence: number;
  rms: number;
  bass: number;
  onset: number;
  notes: readonly DetectedNote[];
}

/** Normalized coordinates are relative to the Fluid solver canvas (0..1). */
export interface OpeningFluidEmitterSpec {
  id: 0 | 1 | 2;
  entry: OpeningEmitterEntry;
  x: number;
  y: number;
  sizeScale: number;
  active: boolean;
}

export interface OpeningFluidImpulse {
  /** Monotonic signal used by the scene to consume the event exactly once. */
  counter: number;
  emitterIndex: 0 | 1 | 2;
  x: number;
  y: number;
  strength: number;
  radius: number;
}

export interface OpeningFluidLightingIntent {
  palette: 'manual' | 'blue' | 'red';
  allEmitters: boolean;
  velocityEmission: boolean;
}

export interface OpeningFluidOutput {
  scene: OpeningFluidScene;
  /** Three stable slots; consumers use `active` instead of reallocating IDs. */
  emitters: readonly OpeningFluidEmitterSpec[];
  /** Increments exactly once for a newly received onset or note attack. */
  impulseCounter: number;
  /** The slot selected by this update's event, otherwise null. */
  impulseEmitterIndex: 0 | 1 | 2 | null;
  impulse: OpeningFluidImpulse | null;
  lighting: OpeningFluidLightingIntent;
  /** Scene 1 is the black 500-particle preparation cue. */
  particleTarget: 500 | null;
  /** Scene 4 is the dedicated Azure collision cue. */
  collisions: boolean;
}

interface EmitterAnchor {
  id: 0 | 1 | 2;
  entry: OpeningEmitterEntry;
  entryX: number;
  entryY: number;
  destinationX: number;
  destinationY: number;
  entrySeconds: number;
  size: number;
  phase: number;
}

interface EmitterState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sizeScale: number;
  sizeVelocity: number;
  seeded: boolean;
  enteredAt: number;
}

const ANCHORS: readonly EmitterAnchor[] = Object.freeze([
  Object.freeze({
    id: 0, entry: 'top', entryX: 0.5, entryY: 0.02,
    destinationX: 0.52, destinationY: 0.42, entrySeconds: 7.2, size: 1, phase: 0.15,
  }),
  Object.freeze({
    id: 1, entry: 'left', entryX: 0.02, entryY: 0.55,
    destinationX: 0.42, destinationY: 0.54, entrySeconds: 8.4, size: 0.94, phase: 2.21,
  }),
  Object.freeze({
    id: 2, entry: 'right', entryX: 0.98, entryY: 0.43,
    destinationX: 0.62, destinationY: 0.47, entrySeconds: 9.4, size: 0.9, phase: 4.37,
  }),
]);

const EMPTY_STATE = (): EmitterState => ({
  x: 0.5,
  y: 0.5,
  vx: 0,
  vy: 0,
  sizeScale: 1,
  sizeVelocity: 0,
  seeded: false,
  enteredAt: 0,
});

const activeIndices = (scene: OpeningFluidScene): readonly (0 | 1 | 2)[] => {
  if (scene === 2) return [0];
  if (scene === 3) return [0, 1];
  if (scene === 4 || scene === 5) return [0, 1, 2];
  return [];
};

const normalizedScene = (scene: number): OpeningFluidScene => (
  Math.round(clamp(scene, 0, 5)) as OpeningFluidScene
);

/**
 * Stateful but deterministic opening choreography for the first six Fluid
 * cues. It only describes normalized emitters/events; FluidScene owns the
 * actual solver and renderer side effects.
 */
export class OpeningFluidDirector {
  private readonly states: EmitterState[] = ANCHORS.map(EMPTY_STATE);
  private previousScene: OpeningFluidScene | null = null;
  private lastAudioSequence = -Infinity;
  private impulseCounter = 0;
  private bassGrowthTarget = 0;
  private bassEnvelope = 0;
  private elapsed = 0;

  reset(): void {
    this.states.splice(0, this.states.length, ...ANCHORS.map(EMPTY_STATE));
    this.previousScene = null;
    this.lastAudioSequence = -Infinity;
    this.impulseCounter = 0;
    this.bassGrowthTarget = 0;
    this.bassEnvelope = 0;
    this.elapsed = 0;
  }

  update(
    audio: OpeningFluidAudio,
    now: number,
    dt: number,
    openingScene: number,
  ): OpeningFluidOutput {
    const scene = normalizedScene(openingScene);
    const delta = safeDt(dt);
    const time = Number.isFinite(now) ? now : this.elapsed + delta;
    this.elapsed = time;
    const rms = clamp(audio.rms);
    this.bassEnvelope = approach(this.bassEnvelope, clamp(audio.bass), 4.2, delta);
    const active = activeIndices(scene);

    this.prepareScene(scene, time, rms, this.bassEnvelope);
    const event = this.consumeAudioEvent(audio, active);
    // Low-note growth is a transient musical envelope rather than a permanent
    // counter: every MIDI 21..35 attack re-excites the same gentle spring.
    this.bassGrowthTarget *= Math.exp(-1.35 * delta);
    this.integrateEmitters(time, delta, rms, this.bassEnvelope, scene);

    let impulse: OpeningFluidImpulse | null = null;
    let impulseEmitterIndex: 0 | 1 | 2 | null = null;
    if (event && active.length) {
      const emitterIndex = active[this.impulseCounter % active.length];
      this.impulseCounter += 1;
      impulseEmitterIndex = emitterIndex;
      const state = this.states[emitterIndex];
      const anchor = ANCHORS[emitterIndex];
      const strength = clamp(0.18 + rms * 0.2 + clamp(audio.onset) * 0.32, 0.12, 0.72);
      // The local spring gets a velocity nudge, never a position jump.
      state.vx += Math.cos(anchor.phase) * strength * 0.032;
      state.vy += Math.sin(anchor.phase) * strength * 0.032;
      state.sizeVelocity += strength * 0.22;
      impulse = {
        counter: this.impulseCounter,
        emitterIndex,
        x: clamp(state.x, 0, 1),
        y: clamp(state.y, 0, 1),
        strength,
        radius: clamp(0.07 + rms * 0.055 + clamp(audio.bass) * 0.025, 0.06, 0.16),
      };
    }

    this.previousScene = scene;
    return {
      scene,
      emitters: ANCHORS.map((anchor) => this.readEmitter(anchor, active.includes(anchor.id))),
      impulseCounter: this.impulseCounter,
      impulseEmitterIndex,
      impulse,
      lighting: this.lightingFor(scene),
      particleTarget: scene === 1 ? 500 : null,
      collisions: scene === 4,
    };
  }

  private prepareScene(scene: OpeningFluidScene, time: number, rms: number, bass: number): void {
    // Original and black preparation cues own no special emitters. Re-arm all
    // slots here so a later 0/1 -> 2 or 0/1 -> 3 always performs the visible
    // edge entrance again rather than resuming an old in-stage position.
    if (scene === 0 || scene === 1) {
      this.invalidateSlots();
      return;
    }
    const previous = this.previousScene;
    const nextActive = activeIndices(scene);
    if (previous === null) {
      for (const index of nextActive) this.seed(index, time, rms, bass, scene);
      return;
    }

    // A backward cue removes only the slots that are no longer present. They
    // are re-seeded from their entry edge if the operator subsequently moves
    // forward again; shared slots keep their springs and never pop.
    const previousActive = activeIndices(previous);
    for (const index of previousActive) {
      if (!nextActive.includes(index)) this.invalidateSlot(index);
    }

    // On a forward transition only the newly introduced slots are seeded.
    // This makes 02 -> 03 add the left source, then 03 -> 04 add the right
    // one, without restarting the sources already in the composition.
    for (const index of nextActive) {
      if (!this.states[index].seeded) this.seed(index, time, rms, bass, scene);
    }
  }

  private invalidateSlots(): void {
    for (const anchor of ANCHORS) this.invalidateSlot(anchor.id);
  }

  private invalidateSlot(index: 0 | 1 | 2): void {
    const state = this.states[index];
    state.vx = 0;
    state.vy = 0;
    state.sizeVelocity = 0;
    state.seeded = false;
  }

  private consumeAudioEvent(
    audio: OpeningFluidAudio,
    active: readonly (0 | 1 | 2)[],
  ): boolean {
    const sequence = Number.isFinite(audio.sequence) ? audio.sequence : this.lastAudioSequence + 1;
    if (sequence === this.lastAudioSequence) return false;
    this.lastAudioSequence = sequence;

    const bassNotes = audio.notes.filter((note) => (
      Number.isInteger(note.midi) && note.midi >= 21 && note.midi <= 35
    ));
    for (const note of bassNotes) {
      const strength = clamp(note.strength, 0.05, 1);
      this.bassGrowthTarget = clamp(this.bassGrowthTarget + 0.008 + strength * 0.012, 0, 0.1);
    }

    // Do not expose an impulse where this cue has no active physical emitter,
    // but still consume the sequence and bass-note growth deterministically.
    return active.length > 0 && (clamp(audio.onset) >= 0.18 || audio.notes.length > 0);
  }

  private integrateEmitters(
    time: number,
    dt: number,
    rms: number,
    bass: number,
    scene: OpeningFluidScene,
  ): void {
    const sceneScale = scene === 5 ? 1.12 : scene === 4 ? 1.06 : 1;
    for (const anchor of ANCHORS) {
      const state = this.states[anchor.id];
      if (!state.seeded) continue;
      const target = this.targetFor(anchor, time, rms, bass, sceneScale, state.enteredAt);
      const positionSpring = 15 + rms * 7;
      const positionDamping = 6.2;
      state.vx += (target.x - state.x) * positionSpring * dt;
      state.vy += (target.y - state.y) * positionSpring * dt;
      state.vx *= Math.exp(-positionDamping * dt);
      state.vy *= Math.exp(-positionDamping * dt);
      state.x = clamp(state.x + state.vx * dt, 0.01, 0.99);
      state.y = clamp(state.y + state.vy * dt, 0.01, 0.99);

      // This intentionally remains underdamped: low piano notes shift the
      // target, and the gentle overshoot reads as a soft breathing bounce.
      const sizeSpring = 54;
      const sizeDamping = 7.4;
      state.sizeVelocity += (target.sizeScale - state.sizeScale) * sizeSpring * dt;
      state.sizeVelocity *= Math.exp(-sizeDamping * dt);
      state.sizeScale = clamp(state.sizeScale + state.sizeVelocity * dt, 0.65, 1.55);
    }
  }

  private seed(
    index: 0 | 1 | 2,
    time: number,
    rms: number,
    bass: number,
    scene: OpeningFluidScene,
  ): void {
    const anchor = ANCHORS[index];
    const target = this.targetFor(
      anchor,
      time,
      rms,
      bass,
      scene === 5 ? 1.12 : scene === 4 ? 1.06 : 1,
      time,
    );
    const state = this.states[index];
    // Seed at the visible canvas edge, never at the final destination. The
    // target then travels inward over 6–10 seconds while the spring follows.
    state.x = anchor.entryX;
    state.y = anchor.entryY;
    state.vx = 0;
    state.vy = 0;
    state.sizeScale = target.sizeScale;
    state.sizeVelocity = 0;
    state.seeded = true;
    state.enteredAt = time;
  }

  private targetFor(
    anchor: EmitterAnchor,
    time: number,
    rms: number,
    bass: number,
    sceneScale: number,
    enteredAt: number,
  ): { x: number; y: number; sizeScale: number } {
    const energy = clamp(rms);
    const floatX = 0.012 + energy * 0.026;
    const floatY = 0.01 + energy * 0.021;
    const phase = time * (0.29 + energy * 0.09) + anchor.phase;
    const progress = clamp((time - enteredAt) / anchor.entrySeconds);
    const easedProgress = progress * progress * (3 - 2 * progress);
    const centerX = anchor.entryX + (anchor.destinationX - anchor.entryX) * easedProgress;
    const centerY = anchor.entryY + (anchor.destinationY - anchor.entryY) * easedProgress;
    // Idle drift starts subtle at the edge and opens up with the entry.
    const floatAmount = 0.18 + easedProgress * 0.82;
    return {
      x: clamp(centerX + (Math.sin(phase) * floatX + Math.sin(phase * 0.43 + 1.4) * floatX * 0.36) * floatAmount, 0.01, 0.99),
      y: clamp(centerY + (Math.cos(phase * 0.83) * floatY + Math.sin(phase * 0.31) * floatY * 0.34) * floatAmount, 0.01, 0.99),
      // `bass` is a continuously smoothed fallback when note attacks are not
      // available. The MIDI attack envelope is the primary (springy) lift;
      // total musical growth stays around +10–18% before cue scaling.
      sizeScale: clamp(
        anchor.size * sceneScale * (1 + energy * 0.04 + clamp(bass) * 0.04 + this.bassGrowthTarget),
        0.65,
        1.5,
      ),
    };
  }

  private readEmitter(anchor: EmitterAnchor, active: boolean): OpeningFluidEmitterSpec {
    const state = this.states[anchor.id];
    return {
      id: anchor.id,
      entry: anchor.entry,
      x: clamp(state.x, 0, 1),
      y: clamp(state.y, 0, 1),
      sizeScale: clamp(state.sizeScale, 0.65, 1.55),
      active,
    };
  }

  private lightingFor(scene: OpeningFluidScene): OpeningFluidLightingIntent {
    if (scene === 5) return { palette: 'red', allEmitters: true, velocityEmission: true };
    if (scene === 2 || scene === 3 || scene === 4) {
      return { palette: 'blue', allEmitters: false, velocityEmission: false };
    }
    return { palette: 'manual', allEmitters: false, velocityEmission: false };
  }
}

export default OpeningFluidDirector;
