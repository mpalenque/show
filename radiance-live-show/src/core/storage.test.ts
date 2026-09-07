import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultShow } from './manifest';
import { loadShow, saveShow } from './storage';

const installStorage = (serialized: string | null, failWrites = false): void => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => serialized),
    setItem: vi.fn(() => {
      if (failWrites) throw new DOMException('quota', 'QuotaExceededError');
    }),
  });
};

afterEach(() => vi.unstubAllGlobals());

describe('show persistence', () => {
  it('sanitizes parameter and master values loaded from storage', () => {
    const saved = createDefaultShow();
    saved.master = -20;
    saved.revision = 4.9;
    Object.assign(saved.automation, {
      enabled: true,
      cycleScenes: false,
      intensity: 9,
      sceneSeconds: 2,
      lookSeconds: 900,
    });
    Object.assign(saved.scenes.fluid.parameters.energy, {
      manual: 99,
      mode: 'invalid',
      source: 'invalid',
      amount: 8,
      smoothing: -3,
      invert: 'yes',
    });
    installStorage(JSON.stringify(saved));

    const loaded = loadShow();
    const energy = loaded.scenes.fluid.parameters.energy;
    expect(loaded.master).toBe(0);
    expect(loaded.revision).toBe(4);
    expect(loaded.automation).toEqual({
      enabled: true,
      cycleScenes: false,
      intensity: 1,
      sceneSeconds: 12,
      lookSeconds: 60,
      run: 0,
    });
    expect(energy.manual).toBe(1);
    expect(energy.mode).toBe('hybrid');
    expect(energy.source).toBe('rms');
    expect(energy.amount).toBe(1);
    expect(energy.smoothing).toBe(0);
    expect(energy.invert).toBe(false);
  });

  it('falls back after malformed JSON and survives unavailable storage', () => {
    installStorage('{not-json');
    expect(loadShow()).toEqual(createDefaultShow());

    installStorage(null, true);
    expect(saveShow(createDefaultShow())).toBe(false);
  });

  it('rounds direct controls and forces them to manual mode', () => {
    const saved = createDefaultShow();
    Object.assign(saved.scenes.fluid.parameters.emissiveMaterial, {
      manual: 2.7,
      mode: 'audio',
      amount: 1,
    });
    installStorage(JSON.stringify(saved));

    const material = loadShow().scenes.fluid.parameters.emissiveMaterial;
    expect(material.manual).toBe(3);
    expect(material.mode).toBe('manual');
  });

  it('migrates the reduced prototype scenes to the restored control defaults', () => {
    const saved = createDefaultShow();
    saved.master = 0.72;
    saved.scenes.fluid.look = 'float';
    saved.scenes.fluid.parameters.radiance.manual = 0.4;
    delete saved.scenes.fluid.parameters.emissiveMaterial;
    saved.scenes.blocks.parameters.density.manual = 0.91;
    delete saved.scenes.blocks.parameters.testNote;
    installStorage(JSON.stringify(saved));

    const loaded = loadShow();
    const defaults = createDefaultShow();
    expect(loaded.master).toBe(0.72);
    expect(loaded.scenes.fluid).toEqual(defaults.scenes.fluid);
    expect(loaded.scenes.blocks).toEqual(defaults.scenes.blocks);
  });

  it('migrates schema v1 without losing manual scene values', () => {
    const saved = createDefaultShow() as unknown as Record<string, unknown>;
    saved.schemaVersion = 1;
    delete saved.automation;
    const scenes = saved.scenes as ReturnType<typeof createDefaultShow>['scenes'];
    scenes.fluid.parameters.radiance.manual = 0.73;
    installStorage(JSON.stringify(saved));

    const loaded = loadShow();
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.scenes.fluid.parameters.radiance.manual).toBe(0.73);
    expect(loaded.automation).toEqual(createDefaultShow().automation);
  });

  it('falls back to a valid legacy snapshot when the v2 payload is damaged', () => {
    const legacy = createDefaultShow() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.automation;
    const scenes = legacy.scenes as ReturnType<typeof createDefaultShow>['scenes'];
    scenes.fluid.parameters.radiance.manual = 0.81;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key.endsWith('v2') ? '{damaged' : JSON.stringify(legacy)),
      setItem: vi.fn(),
    });

    expect(loadShow().scenes.fluid.parameters.radiance.manual).toBe(0.81);
  });

  it('does not coerce corrupt string booleans to true', () => {
    const saved = createDefaultShow() as unknown as Record<string, unknown>;
    saved.blackout = 'false';
    (saved.automation as Record<string, unknown>).enabled = 'false';
    installStorage(JSON.stringify(saved));

    const loaded = loadShow();
    expect(loaded.blackout).toBe(false);
    expect(loaded.automation.enabled).toBe(false);
  });
});
