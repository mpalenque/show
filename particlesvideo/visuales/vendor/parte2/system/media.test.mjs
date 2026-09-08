import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseDDSHeader, decodeDDS } from './dds-format.js';
import { DDSLibrary, SequenceDeck } from './dds-player.js';
import { createMediaServer, matchClipFiles } from './media-server.mjs';

function blockDDS(kind = 'DXT1') {
  const bytes = new Uint8Array(kind === 'DXT1' ? 136 : 144), view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, 0x20534444], [4, 124], [12, 4], [16, 4], [76, 32], [80, 4]]) view.setUint32(offset, value, true);
  bytes.set([...kind].map(char => char.charCodeAt(0)), 84);
  const offset = kind === 'DXT1' ? 128 : 136;
  view.setUint16(offset, 0xf800, true); view.setUint16(offset + 2, 0x07e0, true);
  if (kind === 'DXT3') bytes.fill(0xff, 128, 136);
  if (kind === 'DXT5') { bytes[128] = 200; bytes[129] = 10; }
  return bytes;
}

test('DDS BC1/2/3 headers and CPU fallback preserve known colors and alpha', () => {
  for (const [format, alpha] of [['DXT1', 255], ['DXT3', 255], ['DXT5', 200]]) {
    const bytes = blockDDS(format), header = parseDDSHeader(bytes), rgba = decodeDDS(bytes, header);
    assert.equal(header.width, 4); assert.equal(header.height, 4);
    for (let i = 0; i < rgba.length; i += 4) assert.deepEqual([...rgba.slice(i, i + 4)], [255, 0, 0, alpha]);
  }
  assert.throws(() => parseDDSHeader(new Uint8Array(128)), /inválida/);
  assert.throws(() => decodeDDS(blockDDS().subarray(0, 128)), /incompleto/);
});

test('legacy BGRA masks decode to RGBA without swapping red and blue', () => {
  const bytes = new Uint8Array(132), view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, 0x20534444], [4, 124], [12, 1], [16, 1], [76, 32], [80, 0x41], [88, 32],
    [92, 0xff0000], [96, 0xff00], [100, 0xff], [104, 0xff000000]]) view.setUint32(offset, value, true);
  bytes.set([17, 33, 201, 127], 128);
  assert.deepEqual([...decodeDDS(bytes)], [201, 33, 17, 127]);
});

function fakeLibrary({ loaded = true, partial = false } = {}) {
  const clip = { id: 'clip-00', index: 0, name: 'test', frameCount: 11, fps: 30, availableFrames: partial ? 5 : 11 };
  const second = { ...clip, id: 'clip-01', index: 1, frameCount: 21 };
  const cache = new Map();
  const put = frame => { const texture = { frame, destroyed: false }; cache.set(frame, texture); return texture; };
  if (loaded) for (let i = 0; i < (partial ? 5 : 21); i++) put(i); else put(0);
  return { manifest: { clips: [clip, second] }, cache, put,
    clip: id => id === 1 || id === second.id ? second : clip,
    isAvailable: (id, frame) => frame >= 0 && frame < (partial ? 5 : 21),
    peek: (id, frame) => cache.get(frame), get: () => new Promise(() => {}),
    pin() {}, unpin() {}, preload: () => Promise.resolve([]) };
}

test('transport preserves clip phase, wraps through the endpoint and supports reverse/pingpong', () => {
  const library = fakeLibrary();
  const deck = new SequenceDeck(library);
  assert.equal(deck.update(1 / 30), 1);
  assert.equal(deck.update(1 / 30), 2);
  const phase = deck.phase;
  deck.setClip('clip-01'); assert.equal(deck.phase, phase); assert.equal(deck.frame, 4);
  deck.setClip('clip-00', { reset: true }); deck.seek(0.9);
  assert.equal(deck.update(1 / 30), 10); assert.ok(deck.phase < 0.01);
  assert.equal(deck.update(1 / 30), 1);
  const reverse = new SequenceDeck(library, { speed: -1 });
  assert.equal(reverse.frame, 10); assert.equal(reverse.update(1 / 30), 9);
  const ping = new SequenceDeck(library, { pingpong: true }); ping.seek(0.9);
  assert.equal(ping.update(1 / 30), 10); assert.equal(ping.update(1 / 30), 9);
  const stop = new SequenceDeck(library, { loop: false }); stop.seek(0.9);
  stop.update(0.1); assert.equal(stop.frame, 10); assert.equal(stop.playing, false);
});

test('waiting and missing frames stall only their deck, preserving phase', () => {
  const library = fakeLibrary({ loaded: false });
  const waiting = new SequenceDeck(library);
  waiting.update(1 / 30); assert.equal(waiting.status, 'loading'); assert.equal(waiting.phase, 0);
  library.put(1); waiting.update(5); assert.equal(waiting.frame, 1); assert.equal(waiting.phase, 0.1);
  const missing = new SequenceDeck(fakeLibrary({ partial: true }));
  missing.update(0.2); assert.equal(missing.status, 'missing'); assert.equal(missing.phase, 0);
});

test('shared DDS cache deduplicates uploads and stays bounded', async () => {
  const oldFetch = globalThis.fetch, oldUsage = globalThis.GPUTextureUsage;
  const bytes = blockDDS(); let uploads = 0, destroys = 0;
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => bytes.buffer });
  const engine = { bindCache: new Map(), device: { features: new Set(['texture-compression-bc']),
    createTexture: () => ({ createView: () => ({}), destroy: () => destroys++ }),
    queue: { writeTexture: (destination, payload, layout) => { uploads++; assert.equal(payload.byteLength, 8); assert.equal(layout.rowsPerImage, 1); } } } };
  const manifest = { clips: [{ id: 'clip-00', index: 0, name: 'test', frameCount: 5, availableFrames: 5 }] };
  const library = new DDSLibrary(engine, manifest, { maxTextures: 2 });
  try {
    const a = library.get('clip-00', 0), b = library.get('clip-00', 0); assert.equal(a, b); await a;
    await library.get('clip-00', 1); await library.get('clip-00', 2);
    assert.equal(uploads, 3); assert.equal(destroys, 1); assert.equal(library.cache.size, 2);
    library.dispose(); assert.equal(destroys, 3);
  } finally { globalThis.fetch = oldFetch; globalThis.GPUTextureUsage = oldUsage; }
});

test('original catalog resolves the nonconsecutive filename prefixes without shifting clips', async () => {
  const server = createMediaServer();
  const catalog = await server.getCatalog();
  assert.equal(catalog.clips.length, 68); assert.equal(catalog.totals.expectedFrames, 48030);
  assert.equal(catalog.clips[67].name, 'mariposa');
  assert.ok(catalog.paths && 'dds' in catalog.paths && 'ink' in catalog.paths, 'the catalog reports the resolved media paths');
  const scanned = catalog.roots.filter(root => root.catalog && root.exists && root.hasDDS !== false);
  if (scanned.length) {
    assert.ok(catalog.activeRootId, 'the first scanned DDS root is reported as active');
    // media/dds (or the OneDrive original) always provides at least the first twelve clips; the
    // backup-drive folders found on 7/9/2026 add more when that drive is connected.
    assert.ok(catalog.totals.availableFrames >= 4895 && catalog.totals.completeClips >= 12, JSON.stringify(catalog.totals));
    assert.equal(catalog.clips[3].availableFrames, 281);
    assert.equal(catalog.clips[9].availableFrames, 305);
    assert.equal(catalog.clips[0].mapping, 'original-name-extraction');
    for (const clip of catalog.clips) {
      assert.ok(clip.availableFrames <= clip.frameCount, clip.id);
      if (clip.availableFrames) assert.ok(catalog.roots.some(root => root.id === clip.rootId && root.clips > 0), `${clip.id} names its root`);
    }
  }
  const missing = catalog.clips.find(clip => !clip.availableFrames);
  if (missing) {
    let status, body;
    const req = Readable.from([]); req.method = 'GET'; req.headers = {};
    const res = { writeHead(code) { status = code; }, end(data) { body = data; } };
    await server.handle(req, res, `/media/${missing.id}/0.dds`);
    assert.equal(status, 404); assert.equal(JSON.parse(body).code, 'MISSING_FRAME');
  }
});

test('folder naming variants: patch rule, renamed dds2 folder disambiguated by frame count, resize folder', () => {
  const pad = (n, width) => String(n).padStart(width, '0');
  const seq = (stem, count, width, glue = '', ext = '.dds', from = 0) => Array.from({ length: count }, (_, i) => `${stem}${glue}${pad(i + from, width)}${ext}`);
  // I:\dds keeps the patch's naming: four leading characters, name, frame digits glued to the name.
  const showFiles = [...seq('002 bacteria naranja', 1739, 4), ...seq('004 drone arriba incendio', 281, 3),
    ...seq('006 drone diag fabria-', 1207, 4), ...seq('005 drone frente bosque verde', 366, 3), ...seq('001 celula', 570, 3),
    ...seq('001 celula blanco verde', 801, 3), ...seq('004 drone arriba fabrica gris', 3, 3)].sort();
  const clip = (name, frameCount, extra = {}) => ({ id: name, index: 0, name, frameCount, startGlobal: 0, endGlobal: frameCount - 1, ...extra });
  let match = matchClipFiles(clip('bacteria naranja', 1739), showFiles);
  assert.equal(match.mapping, 'original-name-extraction'); assert.equal(match.frames.size, 1739);
  assert.equal(match.frames.get(1738), '002 bacteria naranja1738.dds', 'four-digit suffixes index frames directly');
  match = matchClipFiles(clip('drone arriba incendi', 281), showFiles);
  assert.equal(match.frames.size, 281); assert.equal(match.frames.get(0), '004 drone arriba incendio000.dds');
  assert.equal(matchClipFiles(clip('drone diag fabria-', 1207), showFiles).frames.size, 1207);
  assert.equal(matchClipFiles(clip('celul', 570), showFiles).frames.size, 570, '"001 celula" is "celul", not "celula blanco verde"');
  assert.equal(matchClipFiles(clip('celula blanco verd', 801), showFiles).frames.size, 801);
  assert.equal(matchClipFiles(clip('drone frente bosque verd', 366), showFiles).frames.size, 366);
  assert.equal(matchClipFiles(clip('drone arriba fabrica gri', 477), showFiles).frames.size, 3, 'partial folders stay partial');
  // …\resize completes the drone clips missing from I:\dds; "verde2" is clip 30, not clip 14.
  const resizeFiles = [...seq('005 drone frente bosque verde2', 886, 3), ...seq('004 drone arriba fabrica gris', 477, 3, '', '.dds', 3), ...seq('012 tinta aceite metalico', 601, 3)].sort();
  assert.equal(matchClipFiles(clip('drone frente bosque verde', 886), resizeFiles).frames.size, 886);
  assert.equal(matchClipFiles(clip('drone frente bosque verd', 366), resizeFiles).frames.size, 0);
  match = matchClipFiles(clip('drone arriba fabrica gri', 477), resizeFiles);
  assert.equal(match.frames.size, 477); assert.equal(match.frames.get(0), '004 drone arriba fabrica gris003.dds', 'out-of-range suffixes fall back to sorted order');
  assert.equal(matchClipFiles(clip('tinta aceite metalic', 601), resizeFiles).frames.size, 601);
  // I:\dds2 was renamed: the catalog name is the END of the stem, and the count tells "NY 1" from "mede 1".
  const dds2Files = [...seq('NY 1', 709, 3, ' ', '.DDS', 1), ...seq('mede 1', 540, 3, ' ', '.DDS', 1), ...seq('mede 2', 870, 3, ' ', '.DDS', 1),
    ...seq('autopista circular dia', 1024, 4, ' ', '.DDS', 1), ...seq('auotpista noche 2', 577, 3, ' ', '.DDS', 1), ...seq('camion', 298, 3, ' ', '.DDS', 1)].sort();
  match = matchClipFiles(clip('1', 709), dds2Files);
  assert.equal(match.mapping, 'name-suffix-and-count'); assert.equal(match.frames.size, 709); assert.equal(match.frames.get(0), 'NY 1 001.DDS');
  assert.equal(match.frames.get(708), 'NY 1 709.DDS', 'one-based suffixes index by sorted position');
  assert.equal(matchClipFiles(clip('e 1', 540), dds2Files).frames.get(0), 'mede 1 001.DDS');
  assert.equal(matchClipFiles(clip('e 2', 870), dds2Files).frames.size, 870);
  match = matchClipFiles(clip('opista circular dia', 1024), dds2Files);
  assert.equal(match.frames.size, 1024); assert.equal(match.frames.get(1023), 'autopista circular dia 1024.DDS');
  assert.equal(matchClipFiles(clip('tpista noche 2', 577), dds2Files).frames.size, 577);
  assert.equal(matchClipFiles(clip('ion', 298), dds2Files).frames.size, 298);
  assert.equal(matchClipFiles(clip('ion', 299), dds2Files).frames.size, 0, 'a different frame count is not the same clip');
  assert.equal(matchClipFiles(clip('mariposa', 2069), [...showFiles, ...dds2Files]).mapping, null);
  // A folder chosen for one clip is that clip unless it is a catalog folder.
  const single = seq('LOMBRIZ', 1319, 4);
  assert.equal(matchClipFiles(clip('LOMBRIZ0', 1319), single, { singleClip: true, catalogRoot: false }).mapping, 'selected-directory');
  assert.equal(matchClipFiles(clip('LOMBRIZ0', 1319), single, { singleClip: true, catalogRoot: true }).frames.size, 0);
});
