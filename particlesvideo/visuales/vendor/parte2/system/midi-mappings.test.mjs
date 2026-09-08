import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMidiMessage, MidiClock, MidiInput } from './midi.js';
import { Mapper, DEFAULT_MAPPINGS, attachToHost } from './mappings.js';

const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const note = (channel, n, velocity = 100, deviceId = 'A') => ({ kind: 'note', channel, note: n, velocity, on: velocity > 0, deviceId });
function rig(options = {}) {
  const controls = [], actions = [], events = [], values = new Map();
  let currentTime = 0, timerId = 0;
  const timers = new Map();
  const mapper = new Mapper({ storage: memory(), onControl: (path, value, meta) => { controls.push({ path, value, meta }); values.set(path, value); },
    onAction: (path, value, meta) => actions.push({ path, value, meta }), getValue: (path) => values.get(path),
    onEvent: (type, payload) => events.push({ type, payload }),
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { time: currentTime + delay, callback }); return id; },
    clearTimer: (id) => timers.delete(id), ...options });
  return { mapper, controls, actions, events, values, advance(ms) {
    currentTime += ms;
    for (const [id, entry] of [...timers]) if (entry.time <= currentTime) { timers.delete(id); entry.callback(); }
  } };
}

test('raw MIDI keeps Parte 1 channels and note shapes; zero velocity and note-off release', () => {
  const msg = normalizeMidiMessage([0x99, 25, 127], { timestamp: 123, deviceId: 'loop' });
  assert.equal(msg.channel, 10);
  assert.equal(msg.note, 25);
  assert.equal(msg.on, true);
  assert.equal(msg.timestamp, 123);
  assert.equal(normalizeMidiMessage([0x90, 60, 0]).on, false);
  const off = normalizeMidiMessage([0x80, 60, 85]);
  assert.equal(off.velocity, 0);
  assert.equal(off.releaseVelocity, 85);
  assert.deepEqual(normalizeMidiMessage([0xb6, 22, 64], { timestamp: 0 }), {
    timestamp: 0, raw: [0xb6, 22, 64], kind: 'cc', channel: 7, cc: 22, value: 64,
  });
  assert.equal(normalizeMidiMessage([0x90, 60]), null);
  assert.equal(normalizeMidiMessage([0x90, 60, 255]), null);
  assert.equal(normalizeMidiMessage([60, 127]), null);
  assert.equal(normalizeMidiMessage([0xf0, 1, 2, 0xf7]), null);
  assert.equal(normalizeMidiMessage([0xfe]), null);
});

test('MIDI clock: 24 PPQ, tempo from timestamps, position, stop and continue', () => {
  const clock = new MidiClock();
  clock.dispatch({ kind: 'transport', command: 'start' });
  for (let i = 0; i < 24; i++) clock.dispatch({ kind: 'transport', command: 'clock', timestamp: i * 60000 / (120 * 24) });
  assert.equal(clock.snapshot().beat, 1);
  assert.ok(Math.abs(clock.snapshot().bpm - 120) < 1e-9);
  clock.dispatch({ kind: 'transport', command: 'stop' });
  clock.dispatch({ kind: 'transport', command: 'clock', timestamp: 600 });
  assert.equal(clock.snapshot().ticks, 24);
  const position = normalizeMidiMessage([0xf2, 8, 0]);
  clock.dispatch(position);
  assert.equal(clock.snapshot().beat, 2);
  clock.dispatch({ kind: 'transport', command: 'continue' });
  clock.dispatch({ kind: 'transport', command: 'clock', timestamp: 620 });
  assert.equal(clock.snapshot().ticks, 49);
  clock.dispatch({ kind: 'transport', command: 'start' });
  assert.equal(clock.snapshot().ticks, 0);
});

test('real default notes map velocity to clips, six different banks and explicit full bank', () => {
  const r = rig();
  r.mapper.dispatch(note(13, 2, 64));
  assert.equal(r.values.get('players.2.clip'), Math.floor(64 / 127 * 68));
  assert.equal(r.values.get('mix.stripes.2.video'), 1);
  r.mapper.dispatch(note(13, 12, 127));
  assert.equal(r.values.get('player.full.clip'), 0); // GetSlice wraps index 68 in a 68-entry catalog.
  r.mapper.dispatch(note(13, 8, 100));
  assert.equal(r.values.get('milky.stripes.2.preset'), 2);
  r.mapper.dispatch(note(13, 13, 127));
  assert.equal(r.values.get('milky.full.preset'), 'final');
  r.mapper.dispatch(note(13, 13, 0));
  assert.equal(r.values.get('milky.full.preset'), 'full1'); // This selector is NOT latched in vvvv.
  assert.equal(r.values.get('mix.fullMilky'), 0);
  r.mapper.dispatch(note(10, 71));
  r.mapper.dispatch(note(10, 72));
  assert.deepEqual(r.actions.filter((a) => a.path === 'scene.goto').map((a) => a.value), ['71']);
  assert.ok(DEFAULT_MAPPINGS.every((row) => row.source.kind !== 'cc'));
});

test('video and Milky MonoFlop tails are 20ms and 80ms; retrigger cancels release', () => {
  const r = rig();
  r.mapper.dispatch(note(13, 0));
  r.mapper.dispatch(note(13, 0, 0));
  r.advance(19);
  assert.equal(r.values.get('mix.stripes.0.video'), 1);
  r.advance(1);
  assert.equal(r.values.get('mix.stripes.0.video'), 0);
  r.mapper.dispatch(note(13, 6));
  r.mapper.dispatch(note(13, 6, 0));
  r.advance(60);
  r.mapper.dispatch(note(13, 6));
  r.advance(40);
  assert.equal(r.values.get('mix.stripes.0.milky'), 1);
  r.mapper.dispatch(note(13, 6, 0));
  r.advance(80);
  assert.equal(r.values.get('mix.stripes.0.milky'), 0);
});

test('default timer adapter preserves the browser global receiver', () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let callback, cleared = false;
  globalThis.setTimeout = function (fn) { assert.equal(this, globalThis); callback = fn; return 123; };
  globalThis.clearTimeout = function (id) { assert.equal(this, globalThis); assert.equal(id, 123); cleared = true; };
  try {
    const mapper = new Mapper({ storage: null });
    mapper.dispatch(note(13, 0)); mapper.dispatch(note(13, 0, 0));
    assert.equal(typeof callback, 'function');
    mapper.dispatch(note(13, 0));
    assert.equal(cleared, true);
    mapper.dispose();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test('Kick all uses aggregate rising edge, Perc any uses each note edge, snare stays held', () => {
  const r = rig();
  r.mapper.dispatch(note(1, 36));
  r.mapper.dispatch(note(1, 41));
  r.mapper.dispatch(note(1, 36, 0));
  r.mapper.dispatch(note(1, 41, 0));
  r.mapper.dispatch(note(1, 50));
  assert.equal(r.actions.filter((a) => a.path === 'kick').length, 2);
  r.mapper.dispatch(note(2, 36));
  r.mapper.dispatch(note(2, 36));
  r.mapper.dispatch(note(2, 37));
  assert.equal(r.actions.filter((a) => a.path === 'percussion').length, 2);
  r.mapper.dispatch(note(1, 37));
  r.mapper.dispatch(note(1, 42));
  r.mapper.dispatch(note(1, 37, 0));
  assert.equal(r.values.get('events.snareHeld'), true);
  r.mapper.dispatch(note(1, 42, 0));
  assert.equal(r.values.get('events.snareHeld'), false);
});

test('two inputs OR held notes; disconnect/all-notes-off release gates and cancel pending tails', () => {
  const r = rig();
  r.mapper.dispatch(note(1, 0, 100, 'A'));
  r.mapper.dispatch(note(1, 0, 100, 'B'));
  r.mapper.dispatch({ kind: 'device', action: 'disconnected', deviceId: 'A' });
  assert.equal(r.values.get('final.button'), true);
  r.mapper.dispatch({ kind: 'cc', channel: 1, cc: 123, value: 0, deviceId: 'B' });
  assert.equal(r.values.get('final.button'), false);
  r.mapper.dispatch(note(13, 1));
  r.mapper.dispatch(note(13, 1, 0));
  r.mapper.dispatch({ kind: 'device', action: 'disconnected', deviceId: 'A' });
  assert.equal(r.values.get('mix.stripes.1.video'), 0);
  r.mapper.dispose();
  assert.equal(r.values.get('mix.stripes.1.video'), 0);
  const count = r.controls.length;
  r.advance(100);
  assert.equal(r.controls.length, count);
});

test('orphan NoteOff overrides demo gates, preserves other held notes and uses original tails', () => {
  const r = rig();
  r.values.set('final.button', true);
  r.values.set('mix.fullMilky', 1);
  r.values.set('mix.stripes.0.video', 1);
  r.mapper.dispatch(note(1, 0, 0));
  r.mapper.dispatch(note(13, 13, 0));
  assert.equal(r.values.get('final.button'), false);
  assert.equal(r.values.get('mix.fullMilky'), 0);
  r.mapper.dispatch(note(13, 0, 0));
  assert.equal(r.values.get('mix.stripes.0.video'), 1);
  r.advance(10);
  r.mapper.dispatch(note(13, 0, 0)); // A duplicate off cannot extend 20ms to30ms.
  r.advance(10);
  assert.equal(r.values.get('mix.stripes.0.video'), 0);
  r.mapper.dispatch(note(1, 37, 100, 'B'));
  r.mapper.dispatch(note(1, 42, 0, 'A'));
  assert.equal(r.values.get('events.snareHeld'), true);
  r.mapper.dispatch(note(1, 37, 0, 'B'));
  assert.equal(r.values.get('events.snareHeld'), false);
});

test('v3 migrates only the untouched FULL selector and preserves learned/edited/deleted rows', async () => {
  const original = structuredClone(DEFAULT_MAPPINGS.find((row) => row.id === 'vvvv.full.milky.preset'));
  delete original.edge; delete original.updatedIn;
  const storage = memory();
  storage.setItem('parte2.mappings', JSON.stringify({ version: 2, mappings: [original] }));
  const migrated = rig({ storage }); await migrated.mapper.init();
  assert.equal(migrated.mapper.mappings[0].edge, 'both');
  assert.equal(JSON.parse(storage.getItem('parte2.mappings')).version, 3);
  for (const changed of [
    { ...original, learned: true },
    { ...original, source: { kind: 'note', channel: 5, note: 50 } },
    { ...original, edge: 'perNote' },
    { ...original, label: 'Mi selector personalizado' },
  ]) {
    storage.setItem('parte2.mappings', JSON.stringify({ version: 2, mappings: [changed] }));
    const custom = rig({ storage }); await custom.mapper.init();
    assert.deepEqual(custom.mapper.mappings, [changed]);
  }
  storage.setItem('parte2.mappings', JSON.stringify({ version: 2, mappings: [] }));
  const deleted = rig({ storage }); await deleted.mapper.init();
  assert.equal(deleted.mapper.mappings.length, 0);
});

test('Parte 1 row schema works, scene gating and MIDI Learn consume input and persist', async () => {
  const storage = memory();
  const r = rig({ storage, defaults: [
    { id: 'scene-filter', source: { kind: 'note', channel: 10, note: 25 }, mode: 'trigger', target: 'scene.goto', arg: '25', scenes: ['24'] },
    { id: 'learn', source: null, mode: 'auto', target: 'final.fx2' },
  ], hasAction: (path) => path === 'scene.goto', getDefinition: () => ({ type: 'float', min: -1, max: 2 }) });
  r.mapper.onSceneChange(23);
  r.mapper.dispatch(note(10, 25));
  assert.equal(r.actions.length, 0);
  r.mapper.onSceneChange(24);
  r.mapper.dispatch(note(10, 25));
  assert.equal(r.actions[0].value, '25');
  r.mapper.learn('learn');
  r.mapper.dispatch(note(10, 24, 0)); // Note-off does not complete Learn.
  assert.equal(r.mapper.learnRow, 'learn');
  r.mapper.dispatch({ kind: 'cc', channel: 7, cc: 11, value: 64 });
  assert.equal(r.mapper.learnRow, null);
  assert.equal(r.values.has('final.fx2'), false); // Consumed, not applied to show.
  r.mapper.dispatch({ kind: 'cc', channel: 7, cc: 11, value: 127 });
  assert.equal(r.values.get('final.fx2'), 2);
  const recovered = rig({ storage });
  await recovered.mapper.init();
  assert.equal(recovered.mapper.mappings.find((row) => row.id === 'learn').source.cc, 11);
  assert.equal(recovered.mapper.mappings.length, 2);
});

test('invalid JSON import is atomic; reset saves; OSC auto routes and custom mapping coexist', () => {
  const r = rig({ defaults: [{ id: 'osc', source: { kind: 'osc', address: '/fx2' }, target: 'final.fx2', mode: 'range', min: 0, max: 4 }] });
  r.mapper.dispatch({ kind: 'osc', address: '/fx2', args: [0.25] });
  assert.equal(r.values.get('final.fx2'), 1);
  r.mapper.dispatch({ kind: 'osc', address: '/pn/final/fx2', args: [0.5] });
  assert.equal(r.controls.at(-1).meta.normalized, true);
  r.mapper.dispatch({ kind: 'osc', address: '/a/final/explode', args: [1] });
  assert.equal(r.actions.at(-1).path, 'final.explode');
  const before = r.mapper.exportJson();
  assert.throws(() => r.mapper.importJson({ mappings: [{ id: 'bad', mode: 'set', target: '__proto__.x' }] }));
  assert.equal(r.mapper.exportJson(), before);
  assert.throws(() => r.mapper.importJson('{no json}'));
  r.mapper.setMappings([]);
  r.mapper.resetToDefault();
  assert.equal(r.mapper.mappings.length, 1);
  assert.ok(r.mapper.storage.getItem('parte2.mappings'));
});

test('MIDI Learn remains usable when an original OSC row becomes a note or a gate becomes CC', () => {
  const r = rig({ getDefinition: () => ({ type: 'float', min: 0, max: 1 }) });
  r.mapper.learn('vvvv.osc.fx2');
  r.mapper.dispatch(note(4, 55, 127));
  r.mapper.dispatch(note(4, 55, 127));
  assert.equal(r.values.get('final.fx2'), 1);
  r.mapper.learn('vvvv.full.video');
  r.mapper.dispatch({ kind: 'cc', channel: 4, cc: 1, value: 64 });
  r.mapper.dispatch({ kind: 'cc', channel: 4, cc: 1, value: 64 });
  assert.equal(r.values.get('mix.fullVideo'), 64 / 127);
  r.mapper.learn('vvvv.scene');
  r.mapper.dispatch({ kind: 'cc', channel: 4, cc: 2, value: 70 });
  r.mapper.dispatch({ kind: 'cc', channel: 4, cc: 2, value: 70 });
  assert.equal(r.actions.at(-1).value, 70);
});

test('MIDI transport only controls the show when external sync is selected', () => {
  const r = rig();
  r.mapper.dispatch({ kind: 'transport', command: 'start' });
  assert.equal(r.actions.length, 0);
  r.values.set('transport.sync', 'midi');
  r.mapper.dispatch({ kind: 'transport', command: 'start' });
  assert.equal(r.values.get('transport.playing'), true);
  assert.equal(r.actions.at(-1).path, 'transport.start');
  for (let i = 0; i < 24; i++) r.mapper.dispatch({ kind: 'transport', command: 'clock', timestamp: i * 60000 / (96 * 24) });
  assert.ok(Math.abs(r.values.get('transport.bpm') - 96) < 1e-8);
  r.mapper.dispatch({ kind: 'transport', command: 'stop' });
  assert.equal(r.values.get('transport.playing'), false);
  r.values.set('transport.followMidi', false);
  const count = r.actions.length;
  r.mapper.dispatch({ kind: 'transport', command: 'continue' });
  assert.equal(r.actions.length, count);
  assert.equal(r.values.get('transport.playing'), false);
});

test('original OSC fx1/fx2/fx4 routes use raw numeric arguments, without inventing BOTON or fx3', () => {
  const r = rig();
  r.mapper.dispatch({ kind: 'osc', address: '/fx1', args: [0.35] });
  r.mapper.dispatch({ kind: 'osc', address: '/fx2', args: [-0.2] });
  r.mapper.dispatch({ kind: 'osc', address: '/fx4', args: ['1.4'] });
  assert.equal(r.values.get('final.fx1'), 0.35);
  assert.equal(r.values.get('final.fx2'), -0.2);
  assert.equal(r.values.get('final.fx4'), 1.4);
  const count = r.controls.length;
  r.mapper.dispatch({ kind: 'osc', address: '/fx2', args: ['NaN'] });
  r.mapper.dispatch({ kind: 'osc', address: '/fx3', args: [1] });
  r.mapper.dispatch({ kind: 'osc', address: '/BOTON', args: [1] });
  assert.equal(r.controls.length, count);
});

class FakePort extends EventTarget {
  constructor(id) { super(); this.id = id; this.name = id; this.state = 'connected'; this.connection = 'closed'; }
  async open() { this.connection = 'open'; }
  async close() { this.connection = 'closed'; }
  send(data) { const event = new Event('midimessage'); event.data = data; this.dispatchEvent(event); }
}
class FakeAccess extends EventTarget { constructor(ports) { super(); this.inputs = new Map(ports.map((p) => [p.id, p])); } }

test('Web MIDI explicit empty selection survives reload; hotplug and disable release devices', async () => {
  const storage = memory(), port = new FakePort('loop'), access = new FakeAccess([port]), messages = [];
  storage.setItem('parte2.midiInputs', '[]');
  const input = new MidiInput({ storage, navigator: { requestMIDIAccess: async () => access }, onMessage: (msg) => messages.push(msg) });
  await input.init();
  port.send([0x90, 36, 100]);
  assert.equal(messages.length, 0);
  input.setEnabled(['loop']);
  port.send([0x90, 36, 100]);
  assert.equal(messages.at(-1).deviceId, 'loop');
  const other = new FakePort('other'); access.inputs.set(other.id, other);
  access.dispatchEvent(new Event('statechange'));
  assert.equal(input.listInputs().find((p) => p.id === 'other').enabled, false);
  input.setEnabled([]);
  assert.equal(messages.at(-1).action, 'disconnected');
  const count = messages.length;
  port.send([0x90, 36, 100]);
  assert.equal(messages.length, count);
  input.dispose();
});

test('Web MIDI automatic selection admits newly connected devices without duplicate listeners', async () => {
  const port = new FakePort('one'), access = new FakeAccess([port]), messages = [];
  const input = new MidiInput({ storage: memory(), navigator: { requestMIDIAccess: async () => access }, onMessage: (msg) => messages.push(msg) });
  await input.init();
  input.refresh(); input.refresh();
  port.send([0x90, 1, 100]);
  assert.equal(messages.length, 1);
  const other = new FakePort('two'); access.inputs.set('two', other); access.dispatchEvent(new Event('statechange'));
  other.send([0xb0, 11, 50]);
  assert.equal(messages.at(-1).deviceId, 'two');
  port.state = 'disconnected'; access.dispatchEvent(new Event('statechange'));
  assert.equal(messages.at(-1).action, 'disconnected');
  input.dispose();
});

test('explicit host adapter writes host Params without claiming a bus or opening devices', async () => {
  const calls = [];
  const bridge = attachToHost({ params: { set: (...args) => calls.push(['set', ...args]),
    setNormalized: (...args) => calls.push(['normalized', ...args]), trigger: (...args) => calls.push(['trigger', ...args]) } },
  { storage: memory(), defaults: [] });
  await bridge.ready;
  bridge.dispatch({ kind: 'osc', address: '/pn/final/fx2', args: [0.3] });
  bridge.dispatch({ kind: 'osc', address: '/scene', args: [70] });
  assert.equal(calls[0][0], 'normalized');
  assert.deepEqual(calls[1].slice(0, 3), ['trigger', 'scene.goto', '70']);
  bridge.dispose();
});
