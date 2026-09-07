import { describe, expect, it } from 'vitest';
import { BLOCKS_LOOKS, BLOCKS_PARAMETER_SPECS } from './parameter-specs';

const byId = Object.fromEntries(BLOCKS_PARAMETER_SPECS.map((spec) => [spec.id, spec]));

describe('Blocks ImpulseMode 3 control surface', () => {
  it('keeps the original neutral macro defaults and single authored look', () => {
    expect(byId.density.default).toBe(0.2);
    expect(byId.turbulence.default).toBe(0.1);
    expect(byId.tension.default).toBe(0.1);
    expect(byId.zoom.default).toBe(1);
    expect(BLOCKS_LOOKS).toEqual([{ id: 'impulse-03', name: 'Impulse 03 · Original' }]);
  });

  it('exposes note testing and the Q/W/E/R operations as direct actions', () => {
    for (const id of ['testNote', 'toggleGravity', 'rotate90', 'toggleEmitterScale', 'resetBlocks']) {
      expect(byId[id]).toMatchObject({ kind: 'action', modulatable: false });
    }
    expect(byId.testMidi.kind).toBe('select');
    expect(byId.testMidi.modulatable).toBe(false);
  });

  it('does not publish duplicate parameter ids', () => {
    expect(new Set(BLOCKS_PARAMETER_SPECS.map((spec) => spec.id)).size)
      .toBe(BLOCKS_PARAMETER_SPECS.length);
  });
});
