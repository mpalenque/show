/** Real UI, live rendering and output-window validation.
 * No FPS threshold: measured step rates include asynchronous DDS waits.
 * No physical MIDI messages are sent, and all input ports stay disabled.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium } from './test-browser.mjs';
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const captures = new URL('../captures/', import.meta.url); await mkdir(captures, { recursive: true });
const report = { started: new Date().toISOString(), environment: 'Chrome headless / real system.html / native 2688x1008',
  note: 'Simulation steps, effect steps and rAF intervals are measured separately. Values include media loading, UI and scheduling. These are not isolated GPU timestamps or a comparison against vvvv. Six Milky layers select four shared A presets.',
  errors: [], runs: {} };
let page, output;
async function measure(name) {
  console.log(`START ${name} 10s`);
  await page.evaluate(() => {
    const s = window.parte2;
    const b = window.liveSystemMeasurement = { started: performance.now(), frames: s.frames, pending: s.pending,
      effectFrames: Object.fromEntries([...s.engine.states].map(([id, state]) => [id, state.frame])),
      decks: s.decks.map(deck => ({ clip: deck.clipId, frame: deck.frame, phase: deck.phase,
        previousFrame: deck.frame, advanced: 0, wraps: 0 })), intervals: [], active: true };
    window.sampleLiveDecks = () => {
      for (let i = 0; i < s.decks.length; i++) {
        const deck = s.decks[i], measured = b.decks[i]; let delta = deck.frame - measured.previousFrame;
        if (delta < -(deck.clip.frameCount - 1) / 2) { delta += deck.clip.frameCount - 1; measured.wraps++; }
        measured.advanced += delta; measured.previousFrame = deck.frame;
      }
    };
    let previous = performance.now();
    const track = now => { b.intervals.push(now - previous); previous = now; sampleLiveDecks(); if (b.active) requestAnimationFrame(track); };
    requestAnimationFrame(track);
  });
  await page.waitForTimeout(10000);
  const result = await page.evaluate(() => {
    const s = window.parte2, b = window.liveSystemMeasurement; b.active = false; sampleLiveDecks();
    const elapsed = (performance.now() - b.started) / 1000;
    const intervals = b.intervals.slice(2).sort((a, b) => a - b), totalSteps = s.frames - b.frames;
    const percentile = p => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))];
    return { elapsedSeconds: elapsed, controllerSteps: totalSteps, controllerStepsPerSecond: totalSteps / elapsed,
      rafCallbacks: b.intervals.length, rafCallbacksPerSecond: b.intervals.length / elapsed,
      rafP50ms: percentile(.5), rafP95ms: percentile(.95), rafP99ms: percentile(.99),
      effects: [...s.engine.states].map(([id, state]) => ({ id, frame: state.frame,
        advanced: state.frame - (b.effectFrames[id] || 0), stepsPerSecond: (state.frame - (b.effectFrames[id] || 0)) / elapsed })),
      decks: s.decks.map((deck, index) => ({ clip: deck.clipId, startFrame: b.decks[index].frame, endFrame: deck.frame,
        advancedFrames: b.decks[index].advanced, wraps: b.decks[index].wraps,
        framesPerSecond: b.decks[index].advanced / elapsed, startPhase: b.decks[index].phase, endPhase: deck.phase,
        status: deck.status, error: deck.error })), activeEffects: s.activeEffects(), diagnostics: s.diagnostics(),
      cache: { ...s.library.stats, size: s.library.cache.size }, inkCache: s.engine.ink.cache.size,
      outputSize: [s.canvas.width, s.canvas.height], mappingCount: s.mapper.list().length };
  });
  report.runs[name] = result; console.log(`DONE ${name}`, JSON.stringify(result)); return result;
}
try {
  // Keep input ports closed even if Chrome restores or auto-grants permission.
  await context.addInitScript(() => { localStorage.setItem('parte2.midiInputs', '[]'); });
  try { await context.grantPermissions(['midi'], { origin: 'http://127.0.0.1:8787' }); report.midiPermissionGranted = true; }
  catch (error) { report.midiPermissionGranted = false; report.midiPermissionError = error.message; }
  page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:8787/system.html?mode=manual&clean&resolution=2688x1008');
  await page.waitForFunction(() => window.parte2 || !document.getElementById('system-error')?.hidden, null, { timeout: 30000 });
  assert(await page.evaluate(() => !!window.parte2), await page.locator('#system-error-message').textContent());
  await page.evaluate(() => { parte2.midi.setEnabled([]); parte2.osc?.close(); });
  report.browser = await page.evaluate(() => {
    const info = parte2.engine.adapter.info;
    return { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      gpu: Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(key => [key, info?.[key]])) };
  });
  await page.waitForFunction(() => window.parte2.frames >= 30, null, { timeout: 30000 });
  report.midi = await page.evaluate(async () => {
    const s = window.parte2; s.midi.setEnabled([]);
    try {
      const inputs = await Promise.race([s.connectMidi(), new Promise((resolve, reject) =>
        setTimeout(() => reject(new Error('La enumeración MIDI no respondió en 5 segundos.')), 5000))]);
      const permission = await navigator.permissions.query({ name: 'midi', sysex: false });
      return { supported: typeof navigator.requestMIDIAccess === 'function', permission: permission.state,
        inputs, activeInputListeners: s.midi.boundInputs.size, physicalMessagesSent: 0 };
    } catch (error) { return { supported: typeof navigator.requestMIDIAccess === 'function', error: error.message, physicalMessagesSent: 0 }; }
  });
  console.log('MIDI ENUMERATION', JSON.stringify(report.midi));
  await measure('default-final');
  await page.screenshot({ path: fileURLToPath(new URL('live-system-final.png', captures)), fullPage: true });

  await page.evaluate(async () => {
    const s = window.parte2; s.params.set('transport.playing', false); s.params.set('scene.automation', false);
    s.params.set('output.preview', 'composition'); s.params.set('milky.full.preset', 'final');
    s.params.set('mix.fullVideo', 1); s.params.set('mix.fullMilky', 1);
    s.params.set('composition.fullVideo.enabled', true); s.params.set('composition.fullMilky.enabled', true);
    s.params.set('composition.stripes.enabled', true); s.params.set('composition.warp.enabled', true);
    s.params.set('composition.warp.full', true); s.params.set('ink.enabled', true);
    for (let i = 0; i < 7; i++) {
      const id = i ? `players.${i - 1}` : 'player.full';
      s.params.set(`${id}.clip`, i); s.params.set(`${id}.seek`, 0); s.params.set(`${id}.playing`, true);
      if (i) { s.params.set(`mix.stripes.${i - 1}.video`, 1); s.params.set(`mix.stripes.${i - 1}.milky`, 1);
        s.params.set(`milky.stripes.${i - 1}.preset`, (i - 1) % 4); }
    }
    s.params.trigger('ink.trigger'); s.params.trigger('final.explode');
    await s.prepare(); s.render(1); await s.engine.device.queue.onSubmittedWorkDone();
    s.params.set('transport.playing', true);
  });
  await page.waitForTimeout(1500);
  await measure('all-layers');
  await page.screenshot({ path: fileURLToPath(new URL('live-system-all-layers.png', captures)), fullPage: true });

  // Click the actual UI control so opening the second window has a user gesture.
  const popup = page.waitForEvent('popup'); await page.locator('#system-output').click(); output = await popup;
  output.on('pageerror', error => report.errors.push(`Output: ${error.message}`));
  await output.waitForLoadState('domcontentloaded');
  await output.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 15000 });
  report.outputWindow = await output.evaluate(() => {
    const video = document.querySelector('video'), tracks = video.srcObject?.getVideoTracks() || [];
    return { url: location.href, hasControllerOpener: !!window.opener?.parte2,
      metadata: [video.videoWidth, video.videoHeight], readyState: video.readyState, paused: video.paused,
      messageHidden: document.getElementById('message').hidden,
      tracks: tracks.map(track => ({ kind: track.kind, readyState: track.readyState, settings: track.getSettings() })) };
  });
  await output.screenshot({ path: fileURLToPath(new URL('live-system-output-window.png', captures)), fullPage: true });
  console.log('OUTPUT WINDOW', JSON.stringify(report.outputWindow)); await output.close(); output = null;
  await page.evaluate(async () => { parte2.params.set('transport.playing', false); await parte2.engine.device.queue.onSubmittedWorkDone(); });
  report.errors.push(...await page.evaluate(() => [...parte2.errors, ...parte2.engine.errors]));
  for (const result of Object.values(report.runs)) {
    assert.deepEqual(result.outputSize, [2688, 1008]); assert(result.controllerSteps > 0);
    assert(result.cache.size <= 128); assert(result.cache.bytes <= 256 * 1024 * 1024); assert(result.inkCache <= 48);
    assert(result.decks.every(deck => deck.advancedFrames > 0));
    assert.deepEqual(result.diagnostics.errors, []);
  }
  assert(report.runs['all-layers'].activeEffects.includes('inkdripping'));
  for (const id of ['1a', '3a', '2a', 'splash', 'final', 'inkdripping']) {
    assert(report.runs['all-layers'].effects.find(effect => effect.id === id)?.advanced > 0, `${id} did not advance`);
  }
  assert.deepEqual(report.outputWindow.metadata, [2688, 1008]); assert(report.outputWindow.hasControllerOpener);
  assert.equal(report.outputWindow.tracks.length, 1); assert.equal(report.outputWindow.tracks[0].readyState, 'live');
  assert.equal(report.outputWindow.tracks[0].settings.width, 2688); assert.equal(report.outputWindow.tracks[0].settings.height, 1008);
  if (!report.midi.error) assert.equal(report.midi.activeInputListeners, 0);
  assert.deepEqual(report.errors, []); report.passed = true; console.log('LIVE SYSTEM PASS');
} catch (error) {
  report.passed = false; report.failure = error.stack || String(error); console.error(report.failure); process.exitCode = 1;
  if (page) report.failureDiagnostics = await page.evaluate(() => window.parte2?.diagnostics()).catch(() => null);
} finally {
  report.finished = new Date().toISOString();
  await writeFile(new URL('live-system-validation.json', captures), JSON.stringify(report, null, 2));
  if (page) await page.evaluate(() => window.parte2?.dispose()).catch(() => {});
  await browser.close();
}
