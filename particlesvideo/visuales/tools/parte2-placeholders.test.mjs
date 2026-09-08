import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createParte2MediaService } from './parte2-media-service.mjs';

test('versioned Parte 2 placeholders serve a still for every available DDS sequence and INK', async () => {
  const service = await createParte2MediaService({
    env: { ...process.env, PARTE2_DDS_ROOT: 'Z:/no-show-media', PARTE2_INK_ROOT: 'Z:/no-show-ink' },
  });
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}/parte2`;
    const catalog = await (await fetch(`${base}/api/catalog`)).json();
    const placeholders = catalog.clips.filter(clip => clip.placeholder);
    assert.equal(placeholders.length, 63);
    assert.equal(catalog.clips.filter(clip => !clip.availableFrames).length, 5);
    for (const clip of placeholders) {
      const response = await fetch(`${base}/media/${clip.id}/${clip.frameCount - 1}.dds`);
      assert.equal(response.status, 200, clip.id);
      assert.match(response.headers.get('x-media-placeholder') || '', /^frame-\d+$/);
      assert.ok((await response.arrayBuffer()).byteLength > 148, clip.id);
    }
    for (const extension of ['dds', 'jpg']) {
      const response = await fetch(`${base}/ink/000060.${extension}`);
      assert.equal(response.status, 200, extension);
      assert.equal(response.headers.get('x-media-placeholder'), 'ink-frame-000000');
      assert.ok((await response.arrayBuffer()).byteLength > 148, extension);
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
