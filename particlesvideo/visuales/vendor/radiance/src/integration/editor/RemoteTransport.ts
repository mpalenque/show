import type { AudioPeaks } from '../../fluids-show/audio-transport';
import type { ShowDoc } from '../../fluids-show/show-doc';

export interface OutputState {
  status: string;
  scene: string | number;
  ownerId?: string;
  mode: string;
  time: number;
  playing: boolean;
  duration: number;
  audioMode: 'web' | 'external';
  audioReady: boolean;
  audioBlocked?: boolean;
  audioPlaying?: boolean;
  volume?: number;
  loaded?: boolean;
  transportReady?: boolean;
  error?: string | null;
  audioError?: string | null;
  storageError?: string | null;
  revision?: number;
  master?: number;
  blackout?: boolean;
  loop?: { from: number; to: number; on?: boolean } | null;
  stats?: { fps?: number; particles?: number; pps?: number; capped?: boolean; warning?: string; scale?: number };
}

type Listener = (message: any) => void;

/** The output owns simulation, document persistence and the transport, and
 * since 2026-09-06 it also plays the show's WAV so image and music share one
 * clock. This editor still produces no sound of its own: it only asks the
 * output to play, pause or seek, and interpolates the playhead between states. */
export default class RemoteTransport {
  readonly clientId = `fluids-editor-${crypto.randomUUID()}`;
  readonly channel = new BroadcastChannel('vis-bus');
  state: OutputState;
  onEnded: (() => void) | null = null;
  connected = false;
  revision = -1;
  private ownerId: string | null = null;
  private listeners = new Set<Listener>();
  private sampledAt = 0;
  private peaksCache: AudioPeaks | null = null;
  private acknowledged = '';
  private pending: ShowDoc | null = null;
  private inFlight: { doc: ShowDoc; editId: string; serialized: string } | null = null;
  private documentReady = false;
  private conflict = false;
  private saveTimer: number | null = null;
  private heartbeat: number;
  private lastGestureActive = false;

  constructor(duration: number) {
    this.state = { status: 'waiting', scene: 0, mode: 'inactive', time: 0, playing: false,
      duration, audioMode: 'web', audioReady: false };
    this.channel.addEventListener('message', this.receive);
    this.hello();
    this.heartbeat = window.setInterval(() => {
      if (performance.now() - this.sampledAt > 3500) {
        if (this.connected) {
          this.connected = false;
          this.emit({ t: 'connection', connected: false });
        }
        this.hello();
      }
    }, 1500);
  }

  get ready() { return this.documentReady || Boolean(this.state.loaded || this.state.transportReady); }
  get hasUnsavedDocument() { return Boolean(this.pending || this.inFlight || this.conflict); }
  get playing() { return this.connected && this.state.playing; }
  get duration() { return this.state.duration; }
  get time() {
    const elapsed = this.playing ? Math.min(0.3, Math.max(0, performance.now() - this.sampledAt) / 1000) : 0;
    return Math.min(this.duration, Math.max(0, this.state.time + elapsed));
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    // A fast output can answer hello before React commits its subscription.
    if (this.documentReady && this.acknowledged) listener({ t: 'document', doc: JSON.parse(this.acknowledged) });
    if (this.connected) listener({ t: 'state', state: this.state });
    if (this.peaksCache) listener({ t: 'peaks', peaks: this.peaksCache });
    return () => { this.listeners.delete(listener); };
  }
  private emit(message: any) { for (const listener of this.listeners) listener(message); }
  private hello() { this.channel.postMessage({ t: 'fluids:hello', clientId: this.clientId }); }
  command(command: string, value?: unknown) {
    this.channel.postMessage({ t: 'fluids:command', command, value, clientId: this.clientId });
  }
  async arm() { this.command('arm'); }
  play() { this.command('play'); }
  pause() { this.command('pause'); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(time: number) { this.command('seek', Math.min(this.duration, Math.max(0, time))); }
  peaks() { return this.peaksCache; }
  setLoop(range: { from: number; to: number } | null) { this.command('loop', range); }
  gesture(value: unknown) {
    // An idle editor must not send 60 null messages per second.
    if (value || this.lastGestureActive) this.command('gesture', value);
    this.lastGestureActive = Boolean(value);
  }
  requestPreview() { this.channel.postMessage({ t: 'fluids:preview-request', clientId: this.clientId }); }

  updateDocument(doc: ShowDoc) {
    if (!this.documentReady) return;
    const serialized = JSON.stringify(doc);
    if (serialized === (this.inFlight?.serialized ?? this.acknowledged)) {
      this.pending = null;
      return;
    }
    this.pending = doc;
    this.emit({ t: 'save', status: this.conflict ? 'conflicto' : 'guardando' });
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      // A separate draft key never overrides the authoritative show on reload.
      try { sessionStorage.setItem(`vis-fluids-draft:${this.clientId}`, JSON.stringify(this.pending ?? doc)); } catch { /* Export remains available. */ }
      this.flush();
    }, 500);
  }

  private flush() {
    if (this.saveTimer !== null || !this.connected || this.conflict || this.inFlight || !this.pending || this.revision < 0) return;
    const doc = this.pending;
    this.pending = null;
    this.inFlight = { doc, editId: crypto.randomUUID(), serialized: JSON.stringify(doc) };
    this.channel.postMessage({ t: 'fluids:document', doc, baseRevision: this.revision,
      ownerId: this.ownerId, clientId: this.clientId, editId: this.inFlight.editId });
  }

  private receive = (event: MessageEvent) => {
    const message = event.data;
    if (!message || typeof message.t !== 'string') return;
    if (message.t === 'fluids:state' && message.state) {
      this.observeOwner(message.state.ownerId);
      const ended = this.state.playing && !message.state.playing && message.state.time >= message.state.duration;
      this.state = { ...this.state, ...message.state };
      this.sampledAt = performance.now();
      this.connected = true;
      this.emit({ t: 'state', state: this.state });
      if (ended) this.onEnded?.();
      this.flush();
    } else if (message.t === 'fluids:document' && message.doc && Number.isFinite(message.revision)) {
      this.observeOwner(message.ownerId);
      if (message.rejected && message.clientId !== this.clientId) return;
      // Requests from another editor have baseRevision only. Never treat them as output ACKs.
      const ownAck = message.clientId === this.clientId && message.editId === this.inFlight?.editId;
      if (ownAck && !message.rejected) {
        this.acknowledged = this.inFlight!.serialized;
        this.inFlight = null;
        this.revision = message.revision;
        this.emit({ t: 'save', status: this.pending ? 'guardando' : 'guardado' });
        if (!this.pending) {
          try { sessionStorage.removeItem(`vis-fluids-draft:${this.clientId}`); } catch { /* Optional draft. */ }
        }
        this.flush();
        return;
      }
      if (message.revision < this.revision) return;
      const serialized = JSON.stringify(message.doc);
      if (serialized === this.acknowledged && this.documentReady && !message.rejected) {
        this.revision = message.revision;
        return;
      }
      if (this.pending || this.inFlight) {
        this.conflict = true;
        this.revision = message.revision;
        this.emit({ t: 'conflict', doc: message.doc,
          error: 'El show cambió en otra ventana. Tu edición sigue aquí: exportala antes de cargar la versión de salida.' });
        return;
      }
      this.documentReady = true;
      this.revision = message.revision;
      this.acknowledged = serialized;
      this.emit({ t: 'document', doc: message.doc });
    } else if (message.t === 'fluids:peaks' && message.peaks) {
      this.peaksCache = message.peaks;
      this.emit({ t: 'peaks', peaks: message.peaks });
    } else if (message.t === 'fluids:preview') {
      this.emit({ t: 'preview', url: message.url });
    } else if (message.t === 'fluids:error') {
      this.emit({ t: 'error', error: message.error });
    }
  };

  private observeOwner(ownerId?: string) {
    if (!ownerId || ownerId === this.ownerId) return;
    const replacing = this.ownerId !== null;
    this.ownerId = ownerId;
    if (!replacing) return;
    const unsaved = this.hasUnsavedDocument;
    this.pending ??= this.inFlight?.doc ?? null;
    this.inFlight = null;
    this.revision = -1;
    this.documentReady = false;
    this.acknowledged = '';
    this.peaksCache = null;
    this.emit({ t: 'output-changed', unsaved });
    if (unsaved) {
      this.conflict = true;
      this.emit({ t: 'conflict', error: 'La salida se reinició mientras editabas. Tu borrador sigue aquí: exportalo antes de cargar la versión de salida.' });
    }
    this.hello();
  }

  reloadDocument() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pending = null;
    this.inFlight = null;
    this.conflict = false;
    this.documentReady = false;
    this.acknowledged = '';
    this.hello();
  }

  dispose() {
    this.gesture(null);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.flush();
    window.clearInterval(this.heartbeat);
    this.channel.removeEventListener('message', this.receive);
    this.channel.close();
    this.listeners.clear();
  }
}
