import { describe, expect, it } from 'vitest';
import { createDspState, extractFeatures } from './dsp';

describe('audio DSP', () => {
  it('gates spectral bands below the calibrated room floor', () => {
    const state = createDspState(4096);
    state.noiseFloor = 0.01;
    state.signalPeak = 0.1;
    const samples = Float32Array.from({ length: 4096 }, (_, index) => (
      Math.sin(index * Math.PI * 2 * 220 / 48_000) * 0.004
    ));
    const frame = extractFeatures(samples, 48_000, state, 1);
    expect(frame.rms).toBe(0);
    expect(frame.bands.low).toBe(0);
    expect(frame.bands.mid).toBe(0);
    expect(frame.bands.high).toBe(0);
  });

  it('publishes calibrated energy for an audible tone', () => {
    const state = createDspState(4096);
    state.noiseFloor = 0.001;
    state.signalPeak = 0.08;
    const samples = Float32Array.from({ length: 4096 }, (_, index) => (
      Math.sin(index * Math.PI * 2 * 110 / 48_000) * 0.08
    ));
    const frame = extractFeatures(samples, 48_000, state, 1);
    expect(frame.rms).toBeGreaterThan(0.5);
    expect(frame.bands.low).toBeGreaterThan(frame.bands.mid);
  });
});

