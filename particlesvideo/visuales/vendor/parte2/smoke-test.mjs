import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

import { launchChromium } from './system/test-browser.mjs';
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
try {
  await page.goto('http://127.0.0.1:8787/?test=1&gallery=1&resolution=400x640');
  await page.waitForFunction(() => window.milky || !document.getElementById('error-panel').hidden, { timeout: 45000 });
  const init = await page.evaluate(() => window.milky ? window.milky.diagnostics() : { error: document.getElementById('error-message').textContent });
  console.log('INIT', JSON.stringify(init));
  assert(!init.error, init.error);
  await page.evaluate(() => window.milky.step(120, true));
  const stats = await page.evaluate(async () => {
    const results = [];
    for (const p of window.milky.PRESETS) {
      const pixels = await window.milky.engine.readback(p.id);
      let sum = 0, squares = 0, lit = 0, hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) {
        const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
        sum += value; squares += value * value; if (value > 8) lit++;
        hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
        hash = Math.imul(hash ^ pixels[i + 1], 16777619) >>> 0;
      }
      const count = pixels.length / 4, mean = sum / count;
      results.push({ id: p.id, mean, variance: squares / count - mean * mean, lit: lit / count, hash });
    }
    return { results, diagnostics: window.milky.diagnostics() };
  });
  console.log('FRAMES120', JSON.stringify(stats));
  assert.equal(stats.diagnostics.errors.length, 0);
  for (const p of stats.results) { assert(p.variance > 5, `${p.id}: imagen uniforme`); assert(p.lit > 0.002, `${p.id}: imagen vacía`); }
  await mkdir(new URL('./captures/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('./captures/gallery.png', import.meta.url)), fullPage: true });
  await page.evaluate(() => window.milky.step(60, true));
  const next = await page.evaluate(async () => {
    const hashes = [];
    for (const p of window.milky.PRESETS) {
      const pixels = await window.milky.engine.readback(p.id); let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) { hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0; hash = Math.imul(hash ^ pixels[i + 1], 16777619) >>> 0; }
      hashes.push(hash);
    }
    return hashes;
  });
  stats.results.forEach((p, i) => assert.notEqual(p.hash, next[i], `${p.id}: no evoluciona`));
  await page.evaluate(async () => { window.milky.reset(); await window.milky.step(120, true); });
  const repeat = await page.evaluate(async () => {
    const hashes = [];
    for (const p of window.milky.PRESETS) {
      const pixels = await window.milky.engine.readback(p.id); let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) { hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0; hash = Math.imul(hash ^ pixels[i + 1], 16777619) >>> 0; }
      hashes.push(hash);
    }
    return hashes;
  });
  stats.results.forEach((p, i) => assert.equal(p.hash, repeat[i], `${p.id}: reset no reproducible`));
  await page.selectOption('#preset-select', '3a');
  await page.locator('label[for="gallery-toggle"]').click();
  await page.click('#kick-button'); await page.click('#snare-button');
  await page.evaluate(() => window.milky.step(4));
  await page.selectOption('#resolution-select', '800x1280');
  await page.evaluate(() => window.milky.step(120));
  await page.screenshot({ path: fileURLToPath(new URL('./captures/single.png', import.meta.url)), fullPage: true });
  const final = await page.evaluate(() => window.milky.diagnostics());
  assert.deepEqual(final.size, [800, 1280]);
  assert.equal(final.errors.length, 0);
  assert.equal(problems.length, 0, problems.join('\n'));
  await writeFile(new URL('./captures/validation.json', import.meta.url), JSON.stringify({ ...stats, final, checks: ['WebGPU shader compilation', 'five nonuniform images', 'temporal evolution', 'deterministic reset', 'preset selection', 'kick/snare', 'original resolution'] }, null, 2));
  console.log('PASS', JSON.stringify(final));
} finally { await browser.close(); }
