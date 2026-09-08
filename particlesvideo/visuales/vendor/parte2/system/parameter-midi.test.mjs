import test from 'node:test';
import assert from 'node:assert/strict';
import { createParameterMappings, mappingsToCSV, PUBLIC_MIDI_CHANNELS } from './parameter-midi.js';
import { Mapper, DEFAULT_MAPPINGS } from './mappings.js';
import { ParameterStore, PARAMETER_DEFINITIONS } from './parameters.js';

test('every current public parameter/action has a unique editable binding without original note collisions', () => {
  const registry = new ParameterStore().list();
  const rows = createParameterMappings(registry);
  assert.equal(rows.length, registry.length);
  assert.deepEqual(new Set(rows.map((row) => row.target)), new Set(registry.map((spec) => spec.id)));
  const cc = rows.filter((row) => row.source.kind === 'cc');
  assert.equal(new Set(cc.map((row) => `${row.source.channel}:${row.source.cc}`)).size, cc.length);
  assert.ok(cc.every((row) => PUBLIC_MIDI_CHANNELS.includes(row.source.channel) && row.source.cc <= 119));
  const actions = rows.filter((row) => row.source.kind === 'note');
  assert.equal(new Set(actions.map((row) => row.source.note)).size, actions.length);
  assert.ok(actions.every((row) => row.source.channel === 16));
  assert.ok(DEFAULT_MAPPINGS.every((row) => row.source.kind !== 'note' || row.source.channel !== 16));
  assert.ok(rows.every((row) => row.origin === 'webextension'));
  assert.deepEqual(createParameterMappings([...registry].reverse()), rows);
  assert.equal(rows.find((row) => row.target === 'scene.goto').arg, PARAMETER_DEFINITIONS.find((spec) => spec.id === 'scene.current').default);
  assert.equal(rows.find((row) => row.target === 'transport.position').arg, 0);
});

test('public CC profile operates bool, enum and integer params through the registry', () => {
  const params = new ParameterStore([
    { id: 'a.boolean', type: 'bool', default: false, min: 0, max: 1 },
    { id: 'b.enum', type: 'enum', default: 'one', options: ['one', 'two', 'three'], min: 0, max: 1 },
    { id: 'c.integer', type: 'int', default: 0, min: -4, max: 4 },
  ]);
  const rows = createParameterMappings(params.list());
  const mapper = new Mapper({ defaults: rows, storage: null, getDefinition: (id) => params.def(id),
    onControl: (id, value, meta) => meta.normalized ? params.setNormalized(id, value) : params.set(id, value) });
  const send = (target, value) => { const { source } = rows.find((row) => row.target === target); mapper.dispatch({ ...source, value }); };
  send('a.boolean', 63); assert.equal(params.get('a.boolean'), false);
  send('a.boolean', 64); assert.equal(params.get('a.boolean'), true);
  send('b.enum', 127); assert.equal(params.get('b.enum'), 'three');
  send('b.enum', 64); assert.equal(params.get('b.enum'), 'two');
  send('c.integer', 80); assert.equal(params.get('c.integer'), 1);
  mapper.dispose();
});

test('previous learned assignments stay stable and new targets use unoccupied CC slots', () => {
  const registry = [
    { id: 'z', type: 'float', default: 0, min: 0, max: 1 },
    { id: 'a', type: 'float', default: 0, min: 0, max: 1 },
  ];
  const previous = createParameterMappings(registry);
  previous[0].source = { kind: 'cc', channel: 12, cc: 99 };
  previous[0].learned = true;
  const rows = createParameterMappings([...registry, { id: '0.new', type: 'float', min: 0, max: 10 }], { previous });
  assert.deepEqual(rows.find((row) => row.target === 'a'), previous[0]);
  assert.deepEqual(rows.find((row) => row.target === 'z'), previous[1]);
  assert.equal(new Set(rows.map((row) => `${row.source.channel}:${row.source.cc}`)).size, rows.length);
  assert.throws(() => createParameterMappings(Array.from({ length: 601 }, (_, i) => ({ id: `p${i}`, type: 'float' }))), /600 CC/);
});

test('v1 migration appends public bindings without replacing learned rows; v2 respects intentional removals', async () => {
  let saved = JSON.stringify({ version: 1, mappings: [
    { id: 'custom', source: { kind: 'cc', channel: 2, cc: 77 }, target: 'x', mode: 'range' },
    { id: 'web.cc.x', source: { kind: 'cc', channel: 7, cc: 66 }, target: 'x', mode: 'range', learned: true },
  ] });
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const defaults = createParameterMappings([{ id: 'x', type: 'float' }, { id: 'y', type: 'float' }]);
  const mapper = new Mapper({ storage, defaults }); await mapper.init();
  assert.equal(mapper.mappings.length, 3);
  assert.equal(mapper.mappings.find((row) => row.id === 'web.cc.x').source.cc, 66);
  assert.ok(mapper.mappings.some((row) => row.id === 'custom'));
  assert.equal(JSON.parse(saved).version, 3);
  mapper.setMappings(mapper.mappings.filter((row) => row.id === 'custom'), { persist: true });
  const recovered = new Mapper({ storage, defaults }); await recovered.init();
  assert.deepEqual(recovered.mappings.map((row) => row.id), ['custom']);
});

test('CSV carries channels, targets, formulas and labels with correct CSV escaping', () => {
  const rows = createParameterMappings([{ id: 'fx', label: 'FX, "brillo"', type: 'float', min: -1, max: 1 }]);
  const csv = mappingsToCSV(rows);
  assert.ok(csv.startsWith('\ufeff"id","perfil"'));
  assert.ok(csv.includes('"Control público · FX, ""brillo"""'));
  assert.ok(csv.includes('"cc","11","","0"'));
  assert.ok(csv.includes('parte2-public-v1'));
});
