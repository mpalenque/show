// BroadcastChannel('vis-bus'): la ventana de salida habla con la del editor.
// La salida es la dueña del estado; el editor solo pide cosas.
export class Bridge {
  constructor(ctx, { midi, osc, mapper } = {}) {
    this.ctx = ctx;
    this.params = ctx.params;
    this.scenes = ctx.scenes;
    this.midi = midi;
    this.osc = osc;
    this.mapper = mapper;
    this.channel = new BroadcastChannel('vis-bus');
    this._lastValues = 0;
    this._lastStats = 0;
    this._midiThrottle = 0;
  }

  init() {
    this.channel.onmessage = (e) => this._onMessage(e.data);
    this.scenes.onSceneChange((id) => this.post({ t: 'scene', id }));
    this.mapper?.on('mappings', (mappings) => this.post({ t: 'mappings', mappings }));
    this.post(this.hello());
  }

  hello() {
    return {
      t: 'hello',
      registry: this.params.list(),
      values: this.params.snapshot(),
      scenes: this.scenes.list(),
      mappings: this.mapper?.mappings ?? [],
      midiInputs: this.midi?.list() ?? [],
      currentScene: this.scenes.current,
      osc: { connected: this.osc?.connected ?? false, udpPort: this.osc?.udpPort ?? 0 },
    };
  }

  post(obj) { this.channel.postMessage(obj); }

  _onMessage(m) {
    if (m?.t?.startsWith('parte2:')) { void this.ctx.parte2?.receive(m); return; }
    if (m?.t?.startsWith('fluids:')) { void this.ctx.radiance?.receive(m); return; }
    switch (m.t) {
      case 'hi': this.post(this.hello()); break;
      // Todo lo que se toca en el editor queda guardado al instante, sin apretar nada.
      case 'set': this.params.set(m.id, m.value); this.ctx.settings?.record(m.id, m.value); break;
      case 'trigger': this.params.trigger(m.id, m.arg); break;
      case 'scene': this.params.trigger('scene.goto', m.id); break;
      case 'mappings': this.mapper?.setMappings(m.mappings); this.mapper?.save(); break;
      case 'learn': this.ctx.parte2?.system?.mapper.cancelLearn(); this.mapper?.learn(m.rowId); break;
      case 'midiInputs': this.midi?.setEnabled(m.enabledIds); break;
      case 'oscPort': this.osc?.setPort(m.port); break;
      case 'fakeMidi': if (this.ctx.input) this.ctx.input.dispatch(m.msg); else this.mapper?.dispatch(m.msg); this.midiActivity(m.msg, true); break;
      case 'save': this.mapper?.save(); break;
      case 'resetSettings': this.ctx.settings?.clear(); break;
      case 'resetMappings': this.mapper?.resetToDefault(); break;
      default: break;
    }
  }

  // Los mensajes de learn no se throttlean (si no, se pierde justo el que se quiere aprender).
  midiActivity(msg, force = false) {
    const now = performance.now();
    const learning = this.mapper?.learnRow != null;
    if (!force && !learning && now - this._midiThrottle < 33) return;
    this._midiThrottle = now;
    this.post({ t: msg.kind === 'osc' ? 'osc' : 'midi', msg, fired: this.mapper?.monitor?.[0]?.fired ?? [] });
  }

  oscStatus(status) { this.post({ t: 'oscStatus', ...status }); }
  midiInputs(list) { this.post({ t: 'midiInputs', midiInputs: list }); }

  // Lo llama el Engine al final de cada frame.
  tick(engine) {
    const now = performance.now();
    this.ctx.radiance?.tick(now);
    this.ctx.parte2?.tick(now);
    if (now - this._lastValues >= 100) {          // valores 10 Hz, solo los que cambiaron
      this._lastValues = now;
      const dirty = this.params.consumeDirty();
      if (dirty) this.post({ t: 'values', values: dirty });
    }
    if (now - this._lastStats >= 500) {           // stats 2 Hz
      this._lastStats = now;
      this.post({
        t: 'stats',
        fps: engine.fps,
        ms: Number(engine.frameMs.toFixed(2)),
        simMs: Number(engine.simMs.toFixed(2)),
        renderMs: Number(engine.renderMs.toFixed(2)),
        particles: engine.sim?.numParticles ?? 0,
        dpr: window.devicePixelRatio,
      });
    }
  }
}
