import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Mapper, MAPPINGS_VERSION } from '../src/io/Mapper.js';

const defaults = JSON.parse(await readFile(new URL('../public/mappings.default.json', import.meta.url)));

test('migración agrega cues Fluids faltantes sin sobrescribir notas aprendidas', async () => {
  const learned = { ...defaults.mappings.find(m => m.id === 'sc24'), source: { kind: 'note', channel: 8, note: 75 } };
  const custom = { id: 'custom', source: { kind: 'cc', channel: 2, cc: 11 }, mode: 'range', target: 'master.brightness' };
  let stored = JSON.stringify({ version: 10, mappings: [learned, custom] });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => stored, setItem: (_key, value) => { stored = value; },
  } });
  try {
    const triggered = [];
    const mapper = new Mapper({ params: {
      def: () => undefined, hasAction: id => id === 'scene.goto',
      trigger: (...args) => triggered.push(args),
    } });
    mapper._loadDefaultMappings = async () => defaults.mappings;
    await mapper.init();
    assert.deepEqual(mapper.mappings.find(m => m.id === 'sc24'), learned);
    assert.deepEqual(mapper.mappings.find(m => m.id === 'custom'), custom);
    assert.deepEqual(mapper.mappings.find(m => m.id === 'sc25').source, { kind: 'note', channel: 10, note: 25 });
    assert.equal(JSON.parse(stored).version, MAPPINGS_VERSION);
    mapper.dispatch({ kind: 'note', channel: 10, note: 25, on: false, velocity: 0 });
    assert.deepEqual(triggered, []);
    mapper.dispatch({ kind: 'note', channel: 10, note: 25, on: true, velocity: 100 });
    assert.deepEqual(triggered, [['scene.goto', '25']]);
    await mapper.init();
    assert.equal(mapper.mappings.filter(m => m.id === 'sc25').length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
