// Web MIDI: enumera entradas, parsea note on/off y CC, hot-plug.
// Canales: se emiten 1..16 (misma convención que el archivo de mapeos y el editor).
export class MidiInput {
  constructor({ onMessage, onInputsChange } = {}) {
    this.onMessage = onMessage;
    this.onInputsChange = onInputsChange;
    this.access = null;
    this.inputs = [];
    this.enabled = new Set(loadEnabled());   // null = todos
    this.enabledLoaded = this.enabled.size > 0;
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
    this.inputs = [...this.access.inputs.values()];
    for (const input of this.inputs) {
      if (!this.enabledLoaded) this.enabled.add(input.id);       // por defecto todos habilitados
      input.onmidimessage = this.enabled.has(input.id) ? (e) => this._parse(e) : null;
    }
    console.info('[vis] MIDI inputs:', this.inputs.map((i) => i.name).join(', ') || '(ninguno)');
    this.onInputsChange?.(this.list());
  }

  list() {
    return this.inputs.map((i) => ({ id: i.id, name: i.name, enabled: this.enabled.has(i.id) }));
  }

  setEnabled(ids) {
    this.enabled = new Set(ids);
    this.enabledLoaded = true;
    localStorage.setItem('vis.midiInputs', JSON.stringify([...this.enabled]));
    this._refresh();
  }

  _parse(event) {
    const [status, d1, d2] = event.data;
    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (type === 0x90) {
      // note on con velocidad 0 = note off (convención MIDI)
      this.onMessage?.({ kind: 'note', channel, note: d1, velocity: d2, on: d2 > 0 });
    } else if (type === 0x80) {
      this.onMessage?.({ kind: 'note', channel, note: d1, velocity: 0, on: false });
    } else if (type === 0xb0) {
      this.onMessage?.({ kind: 'cc', channel, cc: d1, value: d2 });
    }
  }
}

function loadEnabled() {
  try { return JSON.parse(localStorage.getItem('vis.midiInputs') ?? '[]'); }
  catch { return []; }
}
