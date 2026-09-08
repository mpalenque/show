import { MidiClock } from './midi.js';

export const MAPPINGS_VERSION = 3;
export const FULL_PRESET_IDS = ['full1', 'full3', 'full2', 'fullsplash', 'final'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const noop = () => {};
const MODES = new Set(['auto', 'trigger', 'toggle', 'gate', 'velocity', 'set', 'range']);
const SOURCE_KINDS = new Set(['note', 'cc', 'osc', 'transport', 'pitchbend', 'aftertouch', 'polyaftertouch', 'program']);
const SOURCES = 'MIDI SEQ PLAYER.v4p';

/** Defaults are the active player maximus MIDI patch, not MIDI.v4p's unrelated 3D profile. */
export function createDefaultMappings() {
  const rows = [];
  const add = (id, source, target, mode, extra = {}) => rows.push({ id, source, target, mode,
    output: 'control', label: target, sourcePatch: SOURCES, ...extra });
  const note = (channel, number) => ({ kind: 'note', channel, note: number });
  const notes = (channel, numbers) => ({ kind: 'note', channel, notes: numbers });
  const range = (channel, first, last) => ({ kind: 'note', channel, noteRange: [first, last] });
  const gate = { binary: true, offValue: 0 };
  add('vvvv.scene', range(10, 0, 71), 'scene.goto', 'trigger', { output: 'action', valueFrom: 'note',
    label: 'Escena — canal 10 / notas 0–71', sourceNodes: '213 → 4 → 5 → 17 → 72 → 11',
    fidelity: 'OnData release behavior is not verified; default changes scene on note-on only.' });
  for (let i = 0; i < 6; i++) {
    add(`vvvv.video.${i}.clip`, note(13, i), `players.${i}.clip`, 'velocity', {
      min: 0, max: 68, transform: { quantize: 'floor', modulo: 68 },
      label: `Franja ${i + 1} — secuencia`, sourceNodes: '211 → 138 → 135 → 144 → 136 → 137', formula: 'floor(velocity / 127 × 68) % 68' });
    add(`vvvv.video.${i}.gate`, note(13, i), `mix.stripes.${i}.video`, 'gate', {
      ...gate, releaseMs: 20, label: `Franja ${i + 1} — video`, sourceNodes: '211 → 94 → 139 → 115 → 140 → 118' });
    add(`vvvv.milky.${i}.preset`, note(13, i + 6), `milky.stripes.${i}.preset`, 'velocity', {
      min: 0, max: 3, transform: { quantize: 'floor' }, label: `Franja ${i + 1} — preset Milky`,
      sourceNodes: '211 → 116 → 186 → 183 → 185 → 191', formula: 'floor(velocity / 127 × 3)' });
    add(`vvvv.milky.${i}.gate`, note(13, i + 6), `mix.stripes.${i}.milky`, 'gate', {
      ...gate, releaseMs: 80, label: `Franja ${i + 1} — Milky`, sourceNodes: '211 → 116 → 202 → 190 → 119' });
    add(`vvvv.blocks.${i}`, note(7, i + 1), `graphics.blocks.${i}`, 'gate', {
      ...gate, label: `Bloque ${i + 1}`, sourceNodes: '212 → 79 → 73 → 86 → 85' });
  }
  add('vvvv.full.clip', note(13, 12), 'player.full.clip', 'velocity', {
    min: 0, max: 68, transform: { quantize: 'floor', modulo: 68 }, label: 'Video completo — secuencia',
    sourceNodes: '211 → 159 → 162 → 157 → 161 → 160', formula: 'floor(velocity / 127 × 68) % 68' });
  add('vvvv.full.video', note(13, 12), 'mix.fullVideo', 'gate', {
    ...gate, label: 'Video completo — visible', sourceNodes: '211 → 94 → 139 → 123 → 121' });
  add('vvvv.full.milky.preset', note(13, 13), 'milky.full.preset', 'velocity', {
    min: 0, max: 4, edge: 'both', updatedIn: 3, transform: { quantize: 'round', values: FULL_PRESET_IDS }, label: 'Milky completo — preset',
    sourceNodes: '211 → 124 → 125; player maximus: 170 → 219 → 220; 2D/milkyFULL: integer IOBox → Switch',
    fidelity: 'Map ×4 and bank order are exact. Native Float→Integer rounding is unverified; nearest is explicit and editable.' });
  add('vvvv.full.milky.gate', note(13, 13), 'mix.fullMilky', 'gate', {
    ...gate, label: 'Milky completo — visible', sourceNodes: '211 → 124 → 125; player maximus: 170 → LT218' });
  add('vvvv.button', note(1, 0), 'final.button', 'gate', {
    binary: true, onValue: true, offValue: false, label: 'BOTON — mantener', sourceNodes: '214 → 172 → 48.Output1 → 206' });
  add('vvvv.kick1', note(1, 0), 'kick1', 'trigger', {
    output: 'action', edge: 'perNote', label: 'Kick1', sourceNodes: '214 → 32 → 35 → 34.UpEdge → 37' });
  add('vvvv.kick.all', notes(1, [36, 41, 48, 50]), 'kick', 'trigger', {
    output: 'action', edge: 'aggregate', label: 'Kick all — flanco del OR', sourceNodes: '214 → 172 → 48 → 171 → 198.UpEdge → 170' });
  add('vvvv.kick.warp', notes(1, [48, 50]), 'events.kickWarp', 'gate', {
    binary: true, onValue: true, offValue: false, label: 'Kick WARP — OR sostenido', sourceNodes: '214 → 172 → 48 → 176 → 174' });
  add('vvvv.snare.held', notes(1, [37, 42]), 'events.snareHeld', 'gate', {
    binary: true, onValue: true, offValue: false, label: 'Snare all — OR sostenido', sourceNodes: '214 → 172 → 48 → 199 → 200' });
  add('vvvv.snare.edge', notes(1, [37, 42]), 'snare', 'trigger', {
    output: 'action', edge: 'aggregate', label: 'Snare — notificación del primer flanco',
    fidelity: 'Convenience event derived from SNARE ALL; the original signal is the sustained events.snareHeld gate.' });
  add('vvvv.percussion', range(2, 36, 53), 'percussion', 'trigger', {
    output: 'action', edge: 'perNote', label: 'Perc any', sourceNodes: '215 → 40 → 39.UpEdge → 41 → 38' });
  add('vvvv.ink', note(7, 0), 'ink.trigger', 'trigger', {
    output: 'action', edge: 'perNote', label: 'INK', sourceNodes: '212 → 79 → 73.Output1 → 77.UpEdge → 78' });
  for (const number of [1, 2, 4]) add(`vvvv.osc.fx${number}`, { kind: 'osc', address: `/fx${number}` }, `final.fx${number}`, 'set', {
    valueFrom: 'argument', label: `OSC /fx${number}`, sourcePatch: 'player maximus.v4p → osc send.v4p',
    sourceNodes: 'UDP371 port1002 → S+H320 → OSCDecoder → AsValue → S+H → S(Value)',
    formula: 'Numeric argument passed directly, without normalization or clamp.' });
  return rows;
}
export const DEFAULT_MAPPINGS = createDefaultMappings();
const stableJSON = (value) => JSON.stringify(value, function (_key, item) {
  return item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item;
});

export function sourceKey(source) {
  if (!source?.kind) return null;
  if (source.kind === 'note') return `note:${source.channel ?? '*'}:${source.note ?? source.notes?.join(',') ?? source.noteRange?.join('..') ?? '*'}`;
  if (source.kind === 'cc') return `cc:${source.channel ?? '*'}:${source.cc ?? '*'}`;
  if (source.kind === 'osc') return `osc:${source.address}`;
  return `${source.kind}:${source.channel ?? source.command ?? '*'}`;
}
export function describeSource(source) {
  if (!source?.kind) return '(sin asignar)';
  const channel = source.channel == null ? 'cualquier canal' : `ch${source.channel}`;
  if (source.kind === 'note') return `Nota ${source.note ?? source.notes?.join(', ') ?? source.noteRange?.join('–') ?? '*'} · ${channel}`;
  if (source.kind === 'cc') return `CC ${source.cc ?? '*'} · ${channel}`;
  if (source.kind === 'osc') return source.address;
  return `${source.kind} ${source.command ?? ''} ${source.channel ? channel : ''}`.trim();
}
export function matches(source, msg) {
  if (!source || source.kind !== msg.kind) return false;
  if (source.deviceId != null && source.deviceId !== msg.deviceId) return false;
  if (source.channel != null && source.channel !== msg.channel) return false;
  if (source.kind === 'note') return (source.note == null || source.note === msg.note)
    && (!source.notes || source.notes.includes(msg.note))
    && (!source.noteRange || (msg.note >= source.noteRange[0] && msg.note <= source.noteRange[1]));
  if (source.kind === 'cc') return source.cc == null || source.cc === msg.cc;
  if (source.kind === 'osc') return source.address === msg.address;
  if (source.kind === 'transport') return source.command == null || source.command === msg.command;
  return true;
}
function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new TypeError('mappings debe ser un array de hasta 10000 filas.');
  const ids = new Set();
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new TypeError('Cada mapeo necesita un id único.');
    ids.add(row.id);
    if (typeof row.target !== 'string' || !row.target || row.target.length > 200 || /(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(row.target)) throw new TypeError(`Destino inválido: ${row.id}`);
    if (!MODES.has(row.mode ?? 'auto')) throw new TypeError(`Modo inválido: ${row.id}`);
    if (row.output != null && !['control', 'action'].includes(row.output)) throw new TypeError(`output inválido: ${row.id}`);
    const source = row.source;
    if (source != null) {
      if (!SOURCE_KINDS.has(source.kind)) throw new TypeError(`Fuente inválida: ${row.id}`);
      if (source.channel != null && !integer(source.channel, 1, 16)) throw new TypeError(`Canal inválido: ${row.id}`);
      if (source.note != null && !integer(source.note, 0, 127)) throw new TypeError(`Nota inválida: ${row.id}`);
      if (source.cc != null && !integer(source.cc, 0, 127)) throw new TypeError(`CC inválido: ${row.id}`);
      if (source.notes && (!Array.isArray(source.notes) || !source.notes.length || source.notes.some((n) => !integer(n, 0, 127)))) throw new TypeError(`Notas inválidas: ${row.id}`);
      if (source.noteRange && (!Array.isArray(source.noteRange) || source.noteRange.length !== 2 || source.noteRange.some((n) => !integer(n, 0, 127)) || source.noteRange[0] > source.noteRange[1])) throw new TypeError(`Rango de notas inválido: ${row.id}`);
      if (source.kind === 'osc' && (typeof source.address !== 'string' || !source.address.startsWith('/'))) throw new TypeError(`Ruta OSC inválida: ${row.id}`);
    }
    for (const key of ['min', 'max', 'releaseMs']) if (row[key] != null && (!Number.isFinite(row[key]) || (key === 'releaseMs' && (row[key] < 0 || row[key] > 60000)))) throw new TypeError(`${key} inválido: ${row.id}`);
    if (row.scenes != null && (!Array.isArray(row.scenes) || row.scenes.some((s) => !['string', 'number'].includes(typeof s)))) throw new TypeError(`Escenas inválidas: ${row.id}`);
    if (row.in != null && (!Array.isArray(row.in) || row.in.length !== 2 || row.in.some((v) => !Number.isFinite(v)))) throw new TypeError(`Intervalo OSC inválido: ${row.id}`);
    if (row.transform?.modulo != null && !(Number.isFinite(row.transform.modulo) && row.transform.modulo > 0)) throw new TypeError(`Módulo inválido: ${row.id}`);
    if (row.transform?.quantize != null && !['floor', 'round', 'ceil'].includes(row.transform.quantize)) throw new TypeError(`Cuantización inválida: ${row.id}`);
    if (row.transform?.values != null && (!Array.isArray(row.transform.values) || !row.transform.values.length)) throw new TypeError(`Valores inválidos: ${row.id}`);
  }
  return clone(rows);
}

/** Engine-independent mapper. All state writes go through the two supplied callbacks. */
export class Mapper {
  constructor({ onControl = noop, onAction = noop, getValue = () => undefined,
    getScene = () => undefined, getDefinition = () => undefined, hasAction = () => false,
    onEvent = noop, storage = globalThis.localStorage, storageKey = 'parte2.mappings',
    defaults = DEFAULT_MAPPINGS, autoOsc = true,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = (id) => globalThis.clearTimeout(id) } = {}) {
    Object.assign(this, { onControl, onAction, getValue, getScene, getDefinition, hasAction,
      onEvent, storage, storageKey, autoOsc, setTimer, clearTimer });
    this.defaults = validateRows(defaults);
    this.mappings = [];
    this.states = new Map();
    this.listeners = new Map();
    this.monitor = [];
    this.learnRow = null;
    this.currentScene = undefined;
    this.clock = new MidiClock();
    this.setMappings(this.defaults);
  }
  async init() {
    try {
      const saved = this.storage?.getItem(this.storageKey);
      if (saved) {
        const document = JSON.parse(saved);
        const rows = validateRows(Array.isArray(document) ? document : document.mappings);
        // Version 2 adds the explicitly separate public-control profile. Keep
        // every existing assignment and append only newly introduced web rows.
        const version = Array.isArray(document) ? MAPPINGS_VERSION : document.version ?? 1;
        if (version < 2) {
          const ids = new Set(rows.map((row) => row.id));
          for (const row of this.defaults) if ((row.id.startsWith('web.cc.') || row.id.startsWith('web.note.')) && !ids.has(row.id)) rows.push(clone(row));
        }
        if (version < 3) {
          const corrected = DEFAULT_MAPPINGS.find((row) => row.id === 'vvvv.full.milky.preset');
          const previous = clone(corrected); delete previous.edge; delete previous.updatedIn;
          const index = rows.findIndex((row) => row.id === corrected.id);
          // Only untouched factory rows are migrated. A learned source, custom
          // transform, scene filter, label or explicitly chosen edge survives.
          if (index >= 0 && stableJSON(rows[index]) === stableJSON(previous)) rows[index] = clone(corrected);
        }
        this.setMappings(rows, { persist: version < MAPPINGS_VERSION });
      }
    } catch (error) { this._emit('warning', { message: 'Mapeos guardados inválidos; se usan los defaults.', error }); }
    return this.list();
  }
  list() { return clone(this.mappings); }
  setMappings(rows, { persist = false } = {}) {
    const validated = validateRows(rows); // Validate before releasing or mutating current mappings.
    this.releaseAll();
    this.mappings = validated;
    if (persist) this.save();
    this._emit('mappings', this.list());
    return this.list();
  }
  save() {
    try { this.storage?.setItem(this.storageKey, this.exportJson()); return true; }
    catch (error) { this._emit('warning', { message: 'No se pudieron guardar los mapeos.', error }); return false; }
  }
  exportJson() { return JSON.stringify({ version: MAPPINGS_VERSION, profile: 'parte2', mappings: this.mappings }, null, 2); }
  importJson(json, { persist = true } = {}) {
    const document = typeof json === 'string' ? JSON.parse(json) : json;
    const rows = Array.isArray(document) ? document : document?.mappings;
    return this.setMappings(rows, { persist });
  }
  resetToDefault() { this.cancelLearn(); return this.setMappings(this.defaults, { persist: true }); }
  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }
  _emit(type, payload) {
    this.onEvent(type, payload);
    for (const callback of this.listeners.get(type) ?? []) callback(payload);
  }
  onSceneChange(id) {
    this.currentScene = id;
    for (const row of this.mappings) if (!this._sceneAllows(row)) this._releaseRow(row);
  }
  _sceneAllows(row) {
    return !row.scenes?.length || row.scenes.map(String).includes(String(this.getScene() ?? this.currentScene));
  }
  learn(rowId, { deviceSpecific = false } = {}) {
    if (!this.mappings.some((row) => row.id === rowId)) throw new Error(`No existe el mapeo ${rowId}.`);
    this.learnRow = rowId;
    this.learnDevice = deviceSpecific;
    this._emit('learn', { rowId });
  }
  cancelLearn() { this.learnRow = null; this._emit('learn', { rowId: null }); }
  learnTarget(target, options = {}) {
    const id = options.id ?? `learn.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
    this.setMappings([...this.mappings, { id, target, source: null, mode: 'auto', ...options }]);
    this.learn(id);
    return id;
  }
  _assignLearn(msg) {
    const row = this.mappings.find((candidate) => candidate.id === this.learnRow);
    if (!row) { this.cancelLearn(); return; }
    this._releaseRow(row);
    row.source = msg.kind === 'note' ? { kind: 'note', channel: msg.channel, note: msg.note }
      : msg.kind === 'cc' ? { kind: 'cc', channel: msg.channel, cc: msg.cc }
        : { kind: 'osc', address: msg.address };
    if (this.learnDevice && msg.deviceId) row.source.deviceId = msg.deviceId;
    // A learned source may change families. Keep useful transforms, but never
    // leave a note gate or raw OSC argument reader attached to incompatible data.
    if (row.mode === 'gate' && msg.kind !== 'note') row.mode = 'range';
    if (row.valueFrom === 'argument' && msg.kind !== 'osc') {
      delete row.valueFrom;
      row.mode = this._inferMode(row, msg);
    }
    if (row.valueFrom === 'note' && msg.kind !== 'note') {
      delete row.valueFrom;
      row.mode = 'range'; row.min = 0; row.max = 127;
      row.transform = { quantize: 'floor' };
    }
    if (!row.mode || row.mode === 'auto') row.mode = this._inferMode(row, msg);
    const definition = this.getDefinition(row.target);
    if (row.mode === 'range' || row.mode === 'velocity') {
      row.min ??= definition?.min ?? 0;
      row.max ??= definition?.max ?? 1;
    }
    row.learned = true;
    this.cancelLearn();
    this.save();
    this._emit('mappings', this.list());
    this._record(msg, [], { learned: row.id });
  }
  _inferMode(row, msg) {
    if (msg.kind === 'cc' || msg.kind === 'osc') return 'range';
    if (row.output === 'action' || this.hasAction(row.target)) return 'trigger';
    if (this.getDefinition(row.target)?.type === 'bool') return 'toggle';
    return 'velocity';
  }
  dispatch(incoming, { filter } = {}) {
    if (!incoming || typeof incoming.kind !== 'string') return [];
    const msg = incoming.kind === 'note' ? { ...incoming, on: !!incoming.on && Number(incoming.velocity) > 0,
      velocity: incoming.on && Number(incoming.velocity) > 0 ? clamp(Number(incoming.velocity), 0, 127) : 0 } : incoming;
    if (msg.kind === 'device' && msg.action === 'disconnected') { this.releaseDevice(msg.deviceId); return []; }
    if (this.learnRow != null && (msg.kind === 'cc' || msg.kind === 'osc' || (msg.kind === 'note' && msg.on))) {
      this._assignLearn(msg);
      return [];
    }
    const fired = [];
    if (msg.kind === 'transport') this._transport(msg);
    if (msg.kind === 'osc' && this.autoOsc && this._autoOsc(msg)) fired.push('(ruta OSC automática)');
    for (const row of this.mappings) {
      if (filter && !filter(row)) continue;
      if (row.enabled === false || !matches(row.source, msg) || !this._sceneAllows(row)) continue;
      if (this._apply(row, msg)) fired.push(row.id);
    }
    // MIDI all-notes-off/all-sound-off also releases the mapper's held gate state.
    if (msg.kind === 'cc' && [120, 123].includes(msg.cc)) this.releaseDevice(msg.deviceId, msg.channel);
    this._record(msg, fired);
    return fired;
  }
  _state(row) {
    if (!this.states.has(row.id)) this.states.set(row.id, { held: new Map(), timer: null, active: false });
    return this.states.get(row.id);
  }
  _apply(row, msg) {
    const state = this._state(row);
    const key = `${msg.deviceId ?? 'host'}:${msg.channel}:${msg.note}`;
    const wasAny = state.held.size > 0;
    const wasThis = state.held.has(key);
    if (msg.kind === 'note') {
      state.lastSource = { deviceId: msg.deviceId, channel: msg.channel };
      if (msg.on) state.held.set(key, { deviceId: msg.deviceId, channel: msg.channel, value: msg.velocity });
      else state.held.delete(key);
    }
    const mode = row.mode === 'auto' || !row.mode ? this._inferMode(row, msg) : row.mode;
    const meta = { mappingId: row.id, source: msg, mode };
    const definition = this.getDefinition(row.target);
    const min = row.min ?? definition?.min ?? 0;
    const max = row.max ?? definition?.max ?? 1;
    if (mode !== 'gate' && msg.kind === 'note') {
      if (!msg.on && row.edge !== 'both') return false;
      if (msg.on && ((row.edge === 'aggregate' && wasAny) || (row.edge === 'perNote' && wasThis))) return false;
    }
    if (mode === 'trigger') {
      const value = row.valueFrom === 'note' ? String(msg.note) : row.arg ?? true;
      this._write(row, value, meta);
    } else if (mode === 'set') {
      const value = row.valueFrom === 'argument' ? Number(msg.args?.[0]) : row.value;
      if (row.valueFrom === 'argument' && !Number.isFinite(value)) return false;
      this._write(row, value, meta);
    }
    else if (mode === 'toggle') this._write(row, !this.getValue(row.target), meta);
    else if (mode === 'gate') {
      if (msg.kind !== 'note') return false;
      // Repeated NoteOffs must not extend an already scheduled MonoFlop tail.
      if (!msg.on && !state.held.size && state.timer != null) return false;
      if (state.timer != null) { this.clearTimer(state.timer); state.timer = null; }
      if (state.held.size) {
        const velocity = Math.max(...[...state.held.values()].map((v) => v.value));
        const value = row.onValue ?? (row.binary ? 1 : definition?.type === 'bool' ? true : min + velocity / 127 * (max - min));
        state.active = true;
        this._write(row, value, meta);
      } else {
        // MIDI off is authoritative even when its on happened before connect,
        // Learn/reset, or a demo/manual control put this gate high meanwhile.
        if (row.releaseMs > 0) {
          state.active = true;
          state.timer = this.setTimer(() => {
          state.timer = null;
          state.active = false;
          this._write(row, row.offValue ?? (definition?.type === 'bool' ? false : 0), { ...meta, delayedRelease: true });
          }, row.releaseMs);
        }
        else {
          state.active = false;
          this._write(row, row.offValue ?? (definition?.type === 'bool' ? false : 0), meta);
        }
      }
    } else if (mode === 'velocity' || mode === 'range') {
      let n;
      if (msg.kind === 'note') n = msg.velocity / 127;
      else if (msg.kind === 'cc' || msg.kind === 'aftertouch' || msg.kind === 'polyaftertouch') n = msg.value / 127;
      else if (msg.kind === 'pitchbend') n = msg.value / 16383;
      else if (msg.kind === 'program') n = msg.program / 127;
      else if (msg.kind === 'osc') {
        const raw = Number(msg.args?.[0]);
        if (!Number.isFinite(raw)) return false;
        const [a, b] = row.in ?? [0, 1];
        n = a === b ? 0 : (raw - a) / (b - a);
      } else return false;
      if (!Number.isFinite(n)) return false;
      n = clamp(n);
      if (row.curve === 'exp') n *= n;
      else if (row.curve === 'log') n = Math.sqrt(n);
      let value = min + n * (max - min);
      const originalValue = value;
      if (row.transform?.quantize) value = Math[row.transform.quantize](value);
      if (row.transform?.modulo) value = ((value % row.transform.modulo) + row.transform.modulo) % row.transform.modulo;
      if (row.transform?.values) value = row.transform.values[clamp(Math.round(value), 0, row.transform.values.length - 1)];
      if (!row.transform && definition?.type === 'enum') { value = n; meta.normalized = true; }
      else if (definition?.type === 'bool') value = n >= 0.5;
      this._write(row, value, { ...meta, originalValue, normalizedValue: n });
    } else return false;
    return true;
  }
  _write(row, value, meta) {
    if (row.output === 'action' || (row.output == null && this.hasAction(row.target))) this.onAction(row.target, value, meta);
    else this.onControl(row.target, value, meta);
  }
  _releaseRow(row) {
    const state = this.states.get(row.id);
    if (!state) return;
    if (state.timer != null) this.clearTimer(state.timer);
    if (state.active) this._write(row, row.offValue ?? (this.getDefinition(row.target)?.type === 'bool' ? false : 0), { mappingId: row.id, released: true });
    this.states.delete(row.id);
  }
  releaseAll() {
    for (const row of this.mappings) this._releaseRow(row);
    this.states.clear();
  }
  releaseDevice(deviceId, channel) {
    for (const row of this.mappings) {
      const state = this.states.get(row.id);
      if (!state) continue;
      let changed = false;
      for (const [key, held] of state.held) if ((deviceId == null || held.deviceId === deviceId) && (channel == null || held.channel === channel)) {
        state.held.delete(key);
        changed = true;
      }
      const pendingFromDevice = state.timer != null &&
        (deviceId == null || state.lastSource?.deviceId === deviceId) &&
        (channel == null || state.lastSource?.channel === channel);
      if ((changed || pendingFromDevice) && !state.held.size) this._releaseRow(row);
    }
  }
  _autoOsc(msg) {
    const parts = msg.address?.split('/').filter(Boolean) ?? [];
    const head = parts[0];
    const target = parts.slice(1).join('.');
    const value = msg.args?.[0];
    if (target && ['p', 'pn'].includes(head)) {
      if (head === 'pn' && !Number.isFinite(Number(value))) return false;
      this.onControl(target, head === 'pn' ? clamp(Number(value)) : value, { source: msg, normalized: head === 'pn', automatic: true });
      return true;
    }
    if (head === 'a' && target) { this.onAction(target, value, { source: msg, automatic: true }); return true; }
    if (head === 'scene' && value !== undefined) { this.onAction('scene.goto', String(value), { source: msg, automatic: true }); return true; }
    return false;
  }
  _transport(msg) {
    const state = this.clock.dispatch(msg);
    this._emit('clock', state);
    if (this.getValue('transport.sync') !== 'midi') return;
    const meta = { source: msg, transport: state };
    const follow = this.getValue('transport.followMidi') !== false;
    if (follow && ['start', 'continue', 'stop'].includes(msg.command)) {
      this.onControl('transport.playing', state.playing, meta);
      this.onAction(`transport.${msg.command}`, undefined, meta);
    }
    if (follow && msg.command === 'position') this.onAction('transport.position', state.beat, meta);
    if (msg.command === 'clock' && state.bpm != null) this.onControl('transport.bpm', state.bpm, meta);
  }
  _record(msg, fired, extra = {}) {
    const item = { t: Date.now(), msg, fired, ...extra };
    this.monitor.unshift(item);
    if (this.monitor.length > 100) this.monitor.length = 100;
    this._emit('monitor', item);
  }
  dispose() { this.cancelLearn(); this.releaseAll(); this.listeners.clear(); this.clock.reset(); }
}

/** Explicit host integration: no second Web MIDI access, transport owner or BroadcastChannel. */
export function attachToHost(ctx, options = {}) {
  const params = ctx.params ?? ctx;
  const mapper = new Mapper({
    onControl: (path, value, meta) => meta?.normalized && params.setNormalized
      ? params.setNormalized(path, value) : params.set(path, value, meta),
    onAction: (action, value, meta) => params.trigger(action, value, meta),
    getValue: (path) => params.target?.(path) ?? params.get?.(path),
    getDefinition: (path) => params.def?.(path),
    hasAction: (path) => params.hasAction?.(path) ?? false,
    getScene: () => ctx.scenes?.currentScene?.id ?? ctx.currentScene,
    ...options,
  });
  return { mapper, ready: mapper.init(), dispatch: (message) => mapper.dispatch(message),
    onSceneChange: (id) => mapper.onSceneChange(id), dispose: () => mapper.dispose() };
}
