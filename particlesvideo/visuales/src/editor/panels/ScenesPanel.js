export class ScenesPanel {
  constructor(state, bus) {
    this.state = state;
    this.bus = bus;
    this.list = document.getElementById('scenes-list');
    this.midiEl = document.getElementById('midi-inputs');
    this.oscEl = document.getElementById('osc-status');
    this.statsEl = document.getElementById('stats');
    this.transitionEl = document.getElementById('transition');
    this.portEl = document.getElementById('osc-port');
  }

  init() {
    this.portEl.addEventListener('change', () => {
      this.bus.post({ t: 'oscPort', port: Number(this.portEl.value) });
    });
  }

  render() {
    this.list.innerHTML = '';
    for (const s of this.state.scenes) {
      const b = document.createElement('button');
      b.textContent = s.name ? `${s.id} · ${s.name}` : s.id;
      b.title = s.name ?? s.id;
      if (s.id === this.state.currentScene) b.classList.add('active');
      b.onclick = () => this.bus.post({ t: 'scene', id: s.id });
      this.list.appendChild(b);
    }

    this.midiEl.innerHTML = '';
    if (this.state.midiInputs.length === 0) {
      this.midiEl.innerHTML = '<span class="offline">sin entradas MIDI</span>';
    }
    for (const input of this.state.midiInputs) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = input.enabled;
      cb.onchange = () => {
        const ids = this.state.midiInputs.filter((i) => (i.id === input.id ? cb.checked : i.enabled)).map((i) => i.id);
        this.bus.post({ t: 'midiInputs', enabledIds: ids });
      };
      label.append(cb, document.createTextNode(input.name));
      this.midiEl.appendChild(label);
    }

    const { connected, udpPort } = this.state.osc;
    this.oscEl.innerHTML = connected
      ? `<span class="online">bridge conectado</span>`
      : `<span class="offline">bridge desconectado (npm run osc)</span>`;
    if (document.activeElement !== this.portEl) this.portEl.value = udpPort;

    this.renderStats();
  }

  renderStats() {
    const s = this.state.stats;
    if (!s) { this.statsEl.textContent = '—'; return; }
    // El dpr ya no es una falla: el canvas compensa la escala de pantalla. Se avisa igual
    // porque con una escala que no sea múltiplo entero puede correrse medio píxel.
    const dprRaro = s.dpr !== 1;
    this.statsEl.innerHTML =
      `${s.fps} fps · ${s.ms} ms\n` +
      `partículas ${s.particles.toLocaleString('es')}\n` +
      `<span class="${dprRaro ? 'warn' : ''}">dpr ${dprRaro ? `${s.dpr.toFixed(2)} (compensado)` : s.dpr}</span>`;
  }

  get transition() { return Number(this.transitionEl.value) || 0; }
}
