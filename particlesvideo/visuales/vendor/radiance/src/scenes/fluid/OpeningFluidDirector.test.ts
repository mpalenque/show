import { describe, expect, it } from 'vitest';
import OpeningFluidDirector, { type OpeningFluidAudio } from './OpeningFluidDirector';

const audio = (overrides: Partial<OpeningFluidAudio> = {}): OpeningFluidAudio => ({
  sequence: 0,
  rms: 0,
  bass: 0,
  onset: 0,
  notes: [],
  ...overrides,
});

const STEP = 1 / 60;

const activeIds = (output: ReturnType<OpeningFluidDirector['update']>): number[] => (
  output.emitters.filter((emitter) => emitter.active).map((emitter) => emitter.id)
);

const expectEntry = (
  output: ReturnType<OpeningFluidDirector['update']>,
  slot: 0 | 1 | 2,
  x: number,
  y: number,
): void => {
  expect(output.emitters[slot].x).toBeCloseTo(x, 2);
  expect(output.emitters[slot].y).toBeCloseTo(y, 2);
};

describe('OpeningFluidDirector', () => {
  it('maps the six opening cues to the requested progressive slot topology', () => {
    const director = new OpeningFluidDirector();
    const original = director.update(audio(), 0, STEP, 0);
    const black = director.update(audio({ sequence: 1 }), STEP, STEP, 1);
    const single = director.update(audio({ sequence: 2 }), STEP * 2, STEP, 2);
    const duo = director.update(audio({ sequence: 3 }), STEP * 3, STEP, 3);
    const trio = director.update(audio({ sequence: 4 }), STEP * 4, STEP, 4);
    const energy = director.update(audio({ sequence: 5 }), STEP * 5, STEP, 5);

    expect(activeIds(original)).toEqual([]);
    expect(activeIds(black)).toEqual([]);
    expect(black.particleTarget).toBe(500);
    expect(activeIds(single)).toEqual([0]);
    expect(activeIds(duo)).toEqual([0, 1]);
    expect(activeIds(trio)).toEqual([0, 1, 2]);
    expect(activeIds(energy)).toEqual([0, 1, 2]);
    expectEntry(single, 0, 0.5, 0.02);
    expectEntry(duo, 1, 0.02, 0.55);
    expectEntry(trio, 2, 0.98, 0.43);
    expect(trio.collisions).toBe(true);
    expect(energy.collisions).toBe(false);
    expect(energy.lighting).toEqual({ palette: 'red', allEmitters: true, velocityEmission: true });
  });

  it('routes new audio events through the active cue slots only', () => {
    const single = new OpeningFluidDirector();
    single.update(audio(), 0, STEP, 2);
    expect(single.update(audio({ sequence: 1, onset: 0.8 }), STEP, STEP, 2).impulseEmitterIndex).toBe(0);
    expect(single.update(audio({ sequence: 2, onset: 0.8 }), STEP * 2, STEP, 2).impulseEmitterIndex).toBe(0);

    const duo = new OpeningFluidDirector();
    duo.update(audio(), 0, STEP, 3);
    expect(duo.update(audio({ sequence: 1, onset: 0.8 }), STEP, STEP, 3).impulseEmitterIndex).toBe(0);
    expect(duo.update(audio({ sequence: 2, notes: [{ midi: 60, frequency: 261.63, strength: 0.8 }] }), STEP * 2, STEP, 3).impulseEmitterIndex).toBe(1);

    const trio = new OpeningFluidDirector();
    trio.update(audio(), 0, STEP, 4);
    expect(trio.update(audio({ sequence: 1, onset: 0.8 }), STEP, STEP, 4).impulseEmitterIndex).toBe(0);
    expect(trio.update(audio({ sequence: 2, onset: 0.8 }), STEP * 2, STEP, 4).impulseEmitterIndex).toBe(1);
    expect(trio.update(audio({ sequence: 3, onset: 0.8 }), STEP * 3, STEP, 4).impulseEmitterIndex).toBe(2);
  });

  it('grows and rebounds softly for every MIDI 21-35 bass-note attack', () => {
    const director = new OpeningFluidDirector();
    let output = director.update(audio(), 0, STEP, 2);
    for (let index = 1; index <= 25; index += 1) {
      output = director.update(audio({ sequence: index }), index / 30, 1 / 30, 2);
    }
    const initialSize = output.emitters[0].sizeScale;
    output = director.update(audio({
      sequence: 26,
      notes: [{ midi: 35, frequency: 61.7, strength: 1 }],
    }), 26 / 30, 1 / 30, 2);
    let peak = output.emitters[0].sizeScale;
    for (let index = 27; index <= 72; index += 1) {
      output = director.update(audio({ sequence: index }), index / 30, 1 / 30, 2);
      peak = Math.max(peak, output.emitters[0].sizeScale);
    }

    expect(peak).toBeGreaterThan(initialSize);
    expect(output.emitters[0].sizeScale).toBeLessThan(peak);
  });

  it('preserves established slots and introduces only the next slot on forward cues', () => {
    const director = new OpeningFluidDirector();
    let single = director.update(audio({ rms: 0.6 }), 0, STEP, 2);
    for (let frame = 1; frame <= 120; frame += 1) {
      single = director.update(audio({ sequence: frame, rms: 0.6 }), frame * STEP, STEP, 2);
    }

    const duo = director.update(audio({ sequence: 121, rms: 0.6 }), 121 * STEP, STEP, 3);
    expect(duo.emitters[0].x).toBeCloseTo(single.emitters[0].x, 2);
    expect(duo.emitters[0].y).toBeCloseTo(single.emitters[0].y, 2);
    expectEntry(duo, 1, 0.02, 0.55);

    const trio = director.update(audio({ sequence: 122, rms: 0.6 }), 122 * STEP, STEP, 4);
    expect(trio.emitters[0].x).toBeCloseTo(duo.emitters[0].x, 2);
    expect(trio.emitters[1].y).toBeCloseTo(duo.emitters[1].y, 2);
    expectEntry(trio, 2, 0.98, 0.43);
  });

  it('re-arms only the slots removed by a backward cue before replaying forward', () => {
    const director = new OpeningFluidDirector();
    let trio = director.update(audio({ rms: 0.4 }), 0, STEP, 4);
    for (let frame = 1; frame <= 300; frame += 1) {
      trio = director.update(audio({ sequence: frame, rms: 0.4 }), frame * STEP, STEP, 4);
    }
    expect(trio.emitters[2].x).toBeLessThan(0.8);

    const duo = director.update(audio({ sequence: 301, rms: 0.4 }), 301 * STEP, STEP, 3);
    expect(duo.emitters[0].x).toBeCloseTo(trio.emitters[0].x, 2);
    expect(duo.emitters[1].y).toBeCloseTo(trio.emitters[1].y, 2);
    const replayedTrio = director.update(audio({ sequence: 302, rms: 0.4 }), 302 * STEP, STEP, 4);
    expect(replayedTrio.emitters[0].x).toBeCloseTo(duo.emitters[0].x, 2);
    expect(replayedTrio.emitters[1].y).toBeCloseTo(duo.emitters[1].y, 2);
    expectEntry(replayedTrio, 2, 0.98, 0.43);

    const single = director.update(audio({ sequence: 303, rms: 0.4 }), 303 * STEP, STEP, 2);
    const replayedDuo = director.update(audio({ sequence: 304, rms: 0.4 }), 304 * STEP, STEP, 3);
    expect(replayedDuo.emitters[0].x).toBeCloseTo(single.emitters[0].x, 2);
    expectEntry(replayedDuo, 1, 0.02, 0.55);
  });

  it('re-arms every slot after Original or Negro before a later opening cue', () => {
    const director = new OpeningFluidDirector();
    director.update(audio(), 0, STEP, 4);
    director.update(audio({ sequence: 1 }), STEP, STEP, 0);
    const fromOriginal = director.update(audio({ sequence: 2 }), STEP * 2, STEP, 4);
    expectEntry(fromOriginal, 0, 0.5, 0.02);
    expectEntry(fromOriginal, 1, 0.02, 0.55);
    expectEntry(fromOriginal, 2, 0.98, 0.43);

    director.update(audio({ sequence: 3 }), STEP * 3, STEP, 1);
    const fromBlack = director.update(audio({ sequence: 4 }), STEP * 4, STEP, 4);
    expectEntry(fromBlack, 0, 0.5, 0.02);
    expectEntry(fromBlack, 1, 0.02, 0.55);
    expectEntry(fromBlack, 2, 0.98, 0.43);
  });
});
