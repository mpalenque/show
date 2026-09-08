import { createSystemParameters } from '../../vendor/parte2/system/registry.js';
import { createParte2HostAdapter } from '../../vendor/parte2/system/host-adapter.js';
import { PreviewCapture } from '../radiance/PreviewCapture.js';
import { parte2Number } from './scenes.js';
import { prepareDDSCrop } from '../../vendor/parte2/system/dds-gpu-crop.js';

export class Parte2Controller {
  static defineParams(params) {
    for (const spec of createSystemParameters().list()) {
      const def = { ...spec, id: `parte2.${spec.id}`, group: `Parte 2 / ${spec.group}`, sceneReset: false, smooth: 0 };
      if (spec.isAction) params.defineAction(def); else params.define(def);
    }
  }

  constructor(ctx) {
    this.ctx = ctx; this.params = ctx.params;
    this.active = false; this.switching = false; this.generation = 0;
    this.queue = []; this.pendingGPU = 0; this.elapsed = 0;
    this.status = 'idle'; this.error = null; this.subscribedUntil = 0;
    this.canvas = document.createElement('canvas'); this.canvas.id = 'parte2-stage';
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none' });
    document.getElementById('stage').appendChild(this.canvas);
    this.fit = () => {
      this.canvas.style.width = ctx.renderer.domElement.style.width;
      this.canvas.style.height = ctx.renderer.domElement.style.height;
    };
    this.fit();
    this.observer = new MutationObserver(this.fit);
    this.observer.observe(ctx.renderer.domElement, { attributes: true, attributeFilter: ['style'] });
  }
  get ownsFrame() { return this.active || this.switching; }
  post(message) { this.ctx.bridge?.post(message); }
  event(type, data) { this.post({ t: 'parte2:event', type, data }); }

  prepare() {
    if (this.preparing) return this.preparing;
    this.status = 'preparing';
    this.preparing = (async () => {
      this.adapter = await createParte2HostAdapter(this.ctx, {
        canvas: this.canvas, reuseRegistered: true, unregisterOnDispose: false,
        onHostAction: (id, value) => {
          if (id !== 'scene.goto') return false;
          this.ctx.scenes.goto(`parte2:${Number(value ?? this.params.get('parte2.scene.current'))}`, { parte2Manual: true }); return true;
        },
        systemOptions: { restore: true, mediaBase: new URL('./parte2', location.href).pathname,
          onSceneCue: (number, meta) => this.ctx.scenes.goto(`parte2:${Number(number)}`, { parte2Manual: meta.mappingId !== 'vvvv.scene' }),
        },
      });
      const s = this.system = this.adapter.system;
      if (s.engine.device.features.has('texture-compression-bc')) await prepareDDSCrop(s.engine.device);
      // The original scene row stays exportable; the host consumes its cues once.
      s.mapper.autoOsc = false;
      this.unsubscribers = ['mappings', 'learn', 'scenes', 'session', 'catalog', 'control-mode', 'warning', 'error']
        .map(type => s.on(type, data => this.event(type, data)));
      for (const id of ['1a', '3a', '2a', 'splash', 'full1', 'full3', 'full2', 'fullsplash', 'final', 'inkdripping']) s.engine.state(id);
      await s.prepare(1 / 60);
      s.render(0); await s.engine.device.queue.onSubmittedWorkDone();
      this.status = 'ready'; this.error = null;
      return s;
    })().catch(error => { this.preparing = null; this.fail(error); throw error; });
    return this.preparing;
  }

  requestScene(id, options = {}) {
    if (options.parte2Ready) return false;
    const number = parte2Number(id);
    if (number == null) {
      if (this.ownsFrame) {
        this.generation++; this.pending = null; this.queue = [];
        this.system?.mapper.releaseAll(); this.adapter && (this.adapter.accumulator = 0);
        this.active = false; this.switching = false; this.elapsed = 0;
        this.canvas.style.visibility = 'hidden'; this.ctx.renderer.domElement.style.visibility = 'visible';
        this.status = this.system ? 'suspended' : this.status;
      }
      return false;
    }
    if (this.active && this.ctx.scenes.current === id && !options.force) {
      this.applyCue(number, options); return true;
    }
    if (this.pending?.id === id && !options.force) return true;
    const entering = !this.ownsFrame;
    const token = ++this.generation;
    this.pending = { id, token }; this.switching = true;
    this.ctx.mapper?.releaseAll();
    this.ctx.radiance?.requestScene(id);
    this.ctx.renderer.domElement.style.visibility = 'hidden'; this.canvas.style.visibility = 'hidden';
    if (entering) this.queue.push(...(this.ctx.input?.takeRecentParte2() || []));
    this.selection = (async () => {
      await this.prepare(); await this.ctx.engine.whenIdle();
      if (token !== this.generation) return;
      if (entering && !options.parte2Manual) this.system.armMidiShow();
      this.applyCue(number, options);
      this.ctx.scenes.goto(id, { ...options, parte2Ready: true });
      this.ctx.renderer.domElement.style.visibility = 'hidden';
      this.active = true; this.switching = false; this.pending = null; this.status = 'active';
      this.elapsed = 0; this.adapter.accumulator = 0;
      for (const message of this.queue.splice(0)) this.system.dispatchMidi(message);
    })().catch(error => { if (token === this.generation) this.fail(error); });
    return true;
  }

  applyCue(number, options) {
    if (options.parte2Manual) {
      this.system.controlMode = 'manual';
      this.system.params.trigger('scene.goto', number, { source: 'host-editor', hostCue: true });
    } else {
      if (this.system.controlMode !== 'show') this.system.armMidiShow();
      this.system.params.trigger('scene.goto', number, { mappingId: 'vvvv.scene', source: 'host-cue', hostCue: true });
    }
  }
  dispatch(message) {
    if (this.switching) {
      if (this.queue.length >= 512) { this.queue = []; this.system?.mapper.releaseAll(); this.event('warning', 'Se liberaron notas por una cola MIDI demasiado larga durante la carga.'); }
      this.queue.push(message); return [];
    }
    return this.active ? this.system.dispatchMidi(message) : [];
  }
  frame(now, dt) {
    if (!this.active || this.switching || this.system?.failed) return;
    this.elapsed = Math.min(.25, this.elapsed + dt);
    if (this.pendingGPU >= 2) return;
    try {
      this.system.engine.hostMaster = this.params.get('master.brightness');
      this.system.engine.hostBlackout = this.params.get('master.blackout');
      this.adapter.render(this.elapsed); this.elapsed = 0;
      this.pendingGPU++;
      this.system.engine.device.queue.onSubmittedWorkDone().catch(error => this.fail(error)).finally(() => this.pendingGPU--);
      this.canvas.style.visibility = 'visible';
      if (now < this.subscribedUntil && now - (this.lastPreview || 0) >= 500) {
        this.lastPreview = now;
        this.preview ??= new PreviewCapture({ onFrame: blob => this.post({ t: 'parte2:preview', blob }), onError: error => this.event('warning', error.message) });
        this.preview.capture(this.canvas);
      }
    } catch (error) { this.fail(error); }
  }
  fail(error) {
    this.generation++; this.pending = null; this.queue = [];
    this.error = error.message; this.status = 'error'; this.switching = false;
    this.event('error', { message: error.message, fatal: true }); console.error('[parte2]', error);
  }
  state(full = false) {
    const s = this.system;
    return { active: this.active, status: this.status, error: this.error, currentScene: this.ctx.scenes.current,
      values: s?.params.snapshot(), stats: { ...s?.stats, fps: this.active ? this.ctx.engine.fps : 0 },
      controlMode: s?.controlMode, midiInputs: this.ctx.midi?.list() || [],
      osc: { connected: this.ctx.osc?.connected, port: this.ctx.osc?.udpPort },
      ...(full && s ? { registry: s.params.list(), manifest: s.manifest, session: s.exportSession() } : {}),
    };
  }
  tick(now) {
    if (now > this.subscribedUntil || now - (this.lastState || 0) < 250) return;
    this.lastState = now; this.post({ t: 'parte2:state', state: this.state() });
  }
  async receive(message) {
    try {
      this.subscribedUntil = performance.now() + 4000;
      if (message.t === 'parte2:ping') return;
      await this.prepare();
      const s = this.system;
      if (message.t === 'parte2:hi') { this.post({ t: 'parte2:hello', state: this.state(true) }); return; }
      if (message.t !== 'parte2:call') return;
      const args = message.args || [];
      let result;
      switch (message.method) {
        case 'set':
          if (args[0] === 'scene.current') this.ctx.scenes.goto(`parte2:${Number(args[1])}`, { parte2Manual: true });
          else this.params.set(`parte2.${args[0]}`, args[1]);
          break;
        case 'trigger': this.params.trigger(`parte2.${args[0]}`, args[1]); break;
        case 'dispatchMidi': this.ctx.input.dispatch(args[0]); break;
        case 'setMappings': result = s.mapper.setMappings(args[0], { persist: true }); break;
        case 'learn': this.ctx.mapper.learn(null); result = s.mapper.learn(args[0]); break;
        case 'learnTarget': this.ctx.mapper.learn(null); result = s.mapper.learnTarget(...args); break;
        case 'cancelLearn': s.mapper.cancelLearn(); break;
        case 'resetMappings': result = s.mapper.resetToDefault(); break;
        case 'exportSession': result = s.exportSession(); break;
        case 'importSession': result = s.importSession(args[0]); this.event('session', s.exportSession()); break;
        case 'saveScene': s.saveScene(...args); break;
        case 'recallScene': this.ctx.scenes.goto(`parte2:${Number(args[0])}`, { parte2Manual: true }); break;
        case 'runLook':
          this.ctx.scenes.goto(`parte2:${Math.min(80, Math.max(60, s.params.get('scene.current')))}`, { parte2Manual: true });
          await this.selection; await this.ctx.engine.whenIdle(); s.runLook(args[0]); break;
        case 'useVvvvMidi': s.armMidiShow(); break;
        case 'reset': await this.ctx.engine.whenIdle(); s.reset(); break;
        case 'remapMedia': result = await s.remapMedia(args[0]); break;
        case 'capture': result = await s.capture(); break;
        case 'connectMidi': result = await this.ctx.midi.init(); break;
        case 'setEnabled': this.ctx.midi.setEnabled(args[0]); break;
        case 'connectOSC': this.ctx.osc.connect(); break;
        case 'configureOSC': this.ctx.osc.setPort(Number(args[0])); break;
        default: throw new Error('Comando Parte 2 desconocido');
      }
      this.post({ t: 'parte2:reply', requestId: message.requestId, result });
    } catch (error) {
      this.post({ t: 'parte2:reply', requestId: message.requestId, error: error.message });
    }
  }
  dispose() {
    this.generation++; this.active = false; this.switching = false;
    this.system?.mapper.releaseAll(); this.preview?.dispose(); this.observer.disconnect();
    this.unsubscribers?.forEach(off => off()); this.adapter?.dispose(); this.canvas.remove();
  }
}
