import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Mapper, MAPPINGS_VERSION } from '../src/io/Mapper.js';

const defaults = JSON.parse(await readFile(new URL('../public/mappings.default.json', import.meta.url)));
const fullLine = defaults.mappings.find((row) => row.id === 'full-line');
const flip = defaults.mappings.find((row) => row.id === 'perc-creepy-bell-line-flip');

async function withSavedMappings(mappings, check, version = 11) {
  let stored = JSON.stringify({ version, mappings });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => stored,
    setItem: (_key, value) => { stored = value; },
  } });
  const triggered = [];
  const mapper = new Mapper({ params: {
    def: () => undefined,
    hasAction: (id) => ['line.strike', 'line.flip'].includes(id),
    trigger: (...args) => triggered.push(args),
  } });
  mapper._loadDefaultMappings = async () => defaults.mappings;
  try {
    await mapper.init();
    await check(mapper, triggered, () => JSON.parse(stored));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('escena 2 recibe sólo inversión; el trueno conserva su nota aprendida y otras escenas', async () => {
  const source = { kind: 'note', channel: 8, note: 75 };
  const learned = { ...fullLine, source, scenes: ['2', '3', '4', '5', '6', '9', '12'], updatedIn: 0 };
  const note = { ...source, on: true, velocity: 100 };
  await withSavedMappings([learned, flip], async (mapper, triggered, saved) => {
    const migrated = mapper.mappings.find((row) => row.id === 'full-line');
    assert.deepEqual(migrated, { ...learned, scenes: ['3', '4', '5', '6', '9', '12'], updatedIn: 12 });
    assert.equal(saved().version, MAPPINGS_VERSION);
    mapper.onSceneChange('2');
    mapper.dispatch(note);
    assert.deepEqual(triggered, []);
    mapper.dispatch({ ...flip.source, on: true, velocity: 100 });
    assert.deepEqual(triggered, [['line.flip', undefined]]);
    mapper.dispatch({ ...flip.source, on: false, velocity: 0 });
    assert.equal(triggered.length, 1);

    for (const scene of migrated.scenes) {
      triggered.length = 0;
      mapper.onSceneChange(scene);
      mapper.dispatch(note);
      assert.deepEqual(triggered, [['line.strike', 'random']], scene);
      mapper.dispatch({ ...flip.source, on: true, velocity: 100 });
      assert.equal(triggered.length, 1, `flip no debe afectar escena ${scene}`);
    }
    await mapper.init();
    assert.deepEqual(mapper.mappings.find((row) => row.id === 'full-line'), migrated);
  });
});

test('migración conserva destino personalizado, alcance global y modo personalizado', async () => {
  for (const overrides of [
    { target: 'line.flip', scenes: ['2', '3'] },
    { scenes: undefined },
    { scenes: [] },
    { scenes: ['3', '12'] },
    { scenes: ['2'] },
  ]) {
    const customized = { ...fullLine, updatedIn: 0, ...overrides };
    await withSavedMappings([customized], async (mapper) => {
      assert.deepEqual(mapper.mappings.find((row) => row.id === 'full-line'), JSON.parse(JSON.stringify(customized)));
    });
  }
  const customized = { ...fullLine, mode: 'set', value: 'center', scenes: ['2', '12'], updatedIn: 0 };
  await withSavedMappings([customized], async (mapper) => {
    assert.deepEqual(mapper.mappings.find((row) => row.id === 'full-line'), {
      ...customized, scenes: ['12'], updatedIn: 12,
    });
  });
});

test('un disparo limitado a escena 2 no se convierte en un disparo global al migrar', async () => {
  const learned = { ...fullLine, source: { kind: 'note', channel: 8, note: 75 }, scenes: ['2'], updatedIn: 0 };
  await withSavedMappings([learned], async (mapper, triggered) => {
    assert.deepEqual(mapper.mappings.find((row) => row.id === 'full-line'), learned);
    mapper.onSceneChange('3');
    mapper.dispatch({ ...learned.source, on: true, velocity: 100 });
    assert.deepEqual(triggered, []);
  });
});

test('configuración anterior a la incorporación de full-line conserva su fuente aprendida', async () => {
  const learned = { ...fullLine, source: { kind: 'note', channel: 8, note: 75 }, scenes: ['2', '3'], updatedIn: 0 };
  await withSavedMappings([learned], async (mapper) => {
    assert.deepEqual(mapper.mappings.find((row) => row.id === 'full-line'), {
      ...learned, scenes: ['3'], updatedIn: 12,
    });
  }, 2);
});

test('default mantiene la nota 33 para truenos y la nota 36 para invertir la línea de escena 2', () => {
  assert.equal(defaults.version, MAPPINGS_VERSION);
  const triggered = [];
  const mapper = new Mapper({ params: {
    def: () => undefined,
    hasAction: (id) => ['line.strike', 'line.flip'].includes(id),
    trigger: (...args) => triggered.push(args),
  } });
  mapper.setMappings([fullLine, flip]);
  mapper.onSceneChange('2');
  mapper.dispatch({ kind: 'note', channel: 4, note: 33, on: true, velocity: 100 });
  assert.deepEqual(triggered, []);
  mapper.dispatch({ kind: 'note', channel: 2, note: 36, on: true, velocity: 100 });
  assert.deepEqual(triggered, [['line.flip', undefined]]);
  for (const scene of ['3', '4', '5', '6', '9']) {
    triggered.length = 0;
    mapper.onSceneChange(scene);
    mapper.dispatch({ kind: 'note', channel: 4, note: 33, on: true, velocity: 100 });
    assert.deepEqual(triggered, [['line.strike', 'random']], scene);
  }
});
