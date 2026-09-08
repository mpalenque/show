/**
 * Bounded, on-demand player for the original 1,067 INK frames.
 * BC-capable devices upload DDS BC7 blocks directly: 921,600 bytes per frame,
 * with a 48-frame GPU cache (~42.2 MiB), one mip level and four concurrent
 * reads maximum. No decoding, whole-sequence loading or constructor fetch.
 *
 * Without texture-compression-bc on the requested GPUDevice, the matching
 * original JPEG is decoded into rgba8unorm (~168.75 MiB for 48 frames).
 * JPEG decoding/compression can differ from the BC7 reference image.
 *
 * get(frame) / request(frame): Promise<engine-compatible texture wrapper>.
 * peek(frame): synchronous wrapper if cached; cache itself is Map<frame,wrapper>.
 * preload(frames): preloads at most eight requested frames, returns allSettled.
 * dispose(): aborts reads, rejects queued requests, clears binding cache and
 * destroys owned GPU textures. Create a new InkPlayer to resume after disposal.
 *
 * WebGPU rowsPerImage counts texel BLOCK rows, not pixel rows:
 * https://gpuweb.github.io/gpuweb/#dictdef-gputexelcopybufferlayout
 * BC7: 4x4 blocks, 16 bytes/block, bytesPerRow=5,120, rowsPerImage=180.
 */
export class InkPlayer {
  constructor(engine) {
    this.engine = engine;
    this.device = engine.device;
    this.frameCount = 1067;
    this.width = 1280;
    this.height = 720;
    this.compressed = this.device.features.has('texture-compression-bc');
    this.format = this.compressed ? 'bc7-rgba-unorm' : 'rgba8unorm';
    this.limit = 48;
    this.cache = new Map();
    this.pending = new Map();
    this.jobs = [];
    this.active = 0;
    this.maxConcurrent = 4;
    this.disposed = false;
    this.controller = new AbortController();
    this.loadedFrames = 0;
  }

  peek(frame) {
    const wrapper = this.cache.get(frame);
    if (wrapper) {
      this.cache.delete(frame);
      this.cache.set(frame, wrapper);
    }
    return wrapper;
  }

  get(frame) {
    if (this.disposed) return Promise.reject(new Error('El player de tinta ya fue cerrado.'));
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.frameCount) {
      return Promise.reject(new RangeError(`Frame de tinta inválido: ${frame}. El rango es 0–1066.`));
    }
    const cached = this.peek(frame);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(frame);
    if (pending) return pending.promise;
    const job = { frame };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this.pending.set(frame, job);
    this.jobs.push(job);
    this.pump();
    return job.promise;
  }

  request(frame) { return this.get(frame); }

  preload(frames) {
    return Promise.allSettled([...new Set(frames)].slice(0, 8).map(frame => this.get(frame)));
  }

  pump() {
    while (!this.disposed && this.active < this.maxConcurrent && this.jobs.length) {
      const job = this.jobs.shift();
      this.active++;
      this.load(job.frame).then(wrapper => {
        if (this.disposed) {
          wrapper.texture.destroy();
          throw new DOMException('Carga de tinta cancelada.', 'AbortError');
        }
        this.cache.set(job.frame, wrapper);
        this.loadedFrames++;
        while (this.cache.size > this.limit) {
          const oldest = this.cache.keys().next().value;
          const evicted = this.cache.get(oldest);
          this.cache.delete(oldest);
          this.engine.bindCache.clear();
          evicted.texture.destroy();
        }
        job.resolve(wrapper);
      }).catch(error => job.reject(error)).finally(() => {
        if (this.pending.get(job.frame) === job) this.pending.delete(job.frame);
        this.active--;
        this.pump();
      });
    }
  }

  async load(frame) {
    const suffix = this.compressed ? 'dds' : 'jpg';
    const frameName = String(frame).padStart(6, '0');
    const url = `${this.engine.mediaBase || ''}/ink/${frameName}.${suffix}`;
    let response;
    try {
      response = await fetch(url, { signal: this.controller.signal, cache: this.engine.mediaBase ? 'no-store' : 'force-cache' });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error(`No se pudo leer INK${frameName}.${suffix}: ${error.message}`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`No se encontró el frame original INK${frameName}.${suffix} (HTTP ${response.status}).`);
    }
    if (this.compressed) return this.uploadDds(frame, await response.arrayBuffer());
    const bitmap = await createImageBitmap(await response.blob(), {
      colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none',
    });
    try {
      if (bitmap.width !== this.width || bitmap.height !== this.height) {
        throw new Error(`INK${frameName}.jpg tiene ${bitmap.width}×${bitmap.height}; se esperaba 1280×720.`);
      }
      if (this.disposed) throw new DOMException('Carga de tinta cancelada.', 'AbortError');
      const wrapper = this.createWrapper(frame, true);
      try {
        this.device.queue.copyExternalImageToTexture(
          { source: bitmap, flipY: false },
          { texture: wrapper.texture, premultipliedAlpha: false, colorSpace: 'srgb' },
          [this.width, this.height],
        );
      } catch (error) {
        wrapper.texture.destroy();
        throw error;
      }
      return wrapper;
    } finally { bitmap.close(); }
  }

  uploadDds(frame, buffer) {
    const fail = detail => new Error(`DDS INK${String(frame).padStart(6, '0')} inválido: ${detail}.`);
    if (buffer.byteLength < 148) throw fail('cabecera incompleta');
    const header = new DataView(buffer);
    if (header.getUint32(0, true) !== 0x20534444 || header.getUint32(4, true) !== 124) {
      throw fail('firma o tamaño de cabecera incorrectos');
    }
    if (header.getUint32(76, true) !== 32 || header.getUint32(84, true) !== 0x30315844) {
      throw fail('se esperaba una cabecera DDS DX10');
    }
    if (header.getUint32(128, true) !== 98 || header.getUint32(132, true) !== 3 || header.getUint32(140, true) !== 1) {
      throw fail('se esperaba una textura 2D BC7_UNORM (DXGI 98), sin array');
    }
    if (header.getUint32(16, true) !== this.width || header.getUint32(12, true) !== this.height) {
      throw fail('la resolución esperada es 1280×720');
    }
    const blockColumns = this.width / 4;
    const blockRows = this.height / 4;
    const bytesPerRow = blockColumns * 16;
    const byteLength = bytesPerRow * blockRows;
    if (buffer.byteLength < 148 + byteLength) throw fail('faltan bloques BC7 del frame');
    if (this.disposed) throw new DOMException('Carga de tinta cancelada.', 'AbortError');
    const wrapper = this.createWrapper(frame, false);
    try {
      this.device.queue.writeTexture(
        { texture: wrapper.texture }, new Uint8Array(buffer, 148, byteLength),
        { bytesPerRow, rowsPerImage: blockRows }, [this.width, this.height],
      );
    } catch (error) {
      wrapper.texture.destroy();
      throw error;
    }
    return wrapper;
  }

  createWrapper(frame, externalImage) {
    const texture = this.device.createTexture({
      label: `INK${String(frame).padStart(6, '0')}/${this.format}`,
      size: [this.width, this.height], format: this.format, mipLevelCount: 1,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
        (externalImage ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
    });
    const view = texture.createView();
    return { id: `ink${frame}`, texture, width: this.width, height: this.height,
      count: 1, view, levels: [view], version: 1, mipVersion: 1, format: this.format, frame };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    const error = new DOMException('Carga de tinta cancelada.', 'AbortError');
    for (const job of this.jobs) {
      this.pending.delete(job.frame);
      job.reject(error);
    }
    this.jobs.length = 0;
    this.engine.bindCache.clear();
    for (const wrapper of this.cache.values()) wrapper.texture.destroy();
    this.cache.clear();
  }
}
