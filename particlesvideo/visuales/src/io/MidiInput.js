import { normalizeMidiMessage } from '../../vendor/parte2/system/midi.js';
// Single physical input owner for both parts, including transport and device identity.
// Canales: se emiten 1..16 (misma convención que el archivo de mapeos y el editor).
export class MidiInput {
  constructor({ onMessage, onInputsChange } = {}) {
    this.onMessage = onMessage;
    this.onInputsChange = onInputsChange;
    this.access = null;
    this.inputs = [];
    this.enabled = new Set(loadEnabled());   // null = todos
    this.enabledLoaded = localStorage.getItem('vis.midiInputs') != null;
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      console.error('[vis] Web MIDI no disponible (¿no es Chrome o no es contexto seguro?)');
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      console.error('[vis] no se pudo abrir MIDI:', err);
      return false;
    }
    this.access.onstatechange = () => this._refresh();
    this._refresh();
    return true;
  }

  _refresh() {
    const next = [...this.access.inputs.values()];
    for (const previous of this.inputs) {
      if (!next.some(input => input.id === previous.id && input.state !== 'disconnected') || !this.enabled.has(previous.id)) {
        previous.onmidimessage = null;
        this.onMessage?.({ kind: 'device', action: 'disconnected', deviceId: previous.id });
      }
    }
    this.inputs = next;
    for (const input of this.inputs) {
      if (!this.enabledLoaded) this.enabled.add(input.id);       // por defecto todos habilitados
      input.onmidimessage = this.enabled.has(input.id) && input.state !== 'disconnected' ? (e) => this._parse(e, input) : null;
    }
    console.info('[vis] MIDI inputs:', this.inputs.map((i) => i.name).join(', ') || '(ninguno)');
    this.onInputsChange?.(this.list());
  }

  list() {
    return this.inputs.map((i) => ({ id: i.id, name: i.name, manufacturer: i.manufacturer, state: i.state,
      listening: this.enabled.has(i.id) && i.state !== 'disconnected', enabled: this.enabled.has(i.id) }));
  }

  setEnabled(ids) {
    this.enabled = new Set(ids);
    this.enabledLoaded = true;
    localStorage.setItem('vis.midiInputs', JSON.stringify([...this.enabled]));
    if (this.access) this._refresh();
  }

  _parse(event, input = event.target) {
    const message = normalizeMidiMessage(event.data, { deviceId: input?.id ?? 'api', deviceName: input?.name,
      timestamp: event.receivedTime ?? event.timeStamp ?? performance.now() });
    if (message) this.onMessage?.(message);
  }
}

function loadEnabled() {
  try { return JSON.parse(localStorage.getItem('vis.midiInputs') ?? '[]'); }
  catch { return []; }
}
