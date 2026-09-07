import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PreviewCapture } from '../src/radiance/PreviewCapture.js';

const globals = { Worker: globalThis.Worker, OffscreenCanvas: globalThis.OffscreenCanvas,
  createImageBitmap: globalThis.createImageBitmap };
const flush = () => new Promise(resolve => setImmediate(resolve));

class WorkerDouble {
  static current;
  sent = [];
  terminated = false;
  constructor() { WorkerDouble.current = this; }
  postMessage(message, transfer) { this.sent.push({ message, transfer }); }
  terminate() { this.terminated = true; }
  emit(message) { this.onmessage({ data: message }); }
}

test.afterEach(() => Object.assign(globalThis, globals));
function support(createBitmap) {
  globalThis.Worker = WorkerDouble;
  globalThis.OffscreenCanvas = class {};
  globalThis.createImageBitmap = createBitmap;
}

test('keeps exactly one capture in flight and transfers the bitmap to the encoder', async () => {
  let resolveBitmap;
  let calls = 0;
  support((source, options) => {
    calls += 1;
    assert.deepEqual(options, { resizeWidth: 672, resizeHeight: 252, resizeQuality: 'low' });
    return new Promise(resolve => { resolveBitmap = resolve; });
  });
  const frames = [];
  const capture = new PreviewCapture({ onFrame: blob => frames.push(blob) });
  try {
    assert.equal(capture.capture({}), true);
    assert.equal(capture.capture({}), false);
    assert.equal(calls, 1);
    const bitmap = { close() { throw new Error('Transferred bitmap must close in the worker.'); } };
    resolveBitmap(bitmap);
    await flush();
    const [{ message, transfer }] = WorkerDouble.current.sent;
    assert.deepEqual(transfer, [bitmap]);
    assert.equal(message.bitmap, bitmap);
    assert.equal(capture.stats().busy, true);
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    WorkerDouble.current.emit({ type: 'frame', id: message.id, blob, encodeMs: 1.5 });
    assert.equal(frames[0], blob);
    assert.equal(capture.stats().busy, false);
    assert.equal(capture.stats().completed, 1);
    assert.equal(capture.stats().dropped, 1);
    assert.ok(capture.stats().captureCpuMs >= 0);
  } finally { capture.dispose(); }
});

test('closes a bitmap that completes after disposal and sends no stale preview', async () => {
  let resolveBitmap;
  support(() => new Promise(resolve => { resolveBitmap = resolve; }));
  const capture = new PreviewCapture();
  capture.capture({});
  capture.dispose();
  let closed = 0;
  resolveBitmap({ close() { closed += 1; } });
  await flush();
  assert.equal(closed, 1);
  assert.equal(WorkerDouble.current.sent.length, 0);
  assert.equal(WorkerDouble.current.terminated, true);
});

test('a failed snapshot disables only preview and reports one optional error', async () => {
  support(() => Promise.reject(new Error('GPU snapshot failed')));
  const errors = [];
  const capture = new PreviewCapture({ onError: error => errors.push(error.message) });
  try {
    assert.doesNotThrow(() => capture.capture({}));
    await flush();
    assert.equal(capture.stats().disabled, true);
    assert.equal(capture.capture({}), false);
    assert.deepEqual(errors, ['GPU snapshot failed']);
    assert.equal(WorkerDouble.current.terminated, true);
  } finally { capture.dispose(); }
});

test('worker owns pixel drawing and JPEG conversion, and closes its bitmap', async () => {
  const events = [];
  const context = { drawImage() { events.push('draw'); } };
  const worker = { postMessage(message) { events.push(message); } };
  const script = await readFile(new URL('../src/radiance/preview.worker.js', import.meta.url), 'utf8');
  vm.runInNewContext(script, { self: worker, performance,
    OffscreenCanvas: class {
      getContext() { return context; }
      async convertToBlob() { events.push('encode'); return new Blob(['jpeg']); }
    },
  });
  await worker.onmessage({ data: { type: 'capture', id: 7, width: 672, height: 252,
    bitmap: { close() { events.push('close'); } } } });
  assert.equal(events[0], 'draw');
  assert.equal(events[1], 'encode');
  assert.equal(events[2].type, 'frame');
  assert.equal(events[2].id, 7);
  assert.ok(events[2].blob instanceof Blob);
  assert.equal(events[3], 'close');
});
