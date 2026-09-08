import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_PRESETS, FULL_WRAPPER, stepFull } from './full-presets.js';

function harness(id) {
  const calls = [], texture = name => ({ name, width: 3840, height: 1280 });
  const p = FULL_PRESETS.find(preset => preset.id === id);
  const state = { p: structuredClone(p), index: 0, time: 0, frame: 0,
    direction: [...p.direction], secondaryDirection: [...p.secondaryDirection],
    history: [texture('history0'), texture('history1')],
    displacementHistory: [texture('displacement0'), texture('displacement1')] };
  for (const name of ['seed', 'dither', 'post', 'secondary', 'normal', 'blend']) state[name] = texture(name);
  let randomCalls = 0;
  const engine = { settings: { autoSeed: true, externalSeeds: {}, warp: 1, detail: 1 }, dummy: texture('dummy'),
    pass: (name, target, a, b, values = [], options = {}) => calls.push({ name, target, a, b, values, options }),
    mips: target => calls.push({ name: 'mips', target }),
    random: () => (++randomCalls % 2 ? .25 : .75) };
  return { state, engine, calls, randomCalls: () => randomCalls,
    step: dt => { calls.length = 0; stepFull(engine, state, dt); return calls; } };
}

test('FULL2 bypasses the disabled Dither, Glow and Flow graph and feeds its own history', () => {
  const h = harness('full2'), calls = h.step(1 / 60);
  assert.deepEqual(calls.filter(call => call.name !== 'mips').map(call => call.name),
    ['seed', 'normal', 'displace', 'blend', 'unsharp']);
  assert.equal(calls.find(call => call.name === 'normal').a, h.state.history[0]);
  const displace = calls.find(call => call.name === 'displace');
  assert.deepEqual(displace.values.slice(0, 3), [.2, -.01, .01]);
  assert.equal(h.state.output, h.state.history[1]);
  h.step(.98); assert.equal(h.randomCalls(), 2);
  h.step(.02); assert.equal(h.randomCalls(), 2);
  h.step(.01); assert.equal(h.randomCalls(), 4);
});

test('FULL3 uses its previous displacement as control and keeps fixed directions after A events', () => {
  const h = harness('full3'); h.state.direction = [2, 2]; h.state.secondaryDirection = [0, 0];
  const calls = h.step(1 / 60), displacement = calls.filter(call => call.name === 'displace');
  assert.equal(displacement[0].a, h.state.dither);
  assert.equal(displacement[0].b, h.state.displacementHistory[0]);
  assert.deepEqual(displacement[0].values.slice(0, 3), [-.005, 1, 1]);
  assert.deepEqual(displacement[1].values.slice(0, 3), [.032, 0, 0]);
  assert.equal(calls.filter(call => call.name === 'blend').length, 1);
  assert.equal(h.randomCalls(), 0);
});

test('FULL1 and SPLASH preserve opposite post-blend input order and native control textures', () => {
  const one = harness('full1'), oneCalls = one.step(1 / 60);
  const glow = oneCalls.find(call => call.name === 'blend');
  assert.equal(glow.a, one.state.history[0]); assert.equal(glow.b, one.state.dither);
  assert.deepEqual(glow.values, [1, 3]);
  const flow = oneCalls.find(call => call.name === 'flow');
  assert.equal(flow.a, one.state.post); assert.equal(flow.b, one.state.dither);
  assert.deepEqual(flow.values.slice(0, 3), [.001, .59, 1]);
  const splash = harness('fullsplash'), splashCalls = splash.step(1 / 60);
  const reflect = splashCalls.find(call => call.name === 'blend');
  assert.equal(reflect.a, splash.state.dither); assert.equal(reflect.b, splash.state.history[0]);
  assert.deepEqual(reflect.values, [1, 4]);
});

test('wrapper seed is gray, continuous in FULL1, selection-only in FULL3 and periodic in SPLASH', () => {
  assert.deepEqual(FULL_WRAPPER.seedRendererSize, [3840, 1280]);
  const one = harness('full1');
  assert.deepEqual(one.step(.1)[0].values.slice(0, 4), [2, .125, .41, 1]);
  assert.deepEqual(one.step(.1)[0].values.slice(8, 11), [.33164, .33164, .33164]);
  const three = harness('full3');
  assert.equal(three.step(.1)[0].values[3], 1);
  assert.equal(three.step(1.5)[0].values[3], 0);
  assert.equal(three.step(.1)[0].values[3], 0);
  three.state.fullSelected = true; assert.equal(three.step(.1)[0].values[3], 1);
  assert.equal(three.step(.1)[0].values[3], 0);
  const splash = harness('fullsplash');
  assert.equal(splash.step(.25)[0].values[3], 1);
  assert.equal(splash.step(.25)[0].values[3], 0);
  assert.equal(splash.step(.25)[0].values[3], 1);
  assert.equal(splash.step(.25)[0].values[3], 0);
  assert.equal(splash.step(.25)[0].values[3], 1);
});
