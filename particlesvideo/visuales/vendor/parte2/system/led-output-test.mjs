import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DISPLAY_PROFILE, LED_DISPLAY_PARAMETERS } from './display-profile.js';

import { launchChromium } from './test-browser.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const captures = path.join(directory, '..', 'captures');
await mkdir(captures, { recursive: true });
const legacyLayout = {
  'output.resolution': '3840x1200', 'output.preview': 'fullMilky',
  'composition.stripes.x': 0, 'composition.stripes.y': .798097,
  'composition.stripes.width': 1.4, 'composition.stripes.stripWidth': 448 / 3840 * 2,
  'composition.stripes.height': .589466, 'composition.stripes.rotation': 0,
  'composition.view.mode': 'show-strip', 'composition.view.x': 0, 'composition.view.y': -.82,
  'composition.view.scaleX': 1, 'composition.view.scaleY': 1.57,
  'composition.view.outputX': 0, 'composition.view.outputY': -.43,
  'composition.view.outputScaleX': 1, 'composition.view.outputScaleY': 1,
};
const customMapping = { id: 'user.preserved-led-test', label: 'Control personalizado que debe conservarse',
  source: { kind: 'cc', channel: 3, cc: 91 }, target: 'final.fx1', mode: 'range',
  output: 'control', min: -.2, max: .8, enabled: true };
const oldSession = { version: 1, parameters: { ...legacyLayout, 'scene.current': 69,
  'scene.automation': false, 'transport.playing': false, 'player.full.clip': 4,
  'players.2.clip': 7, 'final.fx1': .23, 'final.fx2': .41, 'final.flash': false },
  scenes: { 72: { ...legacyLayout, 'players.2.clip': 8, 'final.fx1': .68, 'final.fx2': .52 } } };
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1512, height: 1080 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
context.on('page', target => target.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({ oldSession, customMapping }) => {
  if (!location.pathname.endsWith('/system.html')) return;
  localStorage.setItem('parte2.session.v1', JSON.stringify(oldSession));
  localStorage.setItem('parte2.mappings', JSON.stringify({ version: 1, profile: 'parte2', mappings: [customMapping] }));
}, { oldSession, customMapping });
const report = { bootstrap: 'system/app.js real, sin interceptar', output: [2688, 1008], blockSize: [448, 1008] };
try {
  await page.goto('http://127.0.0.1:8787/system.html?test');
  await page.waitForFunction(() => window.parte2 && document.querySelector('#system-loading').hidden, null, { timeout: 90000 });
  await page.evaluate(() => window.parte2.engine.device.queue.onSubmittedWorkDone());
  report.migration = await page.evaluate(() => {
    const system = window.parte2;
    return { parameters: system.params.snapshot(), scene: system.sceneSnapshots[72], profile: system.exportSession().displayProfile,
      mapping: system.mapper.list().find(row => row.id === 'user.preserved-led-test'),
      width: system.width, height: system.height, warnings: system.warnings };
  });
  assert.equal(report.migration.profile, DISPLAY_PROFILE);
  assert.equal(report.migration.width, 2688); assert.equal(report.migration.height, 1008);
  for (const [id, value] of Object.entries(LED_DISPLAY_PARAMETERS)) {
    assert.equal(report.migration.parameters[id], value, `Migración del parámetro ${id}`);
    assert.equal(report.migration.scene[id], value, `Migración de la escena: ${id}`);
  }
  assert.equal(report.migration.parameters['player.full.clip'], 4);
  assert.equal(report.migration.parameters['players.2.clip'], 7);
  assert.equal(report.migration.parameters['final.fx1'], .23);
  assert.equal(report.migration.parameters['final.fx2'], .41);
  assert.equal(report.migration.scene['players.2.clip'], 8);
  assert.equal(report.migration.scene['final.fx1'], .68);
  assert.equal(report.migration.scene['final.fx2'], .52);
  assert.deepEqual(report.migration.mapping, customMapping);
  report.sceneRecall = await page.evaluate(() => {
    const system = window.parte2;
    system.recallScene(72);
    return { resolution: system.params.get('output.resolution'), preview: system.params.get('output.preview'),
      clip: system.params.get('players.2.clip'), fx1: system.params.get('final.fx1') };
  });
  assert.deepEqual(report.sceneRecall, { resolution: '2688x1008', preview: 'composition', clip: 8, fx1: .68 });

  report.bands = await page.evaluate(async () => {
    const system = window.parte2, engine = system.engine;
    const colors = [[255,0,0,255], [0,255,0,255], [0,0,255,255], [255,255,0,255], [0,255,255,255], [255,0,255,255]];
    system.runLook('sixDDS');
    for (const [id, value] of Object.entries({ 'scene.automation': false, 'composition.warp.enabled': false,
      'composition.overlay.enabled': false, 'composition.stripes.enabled': true, 'ink.enabled': false,
      'output.master': 1, 'output.blackout': false, 'composition.stripes.videoBrightness': 1,
      'composition.stripes.blend': 'normal', 'events.snareHeld': false })) system.params.set(id, value);
    window.ledTestTextures = colors.map((color, index) => {
      const texture = engine.texture(`test/led-solid-${index}`, 1, 1, 'rgba8unorm', false);
      engine.device.queue.writeTexture({ texture: texture.texture }, new Uint8Array(color), { bytesPerRow: 4 }, [1, 1]);
      const deck = system.decks[index + 1];
      Object.defineProperty(deck, 'texture', { configurable: true, get: () => texture });
      return texture;
    });
    system.render(0); await engine.device.queue.onSubmittedWorkDone();
    const pixels = await system.readback(), width = system.width, height = system.height;
    let mismatchCount = 0, blackCount = 0, transparentCount = 0;
    const failures = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4, expected = colors[Math.floor(x / 448)];
      if (!pixels[offset] && !pixels[offset + 1] && !pixels[offset + 2]) blackCount++;
      if (pixels[offset + 3] !== 255) transparentCount++;
      if (expected.some((value, channel) => value !== pixels[offset + channel])) {
        mismatchCount++; if (failures.length < 10) failures.push({ x, y, actual: Array.from(pixels.slice(offset, offset + 4)), expected });
      }
    }
    const pixel = (x, y) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    const boundaries = [0,447,448,895,896,1343,1344,1791,1792,2239,2240,2687];
    return { width, height, pixelsChecked: width * height, mismatchCount, blackCount, transparentCount, failures,
      topRow: boundaries.map(x => ({ x, color: pixel(x, 0) })), bottomRow: boundaries.map(x => ({ x, color: pixel(x, 1007) })),
      geometry: Array.from({ length: 6 }, (_, index) => system.compositor.project(system.compositor.stripeSettings(index, system.compositionParams()), system.compositionParams())) };
  });
  assert.equal(report.bands.pixelsChecked, 2688 * 1008);
  assert.equal(report.bands.mismatchCount, 0, JSON.stringify(report.bands.failures));
  assert.equal(report.bands.blackCount, 0); assert.equal(report.bands.transparentCount, 0);
  report.png = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(await window.parte2.capture());
    const size = [bitmap.width, bitmap.height]; bitmap.close(); return size;
  });
  assert.deepEqual(report.png, [2688, 1008]);
  const pngEvent = page.waitForEvent('download'); await page.click('#system-capture');
  await (await pngEvent).saveAs(path.join(captures, 'led-bands-2688x1008.png'));

  const popupEvent = context.waitForEvent('page'); await page.click('#system-output'); const output = await popupEvent;
  await output.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => {
    const system = window.parte2; system.render(0); await system.engine.device.queue.onSubmittedWorkDone();
    for (const stream of system.outputStreams) stream.getVideoTracks().forEach(track => track.requestFrame?.());
  });
  await output.waitForFunction(() => {
    const video = document.querySelector('video'); return video && video.videoWidth === 2688 && video.videoHeight === 1008;
  }, null, { timeout: 15000 });
  report.cleanOutput = await output.evaluate(() => {
    const video = document.querySelector('video'), stream = video.srcObject;
    return { video: [video.videoWidth, video.videoHeight], tracks: stream.getVideoTracks().map(track => track.getSettings()),
      messageHidden: document.getElementById('message').hidden, bodyChildren: document.body.children.length };
  });
  assert.deepEqual(report.cleanOutput.video, [2688, 1008]); assert.equal(report.cleanOutput.messageHidden, true);
  assert.equal(report.cleanOutput.tracks[0].width, 2688); assert.equal(report.cleanOutput.tracks[0].height, 1008);
  await output.close();

  report.realDDS = await page.evaluate(async () => {
    const system = window.parte2;
    for (let index = 1; index <= 6; index++) delete system.decks[index].texture;
    window.ledTestTextures.forEach(texture => texture.texture.destroy());
    delete window.ledTestTextures; system.engine.bindCache.clear();
    const available = system.manifest.clips.filter(clip => clip.complete && clip.availableFrames > 0).slice(0, 6);
    if (available.length < 6) throw new Error('Se necesitan seis secuencias completas para la captura DDS.');
    for (let index = 0; index < 6; index++) {
      system.params.set(`players.${index}.clip`, available[index].index);
      system.params.set(`players.${index}.seek`, .2);
      system.params.set(`players.${index}.playing`, false);
    }
    await system.step(1); await system.step(1);
    const pixels = await system.readback();
    const blocks = available.map((clip, index) => {
      let nonBlack = 0, max = 0;
      for (let y = 0; y < system.height; y++) for (let x = index * 448; x < (index + 1) * 448; x++) {
        const offset = (y * system.width + x) * 4;
        const peak = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        if (peak) nonBlack++; max = Math.max(max, peak);
      }
      return { index, clip: clip.name, frame: system.decks[index + 1].frame, nonBlack, max };
    });
    return { blocks, mappedSourcesUnchanged: system.manifest.clips.every(clip => !clip.rootId?.startsWith('test')) };
  });
  assert.equal(report.realDDS.blocks.length, 6); assert.ok(report.realDDS.blocks.every(block => block.nonBlack > 1000));
  const ddsEvent = page.waitForEvent('download'); await page.click('#system-capture');
  await (await ddsEvent).saveAs(path.join(captures, 'led-dds-2688x1008.png'));
  await page.screenshot({ path: path.join(captures, 'led-system-2688x1008.png'), fullPage: true });
  report.errors = errors; report.gpuErrors = await page.evaluate(() => window.parte2.engine.errors);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.gpuErrors, []);
  // Avoid a huge duplicate parameter table in the proof artifact.
  report.migration.parameters = Object.fromEntries(Object.keys({ ...legacyLayout, ...oldSession.parameters }).map(id => [id, report.migration.parameters[id]]));
  await writeFile(path.join(captures, 'led-output-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); await browser.close(); }
