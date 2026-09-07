import {
  CURVE_IDS, EVENT_SPECS, parseShowDoc,
} from '../../vendor/radiance/src/fluids-show/show-doc.ts';
import { AudioTransport } from './AudioTransport.js';

export const SHOW_STORAGE_KEY = 'vis.radiance.show.v1';
export const AUDIO_MODES = ['web', 'external'];
const PEAK_RATE = 400;
const EVENT_TYPES = new Set(EVENT_SPECS.map(({ type }) => type));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function validateDocument(raw) {
  let source;
  try { source = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new Error('El documento Fluids no contiene JSON válido.'); }
  // parseShowDoc deliberately repairs malformed input to an empty show. At the
  // integration boundary an invalid snapshot must instead remain an error.
  if (!source || source.version !== 1 || !finite(source.duration) || source.duration <= 1
    || !source.curves || !Array.isArray(source.events) || !Array.isArray(source.gestures)) {
    throw new Error('Documento Fluids inválido: se requiere ShowDoc v1 con duración, curvas, eventos y gestos.');
  }
  for (const id of CURVE_IDS) {
    const keys = source.curves[id]?.keys;
    if (!Array.isArray(keys) || keys.some((key) => !key || !finite(key.t) || key.t < 0 || !finite(key.v))) {
      throw new Error(`La curva Fluids «${id}» contiene datos inválidos.`);
    }
  }
  for (const event of source.events) {
    if (!event || !EVENT_TYPES.has(event.type) || !finite(event.t) || event.t < 0
      || !finite(event.dur) || event.dur <= 0 || !finite(event.intensity)
      || (event.params && Object.values(event.params).some((value) => !finite(value)))) {
      throw new Error('El documento Fluids contiene un evento inválido.');
    }
  }
  for (const gesture of source.gestures) {
    if (!gesture || !finite(gesture.t0) || !finite(gesture.t1) || gesture.t1 < gesture.t0
      || !Array.isArray(gesture.samples) || gesture.samples.length === 0
      || gesture.samples.some((sample) => !sample || !finite(sample.t) || !finite(sample.x) || !finite(sample.y))) {
      throw new Error('El documento Fluids contiene un gesto inválido.');
    }
  }
  return parseShowDoc(source, source.duration);
}

function freezeDocument(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDocument(child);
  }
  return value;
}

/**
 * La salida posee el documento y el transporte. Desde el 2026-09-06 también
 * reproduce el WAV: mandándolo por Ableton, el reloj de la imagen y el del
 * track corren por separado y la secuencia se despega del audio. Con el audio
 * acá, el tiempo del show sale de `AudioContext.currentTime` y los dos no se
 * pueden separar. `fluids.audioMode` en `external` recupera el comportamiento
 * anterior para ensayar con la música por Ableton.
 */
export class ShowSession {
  constructor(options = {}) {
    this._fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this._storage = options.storage;
    if (this._storage === undefined) {
      try { this._storage = globalThis.localStorage; } catch { this._storage = null; }
    }
    this._now = options.now ?? (() => performance.now());
    this._yield = options.yieldTask ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
    this._createOfflineAudioContext = options.createOfflineAudioContext ?? (() => {
      const Constructor = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
      if (!Constructor) throw new Error('No se pudo decodificar la onda de referencia. El show visual sigue disponible.');
      // This context only decodes the reference file. It has no hardware output
      // and is never rendered, resumed or connected to an audio node.
      return new Constructor(2, 1, 44100);
    });
    const base = options.baseUrl ?? import.meta.env?.BASE_URL ?? '/';
    this._assetBase = `${base.endsWith('/') ? base : `${base}/`}radiance/`;
    this._createAudioTransport = options.createAudioTransport
      ?? ((path, duration) => new AudioTransport(path, { fallbackDuration: duration }));
    this._audioMode = AUDIO_MODES.includes(options.audioMode) ? options.audioMode : 'web';
    this._audio = null;
    this._volume = 1;
    this._doc = null;
    this._revision = 0;
    this._offset = 0;
    this._startedAt = 0;
    this._playing = false;
    this._loop = { from: 0, to: 0, on: false };
    this._referenceContext = null;
    this._referenceAttempted = false;
    this._waveformAttempted = false;
    this._waveformDecoded = false;
    this._peaks = null;
    this._loading = null;
    this._disposed = false;
    this._error = null;
    this._audioError = null;
    this._storageError = null;
  }

  get doc() { return this._doc; }
  get revision() { return this._revision; }
  get duration() { return this._doc?.duration ?? 0; }
  get time() { return clamp(this._rawTime(), 0, this.duration); }
  get playing() { return this._playing; }
  get audioMode() { return this._audioMode; }
  get audioReady() { return !!this._audio?.ready; }
  /** El contexto existe pero Chrome todavía no lo dejó sonar: falta un gesto. */
  get audioBlocked() { return this._audioMode === 'web' && !!this._audio?.blocked; }
  /** ¿El track manda el reloj en este momento? */
  get audioDriving() { return this._audioMode === 'web' && !!this._audio?.ready; }

  async load() {
    this._assertLive();
    if (this._loading) return this._loading;
    if (this._doc && this._waveformAttempted) return this.state();
    this._loading = this._load();
    try { return await this._loading; }
    finally { this._loading = null; }
  }

  async _load() {
    this._error = null;
    try {
      if (!this._doc) {
        let stored = null;
        try { stored = this._storage?.getItem(SHOW_STORAGE_KEY); }
        catch { this._storageError = 'No se pudo leer el guardado local de Fluids.'; }
        if (stored) {
          const snapshot = JSON.parse(stored);
          if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) {
            throw new Error('El guardado local de Fluids está dañado. Exportalo antes de reemplazarlo.');
          }
          this._doc = freezeDocument(validateDocument(snapshot.doc));
          this._revision = snapshot.revision;
        } else {
          const response = await this._fetch(`${this._assetBase}show/fluids.show.json`);
          if (!response.ok) throw new Error(`No se pudo cargar fluids.show.json (${response.status}).`);
          this._assertLive();
          this._doc = freezeDocument(validateDocument(await response.json()));
          this._revision = 1;
        }
        this._loop.to = this.duration;
      }
      // El audio se arma EN SEGUNDO PLANO y el arranque no lo espera. Crear el
      // AudioContext y decodificar dos minutos y medio de WAV puede tardar —o
      // colgarse en una máquina sin salida de audio—, y eso no puede dejar el
      // show sin arrancar. La onda del editor sale del mismo buffer cuando
      // termina: decodificarla aparte en un contexto offline sería repetir el
      // trabajo y 50 MB más para dibujar lo mismo.
      if (this._audioMode === 'web') this._armAudioInBackground();
      else if (!this._peaks && !this._referenceAttempted) await this._loadWaveform();
      this._waveformAttempted = true;
      this._assertLive();
      return this.state();
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async _loadWaveform() {
    this._referenceAttempted = true;
    try {
      this._referenceContext = this._createOfflineAudioContext();
      const response = await this._fetch(`${this._assetBase}audio/fluids.wav`);
      if (!response.ok) throw new Error(`No se pudo cargar fluids.wav (${response.status}).`);
      const buffer = await this._referenceContext.decodeAudioData(await response.arrayBuffer());
      this._assertLive();
      const peaks = await this._buildPeaks(buffer);
      this._assertLive();
      this._waveformDecoded = true;
      this._peaks = peaks;
      this._audioError = null;
    } catch (error) {
      this._audioError = error instanceof Error ? error.message : String(error);
      // A missing/unsupported reference waveform must not prevent scene 25.
    } finally {
      this._referenceContext = null;
    }
  }

  async arm() {
    await this.load();
    await this.armAudio();
    return this.state();
  }

  /**
   * Prepara el WAV para que suene desde la página. Chrome no deja sonar nada
   * antes de un gesto: si todavía no lo hubo, el contexto queda `suspended` y
   * `audioBlocked` lo informa para que la salida pida el clic. Que el audio
   * falle nunca puede impedir que arranque la escena 25.
   */
  _armAudioInBackground() {
    this._armingAudio ??= this.armAudio()
      .catch(() => false)
      .finally(() => { this._armingAudio = null; });
    return this._armingAudio;
  }

  async armAudio() {
    this._assertLive();
    if (this._audioMode !== 'web') return false;
    if (!this._audio) this._audio = this._createAudioTransport(`${this._assetBase}audio/fluids.wav`, this.duration);
    this._audio.setVolume(this._volume);
    // El WAV puede terminar unos milisegundos antes que el documento. Cuando se
    // acaba el track, el reloj se cierra en la duración escrita: el final del
    // show lo define el documento, no el redondeo del archivo.
    this._audio.onEnded = () => { this._offset = this.duration; this._playing = false; };
    try {
      const ready = await this._audio.arm();
      this._audioError = this._audio.blocked
        ? 'El audio está cargado pero Chrome espera un clic en la ventana de salida para dejarlo sonar.'
        : null;
      // Ya hay un buffer decodificado: reusarlo evita la segunda pasada
      // offline sólo para dibujar la onda del editor.
      if (!this._peaks) this._peaks = this._audio.peaks(PEAK_RATE);
      if (this._peaks) this._waveformDecoded = true;
      // Si la nota 25 llegó mientras el WAV todavía se decodificaba, la imagen
      // ya está corriendo con el reloj de pared: el track entra acá, en la
      // posición en la que va la secuencia, en vez de quedarse mudo hasta el
      // próximo cue.
      if (ready && this._playing && !this._audio.playing) {
        this.tick();
        if (this._audioPlay(this.time)) this._startedAt = this._clock();
      }
      return ready;
    } catch (error) {
      this._audioError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  setVolume(volume) {
    this._volume = clamp(Number(volume), 0, 1);
    this._audio?.setVolume(this._volume);
    return this.state();
  }

  restart(cueTimeSeconds = this._clock()) {
    this._assertPlayable();
    this._assertCueTime(cueTimeSeconds);
    this._playing = false;
    this._audio?.pause();
    this._offset = 0;
    return this.play(cueTimeSeconds);
  }

  play(cueTimeSeconds = this._clock()) {
    this._assertPlayable();
    this._assertCueTime(cueTimeSeconds);
    if (this._playing) return this.state();
    if (this._offset >= this.duration) this._offset = 0;
    if (this._loop.on && this._offset >= this._loop.to) this._offset = this._loop.from;
    // Con el audio en la página el cue MIDI no fija el origen del reloj: lo fija
    // el instante en que el track empieza a sonar, que es a lo que hay que
    // pegarse para que imagen y música no se separen. Sin audio armado vuelve a
    // valer el sello del cue, que es `performance.now()/1000` al recibir la
    // nota y no el momento posterior en que termina de prepararse Fluids.
    this._startedAt = this._audioPlay(this._offset) ? this._clock() : cueTimeSeconds;
    this._playing = true;
    this.tick();
    return this.state();
  }

  pause() {
    if (this._playing) {
      this.tick();
      this._offset = this.time;
    }
    this._audio?.pause();
    this._playing = false;
    return this.state();
  }

  seek(seconds) {
    this._assertDocument();
    if (!finite(seconds)) throw new Error('El tiempo de Fluids debe ser un número finito.');
    const wasPlaying = this._playing;
    this._playing = false;
    this._audio?.pause();
    this._offset = clamp(seconds, 0, this.duration);
    // El track queda parado en el mismo punto, así un play posterior arranca de
    // ahí y no del lugar donde se lo dejó la última vez.
    this._audio?.seek(this._offset);
    // A seek to the end holds the final frame instead of implicitly replaying.
    if (wasPlaying && this._offset < this.duration) this.play();
    return this.state();
  }

  setLoop(range) {
    this._assertDocument();
    const { from, to, on } = range ?? { from: this._loop.from, to: this._loop.to, on: false };
    if (!finite(from) || !finite(to) || from < 0 || to > this.duration || to - from < 0.02) {
      throw new Error('El loop de Fluids necesita un rango válido dentro del show.');
    }
    this.tick();
    const position = this.time;
    this._loop = { from, to, on: !!on };
    // Re-anchor after changing loop boundaries so prior revolutions do not
    // reappear when looping is switched off.
    this.seek(this._loop.on && position >= to ? from : position);
    return this.state();
  }

  /**
   * `web` reproduce el WAV desde la salida (lo vigente); `external` lo deja en
   * manos de Ableton y devuelve el reloj local. Cambiar de modo no interrumpe
   * la secuencia en curso: sólo calla o vuelve a arrancar el track.
   */
  setAudioMode(mode) {
    const next = AUDIO_MODES.includes(mode) ? mode : 'web';
    if (next === this._audioMode) return this.state();
    this._audioMode = next;
    if (next === 'external') {
      this.tick();
      this._offset = this.time;
      this._startedAt = this._clock();
      this._audio?.pause();
    } else if (this._playing) {
      void this.armAudio().then(() => {
        if (this._playing && this._audioPlay(this.time)) this._startedAt = this._clock();
      });
    }
    return this.state();
  }

  tick() {
    // El track es el reloj maestro: cada frame vuelve a anclar el reloj local a
    // `AudioContext.currentTime`. Un frame perdido saltea el show en lugar de
    // correrlo, que es lo que hacía que imagen y música se separaran.
    if (this._audio?.playing && this._audioMode === 'web') {
      this._offset = this._audio.time;
      this._startedAt = this._clock();
    }
    if (!this._playing) return this.time;
    const raw = this._rawTime();
    if (this._loop.on && raw >= this._loop.to) {
      const span = this._loop.to - this._loop.from;
      this._offset = this._loop.from + ((raw - this._loop.to) % span);
      this._startedAt = this._clock();
      // El loop de ensayo también rebobina el track: si sólo saltara la imagen,
      // el resto de la vuelta se escucharía contra el audio equivocado.
      this._audio?.seek(this._offset);
    } else if (raw >= this.duration) {
      this._offset = this.duration;
      this._playing = false;
      this._audio?.pause();
    }
    return this.time;
  }

  setDocument(raw, baseRevision) {
    this._assertDocument();
    if (!Number.isSafeInteger(baseRevision) || baseRevision !== this._revision) {
      throw new Error(`Edición Fluids desactualizada (base ${baseRevision}; actual ${this._revision}). Recargá el documento de Output.`);
    }
    const next = freezeDocument(validateDocument(raw));
    this.tick();
    const position = this.time;
    this._doc = next;
    this._revision += 1;
    if (this._loop.to > this.duration || this._loop.from >= this.duration) {
      this._loop = { from: 0, to: this.duration, on: false };
    }
    // Normal curve edits preserve the cue anchor and the running playhead.
    if (position >= this.duration) this.seek(this.duration);
    try {
      this._storage?.setItem(SHOW_STORAGE_KEY, JSON.stringify({ version: 1, revision: this._revision, doc: this._doc }));
      this._storageError = null;
    } catch {
      this._storageError = 'La edición está activa, pero no se pudo guardar Fluids en este navegador. Exportá el documento.';
    }
    return this.state();
  }

  state() {
    return {
      loaded: !!this._doc,
      loading: !!this._loading,
      revision: this._revision,
      time: this.time,
      playing: this.playing,
      duration: this.duration,
      audioMode: this._audioMode,
      audioReady: this.audioReady,
      audioDecoded: this._waveformDecoded,
      waveformReady: !!this._peaks,
      transportReady: !!this._doc,
      loop: { ...this._loop },
      error: this._error,
      audioError: this._audioError,
      storageError: this._storageError,
      audioBlocked: this.audioBlocked,
      audioPlaying: !!this._audio?.playing,
      volume: this._volume,
    };
  }

  peaks() { return this._peaks; }

  dispose() {
    this.pause();
    this._disposed = true;
    this._referenceContext = null;
    this._audio?.dispose();
    this._audio = null;
    this._peaks = null;
  }

  /** Arranca el track si el modo lo permite y ya está decodificado. */
  _audioPlay(offsetSeconds) {
    if (this._audioMode !== 'web' || !this._audio?.ready) return false;
    return this._audio.play(offsetSeconds);
  }

  _clock() { return this._now() / 1000; }
  _rawTime() { return this._offset + (this._playing ? Math.max(0, this._clock() - this._startedAt) : 0); }
  _assertLive() { if (this._disposed) throw new Error('La sesión Fluids ya está cerrada.'); }
  _assertDocument() {
    this._assertLive();
    if (!this._doc) throw new Error('El documento Fluids todavía no está cargado.');
  }
  _assertPlayable() { this._assertDocument(); }
  _assertCueTime(seconds) { if (!finite(seconds)) throw new Error('El instante del cue de Fluids debe ser un número finito en segundos.'); }

  async _buildPeaks(buffer) {
    const count = Math.max(1, Math.ceil(buffer.duration * PEAK_RATE));
    const data = new Float32Array(count * 2);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    const step = buffer.sampleRate / PEAK_RATE;
    for (let bucket = 0; bucket < count; bucket += 1) {
      let min = 0;
      let max = 0;
      const from = Math.floor(bucket * step);
      const to = Math.min(buffer.length, Math.floor((bucket + 1) * step));
      for (const channel of channels) {
        for (let i = from; i < to; i += 1) {
          min = Math.min(min, channel[i]);
          max = Math.max(max, channel[i]);
        }
      }
      data[bucket * 2] = min;
      data[bucket * 2 + 1] = max;
      if (bucket > 0 && bucket % 1024 === 0) {
        await this._yield();
        this._assertLive();
      }
    }
    return { rate: PEAK_RATE, count, data };
  }
}

export default ShowSession;
