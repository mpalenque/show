import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { launchChromium } from './test-browser.mjs';
const browser = await launchChromium();
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:8787/?test=1&resolution=400x640');
  await page.waitForFunction(() => window.milky);
  const result = await page.evaluate(async () => {
    const { Compositor, cloneCompositionDefaults, COMPOSITION_PARAMETERS, sceneAutomation } = await import('/system/compositor.js');
    const e = window.milky.engine; window.milky.pause(true);
    const c = await new Compositor(e, { width: 768, height: 240 }).init();
    const solid = (name, rgb, pattern = false) => {
      const texture = e.texture(name, 64, 64); const pixels = new Uint8Array(64 * 64 * 4);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const factor = pattern ? ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? .9 : .1) : 1;
        pixels.set([...rgb.map(v => Math.round(v * factor)), 255], (y * 64 + x) * 4);
      }
      e.device.queue.writeTexture({ texture: texture.texture }, pixels, { bytesPerRow: 256 }, [64, 64]); return texture;
    };
    const red = solid('test red', [255, 0, 0]); const blue = solid('test blue', [0, 0, 255]);
    const check = solid('test checker', [255, 255, 255], true);
    const p = cloneCompositionDefaults();
    const render = async input => {
      e.begin(); c.render({ fullMilky: red, fullVideo: blue, params: p, ...input });
      e.device.queue.writeBuffer(e.uniformBuffer, 0, e.uniformData.buffer, 0, e.passCount * 256);
      e.device.queue.submit([e.encoder.finish()]); await e.device.queue.onSubmittedWorkDone();
      const pitch = Math.ceil(c.width * 4 / 256) * 256;
      const buffer = e.device.createBuffer({ size: pitch * c.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = e.device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: c.output.texture }, { buffer, bytesPerRow: pitch }, [c.width, c.height]);
      e.device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange());
      const sample = (x, y) => [...bytes.slice(Math.floor(y * c.height) * pitch + Math.floor(x * c.width) * 4, Math.floor(y * c.height) * pitch + Math.floor(x * c.width) * 4 + 4)];
      const samples = { center: sample(.5, .5), left: sample(.02, .5), stripe: sample(.21, .5) };
      let hash = 2166136261; for (let i = 0; i < bytes.length; i += 4) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
      buffer.unmap(); buffer.destroy(); return { ...samples, hash, passes: e.passCount, intermediate: [c.composition.width, c.composition.height] };
    };
    const results = {};
    results.fullMilky = await render();
    p.fullVideo.enabled = true; results.fullVideo = await render();
    p.fullVideo.opacity = .5; results.alpha = await render();
    p.fullVideo.enabled = false; p.stripes.videoOpacity = [1, 1, 1, 1, 1, 1]; p.stripes.milkyOpacity = [1, 1, 1, 1, 1, 1];
    results.stripes = await render({ stripes: Array.from({ length: 6 }, () => ({ milky: red, video: blue })) });
    p.stripes.enabled = false; p.warp.enabled = true;
    results.warp = await render({ fullMilky: check, warpSource: check });
    p.warp.full = false; p.warp.maskMode = 'stripes'; p.warp.mask = [1, 0, 1, 0, 1, 0];
    results.mask = await render({ fullMilky: check, warpSource: check });
    p.view.mode = 'reference'; results.reference = await render({ fullMilky: check, warpSource: check });
    const scopes = [64, 65, 66, 68, 69, 80, 81].map(scene => ({ scene, ...sceneAutomation(scene, true) }));
    const parameterErrors = COMPOSITION_PARAMETERS.filter(item => item.path.split('.').reduce((v, key) => v?.[key], cloneCompositionDefaults()) === undefined).map(item => item.path);
    const output = { results, scopes, parameters: COMPOSITION_PARAMETERS.length, parameterErrors, errors: [...e.errors] };
    c.dispose(); red.texture.destroy(); blue.texture.destroy(); check.texture.destroy(); return output;
  });
  assert.deepEqual(result.results.fullMilky.center, [255, 0, 0, 255]);
  assert.deepEqual(result.results.fullVideo.center, [0, 0, 255, 255]);
  assert(result.results.alpha.center[0] >= 126 && result.results.alpha.center[0] <= 129);
  assert(result.results.alpha.center[2] >= 126 && result.results.alpha.center[2] <= 129);
  assert.deepEqual(result.results.stripes.stripe, [0, 0, 255, 255]);
  assert.deepEqual(result.results.stripes.left, [0, 0, 255, 255]);
  assert.notEqual(result.results.warp.hash, result.results.mask.hash);
  assert.deepEqual(result.results.reference.intermediate, [768, 432]);
  assert.equal(result.parameterErrors.length, 0); assert.equal(result.errors.length, 0); assert.equal(errors.length, 0);
  await writeFile(new URL('../captures/composition-validation.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log('PASS', JSON.stringify(result));
} finally { await browser.close(); }
