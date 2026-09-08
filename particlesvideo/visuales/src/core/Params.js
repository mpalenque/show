import * as THREE from 'three/webgpu';
import { EASINGS, damp, clamp } from './Tween.js';

const NUMERIC = new Set(['float', 'int']);

// Registro central: todo lo controlable es un param (tiene valor) o una action (se dispara).
// Los elementos visuales solo leen de acá; escenas y mapper solo escriben acá.
export class Params {
  constructor() {
    this.defs = new Map();      // id → definición
    this.actions = new Map();   // id → definición de action
    this._changeListeners = new Map();
    this._actionListeners = new Map();
    this._dirty = new Set();    // ids con target cambiado desde el último consumeDirty()
    this._tmpA = new THREE.Color();
    this._tmpB = new THREE.Color();
  }

  define(def) {
    if (this.defs.has(def.id)) throw new Error(`[vis] param duplicado: ${def.id}`);
    const p = {
      id: def.id,
      type: def.type,
      min: def.min ?? 0,
      max: def.max ?? 1,
      step: def.step,
      default: def.default,
      smooth: def.smooth ?? 0,
      label: def.label ?? def.id,
      group: def.group ?? def.id.split('.')[0],
      sceneReset: def.sceneReset !== false,
      transient: def.transient === true,
      retrigger: def.retrigger === true,
      options: def.options,
      value: def.default,
      target: def.default,
      tween: null,
    };
    this.defs.set(p.id, p);
    return p;
  }

  defineAction(def) {
    if (this.actions.has(def.id)) throw new Error(`[vis] action duplicada: ${def.id}`);
    this.actions.set(def.id, {
      id: def.id,
      label: def.label ?? def.id,
      group: def.group ?? def.id.split('.')[0],
      argHint: def.argHint ?? '',
      isAction: true,
    });
  }

  has(id) { return this.defs.has(id); }
  hasAction(id) { return this.actions.has(id); }
  def(id) { return this.defs.get(id); }

  get(id) {
    const p = this.defs.get(id);
    if (!p) { console.error(`[vis] param desconocido: ${id}`); return 0; }
    return p.value;
  }

  target(id) {
    const p = this.defs.get(id);
    return p ? p.target : undefined;
  }

  set(id, value, { immediate = false } = {}) {
    const p = this.defs.get(id);
    if (!p) { console.error(`[vis] param desconocido: ${id}`); return; }
    const v = this._coerce(p, value);
    p.tween = null;                              // un set cancela el tween en curso
    const changed = p.target !== v;
    p.target = v;
    if (immediate || p.smooth <= 0 || !this._isInterpolable(p)) p.value = v;
    if (changed || p.retrigger) this._notifyChange(p);
  }

  // Cambia el valor de fábrica de un param. Lo usa Settings para que un ajuste hecho en el
  // editor sobreviva a los cambios de escena: `goto` cae en el default cuando ni la escena ni
  // BASE listan el param, así que pisar el default es lo que hace que el ajuste "quede".
  setDefault(id, value) {
    const p = this.defs.get(id);
    if (!p) return;
    p.default = this._coerce(p, value);
  }

  setNormalized(id, n01) {
    const p = this.defs.get(id);
    if (!p) { console.error(`[vis] param desconocido: ${id}`); return; }
    const n = clamp(n01, 0, 1);
    if (p.type === 'bool') return this.set(id, n >= 0.5);
    if (p.type === 'enum') {
      const i = Math.min(Math.floor(n * p.options.length), p.options.length - 1);
      return this.set(id, p.options[i]);
    }
    return this.set(id, p.min + n * (p.max - p.min));
  }

  normalized(id) {
    const p = this.defs.get(id);
    if (!p) return 0;
    if (p.type === 'bool') return p.target ? 1 : 0;
    if (p.type === 'enum') return p.options.indexOf(p.target) / Math.max(p.options.length - 1, 1);
    if (p.max === p.min) return 0;
    return clamp((p.target - p.min) / (p.max - p.min), 0, 1);
  }

  tween(id, value, seconds, easing = 'smooth') {
    const p = this.defs.get(id);
    if (!p) { console.error(`[vis] param desconocido: ${id}`); return; }
    const to = this._coerce(p, value);
    if (!this._isInterpolable(p) || !(seconds > 0)) return this.set(id, to, { immediate: true });
    p.tween = { from: p.value, to, duration: seconds, elapsed: 0, ease: typeof easing === 'function' ? easing : (EASINGS[easing] ?? EASINGS.smooth) };
    const changed = p.target !== to;
    p.target = to;
    if (changed) this._notifyChange(p);
  }

  trigger(id, arg) {
    const listeners = this._actionListeners.get(id);
    if (listeners) { for (const fn of listeners) fn(arg); return; }
    // Un "trigger" sobre un param (no action) le fija el valor.
    if (this.defs.has(id)) this.set(id, arg ?? true);
    else console.error(`[vis] action desconocida: ${id}`);
  }

  onAction(id, fn) {
    if (!this._actionListeners.has(id)) this._actionListeners.set(id, []);
    this._actionListeners.get(id).push(fn);
  }

  onChange(id, fn) {
    if (!this._changeListeners.has(id)) this._changeListeners.set(id, []);
    this._changeListeners.get(id).push(fn);
  }

  update(dt) {
    for (const p of this.defs.values()) {
      if (p.tween) {
        p.tween.elapsed += dt;
        const u = Math.min(p.tween.elapsed / p.tween.duration, 1);
        p.value = this._mix(p, p.tween.from, p.tween.to, p.tween.ease(u));
        if (u >= 1) { p.value = p.tween.to; p.tween = null; }
      } else if (p.smooth > 0 && this._isInterpolable(p) && !this._equal(p, p.value, p.target)) {
        p.value = p.type === 'color'
          ? this._mix(p, p.value, p.target, 1 - Math.exp(-dt / p.smooth))
          : this._round(p, damp(p.value, p.target, p.smooth, dt));
      }
    }
  }

  list() {
    const params = [...this.defs.values()].map((p) => ({
      id: p.id, type: p.type, min: p.min, max: p.max, step: p.step, default: p.default,
      label: p.label, group: p.group, options: p.options, sceneReset: p.sceneReset, transient: p.transient, retrigger: p.retrigger, isAction: false,
    }));
    const actions = [...this.actions.values()].map((a) => ({
      id: a.id, type: 'action', label: a.label, group: a.group, argHint: a.argHint, isAction: true,
    }));
    return [...params, ...actions];
  }

  snapshot() {
    const out = {};
    for (const p of this.defs.values()) out[p.id] = p.target;
    return out;
  }

  // Para el Bridge: solo los targets que cambiaron desde la última llamada.
  consumeDirty() {
    if (this._dirty.size === 0) return null;
    const out = {};
    for (const id of this._dirty) out[id] = this.defs.get(id).target;
    this._dirty.clear();
    return out;
  }

  _notifyChange(p) {
    this._dirty.add(p.id);
    const listeners = this._changeListeners.get(p.id);
    if (listeners) for (const fn of listeners) fn(p.target, p.id);
  }

  _isInterpolable(p) { return NUMERIC.has(p.type) || p.type === 'color'; }

  _equal(p, a, b) { return a === b; }

  _round(p, v) { return p.type === 'int' ? Math.round(v) : v; }

  _coerce(p, value) {
    switch (p.type) {
      case 'bool': return value === true || value === 1 || value === 'true';
      case 'enum': return p.options.includes(value) ? value : p.default;
      case 'color': return typeof value === 'string' ? value : `#${new THREE.Color(value).getHexString()}`;
      case 'int': return Math.round(clamp(Number(value), p.min, p.max));
      default: return clamp(Number(value), p.min, p.max);
    }
  }

  // Interpola: colores en RGB lineal (THREE.Color), números en lineal directo.
  _mix(p, from, to, t) {
    if (p.type === 'color') {
      this._tmpA.set(from);
      this._tmpB.set(to);
      this._tmpA.lerp(this._tmpB, t);
      return `#${this._tmpA.getHexString()}`;
    }
    return this._round(p, from + (to - from) * t);
  }
}
