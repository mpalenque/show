const WIDTH = 672;
const HEIGHT = 252;
const CPU_MARK = 'radiance-preview-capture-start';
const CPU_MEASURE = 'radiance-preview-capture-cpu';

/**
 * Optional editor preview. The output thread only snapshots/transfers an
 * ImageBitmap; the 2D draw, pixel readback and JPEG encoding belong to the worker.
 * One pending bitmap/encode at most, with no catch-up queue during slow frames.
 */
export class PreviewCapture {
  constructor({ onFrame = () => {}, onError = () => {} } = {}) {
    this._onFrame = onFrame;
    this._onError = onError;
    this._worker = null;
    this._busy = false;
    this._disabled = false;
    this._disposed = false;
    this._id = 0;
    this._timer = null;
    this._startedAt = 0;
    this._metrics = { requested: 0, completed: 0, dropped: 0, captureCpuMs: 0,
      lastCaptureCpuMs: 0, maxCaptureCpuMs: 0, totalCaptureCpuMs: 0,
      transferCpuMs: 0, maxTransferCpuMs: 0, lastLatencyMs: 0, encodeMs: 0, error: null };
    if (typeof createImageBitmap !== 'function' || typeof Worker !== 'function'
      || typeof OffscreenCanvas !== 'function') {
      this._disable(new Error('La vista previa requiere ImageBitmap y OffscreenCanvas.'));
      return;
    }
    try {
      this._worker = new Worker(new URL('./preview.worker.js', import.meta.url),
        { type: 'module', name: 'radiance-preview-encode' });
      this._worker.onmessage = event => this._receive(event.data);
      this._worker.onerror = event => {
        event.preventDefault?.();
        this._disable(new Error(event.message || 'Error del worker de vista previa.'));
      };
      this._worker.onmessageerror = () => this._disable(new Error('No se pudo transferir la vista previa.'));
    } catch (error) { this._disable(error); }
  }

  /** Call immediately after the fluid renderer has drawn its output canvas. */
  capture(source) {
    if (this._disposed || this._disabled || this._busy || !source) {
      this._metrics.dropped += 1;
      return false;
    }
    this._busy = true;
    this._metrics.requested += 1;
    const id = ++this._id;
    this._startedAt = performance.now();
    this._timer = setTimeout(() => this._disable(new Error('La vista previa no respondió.')), 5000);
    performance.clearMarks?.(CPU_MARK);
    performance.clearMeasures?.(CPU_MEASURE);
    performance.mark?.(CPU_MARK);
    const startedAt = performance.now();
    let capture;
    try {
      // Keep the request adjacent to the render: preserveDrawingBuffer remains
      // off, and awaiting another RAF before snapshotting could capture black.
      capture = createImageBitmap(source, { resizeWidth: WIDTH, resizeHeight: HEIGHT, resizeQuality: 'low' });
    } catch (error) {
      this._recordCaptureCpu(performance.now() - startedAt);
      this._disable(error);
      return false;
    }
    this._recordCaptureCpu(performance.now() - startedAt);
    Promise.resolve(capture).then(bitmap => {
      if (this._disposed || this._disabled || id !== this._id) {
        bitmap.close();
        return;
      }
      const transferAt = performance.now();
      try {
        this._worker.postMessage({ type: 'capture', id, bitmap, width: WIDTH, height: HEIGHT }, [bitmap]);
        this._metrics.transferCpuMs = performance.now() - transferAt;
        this._metrics.maxTransferCpuMs = Math.max(this._metrics.maxTransferCpuMs, this._metrics.transferCpuMs);
      } catch (error) {
        bitmap.close();
        this._disable(error);
      }
    }).catch(error => this._disable(error));
    return true;
  }

  _recordCaptureCpu(elapsed) {
    this._metrics.captureCpuMs = elapsed;
    this._metrics.lastCaptureCpuMs = elapsed;
    this._metrics.maxCaptureCpuMs = Math.max(this._metrics.maxCaptureCpuMs, elapsed);
    this._metrics.totalCaptureCpuMs += elapsed;
    if (performance.measure) performance.measure(CPU_MEASURE, CPU_MARK);
  }

  _receive(message) {
    if (this._disposed || this._disabled || !this._busy || message.id !== this._id) return;
    if (message.type === 'error') {
      this._disable(new Error(message.error || 'No se pudo codificar la vista previa.'));
      return;
    }
    if (message.type !== 'frame' || !(message.blob instanceof Blob)) return;
    clearTimeout(this._timer);
    this._timer = null;
    this._busy = false;
    this._metrics.completed += 1;
    this._metrics.lastLatencyMs = performance.now() - this._startedAt;
    this._metrics.encodeMs = Number(message.encodeMs) || 0;
    try { this._onFrame(message.blob, this.stats()); }
    catch (error) { this._disable(error); }
  }

  stats() {
    return { ...this._metrics, busy: this._busy, disabled: this._disabled, width: WIDTH, height: HEIGHT };
  }

  _disable(error) {
    if (this._disposed || this._disabled) return;
    this._disabled = true;
    this._busy = false;
    this._metrics.error = error?.message || String(error);
    clearTimeout(this._timer);
    this._timer = null;
    this._worker?.terminate();
    this._worker = null;
    // An optional preview failure must never propagate into Engine's frame.
    queueMicrotask(() => {
      if (this._disposed) return;
      try { this._onError(new Error(this._metrics.error)); } catch { /* Output keeps running. */ }
    });
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._busy = false;
    this._id += 1;
    clearTimeout(this._timer);
    this._timer = null;
    this._worker?.terminate();
    this._worker = null;
    this._onFrame = () => {};
    this._onError = () => {};
    performance.clearMarks?.(CPU_MARK);
    performance.clearMeasures?.(CPU_MEASURE);
  }
}

export default PreviewCapture;
