/**
 * Transporte de audio del show Fluids, dentro de la salida.
 *
 * Manuel pidió que el WAV salga de la página y no de Ableton: mandando el
 * audio por Ableton, el reloj de la imagen y el del track son dos relojes
 * distintos y a los dos minutos y medio ya se ven separados. Reproduciéndolo
 * acá, el tiempo que ve el director sale de `ctx.currentTime`, que es el único
 * reloj que no miente sobre lo que se está escuchando: si un frame se atrasa,
 * el show no se corre, se saltea.
 *
 * `AudioBufferSourceNode` es de un solo uso: cada play crea uno nuevo y
 * arranca en el offset pedido, así que buscar mientras suena es parar y volver
 * a arrancar. Es el mismo transporte de la página original de Fluids, portado
 * con su comportamiento intacto.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export class AudioTransport {
  constructor(path, { fallbackDuration = 0, now = () => performance.now() } = {}) {
    this.path = path;
    this.fallbackDuration = fallbackDuration;
    this._now = now;
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.gain = null;
    this.volume = 1;
    this.error = null;
    /** Se dispara cuando el track llega al final por su cuenta. */
    this.onEnded = null;
    this._loading = null;
    this._startedAt = 0;
    this._offset = 0;
    this._running = false;
    this._token = 0;
  }

  get ready() { return this.buffer !== null; }
  get playing() { return this._running; }
  get duration() { return this.buffer?.duration ?? this.fallbackDuration; }
  /**
   * Chrome deja crear el contexto sin gesto, pero lo deja `suspended` y no
   * suena nada. Distinguirlo de "todavía no cargó" es lo que permite avisar en
   * pantalla que falta un clic en vez de dejar el show mudo sin explicación.
   */
  get blocked() { return !!this.ctx && this.ctx.state !== 'running'; }

  /** Posición del track en segundos. Es el reloj del show mientras suena. */
  get time() {
    if (!this._running || !this.ctx) return this._offset;
    return clamp(this._offset + (this.ctx.currentTime - this._startedAt), 0, this.duration);
  }

  /**
   * Crea el contexto y decodifica. Conviene llamarlo desde un gesto del
   * operador; sin gesto el contexto queda suspendido y `blocked` lo delata.
   */
  async arm() {
    if (this.buffer) {
      await this.ctx?.resume().catch(() => {});
      return this.ready;
    }
    if (this._loading) return this._loading;
    this._loading = (async () => {
      try {
        const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Constructor) throw new Error('Este navegador no expone AudioContext.');
        const ctx = this.ctx ?? new Constructor({ latencyHint: 'interactive' });
        this.ctx = ctx;
        await ctx.resume().catch(() => {});
        const response = await fetch(this.path);
        if (!response.ok) throw new Error(`No se pudo leer ${this.path} (${response.status}).`);
        this.buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        this.gain = ctx.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(ctx.destination);
        this.error = null;
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this._loading = null;
      }
    })();
    return this._loading;
  }

  /** Reanuda el contexto: es lo único que hace falta después del primer gesto. */
  async resume() {
    if (!this.ctx) return false;
    await this.ctx.resume().catch(() => {});
    return !this.blocked;
  }

  play(offsetSeconds) {
    if (Number.isFinite(offsetSeconds)) this._offset = clamp(offsetSeconds, 0, this.duration);
    const { ctx, buffer, gain } = this;
    if (!ctx || !buffer || !gain || this._running) return false;
    void ctx.resume().catch(() => {});
    // Arrancar exactamente en el final no reproduce nada: volver al principio
    // es lo que espera cualquiera que apriete play con el track terminado.
    if (this._offset >= buffer.duration - 0.01) this._offset = 0;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const token = ++this._token;
    source.onended = () => {
      // `stop()` también dispara onended: sólo interesa el final natural.
      if (token !== this._token || !this._running) return;
      this._running = false;
      this._offset = buffer.duration;
      this.source = null;
      this.onEnded?.();
    };
    source.start(0, clamp(this._offset, 0, buffer.duration));
    this.source = source;
    this._startedAt = ctx.currentTime;
    this._running = true;
    return true;
  }

  pause() {
    if (!this._running) return;
    this._offset = this.time;
    this._halt();
  }

  seek(seconds) {
    const target = clamp(seconds, 0, this.duration);
    if (!this._running) { this._offset = target; return; }
    this._halt();
    this._offset = target;
    this.play();
  }

  setVolume(volume) {
    this.volume = clamp(volume, 0, 1);
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Picos min/max por cubeta, para que el editor no decodifique otra copia. */
  peaks(rate) {
    const buffer = this.buffer;
    if (!buffer) return null;
    const count = Math.max(1, Math.ceil(buffer.duration * rate));
    const data = new Float32Array(count * 2);
    const step = buffer.sampleRate / rate;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    for (let bucket = 0; bucket < count; bucket += 1) {
      const from = Math.floor(bucket * step);
      const to = Math.min(buffer.length, Math.floor((bucket + 1) * step));
      let min = 0;
      let max = 0;
      for (const channel of channels) {
        for (let index = from; index < to; index += 1) {
          const value = channel[index];
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      data[bucket * 2] = min;
      data[bucket * 2 + 1] = max;
    }
    return { rate, count, data };
  }

  dispose() {
    this._halt();
    this.onEnded = null;
    this.buffer = null;
    try { void this.ctx?.close(); } catch { /* cerrar dos veces no puede tumbar la salida */ }
    this.ctx = null;
    this.gain = null;
  }

  _halt() {
    this._token += 1;
    this._running = false;
    const source = this.source;
    this.source = null;
    if (!source) return;
    try {
      source.onended = null;
      source.stop();
      source.disconnect();
    } catch { /* un source que nunca arrancó lanza al pararse; no importa */ }
  }
}

export default AudioTransport;
