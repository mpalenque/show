import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { MidiInput, VVVV_MIDI_PORT } from './midi.js';
import { Mapper } from './mappings.js';

function memory() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

class FakePort extends EventTarget {
  constructor(id, name, { openError = null } = {}) {
    super();
    Object.assign(this, { id, name, manufacturer: 'test', state: 'connected', connection: 'closed', openError });
    this.opens = 0; this.closes = 0;
  }
  async open() {
    this.opens++;
    this.connection = 'pending';
    await Promise.resolve();
    if (this.openError) { this.connection = 'closed'; throw new Error(this.openError); }
    this.connection = 'open';
    return this;
  }
  async close() { this.closes++; this.connection = 'closed'; return this; }
  send(bytes, receivedTime = 1000) {
    const event = new Event('midimessage');
    event.data = new Uint8Array(bytes);
    event.receivedTime = receivedTime;
    this.dispatchEvent(event);
  }
}
class FakeAccess extends EventTarget {
  constructor(ports) { super(); this.inputs = new Map(ports.map((port) => [port.id, port])); }
  replace(previous, next) {
    previous.state = 'disconnected';
    this.inputs.delete(previous.id);
    this.dispatchEvent(new Event('statechange'));
    this.inputs.set(next.id, next);
    this.dispatchEvent(new Event('statechange'));
  }
}
const makeNavigator = (access) => ({ requestMIDIAccess: async (options) => {
  assert.deepEqual(options, { sysex: false }); return access;
} });

test('preferred loopMIDI Port listens only to the exact named port, excluding APC/ZOOM and suffixes', async () => {
  const loop = new FakePort('loop', VVVV_MIDI_PORT);
  const apc = new FakePort('apc', 'APC40 mkII');
  const zoom = new FakePort('zoom', 'ZOOM R8');
  const suffix = new FakePort('loop-other', 'loopMIDI Port 2');
  const access = new FakeAccess([apc, loop, zoom, suffix]), messages = [];
  const input = new MidiInput({ preferredName: VVVV_MIDI_PORT, storage: memory(),
    navigator: makeNavigator(access), onMessage: (msg) => messages.push(msg) });
  await input.init(); await setImmediate();
  assert.deepEqual(input.listInputs().filter((port) => port.enabled).map((port) => port.id), ['loop']);
  assert.equal(input.status().state, 'listening');
  assert.deepEqual(input.status().selectedNames, [VVVV_MIDI_PORT]);
  assert.equal(loop.opens, 1); assert.equal(apc.opens, 0); assert.equal(zoom.opens, 0); assert.equal(suffix.opens, 0);
  for (const port of [apc, zoom, suffix]) port.send([0x99, 69, 100]);
  assert.equal(messages.length, 0);
  loop.send([0x99, 69, 100], 1234);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].channel, 10); assert.equal(messages[0].deviceId, 'loop');
  assert.equal(messages[0].timestamp, 1234);
  assert.equal(input.status().received, 1);
  input.dispose();
});

test('missing preferred port never falls back silently to a different controller', async () => {
  const access = new FakeAccess([new FakePort('apc', 'APC40 mkII'), new FakePort('zoom', 'ZOOM R8')]);
  const input = new MidiInput({ preferredName: VVVV_MIDI_PORT, storage: memory(), navigator: makeNavigator(access) });
  await input.init(); await setImmediate();
  assert.equal(input.status().state, 'missing');
  assert.equal(input.listInputs().some((port) => port.enabled || port.listening), false);
  const loop = new FakePort('late-loop', VVVV_MIDI_PORT);
  access.inputs.set(loop.id, loop); access.dispatchEvent(new Event('statechange'));
  await setImmediate();
  assert.equal(input.status().state, 'listening');
  assert.equal(input.listInputs().find((port) => port.id === loop.id).enabled, true);
  input.dispose();
});

test('manual name selection survives hotplug with a changed ID and then a reload', async () => {
  const storage = memory();
  const old = new FakePort('old-id', VVVV_MIDI_PORT), apc = new FakePort('apc', 'APC40 mkII');
  const access = new FakeAccess([old, apc]), messages = [];
  const input = new MidiInput({ preferredName: VVVV_MIDI_PORT, storage,
    navigator: makeNavigator(access), onMessage: (msg) => messages.push(msg) });
  await input.init(); await setImmediate();
  input.setEnabled(['old-id']);
  const saved = JSON.parse(storage.getItem('parte2.midiInputs'));
  assert.equal(saved.version, 2); assert.equal(saved.mode, 'manual');
  assert.deepEqual(saved.names, [VVVV_MIDI_PORT]);
  const next = new FakePort('new-id', VVVV_MIDI_PORT);
  access.replace(old, next); await setImmediate();
  assert.ok(messages.some((msg) => msg.kind === 'device' && msg.action === 'disconnected' && msg.deviceId === 'old-id'));
  assert.equal(input.listInputs().find((port) => port.id === 'new-id').listening, true);
  assert.equal(apc.opens, 0);
  next.send([0x90, 0, 100]);
  assert.equal(messages.at(-1).deviceId, 'new-id');
  input.dispose();
  const third = new FakePort('third-id', VVVV_MIDI_PORT);
  const restored = new MidiInput({ storage, preferredName: VVVV_MIDI_PORT, navigator: makeNavigator(new FakeAccess([apc, third])) });
  await restored.init(); await setImmediate();
  assert.equal(restored.listInputs().find((port) => port.id === 'third-id').listening, true);
  assert.equal(restored.listInputs().find((port) => port.id === 'apc').enabled, false);
  restored.dispose();
});

test('explicit empty selection persists despite preferred name; usePreferredInput deliberately restores it', async () => {
  const storage = memory(), loop = new FakePort('loop', VVVV_MIDI_PORT), access = new FakeAccess([loop]);
  const input = new MidiInput({ storage, preferredName: VVVV_MIDI_PORT, navigator: makeNavigator(access) });
  await input.init(); await setImmediate();
  input.setEnabled([]); await setImmediate();
  assert.equal(input.status().state, 'disabled');
  assert.deepEqual(JSON.parse(storage.getItem('parte2.midiInputs')).names, []);
  input.dispose();
  const restored = new MidiInput({ storage, preferredName: VVVV_MIDI_PORT, navigator: makeNavigator(access) });
  await restored.init(); await setImmediate();
  assert.equal(restored.status().state, 'disabled');
  assert.equal(restored.listInputs()[0].enabled, false);
  restored.usePreferredInput(); await setImmediate();
  assert.equal(restored.status().state, 'listening');
  assert.equal(JSON.parse(storage.getItem('parte2.midiInputs')).mode, 'preferred');
  restored.dispose();
});

test('concurrent init requests Web MIDI permission once and installs a single message listener', async () => {
  const loop = new FakePort('loop', VVVV_MIDI_PORT), access = new FakeAccess([loop]), messages = [];
  let resolveRequest, requests = 0;
  const permission = new Promise((resolve) => { resolveRequest = resolve; });
  const input = new MidiInput({ storage: memory(), preferredName: VVVV_MIDI_PORT,
    navigator: { requestMIDIAccess: () => { requests++; return permission; } },
    onMessage: (msg) => messages.push(msg) });
  const first = input.init(), second = input.init(), third = input.init();
  assert.equal(requests, 1); assert.equal(input.status().state, 'requesting');
  resolveRequest(access);
  await Promise.all([first, second, third]); await setImmediate();
  await input.init(); input.refresh();
  assert.equal(requests, 1); assert.equal(loop.opens, 1);
  loop.send([0x90, 36, 100]);
  assert.equal(messages.length, 1);
  input.dispose();
});

test('failed port.open reports the actual error and never claims it is listening', async () => {
  const loop = new FakePort('loop', VVVV_MIDI_PORT, { openError: 'El dispositivo está ocupado' });
  const statuses = [], errors = [];
  const input = new MidiInput({ storage: memory(), preferredName: VVVV_MIDI_PORT,
    navigator: makeNavigator(new FakeAccess([loop])), onEvent: (type, data) => {
      if (type === 'status') statuses.push(data);
      if (type === 'error') errors.push(data);
    } });
  await input.init(); await setImmediate();
  assert.equal(input.status().state, 'error');
  assert.equal(input.status().error, 'El dispositivo está ocupado');
  assert.equal(input.listInputs()[0].listening, false);
  assert.ok(statuses.every((state) => state.state !== 'listening'));
  assert.equal(errors.at(-1).deviceId, 'loop');
  input.dispose();
});

test('init retries a previously failed port after it becomes available', async () => {
  const loop = new FakePort('loop', VVVV_MIDI_PORT, { openError: 'Temporalmente ocupado' });
  let permissionRequests = 0;
  const input = new MidiInput({ storage: memory(), preferredName: VVVV_MIDI_PORT,
    navigator: { requestMIDIAccess: async () => { permissionRequests++; return new FakeAccess([loop]); } } });
  await input.init(); await setImmediate();
  assert.equal(input.status().state, 'error');
  assert.equal(loop.opens, 1);
  loop.openError = null;
  input.refresh(); await setImmediate(); // Ordinary state notifications must not create retry loops.
  assert.equal(loop.opens, 1);
  await input.init(); await setImmediate();
  assert.equal(loop.opens, 2);
  assert.equal(permissionRequests, 1);
  assert.equal(input.status().state, 'listening');
  assert.equal(input.listInputs()[0].error, null);
  input.dispose();
});

test('the actual DOM MIDI listener feeds native mappings, velocity selection and release', async () => {
  const loop = new FakePort('loop', VVVV_MIDI_PORT), apc = new FakePort('apc', 'APC40 mkII');
  const controls = new Map(), actions = [];
  const mapper = new Mapper({ storage: null,
    onControl: (id, value) => controls.set(id, value),
    onAction: (id, value) => actions.push({ id, value }) });
  const input = new MidiInput({ preferredName: VVVV_MIDI_PORT, storage: memory(),
    navigator: makeNavigator(new FakeAccess([loop, apc])), onMessage: (msg) => mapper.dispatch(msg) });
  await input.init(); await setImmediate();
  apc.send([0x99, 65, 100]);
  assert.equal(actions.length, 0);
  loop.send([0x99, 69, 100]);
  assert.deepEqual(actions.at(-1), { id: 'scene.goto', value: '69' });
  loop.send([0x9c, 12, 64]);
  assert.equal(controls.get('player.full.clip'), Math.floor(64 / 127 * 68));
  assert.equal(controls.get('mix.fullVideo'), 1);
  loop.send([0x9c, 13, 127]);
  assert.equal(controls.get('milky.full.preset'), 'final');
  assert.equal(controls.get('mix.fullMilky'), 1);
  loop.send([0x9c, 13, 0]);
  assert.equal(controls.get('milky.full.preset'), 'full1');
  assert.equal(controls.get('mix.fullMilky'), 0);
  loop.send([0x90, 0, 100]);
  assert.equal(controls.get('final.button'), true);
  loop.state = 'disconnected'; input.refresh();
  assert.equal(controls.get('final.button'), false);
  assert.equal(controls.get('mix.fullVideo'), 0);
  input.dispose(); mapper.dispose();
});
