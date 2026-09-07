import { describe, expect, it } from 'vitest';
import ReactiveFluidDirector, { type ReactiveFluidMusic } from './ReactiveFluidDirector';

const silence: ReactiveFluidMusic = {
  rms: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  onset: 0,
  flux: 0,
  centroid: 0.5,
  harmonicCenter: 0,
  harmonicConfidence: 0,
  harmonicSpread: 0,
};

describe('ReactiveFluidDirector parity', () => {
  it('reproduces the original silent opening grade, light and emitter coverage', () => {
    const output = new ReactiveFluidDirector().update(silence, [], 1 / 60, 0);

    expect(output.render).toMatchObject({
      particleSize: 2,
      radiance: 0.97,
      radianceSpread: 1,
      radianceAbsorption: 1.5,
      radianceExposure: 0.135,
      gradeHue: -9.5,
      gradeSaturation: 1.02,
      gradeBrightness: 0.002,
      gradeBlackPoint: 0.085,
      emissiveMaterial: 3,
      allEmitters: 1,
      velocityEmission: 1,
      lightOnly: 0,
    });
    expect(output.render.gradeContrast).toBeCloseTo(1.71);
    expect(output.telemetry.momentId).toBe('float');
    expect(output.physics.gravity).toBe(0);
  });

  it('runs the original automatic moment clock instead of holding one look', () => {
    const director = new ReactiveFluidDirector();
    director.update(silence, [], 1 / 60, 0);
    const output = director.update(silence, [], 1 / 60, 7.6);

    expect(output.telemetry.momentId).toBe('cluster');
    expect(output.telemetry.momentTransition).toBe(0);
    expect(output.telemetry.momentRemaining).toBeGreaterThanOrEqual(6);
  });

  it('emits the original band-specific interaction only on an onset', () => {
    const director = new ReactiveFluidDirector();
    director.update(silence, [], 1 / 60, 0);
    const output = director.update({
      ...silence,
      rms: 0.65,
      bass: 0.9,
      mid: 0.35,
      treble: 0.2,
      onset: 0.85,
      flux: 0.5,
    }, [], 1 / 60, 3);

    expect(output.interactions).toHaveLength(1);
    expect(output.interactions[0]).toMatchObject({
      mode: 'repel',
      x: 0.12,
      y: 0.66,
    });
    expect(output.interactions[0].radius).toBeCloseTo(0.172);
    expect(output.interactions[0].strength).toBeCloseTo((0.28 + 0.85 * 0.38) * 0.65);
  });
});
