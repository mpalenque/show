import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { Params } from '../src/core/Params.js';
import { SceneManager } from '../src/core/SceneManager.js';
import { Mapper } from '../src/io/Mapper.js';
import { Layer2D } from '../src/layers2d/Layer2D.js';
import { Layer3D } from '../src/layers3d/Layer3D.js';
import { Floor } from '../src/layers3d/Floor.js';
import { OffAxisCamera } from '../src/render/OffAxisCamera.js';
import { SCENES } from '../src/scenes/index.js';
import { BASE } from '../src/scenes/base.js';
import { STAGE } from '../src/config/stage.js';

const defaults = JSON.parse(await readFile(new URL('../public/mappings.default.json', import.meta.url)));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `expected ${expected}, received ${actual}`);

async function fixture(t) {
  const params = new Params();
  Layer2D.defineParams(params);
  Layer3D.defineParams(params);
  SceneManager.defineParams(params, SCENES);
  // Observe entry effects without constructing the GPU particle simulation.
  const actions = [];
  for (const id of params.actions.keys()) params.onAction(id, arg => actions.push([id, arg]));
  const ctx = { params };
  const floor = new Floor(ctx);
  await floor.init(new THREE.Scene());
  t.after(() => floor.dispose());
  const manager = new SceneManager(ctx, SCENES, BASE);
  manager.init();
  const mapper = new Mapper(ctx);
  mapper.setMappings(defaults.mappings);
  const changes = [];
  manager.onSceneChange(id => { changes.push(id); mapper.onSceneChange(id); });
  const tick = dt => { params.update(dt); manager.update(dt); floor.update(dt); };
  const note = (id, on = true) => mapper.dispatch({
    kind: 'note', channel: 10, note: Number(id), on, velocity: on ? 100 : 0,
  });
  return { params, floor, manager, mapper, actions, changes, tick, note };
}

// Measure the visible front with the production camera, independently of the tween formula.
function screenProgress(params) {
  const camera = new OffAxisCamera({ ...STAGE.physical, near: STAGE.camera.near, far: 150 });
  camera.setEye(params.target('camera.eyeX'), params.target('camera.eyeY'), params.target('camera.eyeZ'));
  const projectY = depth => new THREE.Vector3(0, 0, -depth).project(camera).y;
  const start = projectY(0);
  return (projectY(params.get('floor.revealDist')) - start) /
    (projectY(params.target('floor.fadeFar')) - start);
}

function assertRestarted({ params, floor }) {
  assert.equal(params.get('floor.revealDist'), 0);
  assert.equal(floor.u.revealDist.value, 0);
  assert.equal(floor.scroll, 0);
  assert.equal(floor.u.scroll.value, 0);
}

test('MIDI scene 7 reveals progressively for sixteen seconds and restarts on every repeated Note On', async t => {
  const f = await fixture(t);
  f.note(7);
  assertRestarted(f);
  for (const elapsedBeforeRetrigger of [4, 16, 16]) {
    f.tick(4);
    close(screenProgress(f.params), 1 / 4);
    assert.ok(f.floor.u.revealDist.value > 0);
    assert.ok(f.floor.mesh.visible);
    if (elapsedBeforeRetrigger === 16) {
      f.tick(4);
      close(screenProgress(f.params), 1 / 2);
      f.tick(8);
      assert.equal(f.params.get('floor.revealDist'), f.params.target('floor.fadeFar'));
    }
    f.note(7);
    assertRestarted(f);
  }
  assert.deepEqual(f.changes, ['7']);
  assert.equal(f.actions.filter(([id]) => id === 'floor.reveal').length, 4);
});

test('scene 7 Note Off leaves the current extension and scroll running', async t => {
  const f = await fixture(t);
  f.note(7);
  f.tick(4);
  const distance = f.params.get('floor.revealDist');
  const scroll = f.floor.scroll;
  f.note(7, false);
  assert.equal(f.params.get('floor.revealDist'), distance);
  assert.equal(f.floor.scroll, scroll);
  assert.equal(f.actions.filter(([id]) => id === 'floor.reveal').length, 1);
  f.tick(4);
  close(screenProgress(f.params), 1 / 2);
});

test('retriggering scene 7 preserves live grid edits, scene parameters and scene listeners', async t => {
  const f = await fixture(t);
  f.note(7);
  f.tick(0.5);
  f.params.set('grid.b1.enabled', false);
  f.params.set('grid.b2.enabled', true);
  f.params.set('grid.b3.offsetY', 123);
  f.params.set('grid.brightness', 0.65);
  const snapshot = f.params.snapshot();
  const opacityTween = f.params.def('layer3d.opacity').tween;
  f.note(7);
  assertRestarted(f);
  assert.deepEqual(f.params.snapshot(), snapshot);
  assert.equal(f.params.def('layer3d.opacity').tween, opacityTween);
  assert.deepEqual(f.changes, ['7']);
});

test('scene 7 main action and floor.reveal without an argument both restart the perspective extension', async t => {
  const f = await fixture(t);
  f.note(7);
  f.tick(16);
  const main = f.manager.mainAction;
  const [id, arg] = Array.isArray(main) ? main : [main, undefined];
  assert.equal(id, 'floor.reveal');
  for (const trigger of [() => f.params.trigger(id, arg), () => f.params.trigger('floor.reveal')]) {
    trigger();
    assertRestarted(f);
    f.tick(4);
    close(screenProgress(f.params), 1 / 4);
    f.tick(12);
    assert.equal(f.params.get('floor.revealDist'), f.params.target('floor.fadeFar'));
  }
});

test('floor extension uses incoming duration and camera targets while those settings are transitioning', async t => {
  const f = await fixture(t);
  f.note(7);
  f.tick(16);
  f.params.set('floor.revealDuration', 4);
  f.params.tween('floor.revealDuration', 12, 2);
  f.params.tween('camera.eyeZ', 8, 2);
  f.params.trigger('floor.reveal');
  assertRestarted(f);
  f.tick(4);
  close(screenProgress(f.params), 1 / 3);
  f.tick(4);
  close(screenProgress(f.params), 2 / 3);
  f.tick(4);
  assert.equal(f.params.get('floor.revealDist'), f.params.target('floor.fadeFar'));
});

test('first entry masks the old full mesh for one display frame before beginning the slow reveal', async t => {
  const f = await fixture(t);
  f.params.set('floor.opacity', 1);
  f.params.set('layer3d.opacity', 1);
  f.params.set('floor.revealDist', f.params.target('floor.fadeFar'));
  f.tick(1 / 60);
  assert.ok(f.floor.mesh.visible);

  f.note(7);
  assertRestarted(f);
  assert.equal(f.floor.mesh.visible, false);
  f.tick(1 / 60);
  assert.equal(f.floor.mesh.visible, false);
  assert.ok(f.floor.u.revealDist.value > 0);
  assert.ok(screenProgress(f.params) < 0.01);
  f.tick(1 / 60);
  assert.ok(f.floor.mesh.visible);
  assert.ok(screenProgress(f.params) < 0.01);
});

test('repeated scene 2 and 10 notes still preserve state and do not replay entry actions', async t => {
  const f = await fixture(t);
  for (const [id, param, value] of [['2', 'line.direction', -1], ['10', 'particles.fraction', 0.3]]) {
    f.note(id);
    f.tick(4);
    f.params.set(param, value);
    const snapshot = f.params.snapshot();
    const entryActions = f.actions.filter(([action]) => action !== 'scene.goto');
    const changes = [...f.changes];
    f.note(id);
    assert.deepEqual(f.params.snapshot(), snapshot);
    assert.deepEqual(f.actions.filter(([action]) => action !== 'scene.goto'), entryActions);
    assert.deepEqual(f.changes, changes);
  }
});
