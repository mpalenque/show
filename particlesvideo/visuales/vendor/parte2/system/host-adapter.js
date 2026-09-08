/** Explicit future Parte 1 integration. This module has no DOM/GPU/network side effects on import. */
export const HOST_NAMESPACE = 'parte2';
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function subscribeHost(params, kind, id, callback) {
  const off = params[kind === 'change' ? 'onChange' : 'onAction'](id, callback);
  if (typeof off === 'function') return off;
  // Parte 1's current Params API returns void. Remove only our own callback;
  // do not replace methods, clear a host listener collection or destroy Params.
  const mapName = kind === 'change' ? '_changeListeners' : '_actionListeners';
  return () => {
    const listeners = params[mapName]?.get(id);
    if (Array.isArray(listeners)) {
      const index = listeners.indexOf(callback);
      if (index >= 0) listeners.splice(index, 1);
      if (!listeners.length) params[mapName].delete(id);
    } else if (listeners?.delete) {
      listeners.delete(callback);
      if (!listeners.size) params[mapName].delete(id);
    }
  };
}

/** Construct around a system created with hosted:true and autoStart:false. */
export class Parte2HostAdapter {
  constructor(host, system, { namespace = HOST_NAMESPACE, ownsSystem = false,
    unregisterOnDispose = true, maxSteps = 4, device = null, reuseRegistered = false, onHostAction = null } = {}) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(namespace)) throw new TypeError('El namespace debe ser un identificador no vacío.');
    const params = host?.params;
    if (!params?.define || !params.defineAction || !params.onChange || !params.onAction || !params.set || !params.trigger) {
      throw new TypeError('El host debe exponer la API Params de Parte 1.');
    }
    if (!system?.params?.list || !system.params.onAction || !system.on || !system.render || !system.dispatchMidi) {
      throw new TypeError('Se requiere una instancia Parte2System.');
    }
    if (device && system.engine?.device !== device) throw new Error('Parte 2 no está usando el GPUDevice solicitado por el host.');
    if (system.raf) throw new Error('La instancia integrada debe crearse con autoStart:false; el host es dueño del frame loop.');
    Object.assign(this, { host, system, namespace, ownsSystem, unregisterOnDispose });
    this.maxSteps = Math.max(1, Math.floor(maxSteps));
    this.disposed = false;
    this.depth = 0;
    this.accumulator = 0;
    this.unsubscribers = [];
    this.ownedDefinitions = new Map();
    this.ownedActions = new Map();
    this.registry = system.params.list().map((spec) => ({ ...copy(spec), id: this.path(spec.id),
      group: `Parte 2 / ${spec.group || 'Sistema'}`, sceneReset: false }));
    // Preflight every collision before registering anything in a running host.
    for (const spec of this.registry) {
      const existing = params.defs?.get(spec.id) || params.actions?.get(spec.id);
      if (reuseRegistered && existing && (spec.isAction ? existing.isAction : existing.type === spec.type)) continue;
      if (params.has?.(spec.id) || params.hasAction?.(spec.id) || params.defs?.has(spec.id) || params.actions?.has(spec.id)) {
        throw new Error(`Registro Parte 1 ya contiene ${spec.id}; no se sobrescribe.`);
      }
    }
    try {
      for (const spec of this.registry) {
        const localId = this.localPath(spec.id);
        if (spec.isAction || spec.type === 'action') {
          if (!reuseRegistered || !params.hasAction(spec.id)) params.defineAction(spec);
          this.ownedActions.set(spec.id, params.actions?.get(spec.id));
          this.unsubscribers.push(subscribeHost(params, 'action', spec.id, (value) => {
            if (this.disposed || this.depth) return;
            if (onHostAction?.(localId, value)) return;
            this._guard(() => system.params.trigger(localId, value, { origin: 'parte1-host' }));
          }));
        } else {
          if (!reuseRegistered || !params.has(spec.id)) params.define({ ...spec, default: copy(system.params.get(localId)), smooth: 0 });
          else params.set(spec.id, copy(system.params.get(localId)), { immediate: true });
          this.ownedDefinitions.set(spec.id, params.defs?.get(spec.id));
          this.unsubscribers.push(subscribeHost(params, 'change', spec.id, (value) => {
            if (this.disposed || this.depth) return;
            this._guard(() => system.params.set(localId, value, { origin: 'parte1-host' }));
          }));
        }
      }
      this.unsubscribers.push(system.on('values', (values) => {
        if (this.disposed) return;
        this._guard(() => {
          for (const [id, value] of Object.entries(values)) {
            const target = this.path(id);
            if (this.ownedDefinitions.has(target)) params.set(target, value, { immediate: true });
          }
        });
      }));
      this.unsubscribers.push(system.params.onAction((id, value) => {
        if (this.disposed || this.depth) return;
        const target = this.path(id);
        if (this.ownedActions.has(target)) this._guard(() => params.trigger(target, value));
      }));
    } catch (error) {
      this.dispose({ destroySystem: false });
      throw error;
    }
  }
  path(id) { return `${this.namespace}.${id}`; }
  localPath(id) {
    const prefix = `${this.namespace}.`;
    if (!id.startsWith(prefix)) throw new Error(`El path ${id} no pertenece a ${this.namespace}.`);
    return id.slice(prefix.length);
  }
  _guard(callback) { this.depth++; try { return callback(); } finally { this.depth--; } }
  _check() { if (this.disposed) throw new Error('El adaptador Parte 2 ya fue destruido.'); }
  get(path) { this._check(); return this.system.params.get(this.localPath(path)); }
  set(path, value) { this._check(); this.localPath(path); this.host.params.set(path, value, { immediate: true }); }
  trigger(path, value) {
    this._check(); this.localPath(path); // Refuse accidental unprefixed scene.goto.
    this.host.params.trigger(path, value);
  }
  dispatch(message) {
    this._check();
    // The host calls this only for the active part; never install a second MIDI listener.
    return this.system.dispatchMidi(message);
  }
  /** Host tick in seconds. Preserves each effect's configured fixed simulation rate. */
  render(dt = 1 / 60) {
    this._check();
    if (!Number.isFinite(dt) || dt < 0) throw new TypeError('dt debe ser un número de segundos no negativo.');
    const rate = Number(this.system.params.get('transport.rate')) || 60;
    const step = 1 / rate;
    if (this.system.params.get('transport.playing')) this.accumulator += Math.min(dt, 0.25);
    else this.accumulator = 0;
    const steps = Math.min(this.maxSteps, Math.floor((this.accumulator + 1e-8) / step));
    this.accumulator = Math.max(0, this.accumulator - steps * step);
    if (this.accumulator > 0.25) this.accumulator = 0;
    this.system.render(steps, step);
    return this.outputTexture;
  }
  get outputTexture() {
    this._check();
    const output = this.system.output;
    return { texture: output?.texture ?? null, view: output?.view ?? null,
      device: this.system.engine?.device ?? null, width: output?.width ?? this.system.width,
      height: output?.height ?? this.system.height, format: output?.format ?? 'rgba8unorm',
      canvas: this.system.canvas };
  }
  getTextureFor(device) {
    const output = this.outputTexture;
    if (!device || device !== output.device) throw new Error('Un GPUTexture sólo puede usarse con el mismo GPUDevice que lo creó.');
    return output;
  }
  dispose({ destroySystem = this.ownsSystem } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribers.splice(0).reverse()) if (typeof off === 'function') off();
    if (this.unregisterOnDispose) {
      const params = this.host.params;
      for (const [id, definition] of this.ownedDefinitions) {
        if (params.defs?.get(id) === definition) params.defs.delete(id);
        params._dirty?.delete(id);
      }
      for (const [id, definition] of this.ownedActions) if (params.actions?.get(id) === definition) params.actions.delete(id);
    }
    this.ownedDefinitions.clear(); this.ownedActions.clear();
    this.accumulator = 0;
    if (destroySystem) this.system.dispose();
  }
}

export async function createParte2HostAdapter(host, { canvas, system, namespace, systemOptions = {},
  device = null, adapter = null, createSystem, ...options } = {}) {
  let instance = system;
  const ownsSystem = !instance;
  if (!instance) {
    if (!canvas) throw new Error('Se necesita un canvas propio para la salida Parte 2.');
    const factory = createSystem ?? (async (target, config) => {
      const { Parte2System } = await import('./controller.js');
      return Parte2System.create(target, config);
    });
    instance = await factory(canvas, { ...systemOptions, hosted: true, autoStart: false,
      connectOSC: false, bridge: false, connectMidi: false,
      ...((device || adapter) ? { gpu: { device, adapter } } : {}) });
  }
  try { return new Parte2HostAdapter(host, instance, { ...options, namespace, ownsSystem, device }); }
  catch (error) { if (ownsSystem) instance.dispose(); throw error; }
}

/** Merge these precise routes into Vite server.proxy; do not proxy all of /api. */
export function createParte2ViteProxy(target = 'http://127.0.0.1:8787') {
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('El proxy necesita un target HTTP(S).');
  const config = { target: url.origin, changeOrigin: true };
  return Object.fromEntries([
    '^/api/catalog(?:\\?|$)', '^/api/media/remap(?:\\?|$)', '^/api/osc/',
    '^/media/', '^/ink/', '^/assets/part2-overlay\\.png(?:\\?|$)',
  ].map((path) => [path, { ...config }]));
}
