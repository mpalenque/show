import { Pane } from 'tweakpane';
import { oscAddress, describeSource, sourcesFor, nextMappingId } from '../reference.js';

const ECHO_MS = 200;   // ignorar valores entrantes de un id que tocamos recién (evita el eco)

export class ParamsPanel {
  constructor(state, bus) {
    this.state = state;
    this.bus = bus;
    this.container = document.getElementById('pane');
    this.refList = document.getElementById('ref-list');
    this.filterEl = document.getElementById('ref-filter');
    this.onlyMappedEl = document.getElementById('ref-only-mapped');
    this.pane = null;
    this.mirror = {};        // objeto espejo que Tweakpane bindea
    this.bindings = new Map();
    this.touched = new Map();
    this.learning = null;    // { target, rowId } del parámetro que está esperando el MIDI
  }

  init() {
    this.filterEl.addEventListener('input', () => this.renderReference());
    this.onlyMappedEl?.addEventListener('change', () => this.renderReference());
    document.getElementById('reset-settings').onclick = () => {
      if (!confirm('¿Borrar los ajustes guardados y volver a los valores de fábrica? Hay que recargar las dos ventanas para verlo.')) return;
      this.bus.post({ t: 'resetSettings' });
    };
    // Escape cancela el learn: si no, queda armado y el próximo CC que pase se lo lleva.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.learning) this._cancelLearn();
    });
  }

  // Learn por parámetro: crea el mapeo ya apuntado a este destino y lo deja esperando. Así
  // Manuel no tiene que ir al panel de mapeos, agregar una fila y tipear el id a mano — que
  // con 200 parámetros es justamente lo que no quiere hacer.
  //
  // El orden importa: primero se publican los mapeos (la ventana de salida los recibe y crea
  // la fila) y recién después el 'learn', porque el Mapper busca la fila POR ID cuando llega
  // el mensaje. BroadcastChannel conserva el orden, así que alcanza con postear en secuencia.
  _startLearn(def) {
    if (this.learning?.target === def.id) return this._cancelLearn();
    if (this.learning) this._cancelLearn();

    const rowId = nextMappingId(this.state.mappings);
    // mode 'auto' = que lo infiera el Mapper según lo que llegue: CC/OSC → range (con el rango
    // del propio parámetro), nota sobre acción → trigger, nota sobre bool → toggle.
    this.state.mappings.push({ id: rowId, source: {}, mode: 'auto', target: def.id });
    this.learning = { target: def.id, rowId };
    this.bus.post({ t: 'mappings', mappings: this.state.mappings });
    this.bus.post({ t: 'learn', rowId });
    this.renderReference();
  }

  _cancelLearn() {
    if (!this.learning) return;
    const { rowId } = this.learning;
    this.learning = null;
    // La fila vacía se descarta: dejarla sin fuente solo ensucia el panel de mapeos.
    this.state.mappings = this.state.mappings.filter((m) => !(m.id === rowId && !m.source?.kind));
    this.bus.post({ t: 'learn', rowId: null });
    this.bus.post({ t: 'mappings', mappings: this.state.mappings });
    this.renderReference();
  }

  _forget(id) {
    const antes = this.state.mappings.length;
    this.state.mappings = this.state.mappings.filter((m) => m.target !== id);
    if (this.state.mappings.length === antes) return;
    this.bus.post({ t: 'mappings', mappings: this.state.mappings });
    this.renderReference();
  }

  rebuild() {
    this.pane?.dispose();
    this.pane = new Pane({ container: this.container });
    this.bindings.clear();
    this.mirror = {};

    const groups = new Map();
    for (const def of this.state.registry) {
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group).push(def);
    }

    for (const [group, defs] of groups) {
      const folder = this.pane.addFolder({ title: group, expanded: false });
      for (const def of defs) {
        if (def.isAction) {
          folder.addButton({ title: def.label, label: def.id })
            .on('click', () => this.bus.trigger(def.id, undefined));
          continue;
        }
        this.mirror[def.id] = this.state.values[def.id] ?? def.default;
        const opts = { label: def.label };
        if (def.type === 'float') { opts.min = def.min; opts.max = def.max; }
        else if (def.type === 'int') { opts.min = def.min; opts.max = def.max; opts.step = def.step ?? 1; }
        else if (def.type === 'enum') { opts.options = Object.fromEntries(def.options.map((o) => [o, o])); }
        else if (def.type === 'color') { opts.view = 'color'; }

        const binding = folder.addBinding(this.mirror, def.id, opts);
        binding.on('change', (ev) => {
          this.touched.set(def.id, performance.now());
          this.bus.set(def.id, ev.value);
        });
        this.bindings.set(def.id, binding);
      }
    }
    this.renderReference();
  }

  refreshValues(values) {
    const now = performance.now();
    let dirty = false;
    for (const [id, value] of Object.entries(values)) {
      if (!(id in this.mirror)) continue;
      if (now - (this.touched.get(id) ?? -Infinity) < ECHO_MS) continue;
      if (this.mirror[id] !== value) { this.mirror[id] = value; dirty = true; }
    }
    if (dirty) this.pane?.refresh();
  }

  // Lista de referencia: id, etiqueta, tipo, rango, dirección OSC, fuentes MIDI/OSC mapeadas
  // y el botón de learn de ESE parámetro. Es la tabla que se usa para mapear: tiene todos los
  // parámetros y acciones, se filtra por texto y cada fila se arma sola.
  renderReference() {
    const filter = this.filterEl.value.trim().toLowerCase();
    const soloMapeados = !!this.onlyMappedEl?.checked;

    // Si lo que estaba aprendiendo ya recibió su fuente, el learn terminó.
    if (this.learning) {
      const row = this.state.mappings.find((m) => m.id === this.learning.rowId);
      if (!row || row.source?.kind) this.learning = null;
    }

    this.refList.innerHTML = '';
    let visibles = 0;
    for (const def of this.state.registry) {
      const hay = `${def.id} ${def.label} ${def.group}`.toLowerCase();
      if (filter && !hay.includes(filter)) continue;

      const fuentes = sourcesFor(def.id, this.state.mappings);
      if (soloMapeados && fuentes.length === 0) continue;
      visibles++;

      const row = document.createElement('div');
      row.className = 'ref-row';

      const id = document.createElement('span');
      id.textContent = def.id;
      id.title = def.label;

      const osc = document.createElement('span');
      osc.className = 'osc';
      osc.textContent = oscAddress(def);
      osc.title = 'copiar dirección OSC';
      osc.onclick = () => navigator.clipboard?.writeText(oscAddress(def));

      const rng = document.createElement('span');
      rng.className = 'rng';
      rng.textContent = def.isAction ? (def.argHint || 'acción')
        : def.type === 'enum' ? def.options.join('|')
        : def.type === 'bool' ? 'bool'
        : `${def.min}..${def.max}`;

      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = fuentes.map(describeSource).join(', ');

      const learn = document.createElement('button');
      learn.className = 'learn-btn';
      const aprendiendo = this.learning?.target === def.id;
      learn.textContent = aprendiendo ? 'movelo…' : 'Learn';
      if (aprendiendo) learn.classList.add('learning');
      learn.title = aprendiendo
        ? 'Mové el fader o tocá la nota. Escape cancela.'
        : `Mapear ${def.id}: tocá acá y después mové el control en Ableton`;
      learn.onclick = () => this._startLearn(def);

      const forget = document.createElement('button');
      forget.className = 'forget-btn';
      forget.textContent = '×';
      forget.title = 'Borrar los mapeos de este parámetro';
      forget.disabled = fuentes.length === 0;
      forget.onclick = () => this._forget(def.id);

      row.append(id, osc, rng, src, learn, forget);
      this.refList.appendChild(row);
    }

    if (visibles === 0) {
      const vacio = document.createElement('div');
      vacio.className = 'ref-empty';
      vacio.textContent = soloMapeados ? 'Todavía no hay nada mapeado.' : 'Ningún parámetro coincide con el filtro.';
      this.refList.appendChild(vacio);
    }
  }
}
