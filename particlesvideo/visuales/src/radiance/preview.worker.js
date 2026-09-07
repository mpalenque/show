let canvas = null;
let context = null;
let busy = false;

self.onmessage = async event => {
  const { type, id, bitmap, width, height } = event.data;
  if (type !== 'capture') return;
  if (busy) {
    bitmap?.close();
    self.postMessage({ type: 'error', id, error: 'La vista previa ya está ocupada.' });
    return;
  }
  busy = true;
  const startedAt = performance.now();
  try {
    if (!canvas) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!context) throw new Error('No se pudo crear el canvas de vista previa.');
      context.imageSmoothingEnabled = false;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.68 });
    self.postMessage({ type: 'frame', id, blob, encodeMs: performance.now() - startedAt });
  } catch (error) {
    self.postMessage({ type: 'error', id, error: error?.message || String(error) });
  } finally {
    bitmap?.close();
    busy = false;
  }
};
