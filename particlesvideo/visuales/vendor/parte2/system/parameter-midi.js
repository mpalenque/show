/** New web control surface. These bindings are explicitly NOT original vvvv MIDI wiring. */
export const PUBLIC_MIDI_PROFILE = 'parte2-public-v1';
export const PUBLIC_MIDI_CHANNELS = [11, 12, 14, 15, 16];
export const PUBLIC_MIDI_CC_COUNT = 120;
export const PUBLIC_MIDI_ACTION_CHANNEL = 16;
export const PUBLIC_MIDI_CSV_FILENAME = 'parte2-controles-midi.csv';
const copy = (value) => JSON.parse(JSON.stringify(value));
const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const sourceID = (source) => source?.kind === 'cc' ? `cc:${source.channel}:${source.cc}`
  : source?.kind === 'note' && source.note != null ? `note:${source.channel}:${source.note}` : null;

/** Deterministic v1 allocation by sorted parameter id. previous preserves learned assignments. */
export function createParameterMappings(registry, { previous = [] } = {}) {
  if (!Array.isArray(registry)) throw new TypeError('Se necesita la lista completa del registro público.');
  const allIDs = new Set();
  for (const spec of registry) {
    if (!spec?.id || typeof spec.id !== 'string' || allIDs.has(spec.id)) throw new TypeError('El registro necesita ids únicos.');
    allIDs.add(spec.id);
  }
  const parameters = registry.filter((spec) => spec.type !== 'action' && !spec.isAction).sort(order);
  const actions = registry.filter((spec) => spec.type === 'action' || spec.isAction).sort(order);
  if (parameters.length > PUBLIC_MIDI_CHANNELS.length * PUBLIC_MIDI_CC_COUNT) throw new Error('El registro supera los 600 CC disponibles del perfil público.');
  if (actions.length > 128) throw new Error('El registro supera las 128 notas disponibles para acciones.');
  const saved = new Map(previous.map((row) => [row.id, row]));
  const occupied = new Set(previous.map((row) => sourceID(row.source)).filter(Boolean));
  const slots = PUBLIC_MIDI_CHANNELS.flatMap((channel) => Array.from({ length: PUBLIC_MIDI_CC_COUNT }, (_, cc) => ({ kind: 'cc', channel, cc })));
  const noteSlots = Array.from({ length: 128 }, (_, note) => ({ kind: 'note', channel: PUBLIC_MIDI_ACTION_CHANNEL, note }));
  let ccCursor = 0, noteCursor = 0;
  const assign = (pool, kind) => {
    let cursor = kind === 'cc' ? ccCursor : noteCursor;
    while (cursor < pool.length && occupied.has(sourceID(pool[cursor]))) cursor++;
    if (cursor >= pool.length) throw new Error(`No quedan fuentes ${kind} libres para agregar controles sin cambiar asignaciones anteriores.`);
    const source = pool[cursor++];
    occupied.add(sourceID(source));
    if (kind === 'cc') ccCursor = cursor; else noteCursor = cursor;
    return source;
  };
  const rows = [];
  for (const spec of parameters) {
    const id = `web.cc.${spec.id}`;
    if (saved.has(id)) { rows.push(copy(saved.get(id))); continue; }
    rows.push({ id, source: assign(slots, 'cc'), target: spec.id, mode: 'range', output: 'control',
      min: Number.isFinite(spec.min) ? spec.min : 0, max: Number.isFinite(spec.max) ? spec.max : 1,
      label: `Control público · ${spec.label || spec.id}`, origin: 'webextension', profile: PUBLIC_MIDI_PROFILE,
      parameterType: spec.type, ...(spec.options ? { options: copy(spec.options) } : {}),
      formula: spec.type === 'bool' ? 'CC >= 64' : spec.type === 'enum' ? 'CC / 127 → registry enum bins'
        : 'min + CC / 127 × (max − min); registry rounds integers',
      fidelity: 'New editable web binding; not present in the original vvvv patch.' });
  }
  const sceneDefault = registry.find((spec) => spec.id === 'scene.current')?.default ?? 69;
  for (const spec of actions) {
    const id = `web.note.${spec.id}`;
    if (saved.has(id)) { rows.push(copy(saved.get(id))); continue; }
    rows.push({ id, source: assign(noteSlots, 'note'), target: spec.id, mode: 'trigger', output: 'action',
      arg: spec.defaultArg ?? (spec.id === 'scene.goto' ? sceneDefault : spec.id === 'transport.position' ? 0 : true),
      label: `Acción pública · ${spec.label || spec.id}`, origin: 'webextension', profile: PUBLIC_MIDI_PROFILE,
      fidelity: 'New editable web binding; not present in the original vvvv patch.' });
  }
  return rows;
}

/** CSV includes original and new profiles if callers pass their complete editable mapping table. */
export function mappingsToCSV(mappings) {
  if (!Array.isArray(mappings)) throw new TypeError('Se necesita una tabla de mapeos.');
  const columns = ['id', 'perfil', 'etiqueta', 'tipo', 'canal', 'nota', 'cc', 'osc', 'destino', 'salida', 'modo', 'min', 'max', 'argumento', 'formula', 'escenas'];
  const escape = (value) => {
    const text = value == null ? '' : Array.isArray(value) ? value.join('|') : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = mappings.map((row) => {
    const source = row.source ?? {};
    return [row.id, row.profile ?? row.sourcePatch ?? '', row.label, source.kind, source.channel,
      source.note ?? source.notes ?? source.noteRange?.join('..'), source.cc, source.address,
      row.target, row.output, row.mode, row.min, row.max, row.arg ?? row.value,
      row.formula, row.scenes];
  });
  return '\ufeff' + [columns, ...rows].map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n';
}
export const exportParameterMappingsCSV = mappingsToCSV;
