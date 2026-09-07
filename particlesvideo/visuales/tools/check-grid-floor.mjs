// Grillas finas y retrigger del piso con mensajes MIDI reales, Chrome/WebGPU aislado.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, root, sleep } from './radiance-browser.mjs';

const out = join(root, 'performance-check/grid-floor');
mkdirSync(out, { recursive: true });
const page = await browser({ port: 5199, base: '/?clean', initScript: `
  navigator.requestMIDIAccess = async () => ({ inputs: new Map(), outputs: new Map(), onstatechange: null });
  window.WebSocket = class { constructor() { this.readyState = 3; } close() {} send() {} addEventListener() {} };
` });
const report = { grids: [] };
try {
  await page.waitFor('!!window.vis');
  await page.ev(`(async () => {
    vis.engine.stop(); await vis.engine.whenIdle();
    window.__grid = vis.layer2d.elements.find(el => el.constructor.name === 'GridBlocks');
    window.__floor = vis.layer3d.elements.find(el => el.constructor.name === 'Floor');
    vis.params.set('grid.fadeTime', 2);
  })()`);
  report.firstFloor = await page.ev(`(() => {
    vis.scenes.goto('1'); vis.params.update(0); __floor.update(0);
    vis.midi._parse({ data: [0x99, 7, 100] });
    const on = { distance: vis.params.get('floor.revealDist'), uniform: __floor.u.revealDist.value,
      visible: __floor.mesh.visible };
    vis.params.update(1 / 60); __floor.update(1 / 60);
    const firstFrame = { distance: vis.params.get('floor.revealDist'), uniform: __floor.u.revealDist.value,
      visible: __floor.mesh.visible };
    vis.params.update(1 / 60); __floor.update(1 / 60);
    const secondFrame = { distance: vis.params.get('floor.revealDist'), uniform: __floor.u.revealDist.value,
      visible: __floor.mesh.visible };
    return { on, firstFrame, secondFrame };
  })()`);
  assert.deepEqual(report.firstFloor.on, { distance: 0, uniform: 0, visible: false });
  assert.equal(report.firstFloor.firstFrame.visible, false);
  assert.ok(report.firstFloor.firstFrame.distance > 0 && report.firstFloor.firstFrame.distance < 0.1);
  assert.equal(report.firstFloor.secondFrame.visible, true);
  for (const scene of [4, 5, 6, 7, 8]) {
    const state = await page.ev(`(() => {
      vis.midi._parse({ data: [0x99, ${scene}, 100] });
      vis.layer2d.update(0);
      return { scene: vis.scenes.current, opacity: vis.params.get('grid.opacity'),
        brightness: vis.params.get('grid.brightness'), blocks: __grid.blocks.map(b => ({
          enabled: vis.params.get('grid.b' + b.n + '.enabled'), fade: b.fade,
          alpha: b.u.alpha.value, reveal: b.u.reveal.value, width: b.u.cellW.value,
        })) };
    })()`);
    for (const b of state.blocks) {
      assert.equal(b.fade, b.enabled ? 1 : 0, 'sin alpha intermedio en el primer frame');
      assert.equal(b.alpha, b.enabled ? state.brightness : 0);
      assert.equal(b.reveal, 1, 'grilla completa desde la nota');
      if (b.enabled) assert.equal(b.width, 84);
    }
    assert.equal(state.opacity, 1);
    report.grids.push(state);
  }
  report.visibilityNote = await page.ev(`(() => {
    vis.midi._parse({ data: [0x90, 0, 100] }); vis.layer2d.update(0);
    const on = __grid.blocks.map(b => [b.fade, b.u.alpha.value]);
    vis.midi._parse({ data: [0x80, 0, 0] }); vis.layer2d.update(0);
    return { on, off: __grid.blocks.map(b => [b.fade, b.u.alpha.value]) };
  })()`);
  assert.ok(report.visibilityNote.on.every(([fade]) => fade === 0 || fade === 1));
  assert.deepEqual(report.visibilityNote.off, report.visibilityNote.on);

  await page.ev(`vis.midi._parse({ data: [0x99, 7, 100] });
    vis.params.set('grid.opacity', 0); // Aislar el piso en las capturas, sin cambiar el código del show.
    vis.engine.clock.getDelta(); vis.engine.start();`);
  const floorState = () => page.ev(`({ scene: vis.scenes.current,
    distance: vis.params.get('floor.revealDist'), duration: vis.params.def('floor.revealDist').tween?.duration,
    opacity: __floor.u.opacity.value, visible: __floor.mesh.visible, scroll: __floor.scroll,
    grid: vis.params.get('grid.opacity') })`);
  report.floor = [];
  for (const [name, depth] of [['inicio', 0.6], ['medio', 3.5], ['completo', 59.99]]) {
    await page.waitFor(`vis.params.get('floor.revealDist') >= ${depth}`, 25000);
    const state = await floorState();
    assert.equal(state.scene, '7');
    assert.equal(state.opacity, 1, 'el avance del frente no se oculta detrás de un fade');
    report.floor.push({ name, ...state });
    await page.shot(join(out, `piso-${name}.png`));
  }
  report.retrigger = await page.ev(`(() => {
    const grid = __grid.blocks.map(b => vis.params.get('grid.b' + b.n + '.enabled'));
    vis.midi._parse({ data: [0x99, 7, 100] });
    return { distance: vis.params.get('floor.revealDist'), uniform: __floor.u.revealDist.value,
      scroll: __floor.scroll, duration: vis.params.def('floor.revealDist').tween.duration,
      gridOpacity: vis.params.get('grid.opacity'), grid,
      afterGrid: __grid.blocks.map(b => vis.params.get('grid.b' + b.n + '.enabled')) };
  })()`);
  assert.equal(report.retrigger.distance, 0);
  assert.equal(report.retrigger.uniform, 0);
  assert.equal(report.retrigger.scroll, 0);
  assert.equal(report.retrigger.duration, 16);
  assert.equal(report.retrigger.gridOpacity, 0);
  assert.deepEqual(report.retrigger.afterGrid, report.retrigger.grid);
  await page.waitFor('vis.params.get("floor.revealDist") >= 0.6');
  await page.shot(join(out, 'piso-repetido.png'));
  report.midRetrigger = await page.ev(`(() => {
    const before = vis.params.get('floor.revealDist');
    vis.midi._parse({ data: [0x89, 7, 0] });
    const afterOff = vis.params.get('floor.revealDist');
    vis.midi._parse({ data: [0x99, 7, 100] });
    return { before, afterOff, afterOn: vis.params.get('floor.revealDist') };
  })()`);
  assert.ok(report.midRetrigger.before > 0);
  assert.equal(report.midRetrigger.afterOff, report.midRetrigger.before);
  assert.equal(report.midRetrigger.afterOn, 0);
  await page.ev('vis.scenes.goto("4");');
  await sleep(100);
  await page.shot(join(out, 'grillas-finas.png'));
  assert.deepEqual(page.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  report.errors = page.errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await page.close();
}
