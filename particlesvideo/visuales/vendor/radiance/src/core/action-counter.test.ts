import { describe, expect, it } from 'vitest';
import { actionCounterDelta } from './action-counter';

describe('actionCounterDelta', () => {
  it('preserves coalesced clicks and the real wrap edge', () => {
    expect(actionCounterDelta(4, 6)).toBe(2);
    expect(actionCounterDelta(999, 0)).toBe(1);
  });

  it('baselines first state and ignores stale controller rollbacks', () => {
    expect(actionCounterDelta(undefined, 12)).toBe(0);
    expect(actionCounterDelta(10, 0)).toBe(0);
    expect(actionCounterDelta(0, 999)).toBe(0);
  });
});
