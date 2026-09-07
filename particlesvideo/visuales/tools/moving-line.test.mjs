import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Params } from '../src/core/Params.js';
import { SceneManager } from '../src/core/SceneManager.js';
// Load the layer first because its element classes import its placeQuad helper.
import '../src/layers2d/Layer2D.js';
import { MovingLine } from '../src/layers2d/MovingLine.js';
import { Frame } from '../src/layers2d/Frame.js';
import { SCENES } from '../src/scenes/index.js';
import { BASE } from '../src/scenes/base.js';
import { STAGE } from '../src/config/stage.js';

async function fixture(t, scenes = SCENES) {
  const params = new Params();
  Frame.defineParams(params);
  MovingLine.defineParams(params);
  SceneManager.defineParams(params, scenes);
  const ctx = { params };
  const line = new MovingLine(ctx);
  await line.init(new THREE.Scene());
  t.after(() => line.dispose());
  const manager = new SceneManager(ctx, scenes, BASE);
  manager.init();
  const tick = dt => { params.update(dt); manager.update(dt); line.update(dt); };
  return { params, line, manager, tick };
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `expected ${expected}, received ${actual}`);
const visible = line => line.quads.filter(quad => quad.visible);

test('scene 2 starts centered with one complete 3 px vertical line and travels at 70 px/s without notes', async t => {
  const { params, line, manager, tick } = await fixture(t);
  manager.goto('2');
  tick(1 / 60);
  assert.equal(line.lines.length, 1);
  const moving = line.lines[0];
  assert.equal(moving.grow, 1);
  assert.equal(moving.fading, false);
  assert.equal(visible(line).length, 1);
  assert.deepEqual(visible(line)[0].scale.toArray(), [3, STAGE.height, 1]);
  const min = params.get('frame.thickness');
  const max = STAGE.width - min - params.get('line.width');
  close(moving.pos, (min + max) / 2 + 70 / 60);
  const start = moving.pos;
  for (let i = 0; i < 600; i++) tick(1 / 60);
  assert.equal(line.lines[0], moving);
  close(moving.pos - start, 700);
  assert.equal(params.get('line.direction'), 1);
  assert.equal(visible(line).length, 1);
  assert.equal(line.uniforms[0].value, 1);
});

test('flip immediately reverses the existing line; repeated scene notes preserve its state', async t => {
  const { params, line, manager, tick } = await fixture(t);
  manager.goto('2');
  tick(0.2);
  const moving = line.lines[0];
  const start = moving.pos;
  const quad = visible(line)[0];
  params.trigger('line.flip');
  assert.equal(params.get('line.direction'), -1);
  assert.equal(moving.pos, start);
  tick(0.1);
  close(moving.pos, start - 7);
  params.trigger('scene.goto', '2');
  assert.equal(line.lines[0], moving);
  assert.equal(params.get('line.direction'), -1);
  close(moving.pos, start - 7);
  params.trigger('line.flip');
  tick(0.1);
  close(moving.pos, start);
  assert.equal(visible(line)[0], quad);
  assert.equal(moving.grow, 1);
});

test('both screen edges wrap without reversing, fading or hiding the continuous line', async t => {
  const { params, line, manager, tick } = await fixture(t);
  manager.goto('2');
  tick(0.2);
  const moving = line.lines[0];
  const min = params.get('frame.thickness');
  const max = STAGE.width - min - params.get('line.width');
  tick((max - moving.pos) / 70 + 0.1);
  close(moving.pos, min + 7);
  assert.equal(params.get('line.direction'), 1);
  assert.equal(moving.fading, false);
  assert.equal(line.uniforms[0].value, 1);
  params.trigger('line.flip');
  tick(0.2);
  close(moving.pos, max - 7);
  assert.equal(params.get('line.direction'), -1);
  assert.equal(moving.fading, false);
  assert.equal(moving.fadeT, 0);
  assert.equal(line.lines[0], moving);
  assert.equal(visible(line).length, 1);
  assert.equal(line.uniforms[0].value, 1);
});

test('legacy entry actions and imported strike mappings cannot recreate or add loop lines', async t => {
  const imported = SCENES.map(scene => scene.id === '2'
    ? { ...scene, actions: [['line.strike', 'edge']] } : scene);
  const { params, line, manager, tick } = await fixture(t, imported);
  manager.goto('2');
  tick(0.2);
  const moving = line.lines[0];
  const start = moving.pos;
  for (const arg of [undefined, 'edge', 'center', 'random', 1500]) params.trigger('line.strike', arg);
  assert.deepEqual(line.lines, [moving]);
  assert.equal(moving.pos, start);
  assert.equal(moving.grow, 1);
  tick(0.2);
  close(moving.pos, start + 14);
  assert.equal(visible(line).length, 1);
});

test('scene 3 retains three note-triggered strikes; returning to 2 clears them and starts one line', async t => {
  const { params, line, manager, tick } = await fixture(t);
  manager.goto('2');
  tick(0.2);
  const continuous = line.lines[0];
  manager.goto('3');
  // Ableton can select the scene and strike before the next rendered frame.
  params.trigger('line.strike', 300);
  assert.equal(line.lines.length, 1);
  const firstStrike = line.lines[0];
  assert.notEqual(firstStrike, continuous);
  assert.equal(firstStrike.grow, 0);
  tick(0.03);
  assert.equal(visible(line).length, 1);
  assert.equal(line.lines[0], firstStrike);
  assert.ok(firstStrike.grow > 0 && firstStrike.grow < 1);
  tick(1);
  for (const pos of [900, 1500]) params.trigger('line.strike', pos);
  assert.equal(line.lines.length, 3);
  assert.ok(!line.lines.includes(continuous));
  assert.ok(line.lines.slice(1).every(strike => strike.grow === 0));
  tick(0.03);
  assert.equal(visible(line).length, 3);
  assert.ok(line.lines.slice(1).every(strike => strike.grow > 0 && strike.grow < 1));
  const strikes = [...line.lines];
  manager.goto('2');
  tick(0.2);
  assert.equal(line.lines.length, 1);
  assert.ok(!strikes.includes(line.lines[0]));
  assert.notEqual(line.lines[0], continuous);
  assert.equal(line.lines[0].grow, 1);
  assert.equal(visible(line).length, 1);
  assert.deepEqual(visible(line)[0].scale.toArray(), [3, STAGE.height, 1]);
});
