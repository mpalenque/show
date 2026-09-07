import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteTransport from './RemoteTransport';
import type { ShowDoc } from '../../fluids-show/show-doc';

class TestChannel {
  static instances: TestChannel[] = [];
  sent: any[] = [];
  listener: ((message: MessageEvent) => void) | null = null;
  constructor() { TestChannel.instances.push(this); }
  postMessage(message: unknown) { this.sent.push(message); }
  addEventListener(_type: string, callback: (message: MessageEvent) => void) { this.listener = callback; }
  removeEventListener() { this.listener = null; }
  close() {}
  deliver(message: unknown) { this.listener?.({ data: message } as MessageEvent); }
}

const doc = (marker = 0) => ({ version: 1, duration: 152.694, events: [{ marker }],
  curves: {}, gestures: [], materialColors: [] }) as unknown as ShowDoc;
let transport: RemoteTransport;
let channel: TestChannel;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('sessionStorage', { setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('BroadcastChannel', TestChannel);
  transport = new RemoteTransport(152.694);
  channel = TestChannel.instances.at(-1)!;
  channel.deliver({ t: 'fluids:state', state: { time: 12, duration: 152.694,
    playing: false, audioMode: 'external', audioReady: false, loaded: true } });
  channel.deliver({ t: 'fluids:document', doc: doc(), revision: 4 });
});

afterEach(() => {
  transport.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const edits = () => channel.sent.filter((message) => message.t === 'fluids:document');

describe('remote timeline document and transport', () => {
  it('never echoes an output document and never plays sound of its own', () => {
    transport.updateDocument(doc());
    vi.advanceTimersByTime(600);
    expect(edits()).toHaveLength(0);
    transport.play();
    expect(channel.sent.at(-1)).toMatchObject({ t: 'fluids:command', command: 'play' });
    expect(transport.playing).toBe(false);
    expect(transport.time).toBe(12);
    expect(transport.ready).toBe(true);
    expect(transport.state.audioMode).toBe('external');
  });

  it('mirrors the output audio mode and forwards the requested one untouched', () => {
    channel.deliver({ t: 'fluids:state', state: { audioMode: 'web', audioReady: true, audioBlocked: true } });
    expect(transport.state.audioMode).toBe('web');
    expect(transport.state.audioReady).toBe(true);
    expect(transport.state.audioBlocked).toBe(true);
    transport.command('audio-mode', 'external');
    expect(channel.sent.at(-1)).toMatchObject({ command: 'audio-mode', value: 'external' });
  });

  it('waits for edit ACKs and keeps newer edits while one revision is in flight', () => {
    transport.updateDocument(doc(1));
    channel.deliver({ t: 'fluids:state', state: { time: 13 } });
    expect(edits()).toHaveLength(0);
    vi.advanceTimersByTime(500);
    const first = edits()[0];
    expect(first.baseRevision).toBe(4);
    transport.updateDocument(doc(2));
    vi.advanceTimersByTime(500);
    expect(edits()).toHaveLength(1);
    channel.deliver({ ...first, revision: 5 });
    expect(edits()).toHaveLength(2);
    expect(edits()[1]).toMatchObject({ doc: doc(2), baseRevision: 5 });
    channel.deliver({ ...edits()[1], revision: 6 });
    expect(transport.hasUnsavedDocument).toBe(false);
  });

  it('preserves dirty edits when a different editor wins the revision', () => {
    const listener = vi.fn();
    transport.subscribe(listener);
    listener.mockClear();
    transport.updateDocument(doc(1));
    channel.deliver({ t: 'fluids:document', doc: doc(7), revision: 5, clientId: 'other' });
    vi.advanceTimersByTime(600);
    expect(edits()).toHaveLength(0);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ t: 'conflict' }));
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'document' }));
    expect(transport.hasUnsavedDocument).toBe(true);
    transport.reloadDocument();
    channel.deliver({ t: 'fluids:document', doc: doc(7), revision: 5 });
    expect(listener).toHaveBeenCalledWith({ t: 'document', doc: doc(7) });
  });

  it('ignores another editor request and unrelated rejected edits', () => {
    transport.updateDocument(doc(1));
    channel.deliver({ t: 'fluids:document', doc: doc(7), baseRevision: 4, clientId: 'other' });
    channel.deliver({ t: 'fluids:document', doc: doc(7), revision: 5, clientId: 'other', rejected: true });
    vi.advanceTimersByTime(500);
    expect(edits()).toHaveLength(1);
    expect(edits()[0].doc).toEqual(doc(1));
  });

  it('sends one gesture release and no recurring idle traffic', () => {
    for (let i = 0; i < 60; i += 1) transport.gesture(null);
    const gestures = () => channel.sent.filter((message) => message.command === 'gesture');
    expect(gestures()).toHaveLength(0);
    transport.gesture({ x: 0.5, y: 0.5 });
    transport.gesture(null);
    transport.gesture(null);
    expect(gestures()).toHaveLength(2);
    expect(gestures().at(-1).value).toBe(null);
  });

  it('accepts the restarted output document even when its revision begins at zero', () => {
    const listener = vi.fn();
    transport.subscribe(listener);
    channel.deliver({ t: 'fluids:state', state: { ownerId: 'first' } });
    channel.deliver({ t: 'fluids:state', state: { ownerId: 'second' } });
    channel.deliver({ t: 'fluids:document', doc: doc(8), revision: 0, ownerId: 'second' });
    expect(listener).toHaveBeenCalledWith({ t: 'document', doc: doc(8) });
    expect(transport.revision).toBe(0);
  });

  it('keeps the local draft when output reloads before acknowledging its edit', () => {
    const listener = vi.fn();
    transport.subscribe(listener);
    listener.mockClear();
    channel.deliver({ t: 'fluids:state', state: { ownerId: 'first' } });
    transport.updateDocument(doc(1));
    vi.advanceTimersByTime(500);
    channel.deliver({ t: 'fluids:state', state: { ownerId: 'second' } });
    channel.deliver({ t: 'fluids:document', doc: doc(), revision: 0, ownerId: 'second' });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ t: 'conflict' }));
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'document' }));
    expect(transport.hasUnsavedDocument).toBe(true);
  });

  it('replays hello data that arrived before the React subscription committed', () => {
    const listener = vi.fn();
    transport.subscribe(listener);
    expect(listener).toHaveBeenCalledWith({ t: 'document', doc: doc() });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ t: 'state' }));
  });
});
