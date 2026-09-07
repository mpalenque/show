import { clamp } from '../core/Tween.js';

export const MAPPINGS_VERSION = 12;

// Tabla fuente → destino. Es lo único que traduce MIDI/OSC a escrituras en Params.
export class Mapper {
  constructor(ctx) {
    this.ctx = ctx;
    this.params = ctx.params;
    this.mappings = [];
    this.index = new Map();          // clave de fuente → filas (fan-out)
    this.learnRow = null;
    this.monitor = [];               // últimos 50 mensajes
    this.currentScene = null;
    this._listeners = { mappings: [], monitor: [] };
  }

  async init() {
    const stored = localStorage.getItem('vis.mappings');
    if (stored) {
      try {
        const saved = JSON.parse(stored);
        const savedVersion = Number(saved.version ?? 1);
        const mappings = saved.mappings ?? [];

        // Conserva lo aprendido a mano, suma mapeos nuevos y reemplaza únicamente las filas
        // default que declaran una corrección posterior. Así una mejora llega a la máquina del
        // show sin obligar a restaurar y perder configuraciones propias.
        if (savedVersion < MAPPINGS_VERSION) {
          const defaults = await this._loadDefaultMappings();
          const upgrades = defaults.filter((row) =>
            (row.addedIn ?? 1) > savedVersion || (row.updatedIn ?? 0) > savedVersion);
          for (const m of upgrades) {
            const index = mappings.findIndex((row) => row.id === m.id);
            if (index < 0) mappings.push(structuredClone(m));
            else if ((m.updatedIn ?? 0) > savedVersion) {
              if (m.id === 'full-line' && m.updatedIn === 12) {
                // La escena 2 conserva su línea autónoma. Corrige sólo el alcance del
                // antiguo disparo: aprender otra nota no debe perder la fuente elegida.
                const row = mappings[index];
                if (row.target === 'line.strike' && row.scenes?.includes('2')) {
                  const scenes = row.scenes.filter((id) => id !== '2');
                  if (scenes.length) mappings[index] = { ...row, scenes, updatedIn: 12 };
                  // Si sólo tenía la 2, conserva la fuente aprendida: una lista vacía
                  // significaría todas las escenas. El modo loop ignora line.strike.
                }
              } else mappings[index] = structuredClone(m);
            }
          }
        }

        this.setMappings(mappings);
        if (savedVersion < MAPPINGS_VERSION) this.save();
        return;
      }
      catch { console.error('[vis] mapeos guardados inválidos, uso el default'); }
    }
    await this.resetToDefault();
  }

  async _loadDefaultMappings() {
    const res = await fetch('./mappings.default.json');
    const json = await res.json();
    return json.mappings ?? [];
  }

  async resetToDefault() {
    try {
      this.setMappings(await this._loadDefaultMappings());
      // Restaurar tiene que sobrevivir al próximo arranque. Antes solo cambiaba las filas en
      // memoria y al recargar volvía el localStorage viejo, por eso el kick perdía los rayos.
      this.save();
    } catch (err) {
      console.error('[vis] no se pudo cargar mappings.default.json', err);
      this.setMappings([]);
    }
  }

  setMappings(mappings) {
    this.mappings = mappings;
    this._reindex();
    this._emit('mappings');
  }

  save() {
    localStorage.setItem('vis.mappings', JSON.stringify({ version: MAPPINGS_VERSION, mappings: this.mappings }));
  }

  exportJson() {
    return JSON.stringify({ version: MAPPINGS_VERSION, mappings: this.mappings }, null, 2);
  }

  onSceneChange(id) { this.currentScene = id; }

  on(event, fn) { this._listeners[event]?.push(fn); }
  _emit(event, payload) { for (const fn of this._listeners[event] ?? []) fn(payload ?? this.mappings); }

  _reindex() {
    this.index.clear();
    for (const m of this.mappings) {
      const key = sourceKey(m.source);
      if (!key) continue;
      if (!this.index.has(key)) this.index.set(key, []);
      this.index.get(key).push(m);
    }
  }

  learn(rowId) {
    this.learnRow = rowId;
  }

  // Punto de entrada de todo lo que llega de MIDI y OSC.
  dispatch(msg) {
    if (this.learnRow != null && isLearnable(msg)) {
      this._assignLearn(msg);
      return;
    }

    const fired = [];

    // Rutas OSC automáticas: funcionan sin mapear nada.
    if (msg.kind === 'osc' && this._autoOsc(msg)) fired.push('(ruta OSC automática)');

    const key = sourceKey(msg.kind === 'note' ? { kind: 'note', channel: msg.channel, note: msg.note }
      : msg.kind === 'cc' ? { kind: 'cc', channel: msg.channel, cc: msg.cc }
      : { kind: 'osc', address: msg.address });

    // Una fuente de nota sin número significa "cualquier nota de este canal". Se consulta junto
    // con la clave exacta, por lo que los mapeos de notas individuales siguen funcionando igual.
    const keys = msg.kind === 'note' ? [key, `note:${msg.channel}:*`] : [key];
    for (const candidate of keys) {
      for (const m of this.index.get(candidate) ?? []) {
        if (!this._sceneAllows(m)) continue;
        if (this._apply(m, msg)) fired.push(m.id);
      }
    }

    this._record(msg, fired);
  }

  _sceneAllows(m) {
    return !m.scenes || m.scenes.length === 0 || m.scenes.includes(this.currentScene);
  }

  _apply(m, msg) {
    const p = this.params.def(m.target);
    const isAction = this.params.hasAction(m.target);
    if (!p && !isAction) { console.error(`[vis] mapeo ${m.id}: destino desconocido ${m.target}`); return false; }

    const min = m.min ?? p?.min ?? 0;
    const max = m.max ?? p?.max ?? 1;

    switch (m.mode) {
      case 'trigger':
        if (msg.kind === 'note' && !msg.on) return false;
        if (isAction) this.params.trigger(m.target, m.arg);
        else this.params.set(m.target, m.arg ?? true);
        return true;

      case 'toggle':
        if (msg.kind === 'note' && !msg.on) return false;
        this.params.set(m.target, !this.params.target(m.target));
        return true;

      case 'gate':
        if (p?.type === 'bool') this.params.set(m.target, !!msg.on);
        else this.params.set(m.target, msg.on ? min + (msg.velocity / 127) * (max - min) : 0);
        return true;

      case 'velocity':
        if (msg.kind === 'note' && !msg.on) return false;
        this.params.set(m.target, min + (msg.velocity / 127) * (max - min));
        return true;

      case 'set':
        if (msg.kind === 'note' && !msg.on) return false;
        if (isAction) this.params.trigger(m.target, m.value);
        else this.params.set(m.target, m.value);
        return true;

      case 'range': {
        let n;
        if (msg.kind === 'cc') n = msg.value / 127;
        else {
          const raw = Number(msg.args?.[0] ?? 0);
          const [a, b] = m.in ?? [0, 1];
          n = b === a ? 0 : (raw - a) / (b - a);
        }
        n = applyCurve(clamp(n, 0, 1), m.curve);
        if (p?.type === 'bool') this.params.set(m.target, n >= 0.5);
        else if (p?.type === 'enum') this.params.setNormalized(m.target, n);
        else this.params.set(m.target, min + n * (max - min));
        return true;
      }

      default:
        console.error(`[vis] mapeo ${m.id}: modo desconocido ${m.mode}`);
        return false;
    }
  }

  // /p/<id> valor nativo · /pn/<id> 0..1 · /a/<id> acción · /scene id
  _autoOsc(msg) {
    const parts = msg.address.split('/').filter(Boolean);
    const head = parts[0];
    const id = parts.slice(1).join('.');
    const arg = msg.args?.[0];

    if (head === 'p' && this.params.has(id)) { this.params.set(id, arg); return true; }
    if (head === 'pn' && this.params.has(id)) { this.params.setNormalized(id, Number(arg)); return true; }
    if (head === 'a' && this.params.hasAction(id)) { this.params.trigger(id, arg); return true; }
    if (head === 'scene' && arg !== undefined) { this.params.trigger('scene.goto', String(arg)); return true; }
    return false;
  }

  _assignLearn(msg) {
    const row = this.mappings.find((m) => m.id === this.learnRow);
    this.learnRow = null;
    if (!row) return;

    row.source = msg.kind === 'note' ? { kind: 'note', channel: msg.channel, note: msg.note }
      : msg.kind === 'cc' ? { kind: 'cc', channel: msg.channel, cc: msg.cc }
      : { kind: 'osc', address: msg.address };

    // Modo por defecto inferido del tipo de fuente y de destino.
    if (!row.mode || row.mode === 'auto') row.mode = inferMode(msg, row.target, this.params);
    if (row.mode === 'range' && row.min == null) {
      const p = this.params.def(row.target);
      if (p) { row.min = p.min; row.max = p.max; }
    }
    this._reindex();
    this.save();
    this._emit('mappings');
  }

  _record(msg, fired) {
    this.monitor.unshift({ t: Date.now(), msg, fired });
    if (this.monitor.length > 50) this.monitor.length = 50;
    this._emit('monitor', { msg, fired });
  }
}

export function sourceKey(source) {
  if (!source || !source.kind) return null;
  if (source.kind === 'note') return `note:${source.channel}:${source.note == null ? '*' : source.note}`;
  if (source.kind === 'cc') return `cc:${source.channel}:${source.cc}`;
  if (source.kind === 'osc') return `osc:${source.address}`;
  return null;
}

export function describeSource(source) {
  if (!source || !source.kind) return '(sin asignar)';
  if (source.kind === 'note') return source.note == null ? `Cualquier nota ch${source.channel}` : `Nota ${source.note} ch${source.channel}`;
  if (source.kind === 'cc') return `CC ${source.cc} ch${source.channel}`;
  if (source.kind === 'osc') return source.address;
  return '?';
}

function isLearnable(msg) {
  return msg.kind === 'osc' || msg.kind === 'cc' || (msg.kind === 'note' && msg.on);
}

function inferMode(msg, target, params) {
  if (msg.kind === 'cc' || msg.kind === 'osc') return 'range';
  if (params.hasAction(target)) return 'trigger';
  const p = params.def(target);
  if (p?.type === 'bool') return 'toggle';
  return 'velocity';
}

function applyCurve(n, curve) {
  if (curve === 'exp') return n * n;
  if (curve === 'log') return Math.sqrt(n);
  return n;
}
