import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { launchChromium } from './system/test-browser.mjs';
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const captures = new URL('./captures/', import.meta.url);
const errors = [];
const checks = [];
const images = {};
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const capturePath = name => fileURLToPath(new URL(name, captures));
const settled = () => page.waitForFunction(() => !window.milky.ui.stepping);
async function imageStats(name) {
  const stats = await page.evaluate(async () => {
    const state = window.milky.engine.state('final');
    const pixels = await window.milky.engine.readback('final');
    let sum = 0, squares = 0, lit = 0, hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 4) {
      const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      sum += value; squares += value * value; if (value > 8) lit++;
      hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
      hash = Math.imul(hash ^ pixels[i + 1], 16777619) >>> 0;
    }
    const count = pixels.length / 4, mean = sum / count;
    return { size: [state.output.width, state.output.height], frame: state.frame, inkFrame: state.inkFrame, mean, variance: squares / count - mean * mean, lit: lit / count, hash };
  });
  images[name] = stats;
  return stats;
}
async function range(id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => { input.value = next; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
  await settled();
}
async function checkbox(id, checked) {
  if (await page.locator(`#${id}`).isChecked() !== checked) await page.locator(`label[for="${id}"]`).click();
  await settled();
}
try {
  await mkdir(captures, { recursive: true });
  await page.goto('http://127.0.0.1:8787/?test=1&preset=final&resolution=400x640');
  await page.waitForFunction(() => window.milky || !document.getElementById('error-panel').hidden, { timeout: 45000 });
  assert(await page.evaluate(() => Boolean(window.milky)), await page.locator('#error-message').textContent());
  assert.equal(await page.locator('#preset-select').inputValue(), 'final');
  assert.equal(await page.locator('#preset-select option').count(), 5);
  assert.equal(await page.locator('#final-controls').isVisible(), true);
  assert.equal(await page.locator('#material-controls').isVisible(), false);
  assert.equal(await page.locator('#kick-button').isEnabled(), true);
  assert.equal(await page.locator('#snare-button').isDisabled(), true);
  assert.deepEqual(await page.locator('#resolution-select option').allTextContents(), ['1920 × 600', '3840 × 1200', '5760 × 1800']);
  checks.push('FINAL selection, five presets, contextual controls and resolution labels');
  console.log('INIT', JSON.stringify(await page.evaluate(() => window.milky.diagnostics())));

  await page.evaluate(() => window.milky.step(36, false));
  const first = await imageStats('initial');
  assert.equal(first.frame, 36);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.milky.engine.state('final').frame), first.frame);
  await page.evaluate(async () => { window.milky.reset(); await window.milky.step(36, false); });
  const repeated = await imageStats('reset');
  assert.equal(repeated.hash, first.hash, 'FINAL reset must reproduce its pixels');
  checks.push('Paused playback stays stopped; 36 deterministic frames and reset reproduce pixels');

  await range('final-fx1', .24); await range('final-fx2', .41); await range('final-fx4', .63);
  const settings = await page.evaluate(() => ({ ...window.milky.engine.settings.final }));
  assert.equal(settings.fx1, .24); assert.equal(settings.fx2, .41); assert.equal(settings.fx4, .63);
  await checkbox('final-loop', false); await checkbox('final-button', false); await checkbox('final-flash', false);
  const disabled = await page.evaluate(() => ({ ...window.milky.engine.settings.final }));
  assert.equal(disabled.loop, false); assert.equal(disabled.button, false); assert.equal(disabled.flash, false);
  await checkbox('final-loop', true); await checkbox('final-button', true); await checkbox('final-flash', true);
  await range('final-fx1', 0); await range('final-fx2', 0); await range('final-fx4', 0);
  checks.push('FX controls and feedback/loop/contrast toggles update engine settings in pause');

  await range('ink-progress', .45);
  assert.equal(await page.evaluate(() => window.milky.engine.settings.final.inkProgress), .45);
  assert.equal(await page.evaluate(() => window.milky.engine.state('final').inkFrame), 298);
  assert.equal(await page.locator('#ink-play-button').isEnabled(), true);
  await page.selectOption('#final-view', 'ink'); await settled();
  const raw = await imageStats('ink');
  assert(raw.variance > 5 && raw.lit > .002, 'Original INK should contain a visible image');
  await page.screenshot({ path: capturePath('final-ink-ui.png'), fullPage: true });
  await page.selectOption('#final-view', 'distort'); await settled();
  const distort = await imageStats('distort');
  assert(distort.variance > 5 && distort.lit > .002, 'Expanded ink should contain a visible image');
  assert.notEqual(distort.hash, raw.hash);
  await page.screenshot({ path: capturePath('final-distort-ui.png'), fullPage: true });
  await page.selectOption('#final-view', 'output'); await settled();
  checks.push('Paused scrub loads frame 298; ink/distort/output views update with nonempty textures');

  await page.click('#ink-play-button'); await settled();
  assert.equal(await page.evaluate(() => window.milky.engine.settings.final.inkProgress), null);
  assert.equal(await page.locator('#ink-play-button').isDisabled(), true);
  await page.click('#final-explode'); await settled();
  assert.equal(await page.evaluate(() => window.milky.engine.state('final').inkFrame), 52);
  const narrow = await page.evaluate(() => window.milky.engine.state('final').narrow);
  await page.click('#kick-button'); await settled();
  assert.notEqual(await page.evaluate(() => window.milky.engine.state('final').narrow), narrow);
  checks.push('Resume tint transport, explosion resets its frame, kick changes geometry');

  await page.selectOption('#resolution-select', '800x1280');
  await page.evaluate(() => window.milky.step(90, false));
  const native = await imageStats('native');
  assert.deepEqual(native.size, [3840, 1200]);
  assert(native.variance > 5 && native.lit > .002, 'Native FINAL must be visibly nonuniform');
  await page.locator('.inspector').evaluate(element => element.scrollTop = 0);
  await page.screenshot({ path: capturePath('final-ui.png'), fullPage: true });
  const downloadEvent = page.waitForEvent('download');
  await page.click('#export-button');
  const download = await downloadEvent;
  const pngPath = capturePath('final-export.png');
  await download.saveAs(pngPath);
  const png = await readFile(pngPath);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [3840, 1200]);
  checks.push('90 native frames at 3840×1200, visible screenshot, exported PNG dimensions');

  await page.selectOption('#resolution-select', '400x640');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.milky.step(75, false));
  const mobile = await imageStats('mobile');
  assert(mobile.variance > 5 && mobile.lit > .002);
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, stage: document.querySelector('.stage').getBoundingClientRect().toJSON() }));
  assert(layout.scrollWidth <= layout.width, 'Mobile page must not overflow horizontally');
  assert(layout.stage.width > 300 && layout.stage.height > 80);
  await page.screenshot({ path: capturePath('final-mobile.png'), fullPage: true });
  checks.push('390px mobile layout without horizontal overflow and visible ink render');

  // Exercise the actual image upload path on machines without BC support.
  // Override the loader's capability decision; shaders and GPU remain real.
  await page.evaluate(async () => {
    const m = window.milky;
    m.engine.ink.dispose();
    const { InkPlayer } = await import('./ink-player.js');
    m.engine.ink = new InkPlayer(m.engine);
    m.engine.ink.compressed = false; m.engine.ink.format = 'rgba8unorm';
    m.engine.settings.final.view = 'ink'; m.engine.settings.final.inkProgress = .45;
    m.reset(); await m.step(1, false);
  });
  const fallback = await imageStats('jpegFallback');
  assert(fallback.variance > 5 && fallback.lit > .002);
  checks.push('Original JPEG fallback decodes and uploads to WebGPU without BC compression');

  const diagnostics = await page.evaluate(() => window.milky.diagnostics());
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(diagnostics.errors.length, 0, diagnostics.errors.join('\n'));
  await writeFile(capturePath('final-ui-validation.json'), JSON.stringify({ checks, images, layout, diagnostics, errors }, null, 2));
  console.log('PASS', JSON.stringify({ checks, images, errors }));
} catch (error) {
  await page.screenshot({ path: capturePath('final-ui-failure.png'), fullPage: true }).catch(() => {});
  console.error('FAIL', error, 'Browser errors:', errors);
  throw error;
} finally { await browser.close(); }
