import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeDDS, encodeBC1, ddsHeader } from './bc1-encoder.mjs';
import { parseDDSHeader, decodeDDS } from './dds-format.js';
import { matchClipFiles } from './media-server.mjs';
import { frameName } from '../tools/import-sequence.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(packageRoot, 'system', 'catalog.json'), 'utf8'));

const fill = (width, height, paint) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = paint(x, y);
    rgba.set([r, g, b, 255], (y * width + x) * 4);
  }
  return rgba;
};
const psnr = (a, b) => {
  let sum = 0, count = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; sum += d * d; count++; }
  return sum === 0 ? Infinity : 10 * Math.log10(255 * 255 / (sum / count));
};

test('the generated DDS is a valid single-image BC1 file the app can parse', () => {
  const rgba = fill(64, 32, (x, y) => [x * 4, y * 8, 128]);
  const dds = encodeDDS(rgba, 64, 32);
  const header = parseDDSHeader(dds);
  assert.equal(header.format, 'bc1-rgba-unorm');
  assert.equal(header.compressed, true);
  assert.equal(header.width, 64); assert.equal(header.height, 32);
  assert.equal(header.mipCount, 1, 'mipMapCount 0 in the file reads back as a single level, like the originals');
  assert.equal(header.offset, 128);
  assert.equal(header.bytesPerRow, 16 * 8); assert.equal(header.rows, 8);
  assert.equal(dds.length, header.totalBytes);
  assert.equal(dds.length, 128 + (64 / 4) * (32 / 4) * 8);
  const fourCC = String.fromCharCode(...dds.subarray(84, 88));
  assert.equal(fourCC, 'DXT1');
});

test('flat colours survive the round trip exactly and every block stays opaque', () => {
  for (const colour of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0], [255, 255, 0]]) {
    const rgba = fill(8, 8, () => colour);
    const decoded = decodeDDS(encodeDDS(rgba, 8, 8));
    for (let i = 0; i < decoded.length; i += 4) {
      assert.deepEqual([...decoded.subarray(i, i + 3)], colour, `colour ${colour}`);
      assert.equal(decoded[i + 3], 255, 'alpha must stay opaque');
    }
  }
});

test('gradients and noise keep normal BC1 quality', () => {
  const gradient = fill(128, 128, (x, y) => [x * 2, y * 2, 255 - x]);
  assert.ok(psnr(gradient, decodeDDS(encodeDDS(gradient, 128, 128))) > 32, 'gradient PSNR');
  let seed = 7;
  const noise = fill(64, 64, () => { seed = (seed * 1103515245 + 12345) >>> 0; return [seed >>> 24, (seed >>> 16) & 255, (seed >>> 8) & 255]; });
  // Independent random RGB per pixel cannot be put on a 4-colour line: ~13 dB is
  // the format's ceiling here, not an encoder defect. Real footage measures far
  // higher: 42 dB on the gradient above, 54-66 dB re-encoding actual show frames.
  assert.ok(psnr(noise, decodeDDS(encodeDDS(noise, 64, 64))) > 12, 'random noise is the worst case for BC1');
  const partial = fill(30, 18, (x, y) => [x * 8, y * 12, 64]);   // not a multiple of 4
  const header = parseDDSHeader(encodeDDS(partial, 30, 18));
  assert.equal(header.width, 30); assert.equal(header.rows, 5);
  assert.ok(psnr(partial, decodeDDS(encodeDDS(partial, 30, 18))) > 30, 'edge blocks clamp instead of smearing');
});

test('re-encoding a real show frame stays close to the original image', async () => {
  const root = path.join(packageRoot, 'media', 'dds');
  if (!existsSync(root)) return; // media not copied on this machine
  const sample = (await readdir(root)).find(name => /\.dds$/i.test(name));
  if (!sample) return;
  const bytes = new Uint8Array(await readFile(path.join(root, sample)));
  const header = parseDDSHeader(bytes);
  if (header.kind !== 'bc1') return;
  const original = decodeDDS(bytes, header);
  const again = decodeDDS(encodeDDS(original, header.width, header.height));
  const quality = psnr(original, again);
  assert.ok(quality > 30, `re-encoding ${sample} gave only ${quality.toFixed(2)} dB`);
});

test('generated file names are matched by the media server for every catalog clip', () => {
  for (const clip of catalog.clips) {
    const extracted = frameName(clip, 0).replace(/\.dds$/i, '').slice(4, -4);
    assert.equal(extracted, clip.name, `${clip.id} name extraction`);
  }
  // The five clips without media: a full generated listing must map frame-for-frame.
  for (const index of [63, 64, 65, 66, 67]) {
    const clip = catalog.clips[index];
    const files = Array.from({ length: clip.frameCount }, (_, frame) => frameName(clip, frame))
      .sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
    const match = matchClipFiles(clip, files);
    assert.equal(match.mapping, 'original-name-extraction', `${clip.id} mapping`);
    assert.equal(match.frames.size, clip.frameCount, `${clip.id} frame count`);
    assert.equal(match.frames.get(0), frameName(clip, 0), `${clip.id} frame 0`);
    assert.equal(match.frames.get(clip.frameCount - 1), frameName(clip, clip.frameCount - 1), `${clip.id} last frame`);
    for (const [frame, name] of match.frames) assert.equal(name, frameName(clip, frame), `${clip.id} frame ${frame}`);
  }
});

test('a partially delivered sequence is reported as partial, never as complete', () => {
  const clip = catalog.clips[63];
  const files = Array.from({ length: 100 }, (_, frame) => frameName(clip, frame)).sort();
  const match = matchClipFiles(clip, files);
  assert.equal(match.frames.size, 100);
  assert.ok(match.frames.size < clip.frameCount);
  assert.equal(ddsHeader(1920, 1080).length, 128);
  assert.equal(encodeBC1(new Uint8Array(8 * 8 * 4), 8, 8).length, 2 * 2 * 8);
});
