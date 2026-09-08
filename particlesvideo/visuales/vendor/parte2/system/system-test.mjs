/** Actual Chrome/WebGPU integration. Requires the local server on 8787.
 * MILKY_PLAYWRIGHT / MILKY_BROWSER can override the locally installed tools.
 * This validates behavior, not a performance comparison against vvvv.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { launchChromium } from './test-browser.mjs';
const browser = await launchChromium();
const captures = new URL('../captures/', import.meta.url);
await mkdir(captures, { recursive: true });
const report = { kind: 'actual GPU / original local DDS', started: new Date().toISOString(), stages: {}, errors: [],
  note: 'Deterministic stepping and readback validate integration. This is not a FPS benchmark or pixel comparison against vvvv.' };
let page;
async function stage(name, fn, arg) {
  console.log(`START ${name}`);
  const value = await page.evaluate(fn, arg); report.stages[name] = value;
  console.log(`DONE ${name}`, JSON.stringify(value)); return value;
}
async function capture(name) {
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await system.capture()).arrayBuffer())]);
  await writeFile(new URL(`system-${name}.png`, captures), new Uint8Array(bytes));
}
try {
  page = await browser.newPage({ viewport: { width: 1600, height: 650 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/__controller-test', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{width:100vw;height:auto;display:block}</style><canvas id="test"></canvas>' }));
  await page.goto('http://127.0.0.1:8787/__controller-test');
  await stage('initialize', async () => {
    const { Parte2System } = await import('/system/controller.js');
    window.system = await Parte2System.create(document.querySelector('canvas'), {
      autoStart: false, restore: false, connectMidi: false, connectOSC: false, bridge: false,
    });
    window.pixelStats = async () => {
      const bytes = await system.readback(); let hash = 2166136261, sum = 0, min = 255, max = 0, nonzero = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        const value = bytes[i] + bytes[i + 1] + bytes[i + 2];
        hash = Math.imul(hash ^ value, 16777619) >>> 0; sum += value;
        min = Math.min(min, bytes[i], bytes[i + 1], bytes[i + 2]);
        max = Math.max(max, bytes[i], bytes[i + 1], bytes[i + 2]); if (value) nonzero++;
      }
      return { hash, min, max, mean: sum / (bytes.length / 4 * 3), nonzero, pixels: bytes.length / 4 };
    };
    system.params.set('output.resolution', '1920x600');
    system.params.set('scene.automation', false); system.runLook('sixDDS');
    await system.prepare(); system.render(0); await system.engine.device.queue.onSubmittedWorkDone();
    return { gpu: system.engine.gpuName, features: [...system.engine.device.features],
      catalog: system.manifest.totals, firstHeader: system.manifest.clips[0],
      registryCount: system.params.defs.size, deckCount: system.decks.length, size: [system.width, system.height] };
  });

  await stage('midi-and-seven-dds', async () => {
    const s = system, clips = [], milky = [];
    const wrongChannel = s.dispatchMidi([0x9d, 0, 100]);
    for (let i = 0; i < 6; i++) {
      const velocity = Math.ceil((i + 1) * 127 / 68);
      const fired = s.dispatchMidi([0x9c, i, velocity]);
      clips.push({ index: i, velocity, clip: s.params.get(`players.${i}.clip`), gate: s.params.get(`mix.stripes.${i}.video`), fired: fired.length });
    }
    s.dispatchMidi([0x9c, 12, 1]);
    await s.prepare(); s.render(0); await s.engine.device.queue.onSubmittedWorkDone();
    const deckObjects = new Set(s.decks).size, textureIds = s.decks.map(deck => deck.texture?.id);
    const samples = [];
    for (let i = 0; i < 7; i++) {
      s.params.set('output.preview', i === 0 ? 'fullVideo' : `deck${i - 1}`);
      s.render(0); samples.push({ id: s.decks[i].clipId, frame: s.decks[i].frame, format: s.decks[i].texture?.format, ...await pixelStats() });
    }
    await s.step(12); await s.prepare(); s.render(0);
    const frames = s.decks.map(deck => deck.frame);
    const beforeSeek = s.decks.map(deck => deck.phase);
    s.params.set('players.2.seek', .3); await s.prepare(); s.render(0);
    const afterSeek = s.decks.map(deck => deck.phase);
    for (let i = 0; i < 6; i++) {
      const velocity = [1, 43, 85, 127][i % 4]; s.dispatchMidi([0x9c, i + 6, velocity]);
      milky.push({ index: i, preset: s.params.get(`milky.stripes.${i}.preset`), gate: s.params.get(`mix.stripes.${i}.milky`) });
    }
    const fullSelections = [];
    for (const velocity of [1, 32, 64, 95, 127]) {
      s.dispatchMidi([0x9c, 13, velocity]); fullSelections.push(s.params.get('milky.full.preset'));
    }
    for (let note = 0; note <= 13; note++) s.dispatchMidi([0x8c, note, 0]);
    await new Promise(resolve => setTimeout(resolve, 100));
    const gatesAfterRelease = [...Array.from({ length: 6 }, (_, i) => s.params.get(`mix.stripes.${i}.video`)),
      ...Array.from({ length: 6 }, (_, i) => s.params.get(`mix.stripes.${i}.milky`)), s.params.get('mix.fullVideo'), s.params.get('mix.fullMilky')];
    s.runLook('sixDDS'); s.render(0);
    return { wrongChannelMatches: wrongChannel.length, clips, fullClip: s.decks[0].clip.index,
      deckObjects, textureIds, samples, frames, beforeSeek, afterSeek, milky, fullSelections, gatesAfterRelease,
      cache: { ...s.library.stats } };
  });
  await capture('six-dds');

  await stage('midi-clock-and-learn', async () => {
    const s = system; s.params.set('transport.sync', 'midi'); s.dispatchMidi([0xfa]);
    for (let i = 0; i < 48; i++) s.dispatchMidi({ kind: 'transport', command: 'clock', timestamp: i * 60000 / (96 * 24) });
    const start = { playing: s.params.get('transport.playing'), bpm: s.params.get('transport.bpm'), frame: s.frames };
    s.startLoop(); await new Promise(resolve => setTimeout(resolve, 140));
    const runningFrames = s.frames; s.dispatchMidi([0xfc]);
    await new Promise(resolve => setTimeout(resolve, 120)); const stoppedFrames = s.frames;
    s.dispatchMidi([0xfb]); await new Promise(resolve => setTimeout(resolve, 100));
    const continuedFrames = s.frames; s.dispatchMidi([0xfc]); cancelAnimationFrame(s.raf); s.raf = null;
    const row = { id: 'system-test.learn', source: null, mode: 'auto', target: 'milky.full1.normalRadius' };
    s.mapper.setMappings([...s.mapper.list(), row]); s.mapper.learn(row.id);
    const before = s.params.get(row.target); s.dispatchMidi([0xb6, 11, 64]);
    const consumed = s.params.get(row.target); s.dispatchMidi([0xb6, 11, 127]);
    const learned = s.mapper.list().find(item => item.id === row.id);
    const after = s.params.get(row.target), engineValue = s.engine.settings.presetOverrides.full1.normalRadius;
    s.params.set(row.target, before); s.mapper.resetToDefault();
    return { start, runningFrames, stoppedFrames, continuedFrames, playing: s.params.get('transport.playing'),
      learn: { before, consumed, after, engineValue, source: learned.source } };
  });

  await stage('missing-clip', async () => {
    // Strict mode (media.fallback off) keeps the original behaviour: a clip without media is 'missing' and
    // draws nothing without failing the system. The TEMPORARY fallback then plays DDSLibrary.substitute().
    const s = system, deck = s.decks[6];
    const absent = s.manifest.clips.find(clip => !s.library.isPlayable(clip.id));
    if (!absent) return { skipped: 'every catalog clip has complete media' };
    s.params.set('media.fallback', false); s.params.set('players.5.clip', absent.index);
    await s.prepare(); s.render(1); await s.engine.device.queue.onSubmittedWorkDone();
    const strict = { status: deck.status, clip: deck.clipId, error: deck.error, phase: deck.phase,
      hasTexture: !!deck.texture, systemFailed: s.failed, frames: s.frames };
    s.params.set('media.fallback', true);
    await s.prepare(); s.render(1); await s.engine.device.queue.onSubmittedWorkDone();
    const substitute = { requested: s.params.get('players.5.clip'), clip: deck.clipId, substituteFor: deck.substituteFor,
      expected: s.library.substitute(absent.id).id, status: deck.status, hasTexture: !!deck.texture, systemFailed: s.failed };
    s.params.set('players.5.clip', 6); s.params.set('players.5.seek', 0); await s.prepare(); s.render(0);
    return { missing: absent.index, strict, substitute };
  });

  await stage('independent-ink-dripping', async () => {
    const s = system; s.runLook('final'); s.params.set('ink.enabled', true); await s.step(10);
    const ink = s.engine.state('inkdripping'), final = s.engine.state('final');
    const verticalIds = ink.vertical.map(texture => texture.id), previousVertical = ink.vertical[ink.index].id;
    const before = { inkFrame: ink.frame, finalFrame: final.frame, finalInkTime: final.inkTime, time: ink.time };
    s.dispatchMidi([0x96, 0, 127]);
    const afterTrigger = { sameState: ink === s.engine.state('inkdripping'), verticalIds: ink.vertical.map(texture => texture.id),
      inkFrame: ink.frame, finalFrame: final.frame, finalInkTime: final.inkTime, resetSeconds: ink.growthResetUntil - ink.time };
    const growthReset = [], verticalSources = [], originalPass = s.engine.pass;
    s.engine.pass = function (name, target, a, b, values, options) {
      if (name === 'growth' && ink.growthFeed.includes(target)) growthReset.push(values[5]);
      if (name === 'vertical' && ink.vertical.includes(target)) verticalSources.push(b.id);
      return originalPass.call(this, name, target, a, b, values, options);
    };
    try { await s.step(10); } finally { s.engine.pass = originalPass; }
    const result = { before, afterTrigger, verticalIds, previousVertical, verticalSources, growthReset,
      separateHistories: ink.vertical.every(texture => !final.vertical.includes(texture))
        && ink.growthFeed.every(texture => !final.growthFeed.includes(texture)),
      after: { inkFrame: ink.frame, finalFrame: final.frame, inkDDS: ink.inkFrame, finalDDS: final.inkFrame, envelope: ink.inkEnvelope } };
    s.dispatchMidi([0x86, 0, 0]); s.params.set('ink.enabled', false); s.engine.reset('inkdripping'); s.inkState = null;
    return result;
  });

  await stage('full-legacy', async () => {
    const s = system, results = [];
    s.runLook('final'); s.params.set('output.preview', 'fullMilky');
    for (const id of ['full1', 'full3', 'full2', 'fullsplash']) {
      s.params.set('milky.full.preset', id); s.engine.reset(id); await s.step(30);
      const state = s.engine.state(id);
      results.push({ id, frame: state.frame, resolution: [state.seed.width, state.seed.height], graph: state.p.graph,
        fullLegacy: state.p.fullLegacy, ...await pixelStats() });
    }
    return results;
  });
  await capture('full-splash');

  await stage('four-a-presets', async () => {
    const s = system, results = []; s.params.set('mix.fullMilky', 0);
    for (const id of ['1a', '3a', '2a', 'splash']) {
      s.params.set('output.preview', id); s.engine.reset(id); await s.step(20);
      const state = s.engine.state(id); results.push({ id, frame: state.frame,
        resolution: [state.seed.width, state.seed.height], ...await pixelStats() });
    }
    return results;
  });

  await stage('manual-composition-mask-warp', async () => {
    const s = system; s.runLook('fullDDS'); s.params.set('milky.full.preset', 'fullsplash');
    s.params.set('composition.warp.enabled', false); s.render(0); const plain = await pixelStats();
    s.params.set('composition.warp.enabled', true); s.params.set('composition.warp.full', true);
    s.render(0); const warped = await pixelStats();
    s.params.set('composition.warp.full', false); s.params.set('composition.warp.maskMode', 'stripes');
    for (let i = 0; i < 6; i++) s.params.set(`composition.warp.mask.${i}`, i % 2 ? 0 : 1);
    s.render(0); const masked = await pixelStats();
    return { plain, warped, masked, parameters: s.compositionParams().warp };
  });
  await capture('masked-dds');

  await stage('native-final', async () => {
    const s = system; s.params.set('composition.warp.enabled', false); s.runLook('final');
    s.params.set('output.resolution', '3840x1200'); s.params.set('output.preview', 'fullMilky');
    s.params.trigger('final.explode'); await s.step(60);
    const state = s.engine.state('final'), effect = await pixelStats();
    s.params.set('output.preview', 'composition'); s.render(0); await s.engine.device.queue.onSubmittedWorkDone();
    return { outputSize: [s.width, s.height], effectSize: [state.output.width, state.output.height],
      frame: state.frame, inkFrame: state.inkFrame, compressedInk: s.engine.ink.compressed,
      inkCache: s.engine.ink.cache.size, effect, composition: await pixelStats(), diagnostics: s.diagnostics() };
  });
  await capture('native-final');
  report.errors.push(...await page.evaluate(() => [...system.errors, ...system.engine.errors]));

  const r = report.stages;
  assert.equal(r.initialize.deckCount, 7); assert.equal(r.initialize.catalog.expectedFrames, 48030);
  assert.deepEqual(r.initialize.size, [1920, 600]);
  const decks = r['midi-and-seven-dds'];
  assert.equal(decks.wrongChannelMatches, 0); assert.equal(decks.deckObjects, 7);
  assert.equal(new Set(decks.textureIds).size, 7, 'Seven independently selected DDS textures');
  assert.deepEqual(decks.clips.map(row => row.clip), [1, 2, 3, 4, 5, 6]);
  assert(decks.clips.every(row => row.gate === 1 && row.fired >= 2));
  assert.equal(decks.fullClip, 0); assert(decks.frames.every(frame => frame > 0));
  assert.equal(new Set(decks.samples.map(sample => sample.hash)).size, 7);
  assert(decks.samples.every(sample => sample.nonzero > 0 && sample.max > sample.min));
  if (r.initialize.features.includes('texture-compression-bc')) assert(decks.samples.every(sample => sample.format === 'bc1-rgba-unorm'));
  assert.notEqual(decks.beforeSeek[3], decks.afterSeek[3]);
  assert(decks.beforeSeek.every((phase, index) => index === 3 || phase === decks.afterSeek[index]));
  assert.deepEqual(decks.milky.map(row => row.preset), [0, 1, 2, 3, 0, 1]);
  assert.deepEqual(decks.fullSelections, ['full1', 'full3', 'full2', 'fullsplash', 'final']);
  assert(decks.gatesAfterRelease.every(value => value === 0));
  const clock = r['midi-clock-and-learn'];
  assert(clock.start.playing); assert(Math.abs(clock.start.bpm - 96) < 1e-6);
  assert(clock.runningFrames > clock.start.frame); assert.equal(clock.stoppedFrames, clock.runningFrames);
  assert(clock.continuedFrames > clock.stoppedFrames); assert.equal(clock.playing, false);
  assert.equal(clock.learn.before, clock.learn.consumed); assert.equal(clock.learn.after, 64);
  assert.equal(clock.learn.engineValue, 64); assert.equal(clock.learn.source.cc, 11);
  if (!r['missing-clip'].skipped) {
    const { missing, strict, substitute } = r['missing-clip'];
    assert.equal(strict.status, 'missing'); assert.equal(strict.systemFailed, false); assert.equal(strict.hasTexture, false);
    assert.equal(substitute.requested, missing); assert.equal(substitute.substituteFor, missing);
    assert.equal(substitute.clip, substitute.expected); assert.equal(substitute.hasTexture, true); assert.equal(substitute.systemFailed, false);
  }
  const ink = r['independent-ink-dripping'];
  assert(ink.separateHistories); assert(ink.afterTrigger.sameState);
  assert.deepEqual(ink.afterTrigger.verticalIds, ink.verticalIds);
  assert.equal(ink.afterTrigger.inkFrame, ink.before.inkFrame);
  assert.equal(ink.afterTrigger.finalFrame, ink.before.finalFrame);
  assert.equal(ink.afterTrigger.finalInkTime, ink.before.finalInkTime);
  assert(Math.abs(ink.afterTrigger.resetSeconds - .1) < 1e-8);
  assert.equal(ink.verticalSources[0], ink.previousVertical);
  assert.equal(ink.growthReset[0], 1); assert.equal(ink.growthReset.at(-1), 0);
  assert.equal(ink.after.inkFrame - ink.before.inkFrame, 10); assert(ink.after.envelope > 0);
  assert(r['full-legacy'].every(preset => preset.frame === 30 && preset.fullLegacy && preset.nonzero > 0 && preset.max > preset.min));
  assert.equal(new Set(r['full-legacy'].map(preset => preset.hash)).size, 4);
  assert(r['four-a-presets'].every(preset => preset.frame === 20 && preset.nonzero > 0 && preset.max > preset.min));
  const comp = r['manual-composition-mask-warp'];
  assert.notEqual(comp.plain.hash, comp.warped.hash); assert.notEqual(comp.warped.hash, comp.masked.hash);
  assert.deepEqual(r['native-final'].outputSize, [3840, 1200]); assert.equal(r['native-final'].frame, 60);
  assert(r['native-final'].effect.nonzero > 0); assert(r['native-final'].composition.nonzero > 0);
  assert(r['native-final'].inkCache <= 48); assert.deepEqual(report.errors, []);
  report.passed = true; console.log('SYSTEM INTEGRATION PASS');
} catch (error) {
  report.passed = false; report.failure = error.stack || String(error);
  if (page) report.failureDiagnostics = await page.evaluate(() => window.system?.diagnostics()).catch(() => null);
  console.error(report.failure); process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  await writeFile(new URL('system-validation.json', captures), JSON.stringify(report, null, 2));
  if (page) await page.evaluate(() => window.system?.dispose()).catch(() => {});
  await browser.close();
}
