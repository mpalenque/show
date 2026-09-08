import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launchChromium } from './system/test-browser.mjs';
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8787/?preset=final');
  await page.waitForFunction(() => window.milky || !document.getElementById('error-panel').hidden);
  assert(await page.evaluate(() => !!window.milky), await page.locator('#error-message').textContent());
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const m = window.milky;
    window.finalBench = { time: performance.now(), frame: m.engine.state('final').frame, intervals: [], running: true };
    let previous = performance.now();
    function track(now) {
      const b = window.finalBench;
      b.intervals.push(now - previous); previous = now;
      if (b.running) requestAnimationFrame(track);
    }
    requestAnimationFrame(track);
  });
  await page.waitForTimeout(10000);
  const result = await page.evaluate(async () => {
    const m = window.milky, b = window.finalBench;
    b.running = false; m.pause();
    const elapsed = (performance.now() - b.time) / 1000;
    const steps = m.engine.state('final').frame - b.frame;
    await m.engine.device.queue.onSubmittedWorkDone();
    const intervals = b.intervals.slice(2).sort((a, b) => a - b);
    return { ...m.diagnostics(), elapsedSeconds: elapsed, simulatedFrames: steps, simulationFps: steps / elapsed,
      rafP50ms: intervals[Math.floor(intervals.length * .5)], rafP95ms: intervals[Math.floor(intervals.length * .95)],
      compressed: m.engine.ink.compressed, cacheFrames: m.engine.ink.cache.size,
      loadedFrames: m.engine.ink.loadedFrames, inkFrame: m.engine.state('final').inkFrame };
  });
  assert.deepEqual(result.size, [3840, 1200]);
  assert.equal(result.errors.length, 0, result.errors.join('\n'));
  assert.equal(errors.length, 0, errors.join('\n'));
  assert(result.simulatedFrames > 0, 'La simulación FINAL no avanzó');
  assert(result.cacheFrames <= 48, 'Caché DDS excede el límite');
  await page.screenshot({ path: fileURLToPath(new URL('./captures/final-live.png', import.meta.url)), fullPage: true });
  await writeFile(new URL('./captures/final-live-validation.json', import.meta.url), JSON.stringify({ result,
    note: 'Chrome headless, FINAL individual a 3840x1200, INK a 1280x720, ring a 960x320. FPS calculados con pasos efectivos del preset, incluyendo esperas DDS. rAF no es tiempo aislado de GPU. No es una comparación con vvvv.' }, null, 2));
  console.log('FINAL LIVE PASS', JSON.stringify(result));
} finally { await browser.close(); }
