// Nomenclatura OSC automática (§7.7) y generación de la hoja de referencia.
// Se regenera siempre desde el registro, nunca a mano.

export function oscAddress(def) {
  const path = def.id.replaceAll('.', '/');
  return def.isAction ? `/a/${path}` : `/p/${path}`;
}

export function oscAddressNormalized(def) {
  return def.isAction ? '' : `/pn/${def.id.replaceAll('.', '/')}`;
}

export function describeSource(source) {
  if (!source || !source.kind) return '';
  if (source.kind === 'note') return source.note == null ? `Cualquier nota ch${source.channel}` : `Nota ${source.note} ch${source.channel}`;
  if (source.kind === 'cc') return `CC ${source.cc} ch${source.channel}`;
  if (source.kind === 'osc') return source.address;
  return '';
}

export function sourcesFor(id, mappings) {
  return mappings.filter((m) => m.target === id && m.source?.kind).map((m) => m.source);
}

// Ids de mapeo: los usan tanto el panel de mapeos como el botón de learn por parámetro, y no
// se pueden pisar entre sí porque el Mapper busca la fila por id cuando llega el MIDI.
export function nextMappingId(mappings) {
  let n = 1;
  while (mappings.some((m) => m.id === `m${String(n).padStart(2, '0')}`)) n++;
  return `m${String(n).padStart(2, '0')}`;
}

// Los '|' de enums y bools rompen las tablas Markdown si no se escapan.
const mdCell = (v) => String(v ?? '').replaceAll('|', '\\|');

export function rangeOf(def) {
  if (def.isAction) return def.argHint || '';
  if (def.type === 'enum') return def.options.join(' | ');
  if (def.type === 'bool') return 'false | true';
  if (def.type === 'color') return 'hex #RRGGBB';
  return `${def.min} .. ${def.max}`;
}

export function buildReferenceMarkdown(registry, mappings, scenes) {
  const lines = [];
  lines.push('# Referencia MIDI / OSC — Visuales LED', '');
  lines.push(`Generado ${new Date().toLocaleString('es-AR')} desde el registro de parámetros.`, '');

  lines.push('## Escenas', '', '| id | nombre | fuente MIDI/OSC |', '|---|---|---|');
  for (const s of scenes) {
    const src = mappings.filter((m) => m.target === 'scene.goto' && String(m.arg) === String(s.id))
      .map((m) => describeSource(m.source)).filter(Boolean).join(', ');
    lines.push(`| ${s.id} | ${mdCell(s.name)} | ${mdCell(src)} |`);
  }
  lines.push('');

  const groups = new Map();
  for (const def of registry) {
    if (!groups.has(def.group)) groups.set(def.group, []);
    groups.get(def.group).push(def);
  }

  lines.push('## Parámetros y acciones', '');
  for (const [group, defs] of groups) {
    lines.push(`### ${group}`, '', '| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |', '|---|---|---|---|---|---|---|');
    for (const def of defs) {
      const src = sourcesFor(def.id, mappings).map(describeSource).join(', ');
      lines.push(`| \`${def.id}\` | ${mdCell(def.label)} | ${def.isAction ? 'acción' : def.type} | ${mdCell(rangeOf(def))} | \`${oscAddress(def)}\` | ${oscAddressNormalized(def) ? `\`${oscAddressNormalized(def)}\`` : ''} | ${mdCell(src)} |`);
    }
    lines.push('');
  }

  lines.push('## Rutas OSC automáticas (sin mapear nada)', '',
    '| Dirección | Efecto |', '|---|---|',
    '| `/p/<grupo>/<nombre>` f | valor en rango nativo |',
    '| `/pn/<grupo>/<nombre>` f 0..1 | valor normalizado |',
    '| `/a/<grupo>/<nombre>` [arg] | dispara la acción |',
    '| `/scene` s\\|i | cambia de escena |', '');

  return lines.join('\n');
}

export function buildReferenceCsv(registry, mappings) {
  const rows = [['id', 'etiqueta', 'grupo', 'tipo', 'rango', 'default', 'osc', 'osc_norm', 'fuentes']];
  for (const def of registry) {
    rows.push([
      def.id, def.label, def.group, def.isAction ? 'accion' : def.type, rangeOf(def),
      def.isAction ? '' : String(def.default), oscAddress(def), oscAddressNormalized(def),
      sourcesFor(def.id, mappings).map(describeSource).join(' + '),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
