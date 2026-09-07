import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The production TS graph uses Vite's extensionless relative imports. Resolve
// those identically here while Node strips types; no browser or GPU is needed.
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
} });
const { default: ShowSession, SHOW_STORAGE_KEY } = await import('../src/radiance/ShowSession.js');
const { emptyDoc } = await import('../vendor/radiance/src/fluids-show/show-doc.ts');

/**
 * Transporte de audio de mentira: mismo contrato que el real, pero su reloj lo
 * mueve el test. Sirve para comprobar que el show se ancla al track y no al
 * tiempo de pared, que es justo lo que hacía que la imagen se despegara.
 */
function fakeTransport({ duration = 10, failArm = false, blocked = false } = {}) {
  return {
    calls: [], ready: false, playing: false, duration, blocked, error: null,
    onEnded: null, volume: 1, clock: 0, offset: 0, startedAt: 0,
    get time() { return this.playing ? Math.min(this.duration, this.offset + (this.clock - this.startedAt)) : this.offset; },
    async arm() {
      this.calls.push('arm');
      if (failArm) { this.error = 'sin audio'; throw new Error('sin audio'); }
      this.ready = true;
      return true;
    },
    play(offset) {
      if (Number.isFinite(offset)) this.offset = offset;
      if (!this.ready || this.playing) return false;
      this.calls.push(`play:${this.offset.toFixed(2)}`);
      this.startedAt = this.clock;
      this.playing = true;
      return true;
    },
    pause() { if (!this.playing) return; this.offset = this.time; this.playing = false; this.calls.push('pause'); },
    seek(seconds) { const wasPlaying = this.playing; this.playing = false; this.offset = seconds; if (wasPlaying) this.play(); },
    setVolume(volume) { this.volume = volume; },
    peaks(rate) { return { rate, count: 4, data: Float32Array.from([-0.5, 0.75, -0.5, 0.75, -0.5, 0.75, -0.5, 0.75]) }; },
    dispose() { this.calls.push('dispose'); this.ready = false; this.playing = false; },
  };
}

function harness({ document = emptyDoc(10), failAudio = false, failDecode = false, stored = null,
  audioMode = 'web', transport = fakeTransport(), transportOptions = null } = {}) {
  let wallTime = 0;
  const writes = [];
  const fetched = [];
  const audioCalls = { offline: 0, transports: 0, forbidden: [] };
  const buffer = {
    duration: 10, sampleRate: 400, length: 4000, numberOfChannels: 1,
    getChannelData: () => Float32Array.from({ length: 4000 }, (_, i) => i % 2 ? 0.75 : -0.5),
  };
  const context = {
    currentTime: 0,
    async decodeAudioData() {
      if (failDecode) throw new Error('Reference waveform decoder unavailable');
      return buffer;
    },
  };
  // La sesión nunca puede fabricarse su propia salida de audio: el único
  // reproductor legítimo es el transporte que se le inyecta.
  for (const method of ['resume', 'createGain', 'createBufferSource', 'destination', 'startRendering']) {
    Object.defineProperty(context, method, { get() {
      audioCalls.forbidden.push(method);
      throw new Error('Forbidden audio operation: ' + method);
    } });
  }
  const audio = transportOptions ? fakeTransport(transportOptions) : transport;
  const session = new ShowSession({
    baseUrl: '/show-base/',
    audioMode,
    now: () => wallTime,
    createOfflineAudioContext: () => { audioCalls.offline += 1; return context; },
    createAudioTransport: (path, duration) => { audioCalls.transports += 1; audio.path = path; audio.duration = duration || audio.duration; return audio; },
    yieldTask: async () => {},
    storage: {
      getItem(key) { assert.equal(key, SHOW_STORAGE_KEY); return stored; },
      setItem(key, value) { writes.push({ key, value }); },
    },
    async fetch(url) {
      fetched.push(url);
      if (url.endsWith('.json')) return { ok: true, json: async () => structuredClone(document) };
      return { ok: !failAudio, status: failAudio ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(4) };
    },
  });
  return { session, context, audio, audioCalls, writes, fetched,
    setWall: (time) => { wallTime = time; }, setAudioClock: (time) => { audio.clock = time; } };
}

test('el modo web arma el track, saca de él la onda y no decodifica una segunda copia', async () => {
  const h = harness();
  await h.session.load();
  assert.equal(h.session.audioMode, 'web');
  assert.equal(h.session.audioReady, true);
  assert.equal(h.session.state().audioDecoded, true);
  assert.equal(h.session.state().transportReady, true);
  // Sólo el documento: el WAV lo pide el transporte, no un contexto offline.
  assert.deepEqual(h.fetched, ['/show-base/radiance/show/fluids.show.json']);
  assert.equal(h.audioCalls.offline, 0);
  assert.equal(h.session.peaks().count, 4);
  assert.deepEqual(h.audioCalls.forbidden, []);
  await h.session.load();
  assert.equal(h.audioCalls.transports, 1, 'un segundo hello no crea otro transporte');
});

test('el arranque no espera al audio y el track entra tarde en la posición correcta', async () => {
  // Decodificar dos minutos y medio de WAV puede tardar, o colgarse en una
  // máquina sin salida de audio. Esperarlo dejaba la salida sin arrancar.
  let liberar;
  const audio = fakeTransport();
  const arm = audio.arm.bind(audio);
  audio.arm = async () => { await new Promise((resolve) => { liberar = resolve; }); return arm(); };
  const h = harness({ transport: audio });
  await h.session.load();
  assert.equal(h.session.state().loaded, true, 'el documento ya está listo');
  assert.equal(h.session.audioReady, false, 'y el track todavía no');

  // La nota 25 llega antes que el WAV: la imagen arranca igual, con el reloj de pared.
  h.session.restart();
  h.setWall(2000);
  assert.equal(h.session.tick(), 2);
  liberar();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.session.audioReady, true);
  assert.equal(h.audio.playing, true, 'el track entra solo al terminar de cargar');
  assert.ok(Math.abs(h.audio.offset - 2) < 0.01, 'y lo hace donde va la secuencia');
});

test('la secuencia sigue el reloj del track y no el tiempo de pared', async () => {
  const h = harness();
  await h.session.load();
  h.session.restart();
  assert.deepEqual(h.audio.calls, ['arm', 'play:0.00']);
  // Un frame que llega tarde no corre el show: lo saltea al tiempo del audio.
  h.setWall(90000);
  h.setAudioClock(4);
  assert.equal(h.session.tick(), 4);
  h.setWall(90050);
  assert.ok(Math.abs(h.session.time - 4.05) < 1e-9, 'entre frames el reloj interpola desde el último anclaje');
  h.setAudioClock(6);
  assert.equal(h.session.tick(), 6);
  h.session.pause();
  assert.equal(h.audio.playing, false);
  h.setAudioClock(20);
  assert.equal(h.session.time, 6);
  h.session.seek(2);
  assert.equal(h.audio.offset, 2);
  assert.equal(h.session.time, 2);
});

test('el final del track detiene el reloj de la secuencia sin volver a arrancar solo', async () => {
  const h = harness();
  await h.session.load();
  h.session.restart();
  h.setAudioClock(10.5);
  assert.equal(h.session.tick(), 10);
  assert.equal(h.session.playing, false);
  assert.equal(h.audio.playing, false);
  assert.equal(h.session.time, 10);
});

test('el volumen y el cambio a Ableton no interrumpen la secuencia en curso', async () => {
  const h = harness();
  await h.session.load();
  h.session.setVolume(0.4);
  assert.equal(h.audio.volume, 0.4);
  h.session.restart();
  h.setAudioClock(3.25);
  assert.equal(h.session.tick(), 3.25);
  h.session.setAudioMode('external');
  assert.equal(h.session.audioMode, 'external');
  assert.equal(h.audio.playing, false, 'con Ableton la página se calla');
  assert.equal(h.session.playing, true, 'pero la imagen no se corta');
  assert.equal(h.session.time, 3.25);
  h.setWall(1500);
  assert.equal(h.session.tick(), 4.75, 'sin track vuelve a mandar el reloj de pared');
});

test('sin audio disponible el show visual arranca igual y avisa', async () => {
  const h = harness({ transportOptions: { failArm: true }, failAudio: true });
  await h.session.load();
  assert.ok(h.session.doc);
  assert.equal(h.session.audioReady, false);
  assert.ok(h.session.state().audioError);
  assert.equal(h.session.state().error, null);
  h.session.restart();
  h.setWall(5500);
  assert.equal(h.session.tick(), 5.5, 'sin track manda el reloj de pared');
  assert.equal(h.session.playing, true);
});

test('el audio cargado pero todavía bloqueado por Chrome se informa como tal', async () => {
  const h = harness({ transportOptions: { blocked: true } });
  await h.session.load();
  assert.equal(h.session.audioReady, true);
  assert.equal(h.session.audioBlocked, true);
  assert.match(h.session.state().audioError, /clic/);
  assert.equal(h.session.state().audioBlocked, true);
});

test('con Ableton la onda se decodifica offline y nunca se crea salida audible', async () => {
  const h = harness({ audioMode: 'external' });
  await h.session.load();
  assert.equal(h.session.audioMode, 'external');
  assert.equal(h.session.audioReady, false);
  assert.equal(h.session.state().audioDecoded, true);
  assert.deepEqual(h.fetched, [
    '/show-base/radiance/show/fluids.show.json', '/show-base/radiance/audio/fluids.wav',
  ]);
  assert.equal(h.session.peaks().count, 4000);
  assert.equal(h.session.peaks().data[0], -0.5);
  assert.equal(h.session.peaks().data[3], 0.75);
  h.session.restart();
  assert.equal(h.session.playing, true);
  assert.deepEqual(h.audio.calls, [], 'en modo externo el transporte ni se crea');
  assert.deepEqual(h.audioCalls, { offline: 1, transports: 0, forbidden: [] });
});

test('visual playback uses absolute elapsed time, pauses, seeks and holds the final frame', async () => {
  const h = harness({ audioMode: 'external' });
  await h.session.load();
  h.session.restart();
  h.context.currentTime = 99;
  h.setWall(5750);
  assert.equal(h.session.tick(), 5.75);
  h.session.pause();
  h.setWall(50000);
  assert.equal(h.session.time, 5.75);
  h.session.play();
  h.setWall(52000);
  assert.equal(h.session.tick(), 7.75);
  h.session.seek(3);
  assert.equal(h.session.time, 3);
  h.setWall(70000);
  assert.equal(h.session.tick(), 10);
  assert.equal(h.session.playing, false);
  h.session.restart();
  h.session.seek(10);
  assert.equal(h.session.time, 10);
  assert.equal(h.session.playing, false);
  assert.deepEqual(h.audioCalls.forbidden, []);
});

test('a delayed preparation keeps the original cue timestamp instead of delaying Ableton', async () => {
  const h = harness({ audioMode: 'external' });
  const cueTimeSeconds = 1;
  h.setWall(3500);
  await h.session.load();
  h.session.restart(cueTimeSeconds);
  assert.equal(h.session.time, 2.5);
  h.setWall(4000);
  assert.equal(h.session.tick(), 3);
  h.session.play(4);
  assert.equal(h.session.time, 3, 'an already-playing transport does not restart');
  h.session.restart(3.5);
  assert.equal(h.session.time, 0.5, 'explicit restart does re-anchor even while playing');
  assert.throws(() => h.session.restart(NaN), /finito/);
  assert.equal(h.session.time, 0.5);
});

test('late visual frames preserve loop phase across multiple revolutions', async () => {
  const h = harness({ audioMode: 'external' });
  await h.session.load();
  h.session.setLoop({ from: 2, to: 5, on: true });
  h.session.restart();
  h.setWall(14500);
  assert.equal(h.session.tick(), 2.5);
  h.session.setLoop({ from: 2, to: 5, on: false });
  h.setWall(16000);
  assert.equal(h.session.tick(), 4);
  h.session.setLoop(null);
  assert.equal(h.session.state().loop.on, false);
});

test('el loop de ensayo rebobina también el track', async () => {
  const h = harness();
  await h.session.load();
  h.session.setLoop({ from: 2, to: 5, on: true });
  h.session.restart();
  h.setAudioClock(6);
  assert.equal(h.session.tick(), 3);
  assert.equal(h.audio.offset, 3);
  assert.equal(h.audio.playing, true);
});

test('edits reject stale revisions and preserve the cue anchor and original storage keys', async () => {
  const h = harness({ audioMode: 'external' });
  await h.session.load();
  h.session.restart();
  h.setWall(3250);
  const next = structuredClone(h.session.doc);
  next.curves.emission.keys = [{ t: 2, v: 0.6, shape: 'linear' }];
  h.session.setDocument(next, 1);
  assert.equal(h.session.revision, 2);
  assert.equal(h.session.time, 3.25);
  assert.equal(h.session.playing, true);
  assert.throws(() => h.session.setDocument(emptyDoc(10), 1), /desactualizada/);
  assert.equal(h.session.doc.curves.emission.keys[0].v, 0.6);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].key, 'vis.radiance.show.v1');
  assert.equal(JSON.parse(h.writes[0].value).revision, 2);
  assert.throws(() => { h.session.doc.duration = 99; }, TypeError);
});

test('missing or undecodable reference waveform never blocks the authored show', async () => {
  for (const options of [{ failAudio: true }, { failDecode: true }]) {
    const h = harness({ ...options, audioMode: 'external' });
    await h.session.load();
    assert.ok(h.session.doc);
    assert.equal(h.session.audioReady, false);
    assert.ok(h.session.state().audioError);
    assert.equal(h.session.state().error, null);
    assert.equal(h.session.state().transportReady, true);
    assert.equal(h.session.peaks(), null);
    h.session.restart();
    h.setWall(5500);
    assert.equal(h.session.tick(), 5.5);
    await h.session.load();
    assert.equal(h.audioCalls.offline, 1, 'failed waveform is not retried on every hello');
    assert.deepEqual(h.audioCalls.forbidden, []);
  }
});

test('own snapshot preserves its revision and malformed data never silently becomes an empty seeded show', async () => {
  const good = harness({ stored: JSON.stringify({ version: 1, revision: 8, doc: emptyDoc(10) }) });
  await good.session.load();
  assert.equal(good.session.revision, 8);
  assert.equal(good.fetched.some((url) => url.endsWith('.json')), false);
  for (const malformed of [null, {}, { ...emptyDoc(10), version: 2 }, { ...emptyDoc(10), events: [{}] }]) {
    const h = harness({ document: malformed });
    await assert.rejects(h.session.load(), /inválid/);
    assert.equal(h.session.doc, null);
    assert.equal(h.session.state().loaded, false);
    assert.ok(h.session.state().error);
    assert.equal(h.writes.length, 0);
  }
  const corruptStored = harness({ stored: 'not JSON' });
  await assert.rejects(corruptStored.session.load());
  assert.equal(corruptStored.fetched.length, 0);
});

test('the shipped authored Fluids document validates without being replaced by a seed', async () => {
  const document = JSON.parse(await readFile(new URL('../public/radiance/show/fluids.show.json', import.meta.url), 'utf8'));
  const h = harness({ document });
  await h.session.load();
  assert.equal(h.session.duration, document.duration);
  assert.equal(h.session.doc.events.length, document.events.length);
  assert.equal(h.session.doc.gestures.length, document.gestures.length);
  assert.deepEqual(h.session.doc.curves.emission, document.curves.emission);
  assert.deepEqual(h.session.doc, document);
});
