import { describe, expect, it } from 'vitest';
import { EMPTY_AUDIO, createDefaultShow } from './manifest';
import { ParameterMixer } from './parameter-mixer';

describe('ParameterMixer', () => {
  it('returns the fader value in manual mode', () => {
    const show = createDefaultShow();
    show.scenes.fluid.parameters.energy = {
      ...show.scenes.fluid.parameters.energy,
      manual: 0.67,
      mode: 'manual',
      smoothing: 0,
    };
    expect(new ParameterMixer().mix('fluid', show, EMPTY_AUDIO, 1 / 60).energy).toBeCloseTo(0.67);
  });

  it('uses the preset base plus audio in audio mode', () => {
    const show = createDefaultShow();
    show.scenes.fluid.parameters.energy = {
      ...show.scenes.fluid.parameters.energy,
      mode: 'audio',
      source: 'rms',
      amount: 0.5,
      smoothing: 0,
    };
    const audio = { ...EMPTY_AUDIO, running: true, rms: 0.4 };
    expect(new ParameterMixer().mix('fluid', show, audio, 1 / 60).energy).toBeCloseTo(0.54);
  });

  it('adds audio modulation to the fader in hybrid mode and clamps it', () => {
    const show = createDefaultShow();
    show.scenes.fluid.parameters.energy = {
      ...show.scenes.fluid.parameters.energy,
      manual: 0.9,
      mode: 'hybrid',
      source: 'onset',
      amount: 0.8,
      smoothing: 0,
    };
    const audio = { ...EMPTY_AUDIO, running: true, onset: 1 };
    expect(new ParameterMixer().mix('fluid', show, audio, 1 / 60).energy).toBe(1);
  });

  it('keeps selectors and colours direct even if stale state requests audio modulation', () => {
    const show = createDefaultShow();
    Object.assign(show.scenes.fluid.parameters.emissiveMaterial, {
      manual: 2.6,
      mode: 'audio',
      source: 'rms',
      amount: 1,
    });
    Object.assign(show.scenes.fluid.parameters.materialColor0, {
      manual: 0x123456,
      mode: 'hybrid',
      source: 'rms',
      amount: 1,
    });
    const audio = { ...EMPTY_AUDIO, running: true, rms: 1 };
    const mixed = new ParameterMixer().mix('fluid', show, audio, 1 / 60);
    expect(mixed.emissiveMaterial).toBe(3);
    expect(mixed.materialColor0).toBe(0x123456);
  });

  it('uses manifest defaults when an older controller omits restored parameters', () => {
    const show = createDefaultShow();
    delete show.scenes.fluid.parameters.emissiveMaterial;
    delete show.scenes.fluid.parameters.materialColor0;
    const mixed = new ParameterMixer().mix('fluid', show, EMPTY_AUDIO, 1 / 60);
    expect(mixed.emissiveMaterial).toBe(0);
    expect(mixed.materialColor0).toBe(0xff1744);
  });
});
