import type { AudioSnapshot } from '../core/types';
import { AudioSnapshotAggregator } from './audio-snapshot';
import { createDspState, extractFeatures } from './dsp';
import type { DspState } from './dsp';
import featureWorkletUrl from './feature-worklet.js?worker&url';
import type { AudioEngineStatus, FeatureFrame } from './types';

type StatusListener = (status: AudioEngineStatus) => void;
type SnapshotListener = (snapshot: AudioSnapshot) => void;

// Feature hops arrive roughly every 5–11 ms. The output only needs a compact
// control-rate stream, but it must not depend on requestAnimationFrame: the
// controller is normally backgrounded while the fullscreen output is active.
const SNAPSHOT_INTERVAL_MS = 1000 / 30;
const WORKLET_FEATURE_TIMEOUT_MS = 1_500;

const INITIAL_STATUS: AudioEngineStatus = {
  state: 'idle',
  running: false,
  sampleRate: 0,
  rawRms: 0,
  latencyMs: null,
  calibrated: false,
  calibrating: false,
  error: null,
};

const localOrigin = (): boolean => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

const explainAudioError = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Permiso de micrófono bloqueado. Habilitalo desde el candado del navegador.';
    if (error.name === 'NotFoundError') return 'No se encontró una entrada de audio.';
    if (error.name === 'NotReadableError') return 'La entrada está ocupada por otra aplicación.';
    if (error.name === 'AbortError') return 'El navegador interrumpió la apertura del micrófono.';
  }
  return error instanceof Error ? error.message : 'No se pudo abrir el micrófono.';
};

export class LiveAudioAnalyzer {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private silentGain: GainNode | null = null;
  private inputTrack: MediaStreamTrack | null = null;
  private fallbackDsp: DspState | null = null;
  private fallbackSamples: Float32Array<ArrayBuffer> | null = null;
  private fallbackTimer: number | null = null;
  private workletWatchdog: number | null = null;
  private fallbackCalibration: { until: number; floor: number; peak: number } | null = null;
  private graphReady = false;
  private usingFallback = false;
  private fallbackTransitioning = false;
  private lastFeatureAt = -Infinity;
  private queue: FeatureFrame[] = [];
  private snapshotQueue: FeatureFrame[] = [];
  private listeners = new Set<StatusListener>();
  private snapshotListeners = new Set<SnapshotListener>();
  private status: AudioEngineStatus = { ...INITIAL_STATUS };
  private starting: Promise<void> | null = null;
  private runId = 0;
  private readonly aggregator = new AudioSnapshotAggregator();
  private readonly snapshotAggregator = new AudioSnapshotAggregator();
  private lastSnapshotAt = -Infinity;

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.status });
    return () => this.listeners.delete(listener);
  }

  getStatus(): AudioEngineStatus {
    return { ...this.status };
  }

  /**
   * Delivers render-ready feature snapshots as soon as the audio thread emits
   * them. This is intentionally separate from UI polling so a background
   * Control tab keeps feeding the Output tab during a show.
   */
  subscribeSnapshots(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    listener(this.snapshotAggregator.current());
    return () => this.snapshotListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.status.running) return;
    if (this.starting) return this.starting;
    if (this.context || this.stream) this.stop();
    const runId = ++this.runId;
    const pending = this.open(runId);
    this.starting = pending;
    try {
      await pending;
    } finally {
      if (this.starting === pending) this.starting = null;
    }
  }

  stop(): void {
    this.runId += 1;
    if (this.fallbackTimer !== null) window.clearInterval(this.fallbackTimer);
    if (this.workletWatchdog !== null) window.clearTimeout(this.workletWatchdog);
    this.fallbackTimer = null;
    this.workletWatchdog = null;
    this.graphReady = false;
    this.usingFallback = false;
    this.fallbackTransitioning = false;
    this.source?.disconnect();
    if (this.node) {
      this.node.onprocessorerror = null;
      this.node.port.onmessage = null;
    }
    this.node?.disconnect();
    this.analyser?.disconnect();
    this.silentGain?.disconnect();
    this.context?.removeEventListener('statechange', this.onContextStateChange);
    this.inputTrack?.removeEventListener('ended', this.onTrackEnded);
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.analyser = null;
    this.silentGain = null;
    this.inputTrack = null;
    this.fallbackDsp = null;
    this.fallbackSamples = null;
    this.fallbackCalibration = null;
    this.lastFeatureAt = -Infinity;
    this.queue = [];
    this.snapshotQueue = [];
    this.aggregator.reset();
    const stoppedSnapshot = this.snapshotAggregator.reset();
    this.lastSnapshotAt = -Infinity;
    this.patchStatus({ ...INITIAL_STATUS });
    this.publishSnapshot({
      ...stoppedSnapshot,
      timestamp: performance.now() / 1000,
    });
  }

  recalibrate(seconds = 10): boolean {
    if (!this.status.running) {
      this.patchStatus({ error: 'Iniciá el micrófono antes de calibrar.' });
      return false;
    }
    const duration = Math.max(1, Number.isFinite(seconds) ? seconds : 10);
    if (this.node && !this.usingFallback) {
      this.node.port.postMessage({ type: 'calibrate', seconds: duration });
    } else if (this.fallbackDsp && this.context) {
      this.fallbackCalibration = {
        until: this.context.currentTime + duration,
        floor: Infinity,
        peak: 0,
      };
    } else {
      this.patchStatus({ error: 'No hay un analizador de audio activo.' });
      return false;
    }
    this.patchStatus({ calibrated: false, calibrating: true, error: null });
    return true;
  }

  takeSnapshot(dt: number): AudioSnapshot {
    const frames = this.queue;
    this.queue = [];
    return this.aggregator.update(frames, this.status.running, dt);
  }

  private async open(runId: number): Promise<void> {
    try {
      this.patchStatus({ state: 'requesting', running: false, error: null });
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!window.isSecureContext && !localOrigin()) throw new Error('El micrófono requiere HTTPS o localhost.');
        throw new Error('Este navegador no expone getUserMedia. Usá Chrome o Edge actualizado.');
      }
      // Create and resume the context before the permission await. It keeps the
      // operation inside the button's user gesture on browsers that otherwise
      // leave a context created after the permission prompt suspended.
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('Web Audio is unavailable.');
      this.context = new AudioContextConstructor({ latencyHint: 'interactive' });
      this.context.addEventListener('statechange', this.onContextStateChange);
      await this.context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 1,
        },
      });
      if (runId !== this.runId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.inputTrack = this.stream.getAudioTracks()[0] ?? null;
      this.inputTrack?.addEventListener('ended', this.onTrackEnded);
      this.patchStatus({ state: 'starting' });
      if (!this.context || !this.stream) throw new Error('Audio input closed before setup completed.');
      this.source = this.context.createMediaStreamSource(this.stream);
      const workletConnected = await this.connectWorklet(runId);
      if (runId !== this.runId) return;
      if (!workletConnected) this.startFallback(runId);
      if (!this.context) return;
      this.graphReady = true;
      await this.context.resume();
      if (this.context.state !== 'running') throw new Error('El contexto de audio quedó suspendido.');
      this.patchStatus({
        state: 'running',
        running: true,
        sampleRate: this.context.sampleRate,
        error: null,
      });
      this.recalibrate();
      if (workletConnected) this.armWorkletWatchdog(runId);
    } catch (error) {
      // A late permission/worklet rejection belongs to an already-cancelled start.
      if (runId !== this.runId) return;
      this.stop();
      this.patchStatus({ state: 'error', error: explainAudioError(error) });
      throw error;
    }
  }

  /** Prefer the worklet; a native analyser is kept as a live-safe fallback. */
  private async connectWorklet(runId: number): Promise<boolean> {
    const context = this.context;
    const source = this.source;
    if (!context?.audioWorklet || !source) return false;
    try {
      await context.audioWorklet.addModule(featureWorkletUrl);
      if (runId !== this.runId || context !== this.context) return false;
      const node = new AudioWorkletNode(context, 'radiance-feature-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(node).connect(silentGain).connect(context.destination);
      this.node = node;
      this.silentGain = silentGain;
      this.usingFallback = false;
      node.port.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!this.usingFallback) this.receive(data, runId);
      };
      // A processor can fail after a healthy startup (for example after an
      // audio-device or browser worklet fault).  Treat it like a stalled
      // feature stream and keep the mic graph alive through the native path.
      node.onprocessorerror = () => this.failoverWorklet(runId);
      return true;
    } catch {
      source.disconnect();
      if (this.node) {
        this.node.onprocessorerror = null;
        this.node.port.onmessage = null;
      }
      this.node?.disconnect();
      this.silentGain?.disconnect();
      this.node = null;
      this.silentGain = null;
      return false;
    }
  }

  private startFallback(runId: number): void {
    const context = this.context;
    const source = this.source;
    if (!context || !source || runId !== this.runId) throw new Error('Audio input closed before fallback setup.');
    if (this.usingFallback) return;
    if (this.fallbackTimer !== null) window.clearInterval(this.fallbackTimer);
    if (this.workletWatchdog !== null) window.clearTimeout(this.workletWatchdog);
    this.fallbackTimer = null;
    this.workletWatchdog = null;
    source.disconnect();
    if (this.node) {
      this.node.onprocessorerror = null;
      this.node.port.onmessage = null;
    }
    this.node?.disconnect();
    this.analyser?.disconnect();
    this.silentGain?.disconnect();
    this.node = null;
    this.analyser = null;
    this.silentGain = null;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.silentGain = context.createGain();
    this.silentGain.gain.value = 0;
    source.connect(this.analyser).connect(this.silentGain).connect(context.destination);
    this.fallbackDsp = createDspState(this.analyser.fftSize);
    this.fallbackSamples = new Float32Array(new ArrayBuffer(this.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
    this.usingFallback = true;
    const sample = (): void => this.readFallback(runId);
    this.fallbackTimer = window.setInterval(sample, SNAPSHOT_INTERVAL_MS);
    sample();
  }

  /**
   * Move a live input to the native analyser exactly once.  Both the
   * processorerror callback and the rolling feature watchdog reach here, so
   * the guard is intentionally before any graph disconnection.
   */
  private failoverWorklet(runId: number): void {
    if (runId !== this.runId || this.usingFallback || this.fallbackTransitioning) return;
    this.fallbackTransitioning = true;
    try {
      this.startFallback(runId);
      // During initial graph construction `running` is still false; open()
      // performs its normal calibration after it marks the graph ready.
      if (this.status.running) this.recalibrate();
    } catch (error) {
      this.patchStatus({ error: explainAudioError(error) });
    } finally {
      this.fallbackTransitioning = false;
    }
  }

  private readFallback(runId: number): void {
    const context = this.context;
    const analyser = this.analyser;
    const samples = this.fallbackSamples;
    const dsp = this.fallbackDsp;
    if (runId !== this.runId || !context || !analyser || !samples || !dsp) return;
    analyser.getFloatTimeDomainData(samples);
    const frame = extractFeatures(samples, context.sampleRate, dsp, context.currentTime);
    this.updateFallbackCalibration(frame.rawRms, frame.t);
    this.receiveFeature(frame);
  }

  private updateFallbackCalibration(rawRms: number, now: number): void {
    const dsp = this.fallbackDsp;
    if (!dsp) return;
    const calibration = this.fallbackCalibration;
    if (calibration) {
      calibration.floor = Math.min(calibration.floor, rawRms);
      calibration.peak = Math.max(calibration.peak, rawRms);
      if (now >= calibration.until) {
        dsp.noiseFloor = Number.isFinite(calibration.floor)
          ? Math.max(0.0001, calibration.floor * 1.5)
          : dsp.noiseFloor;
        dsp.signalPeak = Math.max(calibration.peak, dsp.noiseFloor * 4, 0.01);
        this.fallbackCalibration = null;
        this.patchStatus({ calibrated: true, calibrating: false });
      }
      return;
    }
    dsp.noiseFloor = Math.min(dsp.noiseFloor * 1.0005, Math.max(0.0005, rawRms * 0.6));
    dsp.signalPeak = Math.max(rawRms, dsp.signalPeak * 0.9995);
  }

  private armWorkletWatchdog(runId: number): void {
    if (this.workletWatchdog !== null) window.clearTimeout(this.workletWatchdog);
    this.workletWatchdog = null;
    const context = this.context;
    if (runId !== this.runId
      || this.usingFallback
      || !this.node
      || !this.graphReady
      || !context
      || context.state !== 'running') return;
    const armedAt = performance.now();
    this.workletWatchdog = window.setTimeout(() => {
      this.workletWatchdog = null;
      if (runId !== this.runId || this.usingFallback || !this.node) return;
      // A callback can race a feature delivery after it was queued.  In that
      // case retain the rolling monitor instead of silently stopping it.
      if (this.lastFeatureAt > armedAt) {
        this.armWorkletWatchdog(runId);
        return;
      }
      this.failoverWorklet(runId);
    }, WORKLET_FEATURE_TIMEOUT_MS);
  }

  private receive(data: unknown, runId = this.runId): void {
    if (runId !== this.runId) return;
    if (!data || typeof data !== 'object') return;
    const message = data as { type?: string; frame?: FeatureFrame; state?: string };
    if (message.type === 'features' && message.frame) {
      this.receiveFeature(message.frame);
    }
    if (message.type === 'calibration' && message.state === 'started') {
      this.patchStatus({ calibrated: false, calibrating: true });
    }
    if (message.type === 'calibration' && message.state === 'complete') {
      this.patchStatus({ calibrated: true, calibrating: false });
    }
  }

  private receiveFeature(frame: FeatureFrame): void {
    frame.chroma = new Float32Array(frame.chroma);
    this.queue.push(frame);
    if (this.queue.length > 32) this.queue.splice(0, this.queue.length - 32);
    this.snapshotQueue.push(frame);
    // Bound the queue even if an Output tab is not currently connected.
    if (this.snapshotQueue.length > 64) this.snapshotQueue.splice(0, this.snapshotQueue.length - 64);
    this.lastFeatureAt = performance.now();
    // This is a rolling watchdog, not merely a startup probe.  Every healthy
    // worklet frame postpones the timeout that will fail over a later stall.
    if (!this.usingFallback) this.armWorkletWatchdog(this.runId);
    const nowAudio = this.context?.currentTime ?? frame.t;
    this.patchStatus({
      rawRms: frame.rawRms,
      // Include half the FFT window: it is the useful mic-to-feature latency.
      latencyMs: Math.max(0, (nowAudio - frame.t) * 1000)
        + 2048 / Math.max(1, this.context?.sampleRate ?? 48_000) * 1000,
    });
    this.flushRealtimeSnapshot();
  }

  private patchStatus(patch: Partial<AudioEngineStatus>): void {
    this.status = { ...this.status, ...patch };
    const snapshot = { ...this.status };
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private flushRealtimeSnapshot(now = performance.now()): void {
    if (!this.snapshotQueue.length || now - this.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
    const dt = Number.isFinite(this.lastSnapshotAt)
      ? Math.min(0.2, Math.max(0.001, (now - this.lastSnapshotAt) / 1000))
      : 1 / 30;
    const snapshot = this.snapshotAggregator.update(this.snapshotQueue, this.status.running, dt);
    this.snapshotQueue = [];
    this.lastSnapshotAt = now;
    this.publishSnapshot(snapshot);
  }

  private publishSnapshot(snapshot: AudioSnapshot): void {
    const copy = { ...snapshot, notes: snapshot.notes.map((note) => ({ ...note })) };
    this.snapshotListeners.forEach((listener) => listener(copy));
  }

  private onTrackEnded = (): void => {
    this.stop();
    this.patchStatus({
      state: 'ended',
      running: false,
      calibrating: false,
      error: 'La entrada de audio se desconectó.',
    });
  };

  private onContextStateChange = (): void => {
    // The context is resumed before getUserMedia so that it retains the click
    // gesture. Do not advertise LIVE until the mic graph has been connected.
    if (!this.context || !this.graphReady) return;
    if (this.context.state === 'running') {
      this.patchStatus({ state: 'running', running: true, error: null });
      if (!this.usingFallback) this.armWorkletWatchdog(this.runId);
    }
    if (this.context.state === 'suspended') {
      if (this.workletWatchdog !== null) window.clearTimeout(this.workletWatchdog);
      this.workletWatchdog = null;
      this.patchStatus({ state: 'suspended', running: false });
    }
    if (this.context.state === 'closed' && this.status.state !== 'idle') {
      this.patchStatus({ state: 'ended', running: false });
    }
  };
}
