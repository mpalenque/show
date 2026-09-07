/**
 * Transporte de audio del show Fluids.
 *
 * El reloj maestro del show es este: la página lee `transport.time` en cada
 * rAF y se lo pasa a la escena como `fluidsShowTime`. Nada de contar frames —
 * si la imagen se atrasa un cuadro, el tiempo que ve el director sigue siendo
 * el del audio, y por eso la sincronía no deriva a lo largo de dos minutos y
 * medio de track.
 *
 * `AudioBufferSourceNode` es de un solo uso: cada play crea uno nuevo y
 * arranca en el offset pedido, así que buscar mientras suena es parar y
 * volver a arrancar. La posición se deriva de `ctx.currentTime`, que es el
 * único reloj que no miente sobre lo que se está escuchando.
 */

/** Resolución de la pirámide de picos del waveform, en cubetas por segundo. */
const PEAK_RATE = 400;

export interface AudioPeaks {
  /** Cubetas por segundo. */
  rate: number;
  /** Mínimo y máximo por cubeta, intercalados: [min0, max0, min1, max1, …]. */
  data: Float32Array;
  count: number;
}

export type TransportState = 'idle' | 'loading' | 'ready' | 'error';

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

export class AudioTransport {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private loading: Promise<void> | null = null;
  /** `ctx.currentTime` en el instante del último start(). */
  private startedAt = 0;
  /** Posición de timeline desde la que arrancó ese start(). */
  private offset = 0;
  private running = false;
  private token = 0;
  private peaksCache: AudioPeaks | null = null;

  state: TransportState = 'idle';
  error: string | null = null;
  /** Se dispara cuando el track llega al final por su cuenta. */
  onEnded: (() => void) | null = null;

  constructor(private readonly path: string, private fallbackDuration = 0) {}

  get ready(): boolean {
    return this.buffer !== null;
  }

  get playing(): boolean {
    return this.running;
  }

  get duration(): number {
    return this.buffer?.duration ?? this.fallbackDuration;
  }

  /** Posición actual de la timeline, en segundos. */
  get time(): number {
    if (!this.running || !this.ctx) return this.offset;
    const elapsed = this.ctx.currentTime - this.startedAt;
    return clamp(this.offset + elapsed, 0, this.duration);
  }

  /**
   * Crea el contexto y decodifica. Tiene que llamarse desde un gesto del
   * usuario: los navegadores no dejan sonar nada antes de eso, y por eso la
   * página muestra "CLICK PARA ARMAR AUDIO" hasta que esto resuelve.
   */
  async arm(): Promise<void> {
    if (this.buffer) {
      await this.ctx?.resume().catch(() => undefined);
      return;
    }
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.loading = (async () => {
      try {
        const AudioContextCtor = window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) throw new Error('Este navegador no expone AudioContext.');
        const ctx = this.ctx ?? new AudioContextCtor();
        this.ctx = ctx;
        await ctx.resume().catch(() => undefined);
        const response = await fetch(this.path);
        if (!response.ok) throw new Error(`No se pudo leer ${this.path} (${response.status}).`);
        const encoded = await response.arrayBuffer();
        this.buffer = await ctx.decodeAudioData(encoded);
        this.gain = ctx.createGain();
        this.gain.connect(ctx.destination);
        this.state = 'ready';
        this.error = null;
      } catch (error) {
        this.state = 'error';
        this.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  play(): void {
    const ctx = this.ctx;
    const buffer = this.buffer;
    const gain = this.gain;
    if (!ctx || !buffer || !gain || this.running) return;
    void ctx.resume().catch(() => undefined);
    // Arrancar exactamente en el final no reproduce nada: volver al principio
    // es lo que espera cualquiera que apriete play con el track terminado.
    if (this.offset >= buffer.duration - 0.01) this.offset = 0;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    this.token += 1;
    const token = this.token;
    source.onended = () => {
      // `stop()` también dispara onended: sólo interesa el final natural.
      if (token !== this.token || !this.running) return;
      this.running = false;
      this.offset = buffer.duration;
      this.source = null;
      this.onEnded?.();
    };
    source.start(0, clamp(this.offset, 0, buffer.duration));
    this.source = source;
    this.startedAt = ctx.currentTime;
    this.running = true;
  }

  pause(): void {
    if (!this.running) return;
    this.offset = this.time;
    this.halt();
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.play();
  }

  seek(time: number): void {
    const target = clamp(time, 0, this.duration);
    if (!this.running) {
      this.offset = target;
      return;
    }
    this.halt();
    this.offset = target;
    this.play();
  }

  setVolume(volume: number): void {
    if (this.gain) this.gain.gain.value = clamp(volume, 0, 1);
  }

  /**
   * Picos min/max por cubeta para dibujar el waveform. Se calcula una sola vez
   * al decodificar: recorrer 6,7 M de muestras por frame de dibujo sería
   * inviable, y a 400 cubetas por segundo (2,5 ms) el zoom máximo del editor
   * sigue teniendo más de una cubeta por píxel.
   */
  peaks(): AudioPeaks | null {
    if (this.peaksCache) return this.peaksCache;
    const buffer = this.buffer;
    if (!buffer) return null;
    const count = Math.max(1, Math.ceil(buffer.duration * PEAK_RATE));
    const data = new Float32Array(count * 2);
    const step = buffer.sampleRate / PEAK_RATE;
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, index) => buffer.getChannelData(index),
    );
    for (let bucket = 0; bucket < count; bucket += 1) {
      const from = Math.floor(bucket * step);
      const to = Math.min(channels[0].length, Math.floor((bucket + 1) * step));
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
    this.peaksCache = { rate: PEAK_RATE, data, count };
    return this.peaksCache;
  }

  dispose(): void {
    this.halt();
    this.onEnded = null;
    this.peaksCache = null;
    this.buffer = null;
    try {
      void this.ctx?.close();
    } catch {
      // Cerrar un contexto ya cerrado no puede tumbar la página.
    }
    this.ctx = null;
    this.gain = null;
  }

  private halt(): void {
    this.token += 1;
    this.running = false;
    const source = this.source;
    this.source = null;
    if (!source) return;
    try {
      source.onended = null;
      source.stop();
      source.disconnect();
    } catch {
      // Un source que nunca arrancó lanza al pararse; no importa.
    }
  }
}

export default AudioTransport;
