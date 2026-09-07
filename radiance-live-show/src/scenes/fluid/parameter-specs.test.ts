import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIALS, DEFAULT_PARAMETERS } from './fluid-config.js';
import { applyFluidLookTrim, FLUID_LOOKS, FLUID_LOOK_OPTIONS } from './looks';
import {
  FLUID_INTERACTION_MODES,
  FLUID_OPENING_SCENE_OPTIONS,
  FLUID_PARAMETER_SPECS,
  ORIGINAL_FLUID_DEFAULTS,
} from './parameter-specs';

const byId = Object.fromEntries(FLUID_PARAMETER_SPECS.map((spec) => [spec.id, spec]));

describe('Fluid parameter parity', () => {
  it('keeps every parameter id unique', () => {
    expect(new Set(FLUID_PARAMETER_SPECS.map((spec) => spec.id)).size).toBe(FLUID_PARAMETER_SPECS.length);
  });

  it('matches the original manual physics and render defaults', () => {
    for (const [id, value] of Object.entries(DEFAULT_PARAMETERS)) {
      expect(byId[id]?.default).toBe(value);
    }
    for (const [id, value] of Object.entries(ORIGINAL_FLUID_DEFAULTS)) {
      if (id === 'activeMaterial') expect(byId.emissiveMaterial.default).toBe(value);
      else expect(byId[id]?.default).toBe(value);
    }
    DEFAULT_MATERIALS.forEach((material, index) => {
      expect(byId[`materialMass${index}`].default).toBe(material.mass);
      expect(byId[`materialColor${index}`].kind).toBe('color');
      expect(byId[`materialColor${index}`].default).toBe(Number.parseInt(material.color.slice(1), 16));
    });
  });

  it('exposes every original interaction and direct-control kind', () => {
    expect(byId.interactionMode.options?.map((option) => option.label)).toEqual([...FLUID_INTERACTION_MODES]);
    expect(byId.emissiveMaterial.kind).toBe('select');
    expect(byId.allEmitters.kind).toBe('toggle');
    expect(byId.allEmitters.live).toBe(true);
    expect(byId.allEmitters.label).toBe('Iluminar todo este color');
    expect(byId.resetSimulation.kind).toBe('action');
  });

  it('defines the six dedicated opening cues as a discrete non-generic control', () => {
    expect(byId.openingScene).toMatchObject({
      kind: 'select',
      min: 0,
      max: 5,
      step: 1,
      default: 0,
      modulatable: false,
      live: false,
    });
    expect(byId.openingScene.options).toEqual([...FLUID_OPENING_SCENE_OPTIONS]);
    expect(byId.openingScene.options?.map((option) => option.label)).toEqual([
      'ORIGINAL',
      '01 NEGRO / 500',
      '02 AZUL SUPERIOR',
      '03 SEGUNDO AZUL',
      '04 TERCER AZUL / CHOQUES',
      '05 ROJAS / ENERGÍA',
    ]);
  });

  it('opens on a neutral original look before the seven reactive looks', () => {
    expect(FLUID_LOOK_OPTIONS[0].id).toBe('original');
    expect(FLUID_LOOK_OPTIONS[1]).toEqual({
      id: 'reactive-original',
      name: 'Reactive original',
    });
    expect(FLUID_LOOKS.original).toMatchObject({
      same: DEFAULT_PARAMETERS.sameRestDensity,
      cross: DEFAULT_PARAMETERS.differentRestDensity,
      pressure: DEFAULT_PARAMETERS.stiffness,
      tension: DEFAULT_PARAMETERS.nearStiffness,
      gravity: DEFAULT_PARAMETERS.gravity,
      drag: DEFAULT_PARAMETERS.drag,
      size: 0,
      light: 0,
      exposure: 0,
      contrast: 0,
    });
  });

  it('applies looks as offsets without erasing manual trims', () => {
    const trim = 1.25;
    const manual = DEFAULT_PARAMETERS.sameRestDensity + trim;
    const looked = applyFluidLookTrim(
      manual,
      DEFAULT_PARAMETERS.sameRestDensity,
      FLUID_LOOKS.float.same,
      1,
    );
    expect(looked).toBeCloseTo(FLUID_LOOKS.float.same + trim);
    expect(applyFluidLookTrim(manual, DEFAULT_PARAMETERS.sameRestDensity, FLUID_LOOKS.float.same, 0)).toBe(manual);
  });
});
