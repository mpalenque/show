import { MilkyEngine } from '../engine.js';
import { PRESETS } from '../presets.js';
import { FINAL_NUMBERS } from './parameters.js';
import { createSystemParameters } from './registry.js';
import { MidiInput, normalizeMidiMessage, VVVV_MIDI_PORT } from './midi.js';
import { Mapper, DEFAULT_MAPPINGS } from './mappings.js';
import { createParameterMappings } from './parameter-midi.js';
import { validateSession } from './session.js';
import { armOriginalMidi, isOriginalShowNote } from './show-midi.js';
import { DISPLAY_PROFILE, migrateDisplayProfile } from './display-profile.js';
import { DDSLibrary, SequenceDeck } from './dds-player.js';
import { Compositor, COMPOSITION_PARAMETERS, cloneCompositionDefaults, sceneComposition, snareComposition } from './compositor.js';

const A_IDS = ['1a', '3a', '2a', 'splash'];
const DECK_IDS = ['player.full', ...Array.from({ length: 6 }, (_, i) => `players.${i}`)];
const STORAGE = 'parte2.session.v1';
const COMP_ALIASES = {
  'fullVideo.opacity': 'mix.fullVideo', 'fullMilky.opacity': 'mix.fullMilky',
  'ink.opacity': 'ink.opacity', 'ink.enabled': 'ink.enabled',
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [
    [`stripes.videoOpacity.${i}`, `mix.stripes.${i}.video`],
    [`stripes.milkyOpacity.${i}`, `mix.stripes.${i}.milky`],
  ]).flat()),
};
const setPath = (object, path, value) => {
  const keys = path.split('.'); let at = object;
  for (const key of keys.slice(0, -1)) at = at[key];
  at[keys.at(-1)] = value;
};

export class Parte2System {
  static async create(canvas, options = {}) {
    const system = new Parte2System(canvas, options);
    await system.init(); return system;
  }
  constructor(canvas, options = {}) {
    const { storage = globalThis.localStorage, restore = true, autoStart = true, hosted = false } = options;
    this.options = options; this.hosted = hosted;
    this.controlMode = 'manual';
    this.canvas = canvas; this.storage = storage; this.restore = restore; this.autoStart = !hosted && autoStart;
    this.params = createSystemParameters(); this.listeners = new Map(); this.errors = []; this.warnings = [];
    this.frames = 0; this.time = 0; this.accumulator = 0; this.pending = 0; this.lastTime = 0;
    this.pausedForTest = false; this.dirty = true; this.destroyed = false; this.failed = false;
    this.stats = { fps: 0, frame: 0, gpu: '', cpuMs: 0, passes: 0, pending: 0 };
    this.sceneSnapshots = {}; this.mediaLoading = false; this.rng = 0x638126ad; this.outputStreams = new Set();
    this.fullVideoFade = 0; this.sceneEntered = 0;

  }
  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback); return () => this.listeners.get(type)?.delete(callback);
  }
  emit(type, data) { for (const fn of this.listeners.get(type) || []) fn(data); }
  error(error, fatal = false) {
    const message = error?.message || String(error);
    this.errors.push(message); if (this.errors.length > 50) this.errors.shift();
    if (fatal) this.failed = true;
    this.emit('error', { message, fatal });
  }
  warning(message) { if (!this.warnings.includes(message)) this.warnings.push(message); this.emit('warning', { message }); }
  async init() {
    const gpu = this.options.gpu || this.options;
    const createEngine = async () => {
      if (!gpu.device) return MilkyEngine.create(this.canvas, error => this.error(error, true));
      if (!gpu.adapter) throw new Error('La integración GPU necesita el adaptador y el device del host');
      const engine = new MilkyEngine(this.canvas, gpu.adapter, gpu.device, error => this.error(error, true), { ownsDevice: false });
      await engine.init(); return engine;
    };
    const [engine, response] = await Promise.all([
      createEngine(), fetch(`${this.options.mediaBase || ''}/api/catalog`),
    ]);
    this.engine = engine;
    engine.mediaBase = this.options.mediaBase || "";
    if (!response.ok) throw new Error(`No se pudo leer el catálogo DDS (${response.status})`);
    this.manifest = await response.json();
    const { FULL_PRESETS } = await import('./full-presets.js');
    this.fullPresets = FULL_PRESETS;
    engine.registerPreset({ id: 'inkdripping', name: 'INK dripping 2', inkOnly: true });
    engine.settings.ink = { attack: 15, decay: 1, hideBrush: true };
    for (const preset of FULL_PRESETS) engine.registerPreset(preset);
    this.library = new DDSLibrary(engine, this.manifest);
    this.decks = DECK_IDS.map((id, i) => new SequenceDeck(this.library, { clipId: this.manifest.clips[i].id }));
    this.compositor = await new Compositor(engine).init();
    this.stats.gpu = engine.gpuName;
    this.mapper = new Mapper({ storage: this.storage,
      defaults: [...DEFAULT_MAPPINGS, ...createParameterMappings(this.params.list())],
      onControl: (id, value, meta) => this.applyControl(id, value, meta),
      onAction: (id, value, meta) => this.params.trigger(id, value, meta),
      getValue: id => this.params.get(id), getScene: () => this.params.get('scene.current'),
      getDefinition: id => this.params.def(id), hasAction: id => this.params.actions.has(id),
      onEvent: (type, payload) => this.emit(type, payload),
    });
    await this.mapper.init();
    if (this.hosted) {
      // Upgrade the inherited factory scene range only; keep learned sources.
      const rows = this.mapper.list();
      for (const row of rows) if (row.id === 'vvvv.scene' && row.source?.kind === 'note' && row.source.channel === 10
        && row.source.noteRange?.[0] === 0 && row.source.noteRange?.[1] === 71) {
        row.source.noteRange = [60, 80]; row.label = 'Parte 2 — canal 10 / notas 60–80';
      }
      this.mapper.setMappings(rows);
      this.mapper.defaults = this.mapper.defaults.map(row => row.id === 'vvvv.scene'
        ? { ...row, source: { ...row.source, noteRange: [60, 80] }, label: 'Parte 2 — canal 10 / notas 60–80' } : row);
    }
    this.midi = new MidiInput({ storage: this.storage, preferredName: VVVV_MIDI_PORT,
      onMessage: msg => this.receiveMidi(msg),
      onDevices: inputs => this.emit('devices', inputs),
      onEvent: (type, data) => { if (type === 'error') this.warning(data.message); this.emit(`midi-${type}`, data); },
    });
    if (this.restore) {
      try {
        const data = JSON.parse(this.storage?.getItem(STORAGE) || 'null');
        if (data?.version === 1) {
          const restored = validateSession(migrateDisplayProfile({ ...data, system: 'parte2' }), this.params);
          this.params.apply(restored.parameters);
          this.sceneSnapshots = restored.scenes;
        }
      } catch (error) { this.warning(`No se restauró la sesión guardada: ${error.message}`); }
    }
    this.params.onChange((id, value, meta) => this.parameterChanged(id, value, meta));
    this.params.onAction((id, value, meta) => this.action(id, value, meta));
    for (const [id, value] of Object.entries(this.params.snapshot())) this.parameterChanged(id, value, { initializing: true });
    this.resize();
    if (this.options.showMidi && !this.hosted) { this.armMidiShow(); this.midi.usePreferredInput(); }
    if (!this.hosted && this.options.connectOSC !== false) this.connectOSC();
    if (!this.hosted && this.options.bridge !== false) this.createBridge();
    this.compositor.loadOverlay(`${engine.mediaBase}/assets/part2-overlay.png`).catch(error => this.warning(error.message));
    this._visibility = () => { this.lastTime = 0; this.accumulator = 0; this.dirty = true; };
    document.addEventListener('visibilitychange', this._visibility);
    this._lastStatsTime = performance.now(); this._lastStatsFrame = this.frames;
    if (this.autoStart) this.startLoop();
    // Match Parte 1: request Web MIDI at startup, including when permission is
    // still "prompt". Do not block the render/UI while Chrome asks for access.
    if (!this.hosted && this.options.connectMidi !== false) this.connectMidi().catch(() => {});
    return this;
  }
  applyControl(id, value, meta = {}) {
    if (meta.normalized) this.params.setNormalized(id, value, meta);
    else this.params.set(id, value, meta);
  }
  parameterChanged(id, value, meta = {}) {
    const e = this.engine; this.dirty = true;
    if (id.startsWith('final.')) {
      const key = id.slice(6);
      if (key === 'inkProgress') {
        if (!meta.initializing) this.params.set('final.inkAuto', false, { ...meta, derived: true });
        if (!this.params.get('final.inkAuto')) e.settings.final.inkProgress = value;
      } else if (key === 'inkAuto') e.settings.final.inkProgress = value ? null : this.params.get('final.inkProgress');
      else e.settings.final[key] = value;
    }
    if (id.startsWith('ink.')) e.settings.ink[id.slice(4)] = value;
    if (id === 'milky.autoSeed') e.settings.autoSeed = value;
    if (id === 'milky.warp') e.settings.warp = value;
    if (id === 'milky.detail') e.settings.detail = value;
    if (id === 'milky.full.preset') {
      if (e.extraPresets.has(value)) e.state(value).fullSelected = true;
    }
    const effect = /^milky\.(1a|3a|2a|splash|full1|full3|full2|fullsplash)\.(.+)$/.exec(id);
    if (effect) {
      const [, preset, property] = effect;
      const vector = /^(direction|secondaryDirection)(X|Y)$/.exec(property);
      if (vector) {
        const source = e.extraPresets.get(preset) || PRESETS.find(p => p.id === preset);
        const array = [...(e.settings.presetOverrides[preset]?.[vector[1]] || source[vector[1]])];
        array[vector[2] === 'Y' ? 1 : 0] = value; e.updatePreset(preset, { [vector[1]]: array });
        if (e.states.has(preset)) e.states.get(preset)[vector[1]] = [...array];
      } else e.updatePreset(preset, { [property]: value });
    }
    if (id === 'media.fallback') for (let i = 0; i < DECK_IDS.length; i++) this.applyDeckClip(i);
    for (let i = 0; i < DECK_IDS.length; i++) {
      const prefix = DECK_IDS[i] + '.';
      if (!id.startsWith(prefix)) continue;
      const key = id.slice(prefix.length), deck = this.decks[i];
      if (key === 'clip') this.applyDeckClip(i, value);
      else if (key === 'seek') { if (!meta.initializing) deck.seek(value); }
      else deck[key === 'slow' ? 'masLento' : key] = value;
    }
    if (id === 'scene.current') {
      this.mapper?.onSceneChange(value);
      this.sceneEntered = this.time; this.emit('scene', value);
    }
    if (id === 'mix.fullVideo' && value > 0 && !meta.initializing) this.params.set('composition.fullVideo.enabled', true, { derived: true });
    if (id === 'mix.fullMilky' && value > 0 && !meta.initializing) this.params.set('composition.fullMilky.enabled', true, { derived: true });
    if (id === 'output.resolution' && !meta.initializing) this.resize();
    if (!meta.initializing && !meta.transient && !this.params.def(id).transient) this.scheduleSave();
    this.emit('values', { [id]: value });
  }
  /** The public parameter keeps the clip the show asked for (MIDI velocity, UI,
   * session). The deck plays it when its media is complete; otherwise, while
   * media.fallback is on, it plays the deterministic substitute chosen by
   * DDSLibrary.substitute(). This is a TEMPORARY measure for the 56 missing
   * catalog clips; restoring the DDS files makes every deck play its own clip
   * again without touching parameters, mappings or sessions. */
  applyDeckClip(index, requested = this.params.get(DECK_IDS[index] + '.clip'), { force = false } = {}) {
    const deck = this.decks[index];
    const wanted = this.library.clip(Number(requested));
    if (!deck || !wanted) return null;
    const target = (this.params.get('media.fallback') && this.library.substitute(wanted.id)) || wanted;
    const changed = deck.substituteFor !== (target.index !== wanted.index ? wanted.index : null);
    deck.requestedClipIndex = wanted.index;
    deck.substituteFor = target.index !== wanted.index ? wanted.index : null;
    if (force || deck.clipId !== target.id) deck.setClip(target.id);
    if (changed || force) this.emit('deck-clip', { deck: DECK_IDS[index], index, requested: wanted.index, playing: target.index, substitute: deck.substituteFor != null });
    return target;
  }
  action(id, value, meta = {}) {
    const e = this.engine;
    if (id === 'scene.goto') {
      if (this.options.onSceneCue && !meta.hostCue) { this.options.onSceneCue(value, meta); return; }
      const originalCue = meta.mappingId === 'vvvv.scene';
      if (originalCue) this.lastMidiScene = Number(value);
      this.params.set('scene.current', Number(value), meta);
      if (originalCue && this.controlMode === 'show') this.params.set('scene.automation', true, meta);
      else this.recallScene(Number(value), false);
    }
    else if (id === 'transport.start') { this.reset(); this.params.set('transport.playing', true, meta); }
    else if (id === 'transport.continue') this.params.set('transport.playing', true, meta);
    else if (id === 'transport.stop') this.params.set('transport.playing', false, meta);
    else if (id === 'transport.reset') this.reset();
    else if (id === 'transport.position') {
      const seconds = Number(value) * 60 / this.params.get('transport.bpm');
      for (const deck of this.decks) deck.seek(deck.duration ? (seconds % deck.duration) / deck.duration : 0);
    } else if (id === 'output.blackoutToggle') this.params.set('output.blackout', !this.params.get('output.blackout'), meta);
    else if (id === 'final.explode') {
      this.params.set('final.inkAuto', true, meta); this.params.set('final.button', true, meta);
      e.trigger('seed', ['final']);
    } else if (id === 'milky.seed') e.trigger('seed', this.activeEffects());
    else if (id === 'kick') e.trigger('kick', this.activeEffects());
    else if (id === 'snare') {
      // Sustained SNARE ALL updates random controls per evaluation below.
      if (!this.params.get('events.snareHeld')) this.snare();
    } else if (id === 'ink.trigger') {
      this.inkTriggerTime = this.time;
      this.inkState = e.state('inkdripping');
      this.inkState.inkHoldUntil = this.inkState.time + this.params.get('ink.hold');
      this.inkState.growthResetUntil = this.inkState.time + this.params.get('ink.resetHold');
      this.params.set('ink.hideBrush', this.random() >= .5, { source: 'ink', transient: true });
    }
    this.dirty = true; this.emit('action', { id, value, meta });
  }
  random() { let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0; return this.rng / 4294967296; }
  snare() {
    this.engine.trigger('snare', this.activeEffects());
    const p = this.compositionParams(); snareComposition(p, () => this.random());
    for (let i = 0; i < 6; i++) {
      this.params.set(`composition.stripes.rotations.${i}`, p.stripes.rotations[i], { source: 'snare', transient: true });
      this.params.set(`composition.stripes.flips.${i}`, p.stripes.flips[i], { source: 'snare', transient: true });
    }
  }
  activeEffects() {
    const ids = new Set(), p = this.params;
    const full = p.get('milky.full.preset');
    const automation = p.get('scene.automation') && sceneComposition(p.get('scene.current'), p.get('events.kickWarp'));
    if (p.get('mix.fullMilky') > 0 || p.get('composition.warp.enabled') || automation?.warpEnabled) ids.add(full);
    for (let i = 0; i < 6; i++) if (p.get(`mix.stripes.${i}.milky`) > 0) ids.add(A_IDS[p.get(`milky.stripes.${i}.preset`)]);
    const view = p.get('output.preview');
    if (A_IDS.includes(view)) ids.add(view);
    if (view === 'fullMilky') ids.add(full);
    if (['ink', 'distort'].includes(view)) ids.add('final');
    if (p.get('ink.enabled') || automation?.inkEnabled || this.engine.states.has('inkdripping')) ids.add('inkdripping');
    return [...ids];
  }
  compositionParams() {
    const result = cloneCompositionDefaults();
    for (const spec of COMPOSITION_PARAMETERS) {
      setPath(result, spec.path, this.params.get(COMP_ALIASES[spec.path] || `composition.${spec.path}`));
    }
    if (this.params.get('scene.automation')) {
      const automation = sceneComposition(this.params.get('scene.current'), this.params.get('events.kickWarp'));
      result.warp.enabled = automation.warpEnabled;
      result.ink.enabled = automation.inkEnabled;
      // Decay -> HSV.Value -> Quad.Color changes RGB; the video gate owns alpha.
      result.fullVideo.brightness *= this.fullVideoFade;
      this.engine.settings.final.sceneGate = this.params.get('scene.current') >= 69 && this.params.get('scene.current') <= 80;
    } else this.engine.settings.final.sceneGate = true;
    return result;
  }
  resize() {
    const [width, height] = this.params.get('output.resolution').split('x').map(Number);
    this.width = width; this.height = height;
    this.canvas.width = width; this.canvas.height = height;
    this.engine.setResolution(Math.round(width / 4.8), Math.round(width / 3));
    this.compositor.resize(width, height);
    this.output?.texture.destroy(); this.engine.bindCache.clear();
    this.output = this.engine.texture('system-output', width, height, 'rgba8unorm', false);
    this.fullMix?.texture.destroy(); this.fullMix = null;
    this.dirty = true;
  }
  async prepare(dt = 1 / 60) {
    await this.engine.prepare(this.activeEffects(), dt);
    await Promise.allSettled(this.decks.map(deck => {
      const frame = deck._pendingAdvance?.frame ?? deck.frame;
      return this.library.isAvailable(deck.clipId, frame) ? this.library.get(deck.clipId, frame) : Promise.resolve();
    }));
  }
  render(steps = 1, dt = 1 / 60) {
    const started = performance.now(), e = this.engine;
    const ids = this.activeEffects(), states = ids.map(id => e.state(id));
    let p = this.compositionParams();
    e.settings.externalSeeds = {};
    const input = this.decks[0].texture;
    if (input && (!this.fullInput || this.fullInput.width !== input.width || this.fullInput.height !== input.height)) {
      this.fullInput?.texture.destroy(); e.bindCache.clear();
      this.fullInput = e.texture('full-wrapper-input', input.width, input.height, 'rgba8unorm', false);
    }
    // Context initialization uses separate command buffers; create all needed
    // resources before recording the live render so histories are initialized.
    e.begin();
    if (input) {
      e.pass('hscb', this.fullInput, input, e.dummy, [0, 1, this.params.get('milky.full.ddsContrast'), 0]);
      if (this.params.get('milky.externalSeed')) e.settings.externalSeeds[this.params.get('milky.full.preset')] = this.fullInput;
    }
    for (let step = 0; step < steps; step++) {
      for (const deck of this.decks) deck.update(dt);
      if (this.params.get('events.snareHeld')) this.snare();
      for (const state of states) e.step(state, dt);
      if (this.params.get('scene.automation')) {
        const rising = this.params.get('scene.current') >= 67;
        const duration = this.params.get(rising ? 'mix.fullVideoAttack' : 'mix.fullVideoDecay');
        this.fullVideoFade = duration <= 0 ? Number(rising) : Math.min(1, Math.max(0, this.fullVideoFade + (rising ? dt : -dt) / duration));
      }
      this.time += dt; this.frames++; e.frame++;
    }
    if (!steps) for (const deck of this.decks) deck.update(0);
    const fullId = this.params.get('milky.full.preset');
    let fullMilky = e.states.get(fullId)?.output;
    if (this.params.get('milky.full.bypass')) fullMilky = this.fullInput;
    else if (fullMilky && input && this.params.get('milky.full.ddsBlend') > 0) {
      if (!this.fullMix || this.fullMix.width !== fullMilky.width || this.fullMix.height !== fullMilky.height) {
        this.fullMix?.texture.destroy(); e.bindCache.clear();
        this.fullMix = e.texture('full-wrapper-mix', fullMilky.width, fullMilky.height, 'rgba8unorm', false);
      }
      e.pass('blend', this.fullMix, fullMilky, this.fullInput, [this.params.get('milky.full.ddsBlend'), 2]); fullMilky = this.fullMix;
    }
    p = this.compositionParams();
    const finalState = e.states.get('final');
    this.inkState = e.states.get('inkdripping');
    const composed = this.compositor.render({ fullVideo: this.decks[0].texture, fullMilky,
      stripes: Array.from({ length: 6 }, (_, i) => ({ video: this.decks[i + 1].texture, milky: e.states.get(A_IDS[this.params.get(`milky.stripes.${i}.preset`)])?.output })),
      inkDripping: this.inkState?.output, params: p });
    const view = this.params.get('output.preview');
    let source = view === 'fullVideo' ? this.decks[0].texture : view === 'fullMilky' ? fullMilky
      : view === 'ink' ? finalState?.inkInput : view === 'distort' ? finalState?.distort
      : /^deck[0-5]$/.test(view) ? this.decks[Number(view.at(-1)) + 1].texture
      : A_IDS.includes(view) ? e.states.get(view)?.output : composed;
    source ||= e.dummy;
    const master = this.params.get('output.blackout') || e.hostBlackout ? 0 : this.params.get('output.master') * (e.hostMaster ?? 1);
    const scale = Math.min(this.width / source.width, this.height / source.height);
    const width = view === 'composition' ? 1 : source.width * scale / this.width;
    const height = view === 'composition' ? 1 : source.height * scale / this.height;
    e.pass('comp_normal', this.output, source, e.dummy,
      [.5, .5, width, height, 1, 1, 0, 1, 0, 0, 0, 0, master, master, master, 0], { sourceMip: 0 });
    e.pass('display', null, this.output, e.dummy, [], { view: e.context.getCurrentTexture().createView() });
    e.device.queue.writeBuffer(e.uniformBuffer, 0, e.uniformData.buffer, 0, e.passCount * 256);
    e.device.queue.submit([e.encoder.finish()]);
    this.stats = { ...this.stats, frame: this.frames, cpuMs: performance.now() - started,
      passes: e.passCount, gpu: e.gpuName, size: [this.width, this.height], media: { ...this.library.stats },
      effects: [...e.states].map(([id, state]) => ({ id, frames: state.frame })),
      decks: this.decks.map(deck => ({ clip: deck.clipId, frame: deck.frame, position: deck.position, status: deck.status, error: deck.error,
        requestedClip: deck.requestedClipIndex ?? deck.clip?.index ?? null, substitute: deck.substituteFor != null })) };
    this.dirty = false;
  }
  startLoop() {
    if (this.raf) return;
    const loop = now => {
      this.raf = requestAnimationFrame(loop);
      if (this.destroyed || this.failed || this.pausedForTest) return;
      const rate = this.params.get('transport.rate'), dt = 1 / rate;
      const elapsed = this.lastTime ? Math.min(.25, (now - this.lastTime) / 1000) : dt; this.lastTime = now;
      if (this.params.get('transport.playing') && !document.hidden) this.accumulator += elapsed;
      if (this.pending >= 2) return;
      const steps = Math.min(4, Math.floor((this.accumulator + 1e-7) / dt));
      this.accumulator -= steps * dt;
      if (this.accumulator > .25) { this.stats.dropped = (this.stats.dropped || 0) + Math.floor(this.accumulator / dt); this.accumulator = 0; }
      if (steps || this.dirty || this.library.pending.size) {
        try {
          this.render(steps, dt); this.pending++;
          this.engine.device.queue.onSubmittedWorkDone().then(() => this.pending--).catch(error => this.error(error, true));
        } catch (error) { this.error(error, true); }
      }
      if (now - this._lastStatsTime >= 500) {
        this.stats.fps = (this.frames - this._lastStatsFrame) * 1000 / (now - this._lastStatsTime);
        this._lastStatsTime = now; this._lastStatsFrame = this.frames;
        this.emit('stats', this.stats);
        this.bus?.postMessage({ t: 'stats', ...this.stats });
      }
    };
    this.raf = requestAnimationFrame(loop);
  }
  async step(count = 1) {
    this.pausedForTest = true; this.params.set('transport.playing', false);
    const dt = 1 / this.params.get('transport.rate');
    try {
      for (let i = 0; i < count; i++) { await this.prepare(dt); this.render(1, dt); await this.engine.device.queue.onSubmittedWorkDone(); }
    } finally { this.pausedForTest = false; this.accumulator = 0; this.lastTime = 0; this.emit('stats', this.stats); }
  }
  reset() {
    this.engine.reset(); for (const deck of this.decks) deck.seek(deck.reverse ? deck.end : deck.start);
    this.inkState = null;
    this.time = 0; this.frames = 0; this.fullVideoFade = 0; this.accumulator = 0; this.rng = 0x638126ad; this.dirty = true;
  }
  runLook(name) {
    this.controlMode = 'manual'; this.emit('control-mode', 'manual');
    this.params.set('scene.automation', false);
    this.params.set('output.preview', 'composition'); this.params.set('output.blackout', false);
    this.params.set('mix.fullMilky', name === 'final' ? 1 : 0);
    this.params.set('mix.fullVideo', name === 'fullDDS' || name === 'mixed' ? 1 : 0);
    this.params.set('ink.enabled', false);
    if (name === 'final') {
      this.params.set('milky.full.preset', 'final'); this.params.set('final.button', true);
      this.params.set('final.loop', true); this.params.set('final.inkAuto', true);
    }
    for (let i = 0; i < 6; i++) {
      this.params.set(`mix.stripes.${i}.video`, name === 'sixDDS' ? 1 : 0);
      this.params.set(`mix.stripes.${i}.milky`, name === 'sixMilky' || name === 'mixed' ? 1 : 0);
    }
    this.dirty = true;
  }
  async connectMidi() { const devices = await this.midi.init(); this.emit('devices', devices); return devices; }
  armMidiShow() { armOriginalMidi(this); }
  async useVvvvMidi() {
    this.armMidiShow(); this.midi.usePreferredInput(VVVV_MIDI_PORT);
    return this.connectMidi();
  }
  receiveMidi(message) {
    if (this.options.followOriginalMidi !== false && this.mapper.learnRow == null && this.controlMode !== 'show' && isOriginalShowNote(message)) this.armMidiShow();
    return this.dispatchMidi(message);
  }
  dispatchMidi(input) {
    const message = Array.isArray(input) || ArrayBuffer.isView(input) ? normalizeMidiMessage(input, { deviceId: 'api' }) : input;
    if (!message) return [];
    const fired = this.mapper.dispatch(message);
    this.emit('midi', { msg: message, fired }); this.bus?.postMessage({ t: 'midi', msg: message, fired });
    return fired;
  }
  connectOSC() {
    this.osc?.close(); this.osc = new EventSource('/api/osc/events');
    this.osc.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.t === 'osc') {
          this.dispatchMidi({ ...message, kind: 'osc' });
        } else { this.oscStatus = message; this.emit('osc', message); }
      } catch (error) { this.warning(error.message); }
    };
    this.osc.onerror = () => { this.oscStatus = { connected: false }; this.emit('osc', this.oscStatus); };
  }
  async configureOSC(port, host = '127.0.0.1') {
    const response = await fetch('/api/osc/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: Number(port), host }) });
    const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || 'No se pudo configurar OSC');
    return data;
  }
  createBridge() {
    this.bus = new BroadcastChannel('parte2-bus');
    this.bus.onmessage = event => {
      const m = event.data;
      try {
        if (m?.t === 'hi') this.bus.postMessage(this.hello());
        else if (m?.t === 'set') this.params.set(m.id, m.value, { source: 'editor' });
        else if (m?.t === 'trigger') this.params.trigger(m.id, m.arg, { source: 'editor' });
        else if (m?.t === 'scene') this.params.trigger('scene.goto', m.id);
        else if (m?.t === 'fakeMidi' || m?.t === 'midiInput') this.dispatchMidi(m.msg);
        else if (m?.t === 'mappings') this.mapper.setMappings(m.mappings, { persist: true });
        else if (m?.t === 'learn') this.mapper.learn(m.rowId);
        else if (m?.t === 'midiInputs') this.midi.setEnabled(m.enabledIds);
      } catch (error) { this.warning(error.message); }
    };
    this.on('values', values => this.bus.postMessage({ t: 'values', values }));
    this.bus.postMessage(this.hello());
  }
  hello() { return { t: 'hello', system: 'parte2', registry: this.params.list(), values: this.params.snapshot(),
    mappings: this.mapper.list(), midiInputs: this.midi.listInputs(), currentScene: this.params.get('scene.current'), scenes: Object.keys(this.sceneSnapshots), osc: this.oscStatus }; }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { this.storage?.setItem(STORAGE, JSON.stringify({ version: 1, displayProfile: DISPLAY_PROFILE, parameters: this.params.snapshot({ persistent: true }), scenes: this.sceneSnapshots })); }
      catch (error) { this.warning(`No se pudo guardar la sesión: ${error.message}`); }
    }, 250);
  }
  exportSession() { return { version: 1, system: 'parte2', displayProfile: DISPLAY_PROFILE, parameters: this.params.snapshot({ persistent: true }), mappings: this.mapper.list(), scenes: this.sceneSnapshots }; }
  importSession(data) {
    const validated = validateSession(migrateDisplayProfile(data), this.params);
    if (validated.mappings) this.mapper.setMappings(validated.mappings, { persist: true });
    this.params.apply(validated.parameters, { source: 'import' });
    this.sceneSnapshots = validated.scenes; this.scheduleSave(); this.emit('session', this.exportSession());
  }
  saveScene(scene = this.params.get('scene.current')) {
    const values = this.params.snapshot({ persistent: true }); delete values['scene.current']; delete values['transport.playing'];
    this.sceneSnapshots[scene] = values; this.scheduleSave(); this.emit('scenes', this.sceneSnapshots);
  }
  recallScene(scene = this.params.get('scene.current'), setScene = true) {
    if (setScene) this.params.set('scene.current', Number(scene));
    if (this.sceneSnapshots[scene]) this.params.apply(this.sceneSnapshots[scene], { source: 'scene' });
    return !!this.sceneSnapshots[scene];
  }
  async remapMedia(body) {
    const response = await fetch(`${this.options.mediaBase || ''}/api/media/remap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo reasignar la secuencia');
    this.manifest = data.manifest || data;
    const old = this.library;
    this.library = new DDSLibrary(this.engine, this.manifest);
    // Re-resolve from the requested parameter, not from a substitute the old library may have chosen.
    this.decks.forEach((deck, i) => { deck.dispose(); deck.library = this.library; this.applyDeckClip(i, undefined, { force: true }); });
    old.dispose(); this.emit('catalog', this.manifest); this.dirty = true;
    return this.manifest;
  }
  async readback() {
    const e = this.engine, width = this.output.width, height = this.output.height;
    const pitch = Math.ceil(width * 4 / 256) * 256;
    const buffer = e.device.createBuffer({ size: pitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = e.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: this.output.texture }, { buffer, bytesPerRow: pitch }, [width, height]);
    e.device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
    const source = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) pixels.set(source.subarray(y * pitch, y * pitch + width * 4), y * width * 4);
    buffer.unmap(); buffer.destroy(); return pixels;
  }
  async capture() {
    const width = this.width, height = this.height, pixels = await this.readback();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  openOutput() {
    const previewScale = Math.min(1, 1344 / this.width);
    const output = window.open('./output.html', 'parte2-output', `popup,width=${Math.round(this.width * previewScale)},height=${Math.round(this.height * previewScale)}`);
    if (!output) throw new Error('El navegador bloqueó la ventana de salida. Habilitá las ventanas emergentes para localhost.');
    return output;
  }
  attachOutputWindow(target) {
    const video = target.document.querySelector('video');
    if (!video) return false;
    const stream = this.canvas.captureStream(60); this.outputStreams.add(stream);
    video.srcObject = stream; video.muted = true; video.play().catch(() => {});
    target.addEventListener('beforeunload', () => { for (const track of stream.getTracks()) track.stop(); this.outputStreams.delete(stream); });
    return true;
  }
  diagnostics() { return { ...this.stats, errors: [...this.errors, ...this.engine.errors], warnings: this.warnings,
    scene: this.params.get('scene.current'), registryCount: this.params.defs.size, mappingCount: this.mapper.list().length,
    catalog: this.manifest.totals, midiInputs: this.midi.listInputs() }; }
  dispose() {
    this.destroyed = true; cancelAnimationFrame(this.raf); clearTimeout(this.saveTimer);
    this.osc?.close(); this.bus?.close(); this.midi?.dispose(); this.mapper?.dispose();
    for (const stream of this.outputStreams) for (const track of stream.getTracks()) track.stop();
    for (const deck of this.decks) deck.dispose();
    this.library.dispose(); this.compositor.dispose(); this.output?.texture.destroy(); this.fullInput?.texture.destroy(); this.fullMix?.texture.destroy(); this.engine.destroy();
    document.removeEventListener('visibilitychange', this._visibility); this.listeners.clear();
  }
}
