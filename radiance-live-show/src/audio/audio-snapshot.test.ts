import { describe, expect, it } from 'vitest';
import type { FeatureFrame } from './types';
import { AudioSnapshotAggregator } from './audio-snapshot';

const frame = (overrides: Partial<FeatureFrame> = {}): FeatureFrame => ({
  t: 1,
  rawRms: 0.1,
  rms: 0.8,
  bands: { low: 0.7, mid: 0.4, high: 0.2 },
  onset: true,
  onsetStrength: 0.9,
  chroma: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0]),
  centroid: 0.35,
  flux: 0.72,
  noteAttacks: [{ midi: 68, frequency: 415.3, strength: 0.85 }],
  ...overrides,
});

describe('AudioSnapshotAggregator', () => {
  it('preserves transient peaks and note events in a render snapshot', () => {
    const aggregator = new AudioSnapshotAggregator();
    const snapshot = aggregator.update([frame(), frame({ onsetStrength: 0.2, noteAttacks: [] })], true, 1 / 30);
    expect(snapshot.running).toBe(true);
    expect(snapshot.onset).toBeCloseTo(0.9);
    expect(snapshot.notes.map((note) => note.midi)).toEqual([68]);
    expect(snapshot.harmonic).toBeGreaterThan(0);
    expect(snapshot.harmonicCenter).toBeCloseTo(8 / 11);
    expect(snapshot.harmonicConfidence).toBeGreaterThan(0);
    expect(snapshot.harmonicSpread).toBe(0);
  });

  it('emits note attacks once and decays continuous values without frames', () => {
    const aggregator = new AudioSnapshotAggregator();
    const active = aggregator.update([frame()], true, 1 / 30);
    const decay = aggregator.update([], true, 1 / 30);
    expect(decay.notes).toEqual([]);
    expect(decay.rms).toBeLessThan(active.rms);
    expect(decay.harmonicCenter).toBe(active.harmonicCenter);
    expect(decay.harmonicConfidence).toBeLessThan(active.harmonicConfidence);
  });

  it('reports chroma entropy as harmonic spread for chords', () => {
    const chord = frame({
      chroma: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]),
    });
    const snapshot = new AudioSnapshotAggregator().update([chord], true, 1 / 30);
    expect(snapshot.harmonicSpread).toBeGreaterThan(0);
    expect(snapshot.harmonicConfidence).toBeGreaterThan(0);
  });

  it('keeps legacy harmonic smooth and held when chroma confidence disappears', () => {
    const aggregator = new AudioSnapshotAggregator();
    const established = aggregator.update([frame()], true, 0.2);
    const uncertain = aggregator.update([frame({ chroma: new Float32Array(12) })], true, 1 / 30);

    // The new descriptors are raw analysis values, including the zero-
    // confidence frame.  Old consumers retain their stable harmonic route.
    expect(uncertain.harmonicCenter).toBe(0);
    expect(uncertain.harmonicConfidence).toBe(0);
    expect(uncertain.harmonicSpread).toBe(0);
    expect(uncertain.harmonic).toBe(established.harmonic);
  });
});
