import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launchChromium } from './system/test-browser.mjs';
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8787/?gallery=1');
  await page.waitForFunction(() => window.milky || !document.getElementById('error-panel').hidden);
  assert(await page.evaluate(() => !!window.milky), await page.locator('#error-message').textContent());
  await page.evaluate(() => {
    window.liveIntervals = []; let previous = performance.now();
    function track(now) { window.liveIntervals.push(now - previous); previous = now; if (window.liveIntervals.length < 600) requestAnimationFrame(track); }
    requestAnimationFrame(track);
  });
  await page.waitForTimeout(10000);
  const measurement = await page.evaluate(() => {
    const timings = window.liveIntervals.slice(5).sort((a, b) => a - b);
    return { ...window.milky.diagnostics(), rafP50ms: timings[Math.floor(timings.length * .5)], rafP95ms: timings[Math.floor(timings.length * .95)], rafP99ms: timings[Math.floor(timings.length * .99)] };
  });
  assert.equal(measurement.errors.length, 0);
  assert(measurement.frames > 300, 'La animación no avanzó suficientemente durante 10 s');
  await page.click('#pause-button');
  const before = await page.evaluate(() => window.milky.engine.frame);
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => window.milky.engine.frame), before, 'Pausa no detiene los pasos');
  await page.screenshot({ path: fileURLToPath(new URL('./captures/gallery-original.png', import.meta.url)), fullPage: true });
  const downloadWait = page.waitForEvent('download');
  await page.click('#export-button');
  const download = await downloadWait;
  assert(download.suggestedFilename().endsWith('.png'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Overflow horizontal móvil');
  await page.screenshot({ path: fileURLToPath(new URL('./captures/mobile.png', import.meta.url)), fullPage: true });
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(new URL('./captures/live-validation.json', import.meta.url), JSON.stringify({ measurement, checks: ['10s realtime 5 presets, four at 800x1280 + FINAL at 3840x1200', 'pause freezes simulation', 'PNG export', '390px responsive layout'], note: 'Chrome headless; rAF timings are presentation callback intervals, not isolated GPU execution times or a vvvv comparison.' }, null, 2));
  console.log('LIVE PASS', JSON.stringify(measurement));
} finally { await browser.close(); }
