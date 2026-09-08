import { describeSource } from './mappings.js';
import { mappingsToCSV, PUBLIC_MIDI_CSV_FILENAME } from './parameter-midi.js';

const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
};
const number = value => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 3 });
const PRESET_NAMES = { full1: 'MILKY 1 · FULL', full3: 'MILKY 3 · FULL', full2: 'MILKY 2 · FULL',
  fullsplash: 'SPLASH · FULL', final: 'MILKY FINAL · INK', '1a': 'MILKY 1A', '3a': 'MILKY 3A', '2a': 'MILKY 2A', splash: 'SPLASH A' };
const VALUE_NAMES = { internal: 'Interno', midi: 'MIDI', composition: 'Composición', fullVideo: 'DDS completo', fullMilky: 'Milky completo',
  ink: 'Tinta original', distort: 'Tinta deformada', normal: 'Normal', add: 'Suma', multiply: 'Multiplicar', screen: 'Trama',
  'show-strip': 'Pantalla LED completa · 2688 × 1008', reference: 'Encuadre original · referencia',
  'legacy-overlap': 'Patch original · superpuestas', stripes: 'Distribuir en seis franjas' };
const prettyValue = value => PRESET_NAMES[value] || VALUE_NAMES[value] || String(value).replace(/^(\d+)x(\d+)$/, '$1 × $2');
const option = (value, label = prettyValue(value)) => {
  const node = el('option', '', label); node.value = String(value); return node;
};
const button = (text, callback, className = '') => {
  const node = el('button', className, text); node.type = 'button';
  if (callback) node.addEventListener('click', callback); return node;
};
const check = (text, input) => { const label = el('label', 'check-field'); label.append(input, document.createTextNode(text)); return label; };
const download = (blob, name) => {
  const url = URL.createObjectURL(blob); const link = el('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
};
const dateName = () => new Date().toISOString().replaceAll(':', '-').slice(0, 19);
const safeText = error => error?.message || String(error);
const clipAvailability = clip => !clip ? { state: 'missing', text: 'Sin secuencia' }
  : clip.placeholder ? { state: 'placeholder', text: 'Placeholder (1 frame)' }
  : clip.availableFrames == null ? { state: 'unknown', text: 'Sin verificar' }
    : clip.availableFrames === 0 ? { state: 'missing', text: 'Faltante' }
      : clip.availableFrames < clip.frameCount ? { state: 'partial', text: 'Parcial' }
        : { state: 'ready', text: 'Disponible' };

/** Bind the visible interface to the same public parameter store used by MIDI and OSC. */
export function mountSystemUI(system) {
  const params = system.params;
  const definitions = params.list();
  const defById = new Map(definitions.map(spec => [spec.id, spec]));
  const bindings = new Map();
  const cleanups = [];
  const deckViews = [];
  const paramGroups = [];
  let tab = 'effects';
  let searching = false;
  let mappingPage = 0;
  const mappingPageSize = 20;
  const mappingProfile = row => row.origin === 'webextension' ? 'web' : row.sourcePatch ? 'native' : 'custom';
  let notificationTimer;
  let midiStatusTimer;
  let disposed = false;
  const notify = (message, isError = false) => {
    const node = $('system-notification'); node.querySelector('span').textContent = safeText(message);
    node.classList.toggle('error', isError); node.hidden = false;
    clearTimeout(notificationTimer); notificationTimer = setTimeout(() => { node.hidden = true; }, isError ? 12000 : 5000);
  };
  const guard = fn => async event => {
    try { return await fn(event); } catch (error) { notify(error, true); }
  };
  const click = (id, fn) => $(id).addEventListener('click', guard(fn));
  const on = (type, fn) => { const off = system.on?.(type, fn); if (typeof off === 'function') cleanups.push(off); };
  const observe = (id, fn) => {
    if (!bindings.has(id)) bindings.set(id, new Set()); bindings.get(id).add(fn); fn(params.get(id));
  };
  const write = (id, value) => {
    try { params.set(id, value, { source: 'ui' }); } catch (error) { notify(error, true); }
  };
  const trigger = (id, value) => params.trigger(id, value, { source: 'ui' });
  const bindInput = (input, id, { options, event = 'input' } = {}) => {
    const spec = defById.get(id);
    input.dataset.param = id;
    input.title = `${spec?.label || id} · ${id}`;
    if (!spec) { input.disabled = true; return input; }
    const values = options || spec.options;
    input.addEventListener(event, () => {
      const value = input.type === 'checkbox' ? input.checked : values
        ? values.find(candidate => String(candidate) === input.value) : Number(input.value);
      if (input.type === 'number' && (input.value === '' || !input.validity.valid)) return;
      write(id, value);
    });
    observe(id, value => {
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (document.activeElement !== input) input.value = String(value ?? '');
    });
    return input;
  };
  const numberInput = (id, type = 'number') => {
    const spec = defById.get(id); const input = el('input'); input.type = type;
    if (spec) { input.min = spec.min; input.max = spec.max; input.step = spec.step || (spec.type === 'int' ? 1 : .01); }
    return bindInput(input, id);
  };
  const checkbox = id => { const input = el('input'); input.type = 'checkbox'; return bindInput(input, id, { event: 'change' }); };
  const select = (id, values, labels) => {
    const choices = values || defById.get(id)?.options || [];
    const input = el('select'); choices.forEach((value, index) => input.append(option(value, labels?.[index] || prettyValue(value))));
    return bindInput(input, id, { options: choices, event: 'change' });
  };
  const toggleButton = (node, id, trueLabel, falseLabel) => {
    node.dataset.param = id;
    node.addEventListener('click', () => write(id, !params.get(id)));
    observe(id, value => { node.textContent = value ? trueLabel : falseLabel; node.setAttribute('aria-pressed', String(Boolean(value))); });
  };
  const learnTarget = target => {
    $('mapping-target').value = target; setTab('midi');
    $('mapping-search').value = target; $('mapping-profile-filter').value = 'all'; mappingPage = 0;
    system.mapper.learnTarget(target, { label: defById.get(target)?.label || target,
      output: defById.get(target)?.type === 'action' ? 'action' : 'control' });
    $('learn-status').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  function parameterRow(spec) {
    const row = el('div', `param-row ${spec.type}-row`); row.dataset.parameter = spec.id;
    const label = el('label', 'param-label', spec.label); label.append(el('small', '', spec.id));
    const tools = el('div', 'param-tools');
    const learn = button('M', guard(() => learnTarget(spec.id))); learn.title = `Asignar MIDI a ${spec.label}`;
    learn.setAttribute('aria-label', `Aprender MIDI: ${spec.label}`); tools.append(learn);
    if (spec.type !== 'action') {
      const reset = button('↺', () => write(spec.id, spec.default)); reset.title = `Restaurar: ${prettyValue(spec.default)}`;
      reset.setAttribute('aria-label', `Restaurar ${spec.label}`); tools.append(reset);
    }
    const value = el('div', 'param-value'); let input;
    if (spec.type === 'bool') input = checkbox(spec.id);
    else if (spec.type === 'enum') input = select(spec.id);
    else if (spec.type === 'action') {
      input = button('Disparar', guard(() => trigger(spec.id, spec.id === 'scene.goto' ? params.get('scene.current') : undefined)));
      input.dataset.param = spec.id;
    } else {
      const range = numberInput(spec.id, 'range'); range.setAttribute('aria-label', spec.label);
      value.append(range); input = numberInput(spec.id);
    }
    input.id = `param-${spec.id.replaceAll('.', '-')}-${Math.random().toString(36).slice(2, 7)}`;
    label.htmlFor = input.id;
    input.setAttribute('aria-label', spec.label);
    value.append(input); row.append(label, tools, value);
    return row;
  }
  function buildParameters() {
    const groups = new Map();
    definitions.forEach(spec => {
      const panel = spec.id.startsWith('composition.') ? 'transform' : 'effects';
      const key = `${panel}:${spec.group || 'Sistema'}`;
      if (!groups.has(key)) groups.set(key, { panel, title: spec.group || 'Sistema', specs: [] });
      groups.get(key).specs.push(spec);
    });
    const priority = title => ({ 'Milky FINAL': 0, 'Mezcla': 1, 'Sistema': 2, 'Salida': 3, 'Deformación global': 0 }[title] ?? 10);
    [...groups.values()].sort((a, b) => priority(a.title) - priority(b.title)).forEach(({ panel, title, specs }) => {
      const group = el('details', 'param-group'); const heading = el('summary', '', title);
      heading.append(el('span', '', specs.length)); group.append(heading);
      group.open = title === 'Milky FINAL' || title === 'Deformación global';
      const body = el('div', 'param-group-body');
      const rows = specs.map(spec => ({ spec, element: parameterRow(spec) }));
      rows.forEach(({ element }) => body.append(element)); group.append(body);
      $(`${panel}-parameters`).append(group); paramGroups.push({ element: group, rows, panel, defaultOpen: group.open });
    });
    $('parameter-count').textContent = `${definitions.length} destinos`;
    ['transport.sync', 'transport.followMidi'].forEach(id => $('midi-clock-controls').append(parameterRow(defById.get(id))));
    ['scene.current', 'scene.automation'].forEach(id => $('scene-controls').append(parameterRow(defById.get(id))));
  }
  function setTab(next) {
    tab = next;
    document.querySelectorAll('[data-tab]').forEach(node => {
      const selected = node.dataset.tab === tab; node.setAttribute('aria-selected', String(selected)); node.tabIndex = selected ? 0 : -1;
    });
    filterParameters();
  }
  function filterParameters() {
    const query = $('parameter-search').value.trim().toLocaleLowerCase();
    if (query && !searching) paramGroups.forEach(group => { group.beforeSearchOpen = group.element.open; });
    if (!query && searching) paramGroups.forEach(group => { group.element.open = group.beforeSearchOpen; });
    searching = Boolean(query);
    document.querySelector('.inspector').classList.toggle('searching', Boolean(query));
    document.querySelectorAll('.inspector-panel').forEach(panel => {
      panel.hidden = query ? !panel.classList.contains('parameter-panel') : panel.id !== `panel-${tab}`;
    });
    let matches = 0;
    paramGroups.forEach(group => {
      let count = 0;
      group.rows.forEach(({ spec, element }) => {
        const found = !query || `${spec.id} ${spec.label} ${spec.group}`.toLocaleLowerCase().includes(query);
        element.hidden = !found; if (found) count++;
      });
      group.element.hidden = !count;
      if (query) group.element.open = true;
      group.element.querySelector('summary>span').textContent = count; matches += count;
    });
    $('search-feedback').hidden = !query;
    $('search-feedback').textContent = matches ? `${matches} parámetros en todos los grupos` : 'No hay parámetros con ese nombre.';
  }

  function clipLabel(clip) {
    const available = clipAvailability(clip);
    return `${String((clip.index ?? 0) + 1).padStart(2, '0')} · ${clip.name}${available.state === 'ready' ? '' : ` · ${available.text.toLowerCase()}`}`;
  }
  function opacityControl(id, text) {
    const row = el('label', 'deck-slider'); row.append(el('span', '', text));
    const range = numberInput(id, 'range'); range.setAttribute('aria-label', `${text} · ${defById.get(id)?.label}`);
    const output = el('output'); observe(id, value => { output.textContent = `${Math.round((value || 0) * 100)}%`; });
    row.append(range, output); return row;
  }
  function buildDecks() {
    for (let index = 0; index < 7; index++) {
      const full = index === 0, stripe = index - 1, prefix = full ? 'player.full' : `players.${stripe}`;
      const card = el('article', `deck${full ? ' full-deck' : ''}`); card.dataset.deck = String(index);
      const main = el('div', 'deck-main'), mixing = el('div', 'deck-mixing'), playback = el('div', 'deck-playback');
      const heading = el('div', 'deck-heading'); heading.append(el('span', 'deck-number', full ? 'F' : index), el('strong', '', full ? 'CAPA COMPLETA' : `BLOQUE ${index}`));
      const status = el('span', 'deck-status', 'Sin medios'); heading.append(status);
      const clips = el('select', 'clip-select'); clips.dataset.param = `${prefix}.clip`; clips.setAttribute('aria-label', `Secuencia ${full ? 'completa' : `bloque ${index}`}`);
      clips.addEventListener('change', () => write(`${prefix}.clip`, Number(clips.value)));
      observe(`${prefix}.clip`, value => { clips.value = String(value); refreshDecks(); });
      const info = el('p', 'clip-info'); main.append(heading, clips, info);
      mixing.append(opacityControl(full ? 'mix.fullVideo' : `mix.stripes.${stripe}.video`, 'DDS'), opacityControl(full ? 'mix.fullMilky' : `mix.stripes.${stripe}.milky`, 'Milky'));
      const preset = el('label', 'deck-preset'); preset.append(el('span', '', 'Preset'));
      preset.append(full ? select('milky.full.preset') : select(`milky.stripes.${stripe}.preset`, [0, 1, 2, 3], ['1A', '3A', '2A', 'SPLASH A'])); mixing.append(preset);
      if (full) mixing.append(check('DDS como entrada del efecto', checkbox('milky.externalSeed')));
      const transport = el('div', 'deck-transport'); const play = button('Pausar', null, 'deck-play');
      toggleButton(play, `${prefix}.playing`, 'Pausar', 'Play'); transport.append(play, check('Loop', checkbox(`${prefix}.loop`)));
      const speed = el('label', 'deck-speed'); speed.append(document.createTextNode('×'), numberInput(`${prefix}.speed`)); transport.append(speed);
      const seekRow = el('label', 'deck-seek-row'); const seek = numberInput(`${prefix}.seek`, 'range'); seek.setAttribute('aria-label', `Posición de secuencia ${index}`);
      const frame = el('output', '', '0'); seekRow.append(seek, frame); playback.append(transport, seekRow);
      const details = el('details', 'deck-options'); details.append(el('summary', '', 'Opciones de reproducción'));
      const options = el('div', 'deck-options-body');
      options.append(check('Reversa', checkbox(`${prefix}.reverse`)), check('Ping-pong', checkbox(`${prefix}.pingpong`)));
      for (const [key, name] of [['start', 'Entrada'], ['end', 'Salida'], ['slow', '+ ciclo (s)']]) {
        const label = el('label', 'inline-field', name); label.append(numberInput(`${prefix}.${key}`)); options.append(label);
      }
      if (!full) options.append(check('Máscara', checkbox(`graphics.blocks.${stripe}`)));
      details.append(options); playback.append(details); card.append(main, mixing, playback); $('deck-mixer').append(card);
      deckViews.push({ index, prefix, card, clips, info, status, seek, frame });
    }
  }
  function refreshDecks(stats = system.stats) {
    const clips = system.manifest?.clips || [];
    deckViews.forEach(view => {
      const clip = clips.find(item => item.index === Number(params.get(`${view.prefix}.clip`)));
      const deck = stats?.decks?.[view.index] || system.decks?.[view.index];
      // The live deck knows whether it is standing in for a clip without media (temporary fallback).
      const live = system.decks?.[view.index];
      const substitute = live?.substituteFor != null && live.substituteFor === clip?.index;
      const playing = substitute ? clips.find(item => item.id === live.clipId) : null;
      const availability = clipAvailability(clip);
      const state = substitute ? 'substitute' : availability.state === 'ready' ? deck?.status || 'ready' : availability.state;
      const statusNames = { playing: 'Play', paused: 'Pausa', loading: 'Cargando', ready: 'Listo', missing: 'Faltante', partial: 'Parcial', placeholder: 'Placeholder', ended: 'Fin', error: 'Error', unknown: 'Sin verificar', substitute: 'Sustituto' };
      view.status.dataset.state = state; view.status.textContent = statusNames[state] || state;
      view.status.title = substitute && playing ? `${clip.name}: ${availability.text.toLowerCase()} en disco. Reproduce ${clipLabel(playing)} como sustituto temporal.`
        : deck?.error || `${availability.text}${clip ? ` · ${clip.name}` : ''}`;
      view.info.classList.toggle('substitute', substitute);
      view.info.textContent = substitute && playing ? `→ ${clipLabel(playing)} · sustituto temporal`
        : clip ? `${clip.width ? `${clip.width} × ${clip.height} · ` : ''}${number(clip.availableFrames ?? 0)} / ${number(clip.frameCount)} frames${clip.format ? ` · ${clip.format}` : ''}` : 'Seleccioná una secuencia';
      const position = Number(deck?.position ?? 0);
      if (document.activeElement !== view.seek && Number.isFinite(position)) view.seek.value = String(position);
      view.frame.textContent = String(Math.max(0, Math.round(deck?.frame ?? 0)));
    });
  }
  function refreshCatalog() {
    const manifest = system.manifest || { clips: [] }; const clips = manifest.clips || [];
    deckViews.forEach(view => {
      view.clips.replaceChildren(...clips.map(clip => option(clip.index, clipLabel(clip))));
      view.clips.value = String(params.get(`${view.prefix}.clip`));
    });
    const selectedClip = $('remap-clip').value, selectedRoot = $('remap-root').value;
    $('remap-clip').replaceChildren(option('', 'Todo el catálogo'), ...clips.map(clip => option(clip.id, clipLabel(clip))));
    $('remap-clip').value = selectedClip;
    $('remap-root').replaceChildren(...(manifest.roots || []).map(root => option(root.id, `${root.label}${root.exists === false ? ' · no encontrada' : ''}`)));
    if ([...$('remap-root').options].some(item => item.value === selectedRoot)) $('remap-root').value = selectedRoot;
    const total = manifest.totals || {};
    const available = total.availableFrames ?? clips.reduce((sum, clip) => sum + (clip.availableFrames || 0), 0);
    const expected = total.expectedFrames ?? clips.reduce((sum, clip) => sum + (clip.frameCount || 0), 0);
    const complete = total.completeClips ?? clips.filter(clip => clipAvailability(clip).state === 'ready').length;
    const fallback = complete < clips.length && params.get('media.fallback');
    $('media-summary').textContent = `${complete} / ${clips.length} secuencias completas · ${number(available)} frames disponibles${fallback ? ' · las faltantes se sustituyen (temporal)' : ''}`;
    const sources = (manifest.roots || []).filter(root => root.clips > 0).map(root => `${root.path} (${root.clips})`);
    $('catalog-summary').textContent = `${number(available)} de ${number(expected)} frames disponibles. ${complete} secuencias completas de ${clips.length}. ${fallback ? 'Las secuencias sin medios completos reproducen un sustituto; cada deck lo indica.' : 'Los frames faltantes se indican en cada deck.'}${sources.length ? ` Carpetas en uso: ${sources.join(' · ')}.` : ''}`;
    renderCatalog(); refreshDecks();
  }
  function renderCatalog() {
    const query = $('catalog-search').value.toLocaleLowerCase(), missingOnly = $('catalog-missing').checked;
    const clips = (system.manifest?.clips || []).filter(clip => clip.name.toLocaleLowerCase().includes(query)
      && (!missingOnly || clipAvailability(clip).state !== 'ready'));
    $('catalog-list').replaceChildren(...clips.map(clip => {
      const row = el('article', 'catalog-entry'), availability = clipAvailability(clip);
      row.append(el('strong', '', `${String(clip.index + 1).padStart(2, '0')} · ${clip.name}`), el('span', `catalog-badge ${availability.state}`, availability.text));
      row.append(el('small', '', `${number(clip.availableFrames ?? 0)} / ${number(clip.frameCount)} frames · ${clip.fps || 30} fps${clip.width ? ` · ${clip.width} × ${clip.height}` : ''}${clip.headerError ? ` · ${clip.headerError}` : ''}`));
      return row;
    }));
    if (!clips.length) $('catalog-list').append(el('p', 'muted', 'No hay secuencias que coincidan.'));
  }

  function targetOptions() {
    return definitions.map(spec => option(spec.id, `${spec.label} · ${spec.id}`));
  }
  function updateMapping(id, update) {
    const rows = system.mapper.list(); const row = rows.find(item => item.id === id);
    if (!row) return;
    update(row); system.mapper.setMappings(rows, { persist: true });
  }
  function mappingField(text, input, wide = false) {
    const field = el('label', wide ? 'span-two' : '', text); field.append(input); return field;
  }
  function editorInput(type, value, callback, properties = {}) {
    const node = el('input'); node.type = type; node.value = value ?? ''; Object.assign(node, properties);
    node.addEventListener('change', guard(() => callback(node.value))); return node;
  }
  function editorSelect(choices, value, callback) {
    const node = el('select'); choices.forEach(item => node.append(Array.isArray(item) ? option(item[0], item[1]) : option(item)));
    node.value = value; node.addEventListener('change', guard(() => callback(node.value))); return node;
  }
  function renderMappings() {
    const open = new Set([...$('mapping-list').querySelectorAll('details[open]')].map(node => node.dataset.mapping));
    const query = $('mapping-search').value.toLocaleLowerCase(); const mappings = system.mapper.list();
    $('mapping-count').textContent = `${mappings.length} asignaciones`;
    const profile = $('mapping-profile-filter').value;
    const rows = mappings.filter(row => (profile === 'all' || mappingProfile(row) === profile)
      && `${row.id} ${row.label || ''} ${row.target} ${describeSource(row.source)}`.toLocaleLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(rows.length / mappingPageSize));
    mappingPage = Math.min(mappingPage, pages - 1);
    $('mapping-page-info').textContent = `${rows.length} resultados · ${mappingPage + 1} / ${pages}`;
    $('mapping-prev').disabled = mappingPage === 0; $('mapping-next').disabled = mappingPage === pages - 1;
    $('mapping-list').replaceChildren(...rows.slice(mappingPage * mappingPageSize, (mappingPage + 1) * mappingPageSize).map(row => {
      const details = el('details', 'mapping-row'); details.dataset.mapping = row.id; details.open = open.has(row.id);
      const heading = el('summary'); const title = el('span', 'mapping-title');
      title.append(el('strong', '', row.label || defById.get(row.target)?.label || row.target),
        el('small', '', `${describeSource(row.source)} → ${row.target}`));
      const origin = mappingProfile(row);
      title.append(el('span', `mapping-profile ${origin}`, { web: 'Ampliación web', native: 'Patch vvvv', custom: 'Personalizado' }[origin]));
      heading.append(el('span', `mapping-dot${row.enabled === false ? ' off' : ''}`), title); details.append(heading);
      const buildEditor = () => {
      if (details.querySelector('.mapping-editor')) return;
      const editor = el('div', 'mapping-editor'); const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = row.enabled !== false;
      enabled.addEventListener('change', guard(() => updateMapping(row.id, entry => { entry.enabled = enabled.checked; })));
      editor.append(check('Habilitado', enabled));
      const label = editorInput('text', row.label, value => updateMapping(row.id, entry => { entry.label = value; }));
      editor.append(mappingField('Nombre', label, true));
      const target = el('select'); target.append(...targetOptions()); target.value = row.target;
      target.addEventListener('change', guard(() => updateMapping(row.id, entry => {
        entry.target = target.value; entry.output = defById.get(target.value)?.type === 'action' ? 'action' : 'control';
      }))); editor.append(mappingField('Destino', target, true));
      const sourceKind = row.source?.kind || 'note';
      editor.append(mappingField('Origen', editorSelect([['note', 'Nota'], ['cc', 'CC'], ['osc', 'OSC'], ['transport', 'Transporte'], ['pitchbend', 'Pitch bend'], ['aftertouch', 'Aftertouch'], ['polyaftertouch', 'Poly aftertouch'], ['program', 'Programa']], sourceKind, kind => updateMapping(row.id, entry => {
        const previous = entry.source || {}; entry.source = { kind };
        if (previous.deviceId) entry.source.deviceId = previous.deviceId;
        if (!['osc', 'transport'].includes(kind)) entry.source.channel = previous.channel || 1;
        if (kind === 'note' || kind === 'polyaftertouch') entry.source.note = 36;
        if (kind === 'cc') entry.source.cc = 1;
        if (kind === 'osc') entry.source.address = '/fx1';
        if (kind === 'transport') entry.source.command = 'start';
      }))));
      editor.append(mappingField('Modo', editorSelect([['auto', 'Automático'], ['trigger', 'Disparo'], ['toggle', 'Alternar'], ['gate', 'Mientras se mantiene'], ['velocity', 'Velocidad de nota'], ['range', 'Rango continuo'], ['set', 'Valor fijo']], row.mode || 'auto', mode => updateMapping(row.id, entry => { entry.mode = mode; }))));
      if (!['osc', 'transport'].includes(sourceKind)) {
        editor.append(mappingField('Canal · vacío = todos', editorInput('number', row.source?.channel, value => updateMapping(row.id, entry => {
          entry.source ||= { kind: sourceKind }; if (value === '') delete entry.source.channel; else entry.source.channel = Number(value);
        }), { min: '1', max: '16', step: '1' })));
      }
      if (sourceKind === 'note' || sourceKind === 'polyaftertouch') {
        const note = row.source?.notes?.join(',') ?? row.source?.noteRange?.join('..') ?? row.source?.note ?? '';
        editor.append(mappingField('Nota(s) · 36,41 o 0..71', editorInput('text', note, value => updateMapping(row.id, entry => {
          entry.source ||= { kind: sourceKind }; delete entry.source.note; delete entry.source.notes; delete entry.source.noteRange;
          const text = value.trim();
          if (text.includes('..')) entry.source.noteRange = text.split('..').map(Number);
          else if (text.includes(',')) entry.source.notes = text.split(',').map(part => Number(part.trim()));
          else if (text) entry.source.note = Number(text);
        }))));
      } else if (sourceKind === 'cc') {
        editor.append(mappingField('CC · vacío = todos', editorInput('number', row.source?.cc, value => updateMapping(row.id, entry => {
          entry.source ||= { kind: 'cc' }; if (value === '') delete entry.source.cc; else entry.source.cc = Number(value);
        }), { min: '0', max: '127', step: '1' })));
      } else if (sourceKind === 'osc') {
        editor.append(mappingField('Dirección OSC', editorInput('text', row.source?.address || '/fx1', value => updateMapping(row.id, entry => { entry.source = { ...entry.source, kind: 'osc', address: value }; })), true));
      } else if (sourceKind === 'transport') {
        editor.append(mappingField('Mensaje', editorSelect(['start', 'continue', 'stop', 'clock', 'position'], row.source?.command || 'start', value => updateMapping(row.id, entry => { entry.source = { ...entry.source, kind: 'transport', command: value }; }))));
      }
      for (const [key, name] of [['min', 'Mínimo de salida'], ['max', 'Máximo de salida']]) editor.append(mappingField(name, editorInput('number', row[key], value => updateMapping(row.id, entry => {
        if (value === '') delete entry[key]; else entry[key] = Number(value);
      }), { step: 'any' })));
      editor.append(mappingField('Escenas · vacío = todas', editorInput('text', row.scenes?.join(',') || '', value => updateMapping(row.id, entry => {
        const list = value.trim(); if (!list) delete entry.scenes; else entry.scenes = list.split(',').map(item => Number(item.trim()));
      })), true));
      const advanced = el('details'); advanced.append(el('summary', '', 'Configuración completa · JSON'));
      const json = el('textarea'); json.value = JSON.stringify(row, null, 2); json.setAttribute('aria-label', `JSON del mapeo ${row.id}`);
      advanced.append(json, button('Aplicar JSON', guard(() => {
        const replacement = JSON.parse(json.value); const list = system.mapper.list();
        list[list.findIndex(item => item.id === row.id)] = replacement; system.mapper.setMappings(list, { persist: true });
      }))); editor.append(advanced);
      const actions = el('div', 'mapping-actions'); actions.append(button('Aprender', guard(() => system.mapper.learn(row.id))), button('Eliminar', guard(() => system.mapper.setMappings(system.mapper.list().filter(item => item.id !== row.id), { persist: true }))));
      editor.append(actions); details.append(editor);
      };
      if (details.open) buildEditor();
      details.addEventListener('toggle', () => { if (details.open) buildEditor(); });
      return details;
    }));
    if (!rows.length) $('mapping-list').append(el('p', 'muted', 'No hay mapeos que coincidan.'));
  }
  function showLearn({ rowId } = {}) {
    $('learn-status').hidden = !rowId;
    if (rowId) {
      const row = system.mapper.list().find(item => item.id === rowId);
      $('learn-status').querySelector('span').textContent = `Mové un control para ${defById.get(row?.target)?.label || row?.target || 'el destino seleccionado'}…`;
    }
  }
  function renderDevices(devices) {
    if (devices === undefined) devices = system.midi?.listInputs?.() || [];
    $('midi-devices').replaceChildren(...devices.map(device => {
      const row = el('label', 'device-item'), input = el('input'); input.type = 'checkbox'; input.checked = device.enabled;
      input.addEventListener('change', guard(() => {
        const selected = system.midi.listInputs().filter(item => item.id === device.id ? input.checked : item.enabled).map(item => item.id);
        system.midi.setEnabled(selected);
      }));
      const state = device.listening ? 'abierto · escuchando' : device.error || (device.state === 'connected' ? 'disponible' : 'desconectado');
      const text = el('span', '', device.name); text.append(el('small', '', `${device.manufacturer || 'MIDI'} · ${state}`));
      row.append(input, text); return row;
    }));
    if (!devices.length) $('midi-devices').append(el('p', 'muted', 'Sin entradas MIDI conectadas. Podés seguir usando los controles manuales y OSC.'));
    $('midi-connect').textContent = devices.length ? 'Actualizar' : 'Conectar';
    renderMidiStatus();
  }
  function renderMidiStatus() {
    const status = system.midi.status();
    $('midi-live-port').textContent = status.selectedNames.join(' + ') || status.preferredName || 'MIDI';
    $('midi-live-led').dataset.state = status.state;
    const labels = { idle: 'MIDI sin iniciar', requesting: 'Esperando permiso del navegador…', connecting: 'Abriendo puerto…',
      listening: `Abierto · escuchando · ${status.received} mensajes`, missing: 'El puerto no aparece. Esperando conexión…',
      disabled: 'Sin entradas seleccionadas', error: status.error || 'No se pudo abrir MIDI' };
    $('midi-live-status').textContent = labels[status.state] || status.state;
    $('midi-live-connect').hidden = status.state === 'listening';
    $('midi-live-connect').textContent = status.state === 'error' ? 'Reintentar MIDI' : 'Permitir MIDI';
    $('midi-live-mode').textContent = system.controlMode === 'show' ? 'Show MIDI · notas originales vvvv'
      : 'Muestra manual · la próxima nota del show toma el control';
    if (system.controlMode === 'show') document.querySelectorAll('[data-look]').forEach(node => node.classList.remove('active'));
    $('midi-use-vvvv').setAttribute('aria-pressed', String(system.controlMode === 'show'));
  }
  function scheduleMidiStatus() {
    if (midiStatusTimer) return;
    midiStatusTimer = setTimeout(() => { midiStatusTimer = null; if (!disposed) renderMidiStatus(); }, 80);
  }
  function monitor(payload) {
    const msg = payload?.msg || payload; if (!msg?.kind) return;
    let detail = msg.kind;
    if (msg.kind === 'note') detail = `NOTA ${msg.note} ${msg.on ? 'ON' : 'OFF'} · v${msg.velocity ?? 0}`;
    else if (msg.kind === 'cc') detail = `CC ${msg.cc} · ${msg.value}`;
    else if (msg.kind === 'osc') detail = `${msg.address} · ${JSON.stringify(msg.args ?? msg.value ?? '')}`;
    else if (msg.kind === 'transport') detail = `RELOJ · ${msg.command}`;
    else detail = `${msg.kind.toUpperCase()} · ${msg.value ?? msg.program ?? ''}`;
    const row = el('li', '', `${new Date().toLocaleTimeString('es-AR')} ${msg.channel ? `· CH ${msg.channel} ` : ''}· ${detail}`);
    const fired = payload?.fired?.length ? ` → ${payload.fired.map(item => typeof item === 'string' ? item : item.target || item.id || '').join(', ')}` : '';
    if (msg.kind === 'note' || msg.kind === 'cc') $('midi-live-last').textContent = `CH ${msg.channel} · ${detail} · ${payload?.fired?.length || 0} destinos`;
    row.append(el('span', '', `${msg.deviceName || msg.deviceId || 'Entrada'}${fired}`));
    $('midi-monitor').prepend(row); while ($('midi-monitor').children.length > 50) $('midi-monitor').lastElementChild.remove();
  }
  function refreshStats(stats = system.stats) {
    if (!stats) return;
    $('system-fps').textContent = Number.isFinite(stats.fps) ? number(Math.round(stats.fps * 10) / 10) : '—';
    $('system-frame').textContent = `Frame ${number(stats.frame || 0)}`;
    $('system-gpu').textContent = stats.gpu || 'GPU'; $('system-gpu').title = stats.gpu || '';
    const size = stats.size || String(params.get('output.resolution')).split('x').map(Number);
    $('output-size').textContent = `${size[0]} × ${size[1]}`;
    $('system-stage').style.aspectRatio = `${size[0]} / ${size[1]}`;
    const active = params.get('transport.playing') ? 'En vivo' : 'En pausa';
    $('system-status').textContent = `${active} · escena ${params.get('scene.current')}${stats.passes ? ` · ${stats.passes} pases` : ''}${stats.media?.cached ? ` · ${stats.media.cached} frames en memoria` : ''}`;
    refreshDecks(stats);
  }
  function refreshScenes() {
    const current = Number(params.get('scene.current'));
    $('scene-grid').querySelectorAll('button').forEach(node => {
      const scene = Number(node.dataset.scene); node.setAttribute('aria-pressed', String(scene === current));
      node.title = system.sceneSnapshots?.[scene] ? `Escena ${scene} · guardada` : `Escena ${scene}`;
      node.classList.toggle('saved', Boolean(system.sceneSnapshots?.[scene]));
    });
  }

  buildParameters(); buildDecks();
  $('media-fallback-control').append(check('Sustituir secuencias faltantes por una disponible (temporal)', checkbox('media.fallback')));
  observe('media.fallback', () => { if (system.manifest) refreshCatalog(); });
  $('mapping-target').append(...targetOptions()); $('mapping-target').value = 'final.fx1';
  toggleButton($('system-play'), 'transport.playing', 'Pausar', 'Reproducir');
  toggleButton($('system-blackout'), 'output.blackout', 'Blackout activo', 'Blackout');
  bindInput($('system-scene'), 'scene.current', { event: 'change' });
  bindInput($('system-bpm'), 'transport.bpm', { event: 'change' });
  observe('output.blackout', value => { $('blackout-indicator').hidden = !value; });
  observe('scene.current', refreshScenes);
  observe('transport.playing', () => refreshStats());
  observe('output.resolution', value => { const [w, h] = String(value).split('x'); $('output-size').textContent = `${w} × ${h}`; });
  cleanups.push(params.onChange((id, value) => { bindings.get(id)?.forEach(fn => fn(value)); }));
  click('system-reset', () => system.reset());
  click('system-capture', async () => {
    const node = $('system-capture'); node.disabled = true;
    try { download(await system.capture(), `parte2-${dateName()}.png`); notify(`Captura guardada · ${params.get('output.resolution')}`); }
    finally { node.disabled = false; }
  });
  click('system-output', () => system.openOutput());
  const fullscreen = async () => document.fullscreenElement ? document.exitFullscreen() : $('system-stage').requestFullscreen();
  click('system-fullscreen', fullscreen);
  document.querySelectorAll('[data-look]').forEach(node => node.addEventListener('click', guard(async () => {
    await system.runLook(node.dataset.look); document.querySelectorAll('[data-look]').forEach(other => other.classList.toggle('active', other === node));
  })));
  document.querySelectorAll('[data-action]').forEach(node => node.addEventListener('click', guard(() => trigger(node.dataset.action))));
  document.querySelectorAll('[data-tab]').forEach(node => {
    node.addEventListener('click', () => { $('parameter-search').value = ''; setTab(node.dataset.tab); });
    node.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('[data-tab]')]; const index = tabs.indexOf(node);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[next].click(); tabs[next].focus();
    });
  });
  $('parameter-search').addEventListener('input', filterParameters);
  click('parameter-search-clear', () => { $('parameter-search').value = ''; filterParameters(); });
  click('session-export', () => download(new Blob([JSON.stringify(system.exportSession(), null, 2)], { type: 'application/json' }), `parte2-sesion-${dateName()}.json`));
  click('session-import', () => $('session-file').click());
  $('session-file').addEventListener('change', guard(async event => {
    const file = event.target.files?.[0]; if (!file) return;
    await system.importSession(JSON.parse(await file.text())); event.target.value = ''; refreshScenes(); notify('Sesión importada.');
  }));
  click('midi-connect', async () => { await system.connectMidi(); renderDevices(); });
  click('midi-live-connect', async () => { await system.connectMidi(); renderDevices(); });
  click('midi-use-vvvv', async () => {
    setTab('midi'); $('mapping-profile-filter').value = 'native'; $('mapping-search').value = ''; mappingPage = 0; renderMappings();
    await system.useVvvvMidi(); renderDevices();
  });
  click('osc-connect', async () => { await system.connectOSC(); $('osc-status').textContent = 'Conectando con el receptor OSC…'; });
  click('osc-apply', async () => {
    const port = Number($('osc-port').value); if (!$('osc-port').validity.valid) throw new Error('Ingresá un puerto UDP entre 1024 y 65535.');
    await system.configureOSC(port); $('osc-status').textContent = `Receptor OSC configurado en UDP ${port}.`;
  });
  click('mapping-add', () => {
    const target = $('mapping-target').value;
    const row = { id: `manual.${Date.now()}`, label: defById.get(target)?.label || target,
      enabled: true, source: { kind: 'note', channel: 1, note: 36 }, target, mode: 'auto', output: defById.get(target)?.type === 'action' ? 'action' : 'control' };
    $('mapping-search').value = row.id; $('mapping-profile-filter').value = 'all'; mappingPage = 0;
    system.mapper.setMappings([...system.mapper.list(), row], { persist: true });
    const added = [...$('mapping-list').children].find(node => node.dataset.mapping === row.id); if (added) { added.open = true; added.scrollIntoView({ block: 'nearest' }); }
  });
  click('mapping-learn', () => learnTarget($('mapping-target').value));
  click('mapping-cancel-learn', () => system.mapper.cancelLearn());
  click('mapping-export', () => download(new Blob([system.mapper.exportJson()], { type: 'application/json' }), `parte2-mapeos-${dateName()}.json`));
  click('mapping-csv', () => download(new Blob([mappingsToCSV(system.mapper.list())], { type: 'text/csv;charset=utf-8' }), PUBLIC_MIDI_CSV_FILENAME));
  click('mapping-import', () => $('mapping-file').click());
  $('mapping-file').addEventListener('change', guard(async event => {
    const file = event.target.files?.[0]; if (!file) return; system.mapper.importJson(await file.text()); event.target.value = ''; notify('Mapeos importados.');
  }));
  click('mapping-reset', () => { system.mapper.resetToDefault(); notify('Perfil MIDI restaurado: patch vvvv y controles públicos.'); });
  const resetMappingPage = () => { mappingPage = 0; renderMappings(); };
  $('mapping-search').addEventListener('input', resetMappingPage);
  $('mapping-profile-filter').addEventListener('change', resetMappingPage);
  click('mapping-prev', () => { mappingPage--; renderMappings(); });
  click('mapping-next', () => { mappingPage++; renderMappings(); });
  click('midi-monitor-clear', () => $('midi-monitor').replaceChildren());
  click('test-midi-send', () => {
    const channel = Number($('test-midi-channel').value), n = Number($('test-midi-number').value), value = Number($('test-midi-value').value);
    if (![$('test-midi-channel'), $('test-midi-number'), $('test-midi-value')].every(input => input.validity.valid)) throw new Error('Revisá el canal, la nota y el valor del mensaje.');
    if ($('test-midi-kind').value === 'cc') system.dispatchMidi([0xb0 + channel - 1, n, value]);
    else { system.dispatchMidi([0x90 + channel - 1, n, value]); setTimeout(() => { if (!disposed) system.dispatchMidi([0x80 + channel - 1, n, 0]); }, 140); }
  });
  $('catalog-search').addEventListener('input', renderCatalog); $('catalog-missing').addEventListener('change', renderCatalog);
  click('media-remap', async () => {
    const directory = $('remap-directory').value.trim();
    const body = directory ? { directory } : { rootId: $('remap-root').value };
    if ($('remap-clip').value) body.clipId = $('remap-clip').value;
    const node = $('media-remap'); node.disabled = true; $('remap-status').textContent = 'Examinando archivos DDS…';
    try { await system.remapMedia(body); refreshCatalog(); $('remap-status').textContent = 'Carpeta asignada. Catálogo y decks actualizados.'; }
    catch (error) { $('remap-status').textContent = safeText(error); throw error; }
    finally { node.disabled = false; }
  });
  for (let scene = 60; scene <= 80; scene++) {
    const node = button(scene, guard(() => trigger('scene.goto', scene))); node.dataset.scene = String(scene); $('scene-grid').append(node);
  }
  click('scene-save', () => { const scene = params.get('scene.current'); system.saveScene(scene); refreshScenes(); $('scene-status').textContent = `Escena ${scene} guardada.`; });
  click('scene-recall', () => {
    const scene = params.get('scene.current');
    if (system.sceneSnapshots && !system.sceneSnapshots[scene]) { $('scene-status').textContent = `La escena ${scene} todavía no tiene una combinación guardada.`; return; }
    system.recallScene(scene); $('scene-status').textContent = `Escena ${scene} recuperada.`;
  });
  $('system-notification').querySelector('button').addEventListener('click', () => { $('system-notification').hidden = true; });
  const keydown = guard(event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,button,[contenteditable=true]')) return;
    if (event.code === 'Space') { event.preventDefault(); write('transport.playing', !params.get('transport.playing')); }
    else if (event.key.toLowerCase() === 'k') trigger('kick');
    else if (event.key.toLowerCase() === 's') trigger('snare');
    else if (event.key.toLowerCase() === 'b') trigger('milky.seed');
    else if (event.key.toLowerCase() === 'f') return fullscreen();
  });
  document.addEventListener('keydown', keydown); cleanups.push(() => document.removeEventListener('keydown', keydown));
  on('stats', refreshStats); on('devices', renderDevices); on('catalog', refreshCatalog); on('midi', monitor);
  on('midi-status', scheduleMidiStatus); on('control-mode', renderMidiStatus);
  on('mappings', renderMappings); on('scenes', refreshScenes); on('session', refreshScenes);
  on('osc', state => { $('osc-status').textContent = state?.connected === false ? 'Receptor OSC desconectado.' : `OSC conectado${state?.port ? ` · UDP ${state.port}` : ''}`; });
  on('error', error => {
    notify(error, true);
    if (error.fatal) { $('system-error').hidden = false; $('system-error-message').textContent = safeText(error); $('system-loading').hidden = true; }
  });
  on('warning', warning => notify(warning));
  if (system.mapper.on) cleanups.push(system.mapper.on('learn', showLearn));
  if (system.controlMode === 'show') $('mapping-profile-filter').value = 'native';
  refreshCatalog(); renderMappings(); renderDevices(); refreshScenes(); refreshStats(); setTab(system.controlMode === 'show' ? 'midi' : 'effects');
  return { notify, refresh: () => { refreshCatalog(); renderMappings(); renderDevices(); refreshScenes(); refreshStats(); },
    dispose() { disposed = true; cleanups.forEach(fn => fn?.()); clearTimeout(notificationTimer); clearTimeout(midiStatusTimer); bindings.clear(); } };
}
