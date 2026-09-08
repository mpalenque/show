/** Web MIDI adapter. Channels are 1..16, matching the Parte 1 wire format. */
const now = () => globalThis.performance?.now?.() ?? Date.now();
const byte = (n) => Number.isInteger(n) && n >= 0 && n <= 255;
export const VVVV_MIDI_PORT = 'loopMIDI Port';
const portName = value => String(value || '').trim().toLocaleLowerCase();

export function normalizeMidiMessage(data, metadata = {}) {
  const raw = Array.from(data ?? []);
  if (!raw.length || !raw.every(byte)) return null;
  const status = raw[0];
  if (status < 0x80) return null; // Web MIDI supplies complete messages, not running status.
  const common = { ...metadata, timestamp: metadata.timestamp ?? now(), raw };
  const transport = { 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop' }[status];
  if (transport) return { ...common, kind: 'transport', command: transport };
  if (status === 0xf2) {
    if (raw.length < 3 || raw[1] > 127 || raw[2] > 127) return null;
    return { ...common, kind: 'transport', command: 'position', position: raw[1] | (raw[2] << 7) };
  }
  if (status >= 0xf0) return null; // Ignore SysEx, active sensing and unhandled system messages.
  const type = status & 0xf0;
  const channel = (status & 15) + 1;
  const length = type === 0xc0 || type === 0xd0 ? 2 : 3;
  if (raw.length < length || raw.slice(1, length).some((n) => n > 127)) return null;
  const [a, b] = raw.slice(1);
  if (type === 0x90 || type === 0x80) {
    const on = type === 0x90 && b > 0;
    return { ...common, kind: 'note', channel, note: a, velocity: on ? b : 0,
      on, ...(type === 0x80 ? { releaseVelocity: b } : {}) };
  }
  if (type === 0xb0) return { ...common, kind: 'cc', channel, cc: a, value: b };
  if (type === 0xe0) return { ...common, kind: 'pitchbend', channel, value: (b << 7) | a, signed: ((b << 7) | a) - 8192 };
  if (type === 0xa0) return { ...common, kind: 'polyaftertouch', channel, note: a, value: b };
  if (type === 0xd0) return { ...common, kind: 'aftertouch', channel, value: a };
  if (type === 0xc0) return { ...common, kind: 'program', channel, program: a };
  return null;
}

/** Clock follows 24 MIDI ticks per quarter. Song Position Pointer uses six ticks/unit. */
export class MidiClock {
  constructor() { this.reset(); }
  reset() {
    this.ticks = 0;
    this.playing = false;
    this.bpm = null;
    this.lastTick = null;
    this.intervals = [];
    this.deviceId = null;
  }
  dispatch(msg) {
    if (msg?.kind !== 'transport') return this.snapshot();
    if (this.deviceId != null && msg.deviceId != null && msg.deviceId !== this.deviceId) {
      // Clock estimates cannot combine independent hardware clocks.
      this.intervals = [];
      this.lastTick = null;
      this.bpm = null;
    }
    this.deviceId = msg.deviceId ?? this.deviceId;
    if (msg.command === 'start') {
      this.ticks = 0;
      this.playing = true;
      this.lastTick = null;
      this.intervals = [];
    } else if (msg.command === 'continue') this.playing = true;
    else if (msg.command === 'stop') this.playing = false;
    else if (msg.command === 'position') this.ticks = Math.max(0, Number(msg.position) || 0) * 6;
    else if (msg.command === 'clock') {
      const stamp = Number(msg.timestamp ?? now());
      const interval = this.lastTick == null ? 0 : stamp - this.lastTick;
      this.lastTick = stamp;
      if (interval > 0 && interval < 2000) {
        this.intervals.push(interval);
        if (this.intervals.length > 48) this.intervals.shift();
        if (this.intervals.length >= 6) {
          const sorted = [...this.intervals].sort((a, b) => a - b);
          const middle = sorted.length >> 1;
          const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
          this.bpm = 60000 / (24 * median);
        }
      } else if (interval >= 2000 || interval < 0) {
        this.intervals = [];
        this.bpm = null;
      }
      if (this.playing) this.ticks += 1;
    }
    return this.snapshot();
  }
  snapshot() {
    return { playing: this.playing, ticks: this.ticks, beat: this.ticks / 24,
      position: this.ticks / 6, bpm: this.bpm, deviceId: this.deviceId, ppq: 24 };
  }
}

export class MidiInput {
  constructor({ onMessage = () => {}, onDevices = () => {}, onEvent = () => {},
    storage = globalThis.localStorage, navigator = globalThis.navigator,
    storageKey = 'parte2.midiInputs', preferredName = null } = {}) {
    Object.assign(this, { onMessage, onDevices, onEvent, storage, navigator, storageKey, preferredName });
    this.access = null;
    this.enabledIds = new Set();
    this.explicitSelection = false;
    this.boundInputs = new Map();
    this.enabledNames = new Set(); this.openErrors = new Map();
    this.received = 0; this.lastMessage = null; this.requesting = false; this.error = null;
    this.clock = new MidiClock();
    this.disposed = false;
    this._stateChange = () => this.refresh();
    try {
      const saved = this.storage?.getItem(this.storageKey);
      if (saved !== null && saved !== undefined) {
        const selection = JSON.parse(saved);
        const ids = Array.isArray(selection) ? selection : selection?.ids;
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
          this.enabledIds = new Set(ids);
          this.enabledNames = new Set(selection?.names || []);
          this.explicitSelection = selection?.mode !== 'preferred'; // An explicitly empty selection stays empty.
          if (selection?.mode === 'preferred') this.preferredName = selection.preferredName || preferredName;
        }
      }
    } catch (error) { this.onEvent('warning', { message: 'No se pudo leer la selección MIDI.', error }); }
  }
  async init() {
    if (this.access) return this.refresh({ retryFailed: true });
    if (this.initializing) return this.initializing;
    this.initializing = this._init();
    try { return await this.initializing; } finally { this.initializing = null; }
  }
  async _init() {
    this.disposed = false;
    this.requesting = true; this.error = null; this.publishStatus();
    if (!this.navigator?.requestMIDIAccess) {
      const error = new Error('Web MIDI no está disponible en este navegador/contexto.');
      this.requesting = false; this.error = error.message; this.publishStatus();
      this.onEvent('error', { message: error.message, error });
      throw error;
    }
    try {
      this.access = await this.navigator.requestMIDIAccess({ sysex: false });
      this.requesting = false;
      if (this.disposed) return [];
      this.access.addEventListener?.('statechange', this._stateChange);
      if (!this.access.addEventListener) this.access.onstatechange = this._stateChange;
      return this.refresh();
    } catch (error) {
      this.requesting = false; this.error = error.message; this.publishStatus();
      this.onEvent('error', { message: error.message, error });
      throw error;
    }
  }
  listInputs() {
    return Array.from(this.access?.inputs?.values?.() ?? []).map((port) => ({
      id: port.id, name: port.name || 'MIDI', manufacturer: port.manufacturer || '',
      state: port.state, connection: port.connection, enabled: this.enabledIds.has(port.id),
      listening: this.boundInputs.has(port.id) && port.connection === 'open' && !this.openErrors.has(port.id),
      error: this.openErrors.get(port.id) || null,
    }));
  }
  setEnabled(ids) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new TypeError('MIDI input IDs must be strings.');
    this.explicitSelection = true;
    this.enabledIds = new Set(ids);
    this.enabledNames = new Set(this.listInputs().filter(port => this.enabledIds.has(port.id)).map(port => port.name));
    this.saveSelection();
    return this.refresh();
  }
  saveSelection() {
    try { this.storage?.setItem(this.storageKey, JSON.stringify({ version: 2,
      mode: this.explicitSelection ? 'manual' : 'preferred', preferredName: this.preferredName,
      ids: [...this.enabledIds], names: [...this.enabledNames] })); }
    catch (error) { this.onEvent('warning', { message: 'No se pudo guardar la selección MIDI.', error }); }
  }
  usePreferredInput(name = VVVV_MIDI_PORT) {
    this.preferredName = name; this.explicitSelection = false;
    this.enabledIds.clear(); this.enabledNames.clear(); this.saveSelection();
    return this.refresh({ retryFailed: true });
  }
  setEnabledInputs(ids) { return this.setEnabled(ids); }
  refresh({ retryFailed = false } = {}) {
    if (this.disposed) return [];
    const ports = Array.from(this.access?.inputs?.values?.() ?? []);
    if (!this.explicitSelection) this.enabledIds = new Set(ports.filter(p => p.state !== 'disconnected'
      && (!this.preferredName || portName(p.name) === portName(this.preferredName))).map(p => p.id));
    else for (const port of ports) if ([...this.enabledNames].some(name => portName(name) === portName(port.name))) this.enabledIds.add(port.id);
    const active = new Set();
    for (const port of ports) {
      if (port.state === 'disconnected' || !this.enabledIds.has(port.id)) continue;
      active.add(port.id);
      if (this.boundInputs.get(port.id)?.port === port && !(retryFailed && this.openErrors.has(port.id))) continue;
      this._unbind(port.id);
      const handler = (event) => {
        if (!this.enabledIds.has(port.id) || this.disposed) return;
        const msg = normalizeMidiMessage(event.data, { deviceId: port.id, deviceName: port.name || '',
          timestamp: event.receivedTime ?? event.timeStamp ?? now() });
        if (!msg) return;
        this.received++; this.lastMessage = msg;
        if (msg.kind === 'transport') this.onEvent('clock', this.clock.dispatch(msg));
        this.onMessage(msg);
        this.onEvent('message', msg);
        this.publishStatus();
      };
      if (port.addEventListener) port.addEventListener('midimessage', handler);
      else port.onmidimessage = handler;
      this.boundInputs.set(port.id, { port, handler });
      this.openErrors.delete(port.id);
      Promise.resolve(port.open?.()).then(() => {
        if (this.disposed || this.boundInputs.get(port.id)?.handler !== handler) return;
        this.onDevices(this.listInputs()); this.publishStatus();
      }).catch(error => {
        this.openErrors.set(port.id, error.message); this.publishStatus();
        this.onEvent('error', { message: error.message, deviceId: port.id });
      });
    }
    for (const id of this.boundInputs.keys()) if (!active.has(id)) this._unbind(id);
    const inputs = this.listInputs();
    this.onDevices(inputs);
    this.onEvent('devices', inputs);
    this.publishStatus();
    return inputs;
  }
  _unbind(id) {
    const entry = this.boundInputs.get(id);
    if (!entry) return;
    if (entry.port.removeEventListener) entry.port.removeEventListener('midimessage', entry.handler);
    else if (entry.port.onmidimessage === entry.handler) entry.port.onmidimessage = null;
    this.boundInputs.delete(id);
    this.openErrors.delete(id);
    // The mapper releases held gates on disconnect/disable, avoiding stuck notes.
    this.onMessage({ kind: 'device', action: 'disconnected', deviceId: id, timestamp: now() });
    Promise.resolve(entry.port.close?.()).catch(() => {});
  }
  status() {
    const inputs = this.listInputs(), enabled = inputs.filter(port => port.enabled && port.state !== 'disconnected');
    const state = this.requesting ? 'requesting' : this.error ? 'error' : !this.access ? 'idle'
      : enabled.some(port => port.listening) ? 'listening'
        : enabled.some(port => port.error) ? 'error' : enabled.length ? 'connecting'
          : !this.explicitSelection && this.preferredName ? 'missing' : 'disabled';
    return { state, preferredName: this.preferredName, selectedNames: enabled.map(port => port.name),
      received: this.received, lastMessage: this.lastMessage, error: this.error || enabled.find(port => port.error)?.error || null };
  }
  publishStatus() { this.onEvent('status', this.status()); }
  dispose() {
    this.disposed = true;
    this.access?.removeEventListener?.('statechange', this._stateChange);
    if (this.access?.onstatechange === this._stateChange) this.access.onstatechange = null;
    for (const id of [...this.boundInputs.keys()]) this._unbind(id);
    this.access = null;
    this.clock.reset();
  }
}
