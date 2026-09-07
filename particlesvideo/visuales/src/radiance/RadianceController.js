import { ShowSession, AUDIO_MODES } from './ShowSession.js';
import { PreviewCapture } from './PreviewCapture.js';

// 24 previa, 25 la secuencia escrita, 26 el motor libre que Manuel toca por
// MIDI. Las tres son del mismo runtime: entrar en cualquiera de ellas le quita
// el frame a Parte 1.
const FLUID_MODES = { 24: 'standby', 25: 'timeline', 26: 'live' };
// El rango de la emisión no llega a 1 a propósito. La luz del motor libre se
// reparte entre todas las partículas: con unos pocos miles la imagen se apaga
// sola, y el tramo que sirve está debajo de 0,05. Con 0..1 un CC de 128 pasos
// dejaba cuatro escalones útiles; con 0..0,25 el recorrido entero del fader cae
// dentro de lo que se ve.
const LIVE = {
  emission: [0, .25, .018, 'Emisión'], x: [0, 1, .5, 'Emisor X'], y: [0, 1, .5, 'Emisor Y'],
  hue: [0, 1, 0, 'Color del emisor'], gravity: [-1, 1, 0, 'Gravedad'],
  viscosity: [0, 1, .5, 'Viscosidad'], cohesion: [0, 1, .5, 'Cohesión'],
  light: [0, 3, 1, 'Luz'], forceX: [-1, 1, 0, 'Fuerza X'], forceY: [-1, 1, 0, 'Fuerza Y'],
};

// Un único propietario de render, transporte y documento. El editor sólo envía órdenes.
export class RadianceController {
  static defineParams(params) {
    // El WAV sale de la página: mandándolo por Ableton los dos relojes se
    // separaban. `external` queda para ensayar con la música por Ableton.
    params.define({ id: 'fluids.audioMode', type: 'enum', options: AUDIO_MODES, default: 'web',
      label: 'Audio del show (web = desde la página)', group: 'fluids', sceneReset: false });
    params.define({ id: 'fluids.volume', type: 'float', min: 0, max: 1, default: 1,
      label: 'Volumen del track', group: 'fluids', sceneReset: false });
    // Ganancia de luz y supersampling son ajustes de máquina y de pared, no del
    // show: no los resetea el cambio de escena y sobreviven la recarga.
    // 1 es el show tal como está escrito en el documento. Arranca en 1,25
    // porque Manuel lo vio apagado en la pared: medido a mitad de secuencia,
    // ese cuarto de ganancia lleva el brillo medio de 38 a 58 y la mitad
    // iluminada del cuadro de 37 % a 62 %, sin mover los picos (p99 244→242),
    // así que sube la penumbra sin quemar lo que ya llegaba a blanco.
    params.define({ id: 'fluids.gain', type: 'float', min: 0.4, max: 2.5, default: 1.25,
      label: 'Ganancia de luz · Fluids', group: 'fluids', sceneReset: false });
    params.define({ id: 'fluids.supersample', type: 'float', min: 1, max: 2, default: 2,
      label: 'Supersampling (2 = sin rayado)', group: 'fluids', sceneReset: false });
    for (const [key, [min, max, value, label]] of Object.entries(LIVE)) {
      params.define({ id: `fluids.live.${key}`, type: 'float', min, max, default: value,
        label: `${label} · Fluids live (escena 26)`, group: 'fluids.live', sceneReset: true });
    }
    for (const [id, label, argHint] of [
      ['arm', 'Preparar motor Fluids'], ['standby', 'Previa · escena 24'],
      ['play', 'Play · escena 25'], ['pause', 'Pausa · escena 25'],
      ['restart', 'Reiniciar · escena 25'], ['seek', 'Buscar · escena 25', 'segundos'],
      ['live', 'Fluids live · escena 26'],
      ['live.burst', 'Ráfaga · escena 26', 'cantidad de partículas'],
      ['live.attractor', 'Atractor · escena 26'], ['live.reset', 'Reiniciar fluido · escena 26'],
    ]) params.defineAction({ id: `fluids.${id}`, label, argHint, group: id.startsWith('live.') ? 'fluids.live' : 'fluids' });
  }

  constructor(ctx, view) {
    this.ctx = ctx;
    this.ownerId = crypto.randomUUID();
    this.params = ctx.params;
    this.session = new ShowSession();
    this.runtime = null;
    this.active = false;
    this.mode = null;
    this.pending = null;
    this.status = 'preparing';
    this.error = null;
    this._generation = 0;
    this._queue = Promise.resolve();
    this._lastState = 0;
    this._lastPreview = 0;
    this._previewRequested = false;
    this._preview = new PreviewCapture({
      onFrame: blob => {
        if (this._previewReadyResolve) { this._previewReadyResolve(); this._previewReadyResolve = null; return; }
        const reader = new FileReader();
        reader.onloadend = () => this.post({ t: 'fluids:preview', url: reader.result });
        reader.readAsDataURL(blob);
      },
      onError: error => {
        this._previewReadyResolve?.(); this._previewReadyResolve = null;
        this.post({ t: 'fluids:error', error: `Vista previa: ${error.message}` });
      },
    });
    this._live = {};
    this.host = document.createElement('div');
    this.host.id = 'radiance-stage';
    Object.assign(this.host.style, { position: 'absolute', left: '0', top: '0', width: '2688px',
      height: '1008px', transformOrigin: 'top left', background: '#000', visibility: 'hidden', pointerEvents: 'none' });
    document.getElementById('stage').appendChild(this.host);
    this._fit = () => {
      const canvas = ctx.renderer.domElement;
      const width = parseFloat(canvas.style.width) || 2688;
      this.host.style.transform = `scale(${width / 2688})`;
    };
    this._fit();
    window.addEventListener('resize', this._fit);
    const toggle = view.toggleNative;
    view.toggleNative = () => { const mode = toggle(); this._fit(); return mode; };
    this._sizeObserver = new MutationObserver(this._fit);
    this._sizeObserver.observe(ctx.renderer.domElement, { attributes: true, attributeFilter: ['style'] });
    this._makeStatusPanel();
    this._watchAudioSettings();
    for (const name of ['arm', 'standby', 'play', 'pause', 'restart', 'seek', 'live']) {
      this.params.onAction(`fluids.${name}`, value => { void this.command(name, value); });
    }
    for (const name of ['burst', 'attractor', 'reset']) {
      this.params.onAction(`fluids.live.${name}`, value => {
        if (!this.active || this.mode !== 'live') return;
        const payload = typeof value === 'object' && value ? value :
          name === 'burst' ? { count: Number.isFinite(Number(value)) ? Number(value) : 180 } : {};
        this.runtime.liveAction(name, { x: this.params.get('fluids.live.x'), y: this.params.get('fluids.live.y'), ...payload });
      });
    }
  }

  prepare() {
    if (this._preparing) return this._preparing;
    this.status = 'preparing';
    this._preparing = (async () => {
      const { FluidRuntime } = await import('../../vendor/radiance/src/integration/FluidRuntime.ts');
      this.session.setAudioMode(this.params.get('fluids.audioMode'));
      this.session.setVolume(this.params.get('fluids.volume'));
      await this.session.load().catch(error => { if (!this.session.doc) throw error; });
      if (!this.runtime) {
        this.runtime = new FluidRuntime({ supersample: this.params.get('fluids.supersample') });
        try { await this.runtime.init(this.host); }
        catch (error) { this.runtime.dispose(); this.runtime = null; throw error; }
      }
      this.runtime.setDocument(this.session.doc);
      this.runtime.suspend(true);
      // El primer bitmap/encoder también se prepara antes del show.
      const previewReady = new Promise(resolve => { this._previewReadyResolve = resolve; });
      if (this._preview.capture(this.runtime.canvas)) await previewReady;
      else this._previewReadyResolve = null;
      this.status = 'ready';
      this.error = null;
      this._refreshPanel();
      this.publishDocument();
      return this.runtime;
    })().catch(error => { this._preparing = null; this._fail(error); throw error; });
    return this._preparing;
  }

  // Intercepta goto antes de cambiar presets. Una preparación tardía nunca cambia la escena.
  requestScene(id, options = {}) {
    if (options.radianceReady) return false;
    if (!FLUID_MODES[id]) {
      this._generation++;
      this.pending = null;
      this._switching = false;
      this.session.pause();
      this.runtime?.suspend(true);
      this.active = false;
      this.mode = null;
      this.host.style.visibility = 'hidden';
      this.ctx.renderer.domElement.style.visibility = 'visible';
      if (this.runtime) this.status = 'suspended';
      this._refreshPanel();
      return false;
    }
    if (!options.force && (this.pending?.id === id || (this.active && this.ctx.scenes.current === id))) return true;
    const token = ++this._generation;
    this.pending = { id, options, token, cueTime: performance.now() / 1000 };
    // Cortar la escena anterior al recibir el cue, incluso si aún se está cargando Fluids.
    this.session.pause();
    this._switching = true;
    this._showOnFrame = false;
    this.host.style.visibility = 'hidden';
    this.ctx.renderer.domElement.style.visibility = 'hidden';
    this._resumePending();
    return true;
  }

  _resumePending() {
    const request = this.pending;
    if (!request || request.scheduled) return;
    request.scheduled = true;
    this._queue = this._queue.catch(() => {}).then(async () => {
      const { id, token, options, cueTime } = request;
      await this.prepare();
      if (token !== this._generation) return;
      // Dejar cerrar el frame anterior antes de entregar el canvas al otro renderer.
      this._switching = true;
      await this.ctx.engine?.whenIdle();
      if (token !== this._generation) return;
      this.session.pause();
      this.host.style.visibility = 'hidden';
      this.ctx.renderer.domElement.style.visibility = 'hidden';
      const mode = FLUID_MODES[id];
      if (mode === 'standby') await this.runtime.enterStandby(this.session.doc);
      else if (mode === 'live') await this.runtime.enterLive();
      else if (!this.runtime.startTimeline()) await this.runtime.enterTimeline(this.session.doc);
      if (token !== this._generation) { this.runtime.suspend(true); return; }
      this.active = true;
      this.mode = mode;
      this.pending = null;
      this.status = 'active';
      this.error = null;
      this.ctx.scenes.goto(id, { ...options, radianceReady: true, transition: 0 });
      this.runtime.suspend(false);
      // Un loop usado para editar no debe repetirse contra la secuencia completa.
      this.session.setLoop(null);
      if (mode === 'timeline') this.session.restart(cueTime);
      else this.session.seek(0);
      this._switching = false;
      this._showOnFrame = true;
      this._refreshPanel();
    }).catch(error => {
      this._switching = false;
      if (request.token === this._generation) {
        this.pending = null;
        this.active = false;
        this.runtime?.suspend(true);
        this.host.style.visibility = 'hidden';
        this.ctx.renderer.domElement.style.visibility = 'visible';
        this._fail(error);
      }
    });
  }

  get ownsFrame() { return this.active || this._switching; }

  frame(now, dt) {
    if (!this.active || this._switching) return;
    this.session.tick();
    for (const key of Object.keys(LIVE)) this._live[key] = this.params.get(`fluids.live.${key}`);
    // Al terminar la secuencia el fluido SIGUE corriendo con el último estado de
    // las curvas: la imagen final se quedaba clavada y en el show tiene que
    // seguir viva hasta la próxima nota. Sólo se detiene el reloj del timeline.
    this.runtime.frame({ now: now / 1000, dt, time: this.session.time,
      playing: this.mode === 'timeline' && this.session.playing, live: this._live,
      gain: this.params.get('fluids.gain'), frozen: false });
    const brightness = this.params.get('master.blackout') ? 0 : this.params.get('master.brightness');
    this.host.style.opacity = String(brightness);
    if (this._showOnFrame) { this.host.style.visibility = 'visible'; this._showOnFrame = false; }
    if (this._previewRequested && now - this._lastPreview >= 500) this._capturePreview(now);
  }

  async command(command, value) {
    try {
      if (command === 'arm') {
        await this.prepare();
        this.error = null;
        this._refreshPanel();
        this._resumePending();
      } else if (command === 'scene') this.ctx.scenes.goto(String(value));
      else if (command === 'standby') this.ctx.scenes.goto('24');
      else if (command === 'live') this.ctx.scenes.goto('26');
      else if (command === 'play' && (!this.active || this.mode !== 'timeline')) this.ctx.scenes.goto('25');
      else if (command === 'restart' || command === 'reset') this.requestScene('25', { force: true });
      else if (command === 'audio-mode') this.params.set('fluids.audioMode', value);
      else if (command === 'volume') this.params.set('fluids.volume', Number(value));
      else if (command === 'master') this.params.set('master.brightness', value);
      else if (command === 'blackout') this.params.set('master.blackout', value);
      else if (command === 'loop') this.session.setLoop(value ? { ...value, on: true } : null);
      else if (this.active && this.mode === 'timeline') {
        if (command === 'play') this.session.play();
        else if (command === 'pause') this.session.pause();
        else if (command === 'seek') this.session.seek(Number(value));
        else if (command === 'gesture') this.runtime.setGesture(value);
      }
      this.publishState();
    } catch (error) { this._fail(error); }
  }

  async receive(message) {
    try {
      if (message.t === 'fluids:hello') {
        await this.prepare();
        this.publishDocument();
        this.publishState();
        const peaks = this.session.peaks();
        if (peaks) this.post({ t: 'fluids:peaks', peaks });
      } else if (message.t === 'fluids:command') await this.command(message.command, message.value);
      else if (message.t === 'fluids:preview-request') this._previewRequested = true;
      else if (message.t === 'fluids:document') {
        try {
          if (message.ownerId && message.ownerId !== this.ownerId) throw new Error('La salida se reinició. Recargá su documento antes de guardar.');
          this.session.setDocument(message.doc, message.baseRevision);
          this.runtime?.setDocument(this.session.doc);
          this.publishDocument({ clientId: message.clientId, editId: message.editId });
        } catch (error) {
          this.publishDocument({ clientId: message.clientId, editId: message.editId, rejected: true, error: String(error.message ?? error) });
        }
      }
    } catch (error) { this._fail(error); }
  }

  state() {
    return { ...this.session.state(), ownerId: this.ownerId, status: this.status, error: this.error,
      scene: this.ctx.scenes.current, pendingScene: this.pending?.id ?? null, mode: this.mode,
      master: this.params.get('master.brightness'), blackout: this.params.get('master.blackout'),
      stats: this.runtime ? { ...this.runtime.telemetry(), fps: this.ctx.engine?.fps ?? 0 } : null,
      preview: this._preview.stats() };
  }
  post(message) { this.ctx.bridge?.post(message); }
  publishState() { this.post({ t: 'fluids:state', state: this.state() }); }
  publishDocument(extra = {}) {
    if (this.session.doc) this.post({ t: 'fluids:document', ownerId: this.ownerId, doc: this.session.doc, revision: this.session.revision, ...extra });
  }
  tick(now) {
    if (now - this._lastState < 100) return;
    this._lastState = now;
    this._refreshPanel();
    this.publishState();
  }

  _capturePreview(now) {
    this._lastPreview = now;
    this._previewRequested = false;
    const source = this.host.querySelector('canvas');
    if (source) this._preview.capture(source);
  }

  /**
   * Chrome no deja sonar nada hasta que hubo un gesto en la ventana. El primer
   * clic o tecla de la salida reanuda el contexto; hasta entonces el panel lo
   * avisa, porque un show mudo sin explicación arriba del escenario no sirve.
   */
  _watchAudioSettings() {
    this.params.onChange('fluids.audioMode', mode => {
      this.session.setAudioMode(mode);
      if (mode === 'web') void this.session.armAudio().then(() => this._refreshPanel());
      this._refreshPanel();
      this.publishState();
    });
    this.params.onChange('fluids.volume', volume => { this.session.setVolume(volume); });
    this.params.onChange('fluids.supersample', scale => {
      this.runtime?.resize(2688, 1008, scale);
    });
    const unlock = () => {
      void this.session.armAudio().then(() => { this._refreshPanel(); this.publishState(); });
    };
    for (const event of ['pointerdown', 'keydown']) {
      window.addEventListener(event, unlock, { capture: true });
    }
  }

  _makeStatusPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'fluids-status';
    Object.assign(this.panel.style, { position: 'fixed', right: '12px', top: '12px', zIndex: '30',
      background: '#15191feF', color: '#eee', padding: '12px', font: '13px system-ui', borderRadius: '5px', maxWidth: '330px' });
    this.panelText = document.createElement('div');
    this.panel.append(this.panelText);
    document.body.appendChild(this.panel);
    this._refreshPanel();
  }

  _refreshPanel() {
    const aviso = this.error
      || (this.session.audioBlocked ? 'Fluids: hacé un clic en esta ventana para habilitar el audio del show.' : '');
    this.panel.hidden = !aviso;
    this.panelText.textContent = aviso;
  }
  _fail(error) {
    this.error = error?.message ?? String(error);
    this.status = 'error';
    console.error('[vis] Fluids:', error);
    this._refreshPanel();
    this.publishState();
  }
}
