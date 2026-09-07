import { describe, expect, it } from 'vitest';
import { createDefaultShow, resetShowConfiguration } from './manifest';

describe('show configuration reset', () => {
  it('restores authored values without replaying one-shot actions', () => {
    const current = createDefaultShow();
    current.revision = 41;
    current.scene = 'blocks';
    current.scenes.fluid.parameters.radiance.manual = 0.3;
    current.scenes.fluid.parameters.resetSimulation.manual = 1;
    current.scenes.fluid.parameters.interactionTrigger.manual = 1;
    current.scenes.blocks.parameters.testNote.manual = 7;
    current.scenes.blocks.parameters.toggleGravity.manual = 3;

    const reset = resetShowConfiguration(current);
    const defaults = createDefaultShow();
    expect(reset.revision).toBe(42);
    expect(reset.scene).toBe('fluid');
    expect(reset.scenes.fluid.parameters.radiance.manual)
      .toBe(defaults.scenes.fluid.parameters.radiance.manual);
    expect(reset.scenes.fluid.parameters.resetSimulation.manual).toBe(1);
    expect(reset.scenes.fluid.parameters.interactionTrigger.manual).toBe(1);
    expect(reset.scenes.blocks.parameters.testNote.manual).toBe(7);
    expect(reset.scenes.blocks.parameters.toggleGravity.manual).toBe(3);
  });
});
