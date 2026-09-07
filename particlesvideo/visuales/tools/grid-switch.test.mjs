import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three/webgpu';
import { Params } from '../src/core/Params.js';
import { Mapper } from '../src/io/Mapper.js';
// Load the layer before its elements, which import the layer's placeQuad helper.
import '../src/layers2d/Layer2D.js';
import { GridBlocks } from '../src/layers2d/GridBlocks.js';

const defaults = JSON.parse(await readFile(new URL('../public/mappings.default.json', import.meta.url)));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `expected ${expected}, received ${actual}`);

async function fixture(t) {
  const params = new Params();
  GridBlocks.defineParams(params);
  const grid = new GridBlocks({ params });
  await grid.init(new THREE.Scene());
  t.after(() => grid.dispose());
  params.set('grid.opacity', 1);
  params.set('grid.scrollSpeed', 0);
  const mapper = new Mapper({ params });
  mapper.setMappings(defaults.mappings.filter(row => row.target?.startsWith('grid.')));
  mapper.onSceneChange('4');
  const tick = dt => { params.update(dt); grid.update(dt); };
  const pattern = () => grid.blocks.map(block => block.mesh.visible);
  const assertCut = () => {
    for (const block of grid.blocks) {
      const enabled = params.get(`grid.b${block.n}.enabled`);
      assert.equal(block.fade, enabled ? 1 : 0);
      assert.equal(block.u.alpha.value, enabled ? 0.6 : 0);
      assert.equal(block.mesh.visible, enabled);
    }
  };
  return { params, grid, mapper, tick, pattern, assertCut };
}

test('fine-grid MIDI visibility notes switch every block at full brightness in the next frame', async t => {
  const { mapper, tick, pattern, assertCut } = await fixture(t);
  const note = { kind: 'note', channel: 1, note: 0, on: true, velocity: 100 };
  tick(0);
  let previous = pattern();
  for (let i = 0; i < 20; i++) {
    mapper.dispatch(note);
    tick(1 / 60);
    const current = pattern();
    assert.notDeepEqual(current, previous);
    assert.ok(current.some(Boolean));
    assert.ok(current.some(enabled => !enabled));
    assertCut();
    mapper.dispatch({ ...note, on: false, velocity: 0 });
    tick(1 / 60);
    assert.deepEqual(pattern(), current, 'Note Off must not change the visible pattern');
    assertCut();
    previous = current;
  }
});

test('fine-grid block toggles and toggleAll have no intermediate opacity, even with a saved fade', async t => {
  const { params, grid, tick, assertCut } = await fixture(t);
  params.set('grid.fadeTime', 2);
  for (let i = 0; i < 4; i++) {
    params.trigger('grid.b1.toggle');
    tick(0);
    assert.equal(grid.blocks[0].mesh.visible, i % 2 === 0);
    assertCut();
  }
  params.trigger('grid.toggleAll');
  tick(0);
  assert.ok(grid.blocks.every(block => block.mesh.visible));
  assertCut();
  params.trigger('grid.toggleAll');
  tick(0);
  assert.ok(grid.blocks.every(block => !block.mesh.visible));
  assertCut();
});

test('fine-grid scene opacity transitions display the requested opacity immediately', async t => {
  const { params, grid, tick } = await fixture(t);
  params.set('grid.b1.enabled', true);
  params.set('grid.opacity', 0);
  tick(0);
  const block = grid.blocks[0];
  assert.equal(block.mesh.visible, false);
  params.tween('grid.opacity', 1, 2);
  tick(0);
  assert.equal(params.get('grid.opacity'), 0);
  assert.equal(block.u.alpha.value, 0.6);
  assert.equal(block.mesh.visible, true);
  tick(0.5);
  assert.ok(params.get('grid.opacity') > 0 && params.get('grid.opacity') < 1);
  assert.equal(block.u.alpha.value, 0.6);
  params.tween('grid.opacity', 0, 2);
  tick(0);
  assert.ok(params.get('grid.opacity') > 0);
  assert.equal(block.u.alpha.value, 0);
  assert.equal(block.mesh.visible, false);
});

test('fine-grid cuts retain smooth offsets and retriggers continue from the visible position', async t => {
  const { params, grid, tick, assertCut } = await fixture(t);
  params.set('grid.b1.enabled', true);
  params.set('grid.pixelSnap', false);
  params.set('grid.offsetTime', 0.4);
  params.set('grid.offsetEase', 'linear');
  tick(0);
  params.trigger('grid.b1.nudge', 'horizontal');
  tick(0);
  close(grid.blocks[0].u.offsetX.value, 0);
  tick(0.1);
  close(grid.blocks[0].u.offsetX.value, 10.5);
  assertCut();
  params.trigger('grid.b1.nudge', 'horizontal');
  tick(0);
  close(grid.blocks[0].u.offsetX.value, 10.5);
  tick(0.1);
  close(grid.blocks[0].u.offsetX.value, 21);
  tick(0.3);
  close(grid.blocks[0].u.offsetX.value, 52.5);
  assertCut();
});

test('coarse grids preserve the configured block fade and scene opacity interpolation', async t => {
  const { params, grid, tick } = await fixture(t);
  params.set('grid.coarse', true);
  params.set('grid.b1.enabled', true);
  tick(0.015);
  const block = grid.blocks[0];
  const firstFade = 1 - Math.exp(-0.015 / 0.15);
  close(block.fade, firstFade);
  close(block.u.alpha.value, firstFade * 0.6);
  params.set('grid.b1.enabled', false);
  tick(0.015);
  assert.ok(block.fade > 0 && block.fade < firstFade);
  params.set('grid.b1.enabled', true);
  params.set('grid.opacity', 0);
  params.tween('grid.opacity', 1, 1, 'linear');
  tick(0.5);
  assert.equal(params.get('grid.opacity'), 0.5);
  close(block.u.alpha.value, block.fade * 0.6 * 0.5);
  assert.ok(block.u.alpha.value > 0 && block.u.alpha.value < 0.3);
});
