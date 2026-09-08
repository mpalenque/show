import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { launchChromium } from './test-browser.mjs';
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1512, height: 1080 } });
await context.grantPermissions(['midi', 'midi-sysex'], { origin: 'http://127.0.0.1:8787' });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:8787/system.html?mode=show&clean');
  await page.waitForFunction(() => window.parte2?.midi.status().state === 'listening', null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#midi-live-status').textContent.includes('escuchando'));
  const initial = await page.evaluate(() => {
    const s = parte2;
    window.rawMidi = data => {
      const port = [...s.midi.access.inputs.values()].find(p => p.name === 'loopMIDI Port');
      port.dispatchEvent(new MIDIMessageEvent('midimessage', { data: new Uint8Array(data) }));
    };
    return { mode: s.controlMode, scene: s.params.get('scene.current'), automate: s.params.get('scene.automation'),
      button: s.params.get('final.button'), loop: s.params.get('final.loop'),
      fullGate: s.params.get('mix.fullMilky'), fade: s.fullVideoFade, ports: s.midi.listInputs(),
      ui: document.querySelector('#midi-live-status').textContent };
  });
  assert.equal(initial.mode, 'show'); assert.equal(initial.scene, 0); assert.equal(initial.automate, true);
  assert.equal(initial.fullGate, 0); assert.equal(initial.button, false); assert.equal(initial.loop, false); assert.equal(initial.fade, 0);
  assert.deepEqual(initial.ports.filter(p => p.enabled).map(p => p.name), ['loopMIDI Port']);
  const bank = await page.evaluate(() => {
    const s = parte2, clips = [], presets = [];
    rawMidi([0x99, 66, 100]);
    for (let i = 0; i < 6; i++) {
      rawMidi([0x9c, i, Math.ceil((i + 1) * 127 / 68)]);
      clips.push([s.params.get(`players.${i}.clip`), s.params.get(`mix.stripes.${i}.video`)]);
      rawMidi([0x9c, i + 6, [1, 43, 85, 127][i % 4]]);
      presets.push([s.params.get(`milky.stripes.${i}.preset`), s.params.get(`mix.stripes.${i}.milky`)]);
    }
    rawMidi([0x9c, 12, 2]); rawMidi([0x9c, 13, 127]); rawMidi([0x90, 0, 127]);
    return { scene: s.params.get('scene.current'), clips, presets, fullClip: s.params.get('player.full.clip'),
      fullVideo: s.params.get('mix.fullVideo'), fullPreset: s.params.get('milky.full.preset'),
      fullMilky: s.params.get('mix.fullMilky'), button: s.params.get('final.button'), mode: s.controlMode };
  });
  assert.equal(bank.scene, 66); assert.equal(bank.fullPreset, 'final'); assert.equal(bank.button, true);
  assert.equal(bank.fullVideo, 1); assert.equal(bank.fullMilky, 1); assert.equal(bank.fullClip, 1);
  assert.deepEqual(bank.clips, Array.from({ length: 6 }, (_, i) => [i + 1, 1]));
  assert.deepEqual(bank.presets, Array.from({ length: 6 }, (_, i) => [i % 4, 1]));
  // TEMPORARY media fallback: pick a catalog clip that has no complete media on this machine, send the
  // velocity that selects it on ch13/note 1 (block 2), and check that the parameter keeps the requested clip
  // while the deck plays DDSLibrary.substitute() and the mixer says "Sustituto". Skipped once every clip exists.
  const fallback = await page.evaluate(async () => {
    const s = parte2, clips = s.manifest.clips;
    const missing = clips.find(clip => !s.library.isPlayable(clip.id));
    if (!missing) return { skipped: 'every catalog clip has complete media' };
    let velocity = Math.ceil(missing.index * 127 / 68);
    while (Math.floor(velocity / 127 * 68) % 68 !== missing.index) velocity++;
    const expected = s.library.substitute(missing.id);
    rawMidi([0x9c, 1, velocity]);
    const deck = s.decks[2];
    const requested = s.params.get('players.1.clip'), playing = deck.clipId, substituteFor = deck.substituteFor;
    await new Promise(resolve => setTimeout(resolve, 1500));
    const card = document.querySelector('[data-deck="2"]');
    return { missing: missing.index, velocity, expected: expected.id, expectedLabel: `${String(expected.index + 1).padStart(2, '0')} · ${expected.name}`,
      requested, playing, substituteFor, status: deck.status, frame: deck.frame, hasTexture: !!deck.texture,
      gate: s.params.get('mix.stripes.1.video'), fallbackParam: s.params.get('media.fallback'),
      uiStatus: card.querySelector('.deck-status').textContent, uiInfo: card.querySelector('.clip-info').textContent };
  });
  if (!fallback.skipped) {
    assert.equal(fallback.fallbackParam, true); assert.equal(fallback.requested, fallback.missing); assert.equal(fallback.gate, 1);
    assert.equal(fallback.playing, fallback.expected); assert.equal(fallback.substituteFor, fallback.missing);
    assert.equal(fallback.hasTexture, true, 'the substitute deck has DDS media to draw while the gate is open');
    assert.equal(fallback.status, 'playing'); assert.equal(fallback.uiStatus, 'Sustituto');
    assert.equal(fallback.uiInfo, `→ ${fallback.expectedLabel} · sustituto temporal`);
  }
  await page.evaluate(() => {
    for (let note = 0; note <= 13; note++) rawMidi([0x8c, note, 0]);
    rawMidi([0x90, 0, 0]);
  });
  await page.waitForTimeout(120);
  const released = await page.evaluate(() => ({ preset: parte2.params.get('milky.full.preset'), button: parte2.params.get('final.button'),
    gates: [...Array.from({ length: 6 }, (_, i) => [parte2.params.get(`mix.stripes.${i}.video`), parte2.params.get(`mix.stripes.${i}.milky`)]).flat(),
      parte2.params.get('mix.fullVideo'), parte2.params.get('mix.fullMilky')] }));
  assert.equal(released.preset, 'full1'); assert.equal(released.button, false); assert(released.gates.every(v => v === 0));
  await page.click('[data-look="sixDDS"]');
  const learnedMode = await page.evaluate(() => {
    parte2.mapper.learnTarget('final.fx2', { id: 'test.learn.consumer' });
    rawMidi([0x90, 36, 100]);
    const mode = parte2.controlMode;
    parte2.mapper.setMappings(parte2.mapper.list().filter(row => row.id !== 'test.learn.consumer'));
    return mode;
  });
  assert.equal(learnedMode, 'manual');
  const takeover = await page.evaluate(() => {
    parte2.sceneSnapshots[69] = { 'scene.automation': false, 'mix.fullMilky': 1 };
    rawMidi([0x99, 69, 100]); rawMidi([0x9c, 0, 2]);
    return { mode: parte2.controlMode, automation: parte2.params.get('scene.automation'),
      scene: parte2.params.get('scene.current'), fullGate: parte2.params.get('mix.fullMilky'),
      gates: Array.from({ length: 6 }, (_, i) => parte2.params.get(`mix.stripes.${i}.video`)) };
  });
  assert.equal(takeover.mode, 'show'); assert.equal(takeover.automation, true); assert.equal(takeover.scene, 69);
  assert.deepEqual(takeover.gates, [1, 0, 0, 0, 0, 0]);
  assert.equal(takeover.fullGate, 0);
  const hits = await page.evaluate(() => {
    rawMidi([0x90, 48, 100]); const warp = parte2.params.get('events.kickWarp'); rawMidi([0x80, 48, 0]);
    rawMidi([0x90, 37, 100]); const snare = parte2.params.get('events.snareHeld'); rawMidi([0x80, 37, 0]);
    rawMidi([0x96, 0, 100]); rawMidi([0x86, 0, 0]);
    return { warp, snare, ink: !!parte2.engine.states.get('inkdripping'), received: parte2.midi.received };
  });
  assert.equal(hits.warp, true); assert.equal(hits.snare, true); assert.equal(hits.ink, true);
  await page.click('[data-look="sixDDS"]'); await page.waitForTimeout(150);
  await page.click('#midi-use-vvvv');
  const rearmed = await page.evaluate(() => ({ mode: parte2.controlMode, scene: parte2.params.get('scene.current'),
    gates: Array.from({ length: 6 }, (_, i) => parte2.params.get(`mix.stripes.${i}.video`)), status: parte2.midi.status().state }));
  assert.equal(rearmed.mode, 'show'); assert.equal(rearmed.scene, 69); assert(rearmed.gates.every(v => v === 0));
  assert.equal(rearmed.status, 'listening');
  await page.screenshot({ path: fileURLToPath(new URL('../captures/midi-show-connected.png', import.meta.url)), fullPage: true });
  const gpuErrors = await page.evaluate(() => parte2.engine.errors);
  assert.deepEqual(errors, []); assert.deepEqual(gpuErrors, []);
  const report = { initial, bank, fallback, released, takeover, hits, rearmed, errors, gpuErrors,
    note: 'Real Web MIDI port opened. Test MIDIMessageEvents enter its actual listener; no MIDI bytes are emitted to Windows, Ableton or other apps.' };
  await writeFile(new URL('../captures/midi-show-validation.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
