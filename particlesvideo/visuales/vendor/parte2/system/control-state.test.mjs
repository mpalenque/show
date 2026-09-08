import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParameterStore } from './parameters.js';
import { decodeOsc } from './osc-server.mjs';
import { validateSession } from './session.js';
import { Parte2System } from './controller.js';

test('the scene fade changes DDS brightness while its MIDI video gate keeps alpha', () => {
  const s = new Parte2System(null, { hosted: true, storage: null });
  s.engine = { settings: { final: {} } }; s.fullVideoFade = .25;
  s.params.set('scene.current', 67); s.params.set('mix.fullVideo', .5);
  let p = s.compositionParams();
  assert.equal(p.fullVideo.opacity, .5); assert.equal(p.fullVideo.brightness, .25);
  s.params.set('scene.automation', false); p = s.compositionParams();
  assert.equal(p.fullVideo.opacity, .5); assert.equal(p.fullVideo.brightness, 1);
});

test('a broken mapping or scene rejects the entire session before mutating live controls', () => {
  const p = new ParameterStore(); p.set('final.fx1', .5);
  const base = { version: 1, system: 'parte2', parameters: { 'final.fx1': .8 } };
  assert.throws(() => validateSession({ ...base, mappings: [{ id: 'bad', target: 'final.fx1', source: { kind: 'cc', channel: 17, cc: 0 } }] }, p));
  assert.throws(() => validateSession({ ...base, scenes: { 69: { 'missing.control': 1 } } }, p));
  assert.throws(() => validateSession({ ...base, scenes: { 128: {} } }, p));
  assert.equal(p.get('final.fx1'), .5);
  const valid = validateSession({ ...base, scenes: { 69: { 'final.fx1': 2 } } }, p);
  assert.equal(valid.scenes[69]['final.fx1'], 1);
  assert.equal(valid.parameters['final.fx1'], .8);
  assert.equal(p.get('final.fx1'), .5);
});

test('central registry clamps finite controls and validates a complete import before changing live values', () => {
  const p = new ParameterStore();
  p.set('final.fx1', .5);
  assert.throws(() => p.apply({ 'final.fx1': .8, 'final.missing': 1 }));
  assert.equal(p.get('final.fx1'), .5);
  assert.throws(() => p.set('final.fx1', NaN));
  p.set('final.fx1', 5); assert.equal(p.get('final.fx1'), 1);
  p.setNormalized('milky.full.preset', 1); assert.equal(p.get('milky.full.preset'), 'final');
  p.setNormalized('output.blackout', .75); assert.equal(p.get('output.blackout'), true);
  assert.equal(p.snapshot({ persistent: true })['events.snareHeld'], undefined);
});

test('manual control and external input notify the same parameter with source metadata', () => {
  const p = new ParameterStore(), messages = [];
  p.onChange((id, value, meta) => messages.push([id, value, meta.source]));
  p.set('mix.fullVideo', .5, { source: 'ui' });
  p.set('mix.fullVideo', 1, { source: 'midi' });
  assert.deepEqual(messages, [['mix.fullVideo', .5, 'ui'], ['mix.fullVideo', 1, 'midi']]);
});

test('repeated seek commands notify even when the slider value has not changed', () => {
  const p = new ParameterStore(), seeks = [];
  p.onChange((id, value) => { if (id === 'player.full.seek') seeks.push(value); });
  p.set('player.full.seek', 0); p.set('player.full.seek', 0);
  assert.deepEqual(seeks, [0, 0]);
});

const oscString = value => { const b = Buffer.from(value + '\0'); const out = Buffer.alloc(Math.ceil(b.length / 4) * 4); b.copy(out); return out; };
const float = value => { const b = Buffer.alloc(4); b.writeFloatBE(value); return b; };
const message = (address, value) => Buffer.concat([oscString(address), oscString(',f'), float(value)]);
test('OSC decoder reads floats and nested bundles and rejects truncated payloads', () => {
  const packet = message('/fx2', .75);
  assert.deepEqual(decodeOsc(packet), [{ kind: 'osc', address: '/fx2', args: [.75] }]);
  const size = Buffer.alloc(4); size.writeUInt32BE(packet.length);
  const bundle = Buffer.concat([oscString('#bundle'), Buffer.alloc(8), size, packet]);
  assert.deepEqual(decodeOsc(bundle), decodeOsc(packet));
  assert.throws(() => decodeOsc(packet.subarray(0, packet.length - 1)));
  assert.throws(() => decodeOsc(Buffer.from('broken')));
  assert.throws(() => decodeOsc(message('/fx1', Infinity)));
});
