import { describe, expect, it } from 'vitest';
import { isShowBusMessage } from './bus';
import { createDefaultShow, EMPTY_AUDIO } from './manifest';

const envelope = { v: 3, sender: 'test-window', at: 42 } as const;

describe('show bus validation', () => {
  it('accepts complete protocol messages', () => {
    expect(isShowBusMessage({ ...envelope, type: 'show-state', state: createDefaultShow() })).toBe(true);
    expect(isShowBusMessage({ ...envelope, type: 'audio-frame', audio: EMPTY_AUDIO })).toBe(true);
  });

  it('rejects unknown, incomplete and non-finite messages', () => {
    expect(isShowBusMessage({ ...envelope, type: 'unknown' })).toBe(false);
    expect(isShowBusMessage({ ...envelope, v: 1, type: 'hello' })).toBe(false);
    expect(isShowBusMessage({ ...envelope, type: 'show-state', state: { schemaVersion: 2 } })).toBe(false);
    expect(isShowBusMessage({
      ...envelope,
      type: 'audio-frame',
      audio: { ...EMPTY_AUDIO, rms: Number.NaN },
    })).toBe(false);
  });
});
