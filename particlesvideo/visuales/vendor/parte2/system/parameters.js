import { PRESETS } from '../presets.js';

const specs = [];
const def = (id, label, type, value, min = 0, max = 1, step = .01, group = 'Sistema', options) => {
  const spec = { id, label, type, default: value, min, max, step, group };
  if (options) spec.options = options;
  specs.push(spec); return spec;
};
def('transport.playing', 'Reproducir', 'bool', true);
def('transport.rate', 'Pasos de efectos / s', 'enum', 60, 0, 1, 1, 'Sistema', [30, 60, 120]);
def('transport.bpm', 'Tempo', 'float', 120, 20, 300, .1);
def('transport.sync', 'Reloj', 'enum', 'internal', 0, 1, 1, 'Sistema', ['internal', 'midi']);
def('transport.followMidi', 'Seguir Start / Stop MIDI', 'bool', true);
def('scene.current', 'Escena vvvv', 'int', 69, 0, 127, 1);
def('scene.automation', 'Automatización original por escena', 'bool', true);
def('output.resolution', 'Resolución de salida', 'enum', '2688x1008', 0, 1, 1, 'Salida', ['2688x1008', '1920x600', '3840x1200', '5760x1800', '3840x2160']);
def('output.master', 'Master', 'float', 1, 0, 1, .01, 'Salida');
def('output.blackout', 'Blackout', 'bool', false, 0, 1, 1, 'Salida');
def('output.preview', 'Vista', 'enum', 'composition', 0, 1, 1, 'Salida', ['composition', 'fullVideo', 'fullMilky', 'ink', 'distort', '1a', '3a', '2a', 'splash', 'deck0', 'deck1', 'deck2', 'deck3', 'deck4', 'deck5']);
def('mix.fullVideo', 'DDS completo', 'float', 0, 0, 1, .01, 'Mezcla');
def('mix.fullVideoAttack', 'Ataque de brillo DDS full (s)', 'float', 60, 0, 120, .01, 'Mezcla');
def('mix.fullVideoDecay', 'Caída de brillo DDS full (s)', 'float', 1, 0, 60, .01, 'Mezcla');
def('mix.fullMilky', 'Milky completo', 'float', 1, 0, 1, .01, 'Mezcla');
def('milky.full.preset', 'Milky full', 'enum', 'final', 0, 1, 1, 'Mezcla', ['full1', 'full3', 'full2', 'fullsplash', 'final']);
def('milky.externalSeed', 'DDS como entrada Milky full', 'bool', false, 0, 1, 1, 'Mezcla');
def('milky.full.ddsBlend', 'Exclusion con DDS', 'float', 0, 0, 1, .01, 'Mezcla');
def('milky.full.ddsContrast', 'Contraste de DDS en Milky', 'float', .93, -2, 4, .01, 'Mezcla');
def('milky.full.bypass', 'Bypass Milky full', 'bool', false, 0, 1, 1, 'Mezcla');
def('milky.autoSeed', 'Semillas automáticas', 'bool', true, 0, 1, 1, 'Mezcla');
def('milky.warp', 'Multiplicador deformación', 'float', 1, 0, 2, .01, 'Mezcla');
def('milky.detail', 'Multiplicador detalle', 'float', 1, 0, 2, .01, 'Mezcla');
// TEMPORARY: while 56 of the 68 catalog clips are missing on this machine, a
// selected clip without complete media plays a deterministic substitute
// (playable[index % playable.length]) instead of leaving the deck black.
def('media.fallback', 'Sustituir secuencias DDS faltantes (temporal)', 'bool', true, 0, 1, 1, 'Medios');
def('ink.enabled', 'INK dripping', 'bool', false, 0, 1, 1, 'Tinta / INK');
def('ink.opacity', 'Opacidad INK', 'float', 1, 0, 1, .01, 'Tinta / INK');
def('ink.attack', 'Ataque de tinta (s)', 'float', 15, .05, 60, .01, 'Tinta / INK');
def('ink.decay', 'Caída de tinta (s)', 'float', 1, 0, 60, .01, 'Tinta / INK');
def('ink.hold', 'Duración del disparo (s)', 'float', 4, .05, 30, .01, 'Tinta / INK');
def('ink.resetHold', 'Reset de Growth (s)', 'float', .1, 0, 1, .001, 'Tinta / INK');
def('ink.hideBrush', 'Growth · ocultar pincel', 'bool', true, 0, 1, 1, 'Tinta / INK');
for (let i = 0; i < 6; i++) {
  def(`mix.stripes.${i}.video`, `DDS bloque ${i + 1}`, 'float', 0, 0, 1, .01, 'Mezcla de bloques');
  def(`mix.stripes.${i}.milky`, `Milky bloque ${i + 1}`, 'float', 0, 0, 1, .01, 'Mezcla de bloques');
  def(`milky.stripes.${i}.preset`, `Preset bloque ${i + 1}`, 'int', i % 4, 0, 3, 1, 'Mezcla de bloques');
  def(`graphics.blocks.${i}`, `bOTON GRI ${i + 1} · señal publicada`, 'bool', false, 0, 1, 1, 'Señales originales');
}
for (const [id, index] of [['player.full', 0], ...Array.from({ length: 6 }, (_, i) => [`players.${i}`, i + 1])]) {
  const group = id === 'player.full' ? 'Player full' : `Player bloque ${index}`;
  def(`${id}.clip`, 'Secuencia', 'int', index, 0, 67, 1, group);
  def(`${id}.playing`, 'Reproducir', 'bool', true, 0, 1, 1, group);
  def(`${id}.speed`, 'Velocidad', 'float', 1, 0, 4, .01, group);
  def(`${id}.slow`, 'Tiempo extra del ciclo (s)', 'float', 0, 0, 60, .01, group);
  def(`${id}.start`, 'Entrada', 'float', 0, 0, 1, .001, group);
  def(`${id}.end`, 'Salida', 'float', 1, 0, 1, .001, group);
  const seek = def(`${id}.seek`, 'Posición', 'float', 0, 0, 1, .001, group);
  seek.transient = true; seek.retrigger = true;
  def(`${id}.loop`, 'Loop', 'bool', true, 0, 1, 1, group);
  def(`${id}.reverse`, 'Reversa', 'bool', false, 0, 1, 1, group);
  def(`${id}.pingpong`, 'Ping-pong', 'bool', false, 0, 1, 1, group);
}
const final = (key, label, type, value, min = 0, max = 1, step = .01) => def(`final.${key}`, label, type, value, min, max, step, 'Milky FINAL');
final('fx1', 'FX1 · deriva X / anillo', 'float', 0);
final('fx2', 'FX2 · deriva Y / profundidad', 'float', 0);
final('fx4', 'FX4 · desplazamiento final', 'float', 0);
final('button', 'BOTON · feedback activo', 'bool', true);
final('loop', 'Repetir tinta', 'bool', true);
final('flash', 'Contraste pulsante', 'bool', true);
final('inkAuto', 'Reproducir tinta', 'bool', true);
final('inkProgress', 'Posición de tinta', 'float', 0, 0, 1, .001).transient = true;
export const FINAL_NUMBERS = [
  ['attack', 'Ataque tinta (s)', 3.04, .05, 30], ['loopDuration', 'Ciclo tinta (s)', 4.5, .1, 60],
  ['verticalScale', 'Flujo vertical', .013, -.2, .2], ['verticalFeedback', 'Feedback vertical', .97, 0, 1],
  ['inkDepth', 'Normal tinta · profundidad', 2.36, -4, 4], ['inkDisplace', 'Desplazamiento tinta', .61, -2, 2],
  ['hsvAmount', 'UnsharpHSV · intensidad', 2, 0, 5], ['hsvShape', 'UnsharpHSV · escala', -1.46, -3, 3],
  ['hsvHue', 'UnsharpHSV · matiz', -1.42, -3, 3], ['hsvSaturation', 'UnsharpHSV · saturación', .5, 0, 3],
  ['growthSpeed', 'Growth · velocidad', 100, 0, 300], ['growthFade', 'Growth · caída', .12, 0, 5],
  ['growthShape', 'Growth · forma', -.4, -2, 2], ['growthEdge', 'Growth · borde', 1, .1, 8],
  ['growthTranslate', 'Growth · traslación X', .001, -.02, .02], ['growthDisplace', 'Growth · desplazamiento', .54, -2, 2],
  ['inputBlack', 'Levels · negro entrada', .38629, 0, .99], ['outputBlack', 'Levels · negro salida', .24456, 0, 1],
  ['threshold', 'Dither', 6, .1, 10], ['secondaryAmount', 'Desplazamiento secundario', .105, -1, 1],
  ['normalRadius', 'Radio normales', 12, .1, 64], ['displaceAmount', 'Desplazamiento principal', -.047, -1, 1],
  ['opacity', 'Exclusion · opacidad', .94, 0, 1], ['unsharpAmount', 'Unsharp · intensidad', 1.75, 0, 5],
  ['unsharpShape', 'Unsharp · escala', .03, -3, 3], ['saturation', 'Unsharp · saturación', .55, 0, 3],
  ['brightness', 'Brillo de salida', 2.34, -4, 4], ['contrast', 'Contraste pulsante · intensidad', 4, 0, 6],
  ['flashPeriod', 'Contraste pulsante · período', .19, .03, 5], ['ringOpacity', 'Anillo · feedback', .87, 0, 1],
  ['ringAmount', 'Anillo · desplazamiento', 4.67, -8, 8], ['ringSharp', 'Anillo · Unsharp', .35, 0, 3],
];
for (const [id, label, value, min, max] of FINAL_NUMBERS) final(id, label, 'float', value, min, max, .001);
for (const [id, label, value, min, max] of FINAL_NUMBERS.slice(2, 18)) def(`ink.${id}`, label, 'float', value, min, max, .001, 'Tinta / INK');
const presetRanges = {
  opacity: [0, 1], normalRadius: [.1, 64], normalDepth: [-4, 4], displaceAmount: [-2, 2],
  unsharpAmount: [0, 5], unsharpShape: [-3, 3], saturation: [0, 3], ditherThreshold: [.1, 10],
  secondaryAmount: [-2, 2], postBlendOpacity: [0, 1], flowBlur: [0, 1], flowIterations: [0, 16],
};
for (const preset of PRESETS.filter(p => p.id !== 'final')) {
  for (const [key, [min, max]] of Object.entries(presetRanges)) {
    if (typeof preset[key] === 'number') def(`milky.${preset.id}.${key}`, key, key === 'flowIterations' ? 'int' : 'float', preset[key], min, max, .01, preset.name);
  }
  for (const [key, values] of [['direction', preset.direction], ['secondaryDirection', preset.secondaryDirection]]) {
    for (let i = 0; i < 2; i++) def(`milky.${preset.id}.${key}${i ? 'Y' : 'X'}`, `${key} ${i ? 'Y' : 'X'}`, 'float', values[i], -2, 2, .001, preset.name);
  }
}
for (const event of ['kickWarp', 'snareHeld']) def(`events.${event}`, event, 'bool', false, 0, 1, 1, 'Eventos MIDI').transient = true;

export const ACTIONS = [
  ['scene.goto', 'Ir a escena'], ['kick', 'Kick'], ['kick1', 'Kick 1 · señal publicada'], ['snare', 'Snare'], ['percussion', 'Percusión · señal publicada'],
  ['ink.trigger', 'Disparar INK'], ['final.explode', 'Disparar explosión'], ['milky.seed', 'Inyectar semilla'],
  ['transport.start', 'Start'], ['transport.continue', 'Continue'], ['transport.stop', 'Stop'], ['transport.reset', 'Reiniciar todo'],
  ['transport.position', 'Posición MIDI (pulsos)'],
  ['output.blackoutToggle', 'Alternar blackout'],
].map(([id, label]) => ({ id, label, type: 'action', isAction: true, group: 'Acciones' }));
export const PARAMETER_DEFINITIONS = specs;

/** Single source for manual controls, MIDI, OSC, remote editor and host API. */
export class ParameterStore {
  constructor(definitions = PARAMETER_DEFINITIONS) {
    this.defs = new Map(); this.actions = new Map(ACTIONS.map(a => [a.id, a]));
    this.values = new Map(); this.listeners = new Set(); this.actionListeners = new Set();
    this.revision = 0;
    for (const spec of definitions) this.define(spec);
  }
  define(spec) {
    if (this.defs.has(spec.id)) throw new Error(`Parámetro duplicado: ${spec.id}`);
    this.defs.set(spec.id, { ...spec }); this.values.set(spec.id, spec.default);
  }
  get(id) { return this.values.get(id); }
  has(id) { return this.defs.has(id); }
  def(id) { return this.defs.get(id); }
  list() { return [...this.defs.values(), ...this.actions.values()]; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onAction(fn) { this.actionListeners.add(fn); return () => this.actionListeners.delete(fn); }
  set(id, value, meta = {}) {
    const spec = this.defs.get(id);
    if (!spec) throw new Error(`Parámetro desconocido: ${id}`);
    let result;
    if (spec.type === 'bool') result = value === true || value === 1 || value === 'true';
    else if (spec.type === 'enum') {
      if (!spec.options.includes(value)) throw new Error(`Valor inválido para ${id}: ${value}`);
      result = value;
    } else {
      result = Number(value);
      if (!Number.isFinite(result)) throw new Error(`Valor no finito para ${id}`);
      result = Math.min(spec.max, Math.max(spec.min, result));
      if (spec.type === 'int') result = Math.round(result);
    }
    const previous = this.get(id);
    if (previous === result && !meta.force && !spec.retrigger) return result;
    this.values.set(id, result); this.revision++;
    for (const fn of this.listeners) fn(id, result, { ...meta, previous });
    return result;
  }
  setNormalized(id, value, meta = {}) {
    const spec = this.defs.get(id);
    if (!spec) throw new Error(`Parámetro desconocido: ${id}`);
    const n = Math.min(1, Math.max(0, Number(value)));
    return this.set(id, spec.type === 'bool' ? n >= .5 : spec.type === 'enum'
      ? spec.options[Math.min(spec.options.length - 1, Math.floor(n * spec.options.length))]
      : spec.min + n * (spec.max - spec.min), meta);
  }
  trigger(id, value, meta = {}) {
    if (!this.actions.has(id)) throw new Error(`Acción desconocida: ${id}`);
    for (const fn of this.actionListeners) fn(id, value, meta);
  }
  snapshot({ persistent = false } = {}) {
    return Object.fromEntries([...this.values].filter(([id]) => !persistent || !this.defs.get(id).transient));
  }
  apply(values, meta = {}) {
    // Validate a complete document before touching the live state.
    const temporary = new ParameterStore([...this.defs.values()]);
    for (const [id, value] of Object.entries(values)) temporary.set(id, value);
    for (const [id, value] of Object.entries(values)) this.set(id, value, meta);
  }
}
