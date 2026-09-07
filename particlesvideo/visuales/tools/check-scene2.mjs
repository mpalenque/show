// Movimiento autónomo y MIDI sobre la escena real, en Chrome/WebGPU aislado.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, root, sleep } from './radiance-browser.mjs';

const out = join(root, 'performance-check/scene2');
mkdirSync(out, { recursive: true });
const page = await browser({ port: 5198, base: '/?clean', initScript: `
  navigator.requestMIDIAccess = async () => ({ inputs: new Map(), outputs: new Map(), onstatechange: null });
  window.WebSocket = class { constructor() { this.readyState = 3; } close() {} send() {} addEventListener() {} };
` });
const report = {};
try {
  await page.waitFor('!!window.vis');
  await page.ev(`(async () => {
    vis.engine.stop(); await vis.engine.whenIdle();
    // La opacidad de la línea entra en 120 ms; aplicar ese tween sin avanzar la capa
    // permite inspeccionar su primera posición visible antes de que se desplace.
    vis.scenes.goto('2'); vis.params.update(0.12); vis.layer2d.update(0);
    window.__line = vis.layer2d.elements.find(el => el.constructor.name === 'MovingLine');
  })()`);
  const snapshot = () => page.ev(`({ scene: vis.scenes.current, x: __line.lines[0]?.pos,
    count: __line.lines.length, dir: vis.params.get('line.direction'), mode: vis.params.get('line.mode'),
    speed: vis.params.get('line.speed'),
    visible: __line.quads[0].visible, width: __line.quads[0].scale.x, height: __line.quads[0].scale.y,
    opacity: __line.uniforms[0].value, fading: __line.lines[0]?.fading })`);
  report.start = await snapshot();
  assert.equal(report.start.x, 1342.5, 'arranca en el centro útil de la pantalla');
  await page.ev('vis.engine.clock.getDelta(); vis.engine.start();');
  await sleep(750);
  report.withoutNotes = await snapshot();
  assert.equal(report.start.mode, 'loop');
  assert.equal(report.start.speed, 70);
  assert.equal(report.withoutNotes.count, 1);
  assert.equal(report.withoutNotes.height, 1008);
  assert.equal(report.withoutNotes.width, 3);
  assert.equal(report.withoutNotes.opacity, 1);
  assert.equal(report.withoutNotes.fading, false);
  assert.ok(report.withoutNotes.x > report.start.x + 15, 'avanza sin recibir notas');

  report.flip = await page.ev(`(() => {
    const line = __line.lines[0], before = line.pos;
    vis.midi._parse({ data: [0x91, 36, 100] });
    const after = line.pos, dir = vis.params.get('line.direction');
    vis.midi._parse({ data: [0x81, 36, 0] });
    return { before, after, dir, afterOff: vis.params.get('line.direction'), same: __line.lines[0] === line };
  })()`);
  assert.equal(report.flip.before, report.flip.after);
  assert.equal(report.flip.dir, -1);
  assert.equal(report.flip.afterOff, -1);
  assert.equal(report.flip.same, true);
  await sleep(300);
  report.reversed = await snapshot();
  assert.ok(report.reversed.x < report.flip.after, 'continúa hacia el lado contrario');

  report.legacyAndRepeatedCue = await page.ev(`(() => {
    const line = __line.lines[0], x = line.pos;
    vis.midi._parse({ data: [0x93, 33, 100] });
    vis.params.trigger('line.strike', 'random');
    vis.midi._parse({ data: [0x99, 2, 100] });
    return { same: __line.lines[0] === line, x, after: __line.lines[0].pos,
      count: __line.lines.length, dir: vis.params.get('line.direction') };
  })()`);
  assert.equal(report.legacyAndRepeatedCue.same, true);
  assert.equal(report.legacyAndRepeatedCue.after, report.legacyAndRepeatedCue.x);
  assert.equal(report.legacyAndRepeatedCue.count, 1);
  assert.equal(report.legacyAndRepeatedCue.dir, -1);

  // Adelantar sólo la capa 2D permite comprobar un cruce completo del borde sin
  // esperar los ~38 s que necesita la línea a velocidad real.
  await page.ev(`(async () => {
    vis.engine.stop(); await vis.engine.whenIdle();
    vis.params.update(3); vis.layer2d.update(100);
    vis.engine.compositor.update(); await vis.engine.compositor.render(); await vis.renderer.waitForGPU();
  })()`);
  report.afterCrossing = await snapshot();
  assert.equal(report.afterCrossing.dir, -1, 'el borde no invierte el sentido');
  assert.equal(report.afterCrossing.count, 1);
  assert.equal(report.afterCrossing.visible, true);
  assert.equal(report.afterCrossing.fading, false);
  assert.ok(report.afterCrossing.x >= 10 && report.afterCrossing.x <= 2675);
  // Presentar frames nuevos: la captura de Chrome puede conservar el último frame
  // del animation loop cuando se pide justo después de un render manual detenido.
  await page.ev('vis.engine.clock.getDelta(); vis.engine.start();');
  await sleep(150);
  await page.shot(join(out, 'linea-vertical.png'));
  assert.deepEqual(page.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  report.errors = page.errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await page.close();
}
