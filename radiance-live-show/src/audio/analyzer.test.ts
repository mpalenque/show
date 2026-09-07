import { describe, expect, it, vi } from 'vitest';
import { LiveAudioAnalyzer } from './analyzer';
import type { FeatureFrame } from './types';

type AnalyzerInternals = {
  context: AudioContext | null;
  graphReady: boolean;
  status: { state: string; running: boolean };
  receive(data: unknown): void;
  onContextStateChange(): void;
  startFallback(runId: number): void;
  failoverWorklet(runId: number): void;
  source: MediaStreamAudioSourceNode | null;
  node: AudioWorkletNode | null;
  usingFallback: boolean;
};

const frame = (): FeatureFrame => ({
  t: 1,
  rawRms: 0.12,
  rms: 0.8,
  bands: { low: 0.7, mid: 0.4, high: 0.2 },
  onset: true,
  onsetStrength: 0.9,
  chroma: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0]),
  centroid: 0.35,
  flux: 0.72,
  noteAttacks: [{ midi: 68, frequency: 415.3, strength: 0.85 }],
});

describe('LiveAudioAnalyzer transport', () => {
  it('publishes feature snapshots without waiting for a UI animation frame', () => {
    const analyzer = new LiveAudioAnalyzer();
    const internals = analyzer as unknown as AnalyzerInternals;
    const snapshots: number[] = [];
    analyzer.subscribeSnapshots((snapshot) => snapshots.push(snapshot.rms));
    internals.status = { state: 'running', running: true };

    internals.receive({ type: 'features', frame: frame() });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toBeGreaterThan(0);
  });

  it('does not advertise a resumed context before the mic graph is connected', () => {
    const analyzer = new LiveAudioAnalyzer();
    const internals = analyzer as unknown as AnalyzerInternals;
    internals.context = { state: 'running' } as AudioContext;

    internals.graphReady = false;
    internals.onContextStateChange();
    expect(analyzer.getStatus().running).toBe(false);

    internals.graphReady = true;
    internals.onContextStateChange();
    expect(analyzer.getStatus().running).toBe(true);
  });

  it('falls back to the native analyser when a worklet cannot produce features', () => {
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect: vi.fn((destination: AudioNode) => destination),
      disconnect: vi.fn(),
      getFloatTimeDomainData: (samples: Float32Array) => {
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] = Math.sin(index * Math.PI * 2 * 110 / 48_000) * 0.08;
        }
      },
    } as unknown as AnalyserNode;
    const gain = {
      gain: { value: 1 },
      connect: vi.fn((destination: AudioNode) => destination),
      disconnect: vi.fn(),
    } as unknown as GainNode;
    const source = {
      connect: vi.fn((destination: AudioNode) => destination),
      disconnect: vi.fn(),
    } as unknown as MediaStreamAudioSourceNode;
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    });

    try {
      const analyzer = new LiveAudioAnalyzer();
      const internals = analyzer as unknown as AnalyzerInternals;
      const snapshots: number[] = [];
      analyzer.subscribeSnapshots((snapshot) => snapshots.push(snapshot.rms));
      internals.status = { state: 'running', running: true };
      internals.context = {
        currentTime: 1,
        sampleRate: 48_000,
        destination: {} as AudioDestinationNode,
        createAnalyser: () => analyser,
        createGain: () => gain,
      } as unknown as AudioContext;
      internals.source = source;

      internals.startFallback(0);

      expect(internals.usingFallback).toBe(true);
      expect(snapshots.at(-1)).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-arms the worklet watchdog after every healthy feature frame', () => {
    const setTimeout = vi.fn(() => 41);
    const clearTimeout = vi.fn();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    try {
      const analyzer = new LiveAudioAnalyzer();
      const internals = analyzer as unknown as AnalyzerInternals;
      internals.context = { state: 'running', currentTime: 1, sampleRate: 48_000 } as AudioContext;
      internals.node = {} as AudioWorkletNode;
      internals.graphReady = true;

      internals.receive({ type: 'features', frame: frame() });
      internals.receive({ type: 'features', frame: frame() });

      expect(setTimeout).toHaveBeenCalledTimes(2);
      expect(clearTimeout).toHaveBeenCalledWith(41);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the rolling watchdog to fail over after a later worklet stall', () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      clearTimeout: vi.fn(),
    });
    try {
      const analyzer = new LiveAudioAnalyzer();
      const internals = analyzer as unknown as AnalyzerInternals;
      const failover = vi.spyOn(
        analyzer as unknown as { failoverWorklet(runId: number): void },
        'failoverWorklet',
      );
      internals.context = { state: 'running', currentTime: 1, sampleRate: 48_000 } as AudioContext;
      internals.node = {} as AudioWorkletNode;
      internals.graphReady = true;

      internals.receive({ type: 'features', frame: frame() });
      callbacks[0]?.();

      expect(failover).toHaveBeenCalledWith(0);
      failover.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails over only once when the worklet reports a processor error', () => {
    const analyzer = new LiveAudioAnalyzer();
    const internals = analyzer as unknown as AnalyzerInternals;
    const fallback = vi.spyOn(
      analyzer as unknown as { startFallback(runId: number): void },
      'startFallback',
    ).mockImplementation(() => {
      internals.usingFallback = true;
    });
    internals.context = {} as AudioContext;
    internals.source = {} as MediaStreamAudioSourceNode;

    internals.failoverWorklet(0);
    internals.failoverWorklet(0);

    expect(fallback).toHaveBeenCalledTimes(1);
    fallback.mockRestore();
  });
});
