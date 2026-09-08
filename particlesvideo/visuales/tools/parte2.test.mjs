import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Params } from '../src/core/Params.js';
import { Parte2Controller } from '../src/parte2/Parte2Controller.js';
import { Parte2HostAdapter } from '../vendor/parte2/system/host-adapter.js';
import { createSystemParameters } from '../vendor/parte2/system/registry.js';
import { Mapper as Parte2Mapper, DEFAULT_MAPPINGS } from '../vendor/parte2/system/mappings.js';
import { Mapper } from '../src/io/Mapper.js';
import { ShowInputRouter } from '../src/io/ShowInputRouter.js';
import { MidiInput } from '../src/io/MidiInput.js';

const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
globalThis.localStorage = memory();

test('the real host registry preserves numeric enums, repeated seek and adapter cleanup', () => {
  const params = new Params(); Parte2Controller.defineParams(params);
  const store = createSystemParameters(), listeners = new Map();
  const system = { params: store, engine: { device: {} }, render() {}, dispatchMidi() {},
    on(type, fn) { listeners.set(type, fn); return () => listeners.delete(type); } };
  store.onChange((id, value) => listeners.get('values')?.({ [id]: value }));
  const adapter = new Parte2HostAdapter({ params }, system, { reuseRegistered: true, unregisterOnDispose: false });
  assert.equal(params.list().length, 444);
  assert.ok(params.list().every(spec => spec.isAction || spec.sceneReset === false));
  params.set('parte2.transport.rate', 120); assert.equal(store.get('transport.rate'), 120);
  store.set('transport.rate', 30); assert.equal(params.get('parte2.transport.rate'), 30);
  let seeks = 0; store.onChange(id => { if (id === 'players.0.seek') seeks++; });
  params.set('parte2.players.0.seek', .5); params.set('parte2.players.0.seek', .5);
  assert.equal(seeks, 2);
  adapter.dispose(); assert.equal(params.list().length, 444);
  params.set('parte2.transport.rate', 60); assert.equal(store.get('transport.rate'), 30);
});

function routing() {
  const params = new Params(); Parte2Controller.defineParams(params);
  params.define({ id: 'primary.gate', type: 'bool', default: false });
  params.defineAction({ id: 'scene.goto' });
  const ctx = { params, scenes: { current: '2', goto(id) { this.current = id; ctx.parte2.active = id.startsWith('parte2:'); } } };
  params.onAction('scene.goto', id => ctx.scenes.goto(id));
  ctx.mapper = new Mapper(ctx);
  ctx.mapper.setMappings([
    { id: 'scene2', source: { kind: 'note', channel: 10, note: 2 }, target: 'scene.goto', mode: 'set', value: '2' },
    { id: 'primary', source: { kind: 'note', channel: 13, note: 0 }, target: 'primary.gate', mode: 'gate' },
  ]);
  const local = createSystemParameters();
  const mappings = DEFAULT_MAPPINGS.map(row => row.id === 'vvvv.scene' ? { ...row, source: { kind: 'note', channel: 10, noteRange: [60, 80] } } : row);
  const mapper = new Parte2Mapper({ storage: memory(), defaults: mappings,
    getDefinition: id => local.def(id), getValue: id => local.get(id), hasAction: id => local.actions.has(id),
    onControl: (id, value) => local.set(id, value), onAction: (id, value) => { if (id === 'scene.goto') ctx.scenes.goto(`parte2:${value}`); },
  });
  ctx.parte2 = { system: { mapper }, active: false, get ownsFrame() { return this.active; },
    dispatch: msg => mapper.dispatch(msg), event() {} };
  ctx.input = new ShowInputRouter(ctx);
  return { ctx, local, mapper };
}
const note = (channel, n, on = true, deviceId = 'keyboard') => ({ kind: 'note', channel, note: n, on, velocity: on ? 127 : 0, deviceId });

test('scene 72 is consumed once; primary effects do not receive Parte 2 musical notes', () => {
  const { ctx, local } = routing();
  ctx.input.dispatch(note(10, 72)); assert.equal(ctx.scenes.current, 'parte2:72');
  ctx.input.dispatch(note(13, 0)); assert.equal(local.get('mix.stripes.0.video'), 1);
  assert.equal(local.get('players.0.clip'), 0); assert.equal(ctx.params.get('primary.gate'), false);
  ctx.input.dispatch(note(10, 72, false)); assert.equal(ctx.scenes.current, 'parte2:72');
  ctx.input.dispatch(note(10, 2)); assert.equal(ctx.scenes.current, '2');
});

test('learned Parte 2 scene sources work from the primary bank', () => {
  const { ctx, mapper } = routing();
  mapper.setMappings([{ id: 'customScene', source: { kind: 'note', channel: 8, note: 40 }, target: 'scene.goto', mode: 'set', output: 'action', value: 70 }]);
  ctx.input.dispatch(note(8, 40)); assert.equal(ctx.scenes.current, 'parte2:70');
});

test('scene Learn consumes its note without selecting a bank', () => {
  const { ctx, mapper } = routing(); mapper.learn('vvvv.video.0.clip');
  ctx.input.dispatch(note(10, 72)); assert.equal(ctx.scenes.current, '2');
  assert.equal(mapper.mappings.find(m => m.id === 'vvvv.video.0.clip').source.note, 72);
});

test('imported historical scene ranges cannot swallow return cues 1–29', () => {
  const { ctx, mapper } = routing(); mapper.setMappings(DEFAULT_MAPPINGS);
  ctx.parte2.active = true; ctx.scenes.current = 'parte2:67';
  ctx.input.dispatch(note(10, 2)); assert.equal(ctx.scenes.current, '2');
});

test('gates preserve another device note, and all-notes-off cancels delayed releases', () => {
  const { ctx, local, mapper } = routing(); ctx.parte2.active = true;
  ctx.input.dispatch(note(13, 0, true, 'a')); ctx.input.dispatch(note(13, 0, true, 'b'));
  ctx.input.dispatch({ kind: 'device', action: 'disconnected', deviceId: 'a' });
  assert.equal(local.get('mix.stripes.0.video'), 1);
  ctx.input.dispatch({ kind: 'cc', channel: 13, cc: 123, value: 0, deviceId: 'b' });
  assert.equal(local.get('mix.stripes.0.video'), 0);
  assert.ok([...mapper.states.values()].every(state => !state.timer && state.held.size === 0));
});

test('primary gates also count devices and release the correct owner', () => {
  const { ctx } = routing();
  ctx.input.dispatch(note(13, 0, true, 'a')); ctx.input.dispatch(note(13, 0, true, 'b'));
  ctx.input.dispatch({ kind: 'device', action: 'disconnected', deviceId: 'a' });
  assert.equal(ctx.params.get('primary.gate'), true);
  ctx.input.dispatch(note(13, 0, false, 'b')); assert.equal(ctx.params.get('primary.gate'), false);
});

test('the physical parser preserves clock, SPP and input identity', () => {
  const received = []; const midi = new MidiInput({ onMessage: m => received.push(m) });
  midi._parse({ data: [0xf8], receivedTime: 123 }, { id: 'a', name: 'A' });
  midi._parse({ data: [0xf2, 1, 2] }, { id: 'b' });
  assert.equal(received[0].command, 'clock'); assert.equal(received[0].timestamp, 123);
  assert.equal(received[0].deviceId, 'a'); assert.equal(received[1].position, 257);
});

test('a late Parte 2 preparation cannot override a newer primary cue', async () => {
  let finish; const prepared = new Promise(resolve => { finish = resolve; });
  const controller = Object.create(Parte2Controller.prototype);
  const ctx = { renderer: { domElement: { style: {} } }, engine: { whenIdle: async () => {} },
    scenes: { current: '2', goto(id) { this.current = id; } }, radiance: { requestScene() {} }, mapper: { releaseAll() {} } };
  Object.assign(controller, { ctx, active: false, switching: false, generation: 0, queue: [], canvas: { style: {} },
    prepare: () => prepared, system: { mapper: { releaseAll() {} } } });
  controller.requestScene('parte2:72'); controller.requestScene('2');
  finish(); await controller.selection;
  assert.equal(ctx.scenes.current, '2'); assert.equal(controller.ownsFrame, false); assert.deepEqual(controller.queue, []);
});

test('failed preparation permits a fresh cue attempt', async () => {
  const controller = Object.create(Parte2Controller.prototype);
  Object.assign(controller, { generation: 1, pending: { id: 'parte2:72' }, queue: [note(13, 0)], switching: true, event() {} });
  const log = console.error; console.error = () => {};
  try { controller.fail(new Error('test failure')); } finally { console.error = log; }
  assert.equal(controller.pending, null); assert.equal(controller.generation, 2); assert.deepEqual(controller.queue, []);
});
