import { parseDDSHeader, decodeDDS } from './dds-format.js';
import { uploadCroppedDDS } from './dds-gpu-crop.js';

const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
let libraryId = 0, deckId = 0;

/** Shared media cache for all seven decks. Constructor performs no reads.
 * Sources have one mip; effects create their own mipmapped render targets.
 * BC1/2/3/7 remain compressed when the device supports them. BC1/2/3 and RGB
 * DDS can fall back to RGBA8; BC7 needs BC support or an original JPG sibling.
 * Cache is bounded by both texture count (128) and payload bytes (256 MiB).
 */
export class DDSLibrary {
  constructor(engine, manifest, { maxBytes = 256 * 1024 * 1024, maxTextures = 128, maxConcurrent = 8 } = {}) {
    this.engine = engine;
    this.device = engine.device;
    this.manifest = manifest;
    this.clips = new Map(manifest.clips.map(clip => [clip.id, clip]));
    this.id = ++libraryId;
    this.maxBytes = maxBytes;
    this.maxTextures = maxTextures;
    this.maxConcurrent = maxConcurrent;
    this.cache = new Map();
    this.pending = new Map();
    this.jobs = [];
    this.pins = new Map();
    this.active = 0;
    this.bytes = 0;
    this.disposed = false;
    this.controller = new AbortController();
    this.stats = { loads: 0, hits: 0, failures: 0, bytes: 0, cached: 0 };
  }

  clip(id) { return typeof id === 'number' ? this.manifest.clips.find(clip => clip.index === id) : this.clips.get(id); }
  key(clipId, frame) { return `${clipId}/${frame}`; }

  /** A clip is playable only when every frame the transport can request exists. */
  isPlayable(clipId) {
    const clip = this.clip(clipId);
    return !!clip && clip.frameCount > 0 && (clip.complete === true || clip.availableFrames === clip.frameCount
      || (clip.placeholder === true && clip.availableFrames > 0));
  }
  playableClips() { return this.manifest.clips.filter(clip => this.isPlayable(clip.id)); }

  /** TEMPORARY fallback for the missing catalog media (56 of 68 clips are not on
   * this machine). The MIDI selector floor(velocity/127×68)%68 keeps producing
   * indices 12–67; without a substitute those decks stay black while their gate
   * is open. Deterministic: requested index N → playable[N % playable.length],
   * so the same velocity always shows the same substitute. Returns the clip
   * itself when it is playable, or null when nothing is playable at all.
   * Remove/disable (media.fallback=false) once the original DDS are restored.
   */
  substitute(clipId) {
    const clip = this.clip(clipId);
    if (!clip) return null;
    if (this.isPlayable(clip.id)) return clip;
    const playable = this.playableClips();
    return playable.length ? playable[clip.index % playable.length] : null;
  }
  isAvailable(clipId, frame) {
    const clip = this.clip(clipId);
    return !!clip && Number.isInteger(frame) && frame >= 0 && frame < clip.frameCount &&
      (clip.placeholder === true ? clip.availableFrames > 0
        : clip.availableRanges ? clip.availableRanges.some(([start, end]) => frame >= start && frame <= end) : frame < clip.availableFrames);
  }

  peek(clipId, frame) {
    const clip = this.clip(clipId);
    if (!clip) return undefined;
    const key = this.key(clip.id, frame), wrapper = this.cache.get(key);
    if (wrapper) { this.cache.delete(key); this.cache.set(key, wrapper); this.stats.hits++; }
    return wrapper;
  }

  pin(owner, clipId, frame) { const clip = this.clip(clipId); if (clip) this.pins.set(owner, this.key(clip.id, frame)); }
  unpin(owner) { this.pins.delete(owner); }

  get(clipId, frame, priority = true) {
    const clip = this.clip(clipId);
    if (this.disposed) return Promise.reject(new Error('La biblioteca DDS fue cerrada.'));
    if (!clip || !Number.isInteger(frame) || frame < 0 || frame >= clip.frameCount) {
      return Promise.reject(new RangeError(`Clip/frame inválido: ${clipId}/${frame}.`));
    }
    if (!this.isAvailable(clip.id, frame)) {
      return Promise.reject(Object.assign(new Error(`Falta el frame ${frame} de «${clip.name}». Seleccioná su carpeta original.`), { code: 'MISSING_FRAME' }));
    }
    const cached = this.peek(clip.id, frame);
    if (cached) return Promise.resolve(cached);
    const key = this.key(clip.id, frame), old = this.pending.get(key);
    if (old) {
      if (priority && !old.priority) { old.priority = true; const at = this.jobs.indexOf(old); if (at >= 0) { this.jobs.splice(at, 1); this.jobs.unshift(old); } }
      return old.promise;
    }
    if (this.jobs.length >= 96) {
      const at = this.jobs.findIndex(job => !job.priority);
      if (at < 0 || !priority) return Promise.reject(Object.assign(new Error('La precarga DDS está ocupada.'), { code: 'QUEUE_FULL' }));
      const discarded = this.jobs.splice(at, 1)[0];
      this.pending.delete(discarded.key);
      discarded.reject(Object.assign(new Error('Precarga reemplazada por un frame visible.'), { code: 'QUEUE_FULL' }));
    }
    const job = { clip, frame, key, priority };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this.pending.set(key, job);
    if (priority) this.jobs.unshift(job); else this.jobs.push(job);
    this.pump();
    return job.promise;
  }

  request(clipId, frame) { return this.get(clipId, frame); }
  preload(clipId, frames) { return Promise.allSettled([...new Set(frames)].slice(0, 4).map(frame => this.get(clipId, frame, false))); }

  pump() {
    while (!this.disposed && this.active < this.maxConcurrent && this.jobs.length) {
      const job = this.jobs.shift(); this.active++;
      this.load(job.clip, job.frame).then(wrapper => {
        if (this.disposed) { wrapper.texture.destroy(); throw new DOMException('Carga cancelada.', 'AbortError'); }
        this.cache.set(job.key, wrapper); this.bytes += wrapper.byteLength;
        this.trim(job.key);
        this.stats.loads++;
        job.resolve(wrapper);
      }).catch(error => { this.stats.failures++; job.reject(error); }).finally(() => {
        this.pending.delete(job.key); this.active--; this.pump();
      });
    }
  }

  trim(newKey) {
    const pinned = new Set(this.pins.values());
    while (this.bytes > this.maxBytes || this.cache.size > this.maxTextures) {
      const victim = [...this.cache.keys()].find(key => key !== newKey && !pinned.has(key));
      if (victim == null) {
        this.evict(newKey);
        throw new Error('El frame excede el presupuesto de memoria DDS disponible para los decks activos.');
      }
      this.evict(victim);
    }
    this.stats.bytes = this.bytes; this.stats.cached = this.cache.size;
  }

  evict(key) {
    const wrapper = this.cache.get(key);
    if (!wrapper) return;
    this.engine.bindCache.clear();
    wrapper.destroyed = true; wrapper.texture.destroy();
    this.bytes -= wrapper.byteLength; this.cache.delete(key);
    this.stats.bytes = this.bytes; this.stats.cached = this.cache.size;
  }

  async load(clip, frame) {
    const base = `${this.engine.mediaBase || ''}/media/${clip.id}/${frame}`;
    const query = `?revision=${encodeURIComponent(this.manifest.revision || 0)}`;
    const response = await fetch(base + '.dds' + query, { signal: this.controller.signal, cache: this.engine.mediaBase ? 'no-store' : 'force-cache' });
    if (!response.ok) throw Object.assign(new Error(`No se pudo leer «${clip.name}», frame ${frame} (HTTP ${response.status}).`), { code: response.status === 404 ? 'MISSING_FRAME' : 'MEDIA_ERROR' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const header = parseDDSHeader(bytes);
    if (bytes.byteLength < header.totalBytes) throw new Error(`DDS incompleto: ${clip.name}, frame ${frame}.`);
    if (this.disposed) throw new DOMException('Carga cancelada.', 'AbortError');
    const gpuCompressed = header.compressed && this.device.features.has('texture-compression-bc') && header.width % 4 === 0 && header.height % 4 === 0;
    if (header.kind === 'bc1' && !header.srgb && !gpuCompressed) {
      return uploadCroppedDDS(this, clip, frame, bytes, header);
    }
    if (header.kind === 'bc7' && !gpuCompressed) return this.loadImage(clip, frame, base + '.jpg' + query);
    const format = gpuCompressed ? header.format : `rgba8unorm${header.srgb ? '-srgb' : ''}`;
    const payload = gpuCompressed ? bytes.subarray(header.offset, header.totalBytes) : decodeDDS(bytes, header);
    const wrapper = this.createTexture(clip, frame, header.width, header.height, format, payload.byteLength, false);
    try {
      this.device.queue.writeTexture({ texture: wrapper.texture }, payload,
        { bytesPerRow: gpuCompressed ? header.bytesPerRow : header.width * 4, rowsPerImage: gpuCompressed ? header.rows : header.height },
        [header.width, header.height]);
    } catch (error) { wrapper.texture.destroy(); throw error; }
    return wrapper;
  }

  async loadImage(clip, frame, url) {
    const response = await fetch(url, { signal: this.controller.signal, cache: this.engine.mediaBase ? 'no-store' : 'force-cache' });
    if (!response.ok) throw new Error(`«${clip.name}» usa BC7: activá la compresión BC en WebGPU o conservá el JPG original junto al DDS.`);
    const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    try {
      if (this.disposed) throw new DOMException('Carga cancelada.', 'AbortError');
      const wrapper = this.createTexture(clip, frame, bitmap.width, bitmap.height, 'rgba8unorm', bitmap.width * bitmap.height * 4, true);
      try { this.device.queue.copyExternalImageToTexture({ source: bitmap, flipY: false }, { texture: wrapper.texture, premultipliedAlpha: false }, [bitmap.width, bitmap.height]); }
      catch (error) { wrapper.texture.destroy(); throw error; }
      return wrapper;
    } finally { bitmap.close(); }
  }

  createTexture(clip, frame, width, height, format, byteLength, external, extraUsage = 0) {
    const texture = this.device.createTexture({ label: `${clip.id}/${frame}`, size: [width, height], format, mipLevelCount: 1,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | extraUsage | (external ? GPUTextureUsage.RENDER_ATTACHMENT : 0) });
    const view = texture.createView();
    return { id: `dds${this.id}/${clip.id}/${frame}`, texture, width, height, format, byteLength, count: 1,
      view, levels: [view], version: 1, mipVersion: 1, clipId: clip.id, frame, destroyed: false };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.controller.abort();
    for (const job of this.jobs) { this.pending.delete(job.key); job.reject(new DOMException('Carga cancelada.', 'AbortError')); }
    this.jobs.length = 0;
    for (const key of this.cache.keys()) this.evict(key);
    this.pins.clear();
  }
}

/** Independent transport. start/end and seek use normalized clip positions.
 * The original defaults are looping 30 FPS and preserved LFO phase when a
 * clip changes. A wrap displays the last frame for one evaluation, matching
 * Selector frames' LFO.Output + LFO.Change -> Clamp -> Whole Part wiring.
 * A pending frame stalls this deck's phase; missing media never blocks other
 * decks or the effects. Reverse/pingpong/range/speed are optional web controls.
 */
export class SequenceDeck {
  constructor(library, options = {}) {
    this.library = library;
    this.id = `deck${++deckId}`;
    this.start = 0; this.end = 1; this.speed = 1; this.reverse = false;
    this.loop = true; this.pingpong = false; this.playing = true; this.masLento = 0;
    for (const name of ['start', 'end', 'speed', 'reverse', 'loop', 'pingpong', 'playing', 'masLento']) if (name in options) this[name] = options[name];
    this.phase = 0; this.frame = 0; this.status = 'loading'; this.error = null;
    // Filled by the controller: the clip the show asked for, and which request
    // this deck is standing in for when media.fallback substitutes a missing clip.
    this.requestedClipIndex = null; this.substituteFor = null;
    this._pingDirection = 1; this._pendingAdvance = null; this._requested = null; this._lastTexture = null;
    this.setClip(options.clipId ?? library.manifest.clips[0]?.id, { reset: true });
  }

  get clip() { return this.library.clip(this.clipId); }
  get position() { return this.phase; }
  get duration() { return this.clip ? (this.clip.frameCount - 1) / (this.clip.fps || 30) + this.masLento : 0; }
  get texture() { return this.library.peek(this.clipId, this.frame) || (this._lastTexture && !this._lastTexture.destroyed ? this._lastTexture : null); }

  setClip(id, { reset = false } = {}) {
    const clip = this.library.clip(id);
    if (!clip) throw new Error(`Clip desconocido: ${id}.`);
    this.library.unpin(this.id);
    this.clipId = clip.id;
    if (reset) this.phase = (this.reverse ? -1 : 1) * (this.speed < 0 ? -1 : 1) < 0 ? this.end : this.start;
    this.phase = clamp(this.phase, 0, 1);
    this.frame = Math.floor(this.phase * Math.max(0, clip.frameCount - 1));
    this._pendingAdvance = null; this._requested = null; this._lastTexture = null; this._pingDirection = 1;
    this.status = 'loading'; this.error = null;
    this.ensure(this.frame); this.prefetch();
    return this;
  }

  seek(normalized) {
    this.phase = clamp(Number(normalized) || 0, Math.min(this.start, this.end), Math.max(this.start, this.end));
    this.frame = Math.floor(this.phase * Math.max(0, this.clip.frameCount - 1));
    this._pendingAdvance = null; this._requested = null; this.error = null;
    this.ensure(this.frame); this.prefetch();
    return this.frame;
  }

  ensure(frame) {
    const cached = this.library.peek(this.clipId, frame);
    if (cached) return cached;
    if (!this.library.isAvailable(this.clipId, frame)) {
      this.status = 'missing'; this.error = `Falta «${this.clip.name}», frame ${frame}.`; return null;
    }
    const key = `${this.clipId}/${frame}`;
    this.status = 'loading';
    if (this._requested !== key) {
      this._requested = key;
      this.library.get(this.clipId, frame).then(() => { if (this._requested === key) this._requested = null; }).catch(error => {
        if (this._requested !== key) return;
        this._requested = null;
        this.status = error.code === 'MISSING_FRAME' ? 'missing' : error.code === 'QUEUE_FULL' ? 'loading' : 'error';
        this.error = error.message;
      });
    }
    return null;
  }

  prefetch() {
    const clip = this.clip;
    if (!clip) return;
    const direction = (this.speed < 0 ? -1 : 1) * (this.reverse ? -1 : 1) * this._pingDirection;
    const first = Math.floor(clamp(Math.min(this.start, this.end), 0, 1) * (clip.frameCount - 1));
    const last = Math.floor(clamp(Math.max(this.start, this.end), 0, 1) * (clip.frameCount - 1));
    const frames = [this.frame];
    for (let i = 1; i < 4; i++) {
      let frame = this.frame + direction * i;
      if (this.pingpong) { const span = last - first; const at = span ? mod(frame - first, span * 2) : 0; frame = first + (at <= span ? at : 2 * span - at); }
      else if (this.loop) frame = first + mod(frame - first, last - first + 1);
      else frame = clamp(frame, first, last);
      frames.push(frame);
    }
    this.library.preload(this.clipId, frames.filter(frame => this.library.isAvailable(this.clipId, frame)));
  }

  commit(next, texture) {
    this.phase = next.phase; this.frame = next.frame; this._pingDirection = next.direction;
    if (next.stop) this.playing = false;
    this._lastTexture = texture; this.library.pin(this.id, this.clipId, this.frame);
    this.status = next.stop ? 'ended' : this.playing ? 'playing' : 'paused'; this.error = null;
    this._pendingAdvance = null; this.prefetch();
  }

  update(dt) {
    if (this._pendingAdvance) {
      const texture = this.ensure(this._pendingAdvance.frame);
      if (texture) this.commit(this._pendingAdvance, texture);
      return this.frame;
    }
    const current = this.ensure(this.frame);
    if (!current) return this.frame;
    this._lastTexture = current; this.library.pin(this.id, this.clipId, this.frame);
    this.status = this.playing ? 'playing' : 'paused'; this.error = null;
    if (!this.playing || !this.speed || !(dt > 0) || this.clip.frameCount < 2) return this.frame;
    const start = clamp(Math.min(this.start, this.end), 0, 1), end = clamp(Math.max(this.start, this.end), 0, 1);
    const span = end - start;
    if (!span) return this.frame;
    const direction = (this.speed < 0 ? -1 : 1) * (this.reverse ? -1 : 1) * this._pingDirection;
    let phase = clamp(this.phase, start, end) + dt * Math.abs(this.speed) * direction / Math.max(0.000001, this.duration);
    let pingDirection = this._pingDirection, endpoint = null, stop = false;
    if (phase >= end || phase < start) {
      if (this.pingpong) {
        const segment = Math.floor((phase - start) / span);
        const at = mod(phase - start, span * 2);
        phase = start + (at <= span ? at : span * 2 - at);
        if (Math.abs(segment) % 2) pingDirection *= -1;
      } else if (this.loop) {
        endpoint = direction > 0 ? end : start;
        phase = start + mod(phase - start, span);
      } else { phase = clamp(phase, start, end); stop = true; }
    }
    const frame = Math.floor((endpoint ?? phase) * (this.clip.frameCount - 1) + 1e-8);
    const next = { phase, frame, direction: pingDirection, stop };
    const texture = this.ensure(frame);
    if (texture) this.commit(next, texture);
    else this._pendingAdvance = next;
    return this.frame;
  }

  dispose() { this.library.unpin(this.id); this._lastTexture = null; this._requested = null; }
}
