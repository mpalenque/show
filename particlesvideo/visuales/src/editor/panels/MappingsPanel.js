import { describeSource, buildReferenceMarkdown, buildReferenceCsv, download, nextMappingId } from '../reference.js';
import { MAPPINGS_VERSION } from '../../io/Mapper.js';

const MODES = ['trigger', 'toggle', 'gate', 'velocity', 'set', 'range'];

export class MappingsPanel {
  constructor(state, bus) {
    this.state = state;
    this.bus = bus;
    this.table = document.getElementById('mappings-table');
    this.learning = null;
  }

  init() {
    document.getElementById('add-mapping').onclick = () => {
      this.state.mappings.push({ id: nextMappingId(this.state.mappings), source: {}, mode: 'trigger', target: '' });
      this.push();
    };
    document.getElementById('save-mappings').onclick = () => this.bus.post({ t: 'save' });
    document.getElementById('reset-mappings').onclick = () => this.bus.post({ t: 'resetMappings' });
    document.getElementById('export-mappings').onclick = () =>
      download('mappings.json', JSON.stringify({ version: MAPPINGS_VERSION, mappings: this.state.mappings }, null, 2), 'application/json');
    document.getElementById('import-mappings').onclick = () => this._importJson();
    document.getElementById('export-reference').onclick = () => {
      download('REFERENCIA-MIDI-OSC.md', buildReferenceMarkdown(this.state.registry, this.state.mappings, this.state.scenes), 'text/markdown');
      download('REFERENCIA-MIDI-OSC.csv', buildReferenceCsv(this.state.registry, this.state.mappings), 'text/csv');
    };
  }

  push() {
    this.bus.post({ t: 'mappings', mappings: this.state.mappings });
    this.render();
  }

  render() {
    // El learn puede haberlo resuelto la otra ventana (o el botón por parámetro del panel de
    // referencia, que comparte el mismo `learnRow` en el Mapper): si la fila ya tiene fuente,
    // el botón no puede seguir parpadeando.
    if (this.learning) {
      const row = this.state.mappings.find((m) => m.id === this.learning);
      if (!row || row.source?.kind) this.learning = null;
    }
    this.table.innerHTML = '';
    const targets = this.state.registry.map((d) => d.id);

    for (const m of this.state.mappings) {
      const row = document.createElement('div');
      row.className = 'map-row' + (m.source?.kind ? '' : ' unassigned');

      const src = document.createElement('span');
      src.className = 'srclabel';
      src.textContent = m.source?.kind ? describeSource(m.source) : '(sin asignar)';

      const mode = select(MODES, m.mode, (v) => { m.mode = v; this.push(); });

      const target = document.createElement('input');
      target.setAttribute('list', 'target-ids');
      target.value = m.target ?? '';
      target.onchange = () => { m.target = target.value.trim(); this.push(); };

      const extra = this._extraField(m);

      const scenes = document.createElement('input');
      scenes.value = (m.scenes ?? []).join(',');
      scenes.placeholder = 'escenas';
      scenes.title = 'Escenas donde aplica (vacío = siempre)';
      scenes.onchange = () => {
        const list = scenes.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length) m.scenes = list; else delete m.scenes;
        this.push();
      };

      const learn = document.createElement('button');
      learn.textContent = 'Learn';
      if (this.learning === m.id) learn.classList.add('learning');
      learn.onclick = () => {
        this.learning = this.learning === m.id ? null : m.id;
        this.bus.post({ t: 'learn', rowId: this.learning });
        this.render();
      };

      const del = document.createElement('button');
      del.textContent = '×';
      del.className = 'danger';
      del.onclick = () => {
        this.state.mappings = this.state.mappings.filter((x) => x !== m);
        this.push();
      };

      row.append(src, mode, target, extra, scenes, learn, del);
      this.table.appendChild(row);
    }

    let dl = document.getElementById('target-ids');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'target-ids'; document.body.appendChild(dl); }
    dl.innerHTML = targets.map((id) => `<option value="${id}">`).join('');
  }

  // El campo de la derecha cambia según el modo: arg, valor, o min/max/curva.
  _extraField(m) {
    const wrap = document.createElement('span');
    wrap.style.display = 'flex';
    wrap.style.gap = '3px';

    if (m.mode === 'range' || m.mode === 'velocity' || m.mode === 'gate') {
      const min = numInput(m.min ?? 0, (v) => { m.min = v; this.push(); }, 'min');
      const max = numInput(m.max ?? 1, (v) => { m.max = v; this.push(); }, 'max');
      wrap.append(min, max);
      if (m.mode === 'range') {
        wrap.append(select(['linear', 'exp', 'log'], m.curve ?? 'linear', (v) => { m.curve = v; this.push(); }));
      }
    } else if (m.mode === 'set') {
      wrap.append(textInput(m.value ?? '', (v) => { m.value = v; this.push(); }, 'valor'));
    } else if (m.mode === 'trigger') {
      wrap.append(textInput(m.arg ?? '', (v) => { if (v) m.arg = v; else delete m.arg; this.push(); }, 'arg'));
    }
    return wrap;
  }

  _importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        this.state.mappings = json.mappings ?? [];
        this.push();
      } catch (err) {
        console.error('[editor] JSON inválido', err);
        alert('JSON inválido');
      }
    };
    input.click();
  }
}

function select(options, value, onChange) {
  const el = document.createElement('select');
  el.innerHTML = options.map((o) => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('');
  el.onchange = () => onChange(el.value);
  return el;
}

function numInput(value, onChange, placeholder) {
  const el = document.createElement('input');
  el.type = 'number';
  el.value = value;
  el.placeholder = placeholder;
  el.style.width = '52px';
  el.onchange = () => onChange(Number(el.value));
  return el;
}

function textInput(value, onChange, placeholder) {
  const el = document.createElement('input');
  el.value = value;
  el.placeholder = placeholder;
  el.style.width = '100px';
  el.onchange = () => onChange(el.value);
  return el;
}
