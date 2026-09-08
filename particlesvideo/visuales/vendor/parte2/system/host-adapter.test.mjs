import test from 'node:test';
import assert from 'node:assert/strict';
import { Parte2HostAdapter, createParte2HostAdapter, createParte2ViteProxy } from './host-adapter.js';

// Deliberately matches Parte 1's existing onChange(id,fn)/onAction(id,fn),
// including their void return and private listener arrays.
class LegacyHostParams {
  constructor() { this.defs = new Map(); this.actions = new Map(); this._changeListeners = new Map(); this._actionListeners = new Map(); this._dirty = new Set(); }
  define(spec) { this.defs.set(spec.id, { ...spec, value: spec.default }); }
  defineAction(spec) { this.actions.set(spec.id, { ...spec }); }
  has(id) { return this.defs.has(id); }
  hasAction(id) { return this.actions.has(id); }
  get(id) { return this.defs.get(id)?.value; }
  onChange(id, fn) { if (!this._changeListeners.has(id)) this._changeListeners.set(id, []); this._changeListeners.get(id).push(fn); }
  onAction(id, fn) { if (!this._actionListeners.has(id)) this._actionListeners.set(id, []); this._actionListeners.get(id).push(fn); }
  set(id, value) { const spec = this.defs.get(id); if (!spec) throw new Error(`Unknown ${id}`); if (spec.value === value) return; spec.value = value; this._dirty.add(id); for (const fn of this._changeListeners.get(id) ?? []) fn(value, id); }
  trigger(id, value) { for (const fn of this._actionListeners.get(id) ?? []) fn(value); }
}
function fakeSystem() {
  const values = new Map([['scene.current', 69], ['final.fx2', 0], ['transport.playing', true], ['transport.rate', 60]]);
  const listeners = new Map(), actions = new Set();
  const system = { engine: { device: {} }, canvas: {}, output: { texture: {}, view: {}, width: 3840, height: 1200 },
    frames: [], messages: [], triggered: [], disposed: 0,
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type)?.delete(fn); },
    emit(type, payload) { for (const fn of listeners.get(type) ?? []) fn(payload); },
    render(steps, dt) { this.frames.push({ steps, dt }); },
    dispatchMidi(msg) { this.messages.push(msg); return ['mapped']; },
    dispose() { this.disposed++; },
  };
  system.params = {
    list: () => [
      ...[...values].map(([id, value]) => ({ id, type: typeof value === 'boolean' ? 'bool' : 'float', default: value, min: 0, max: 127, group: 'Test' })),
      { id: 'scene.goto', type: 'action', isAction: true },
    ],
    get: (id) => values.get(id),
    set: (id, value) => { if (values.get(id) === value) return; values.set(id, value); system.emit('values', { [id]: value }); },
    onAction: (fn) => { actions.add(fn); return () => actions.delete(fn); },
    trigger: (id, value) => {
      system.triggered.push({ id, value });
      if (id === 'scene.goto') system.params.set('scene.current', Number(value));
      for (const fn of actions) fn(id, value);
    },
  };
  return system;
}

test('namespaced registry preserves Parte 1 scenes, syncs both directions and forwards actions once', () => {
  const host = { params: new LegacyHostParams() }, system = fakeSystem();
  host.params.define({ id: 'scene.current', default: 25 });
  host.params.defineAction({ id: 'scene.goto' });
  let originalSceneActions = 0;
  host.params.onAction('scene.goto', () => originalSceneActions++);
  const adapter = new Parte2HostAdapter(host, system);
  assert.equal(host.params.get('scene.current'), 25);
  assert.equal(host.params.get('parte2.scene.current'), 69);
  assert.equal(host.params.defs.get('parte2.scene.current').sceneReset, false);
  host.params.set('parte2.final.fx2', 0.6);
  assert.equal(system.params.get('final.fx2'), 0.6);
  system.params.set('final.fx2', 0.2);
  assert.equal(host.params.get('parte2.final.fx2'), 0.2);
  host.params.trigger('parte2.scene.goto', 70);
  assert.equal(system.triggered.length, 1);
  assert.equal(host.params.get('parte2.scene.current'), 70); // Derived action update also syncs.
  system.params.trigger('scene.goto', 66);
  assert.equal(system.triggered.length, 2); // Echo must not retrigger it.
  assert.equal(host.params.get('parte2.scene.current'), 66);
  assert.equal(originalSceneActions, 0);
  assert.equal(host.params.get('scene.current'), 25);
  assert.throws(() => adapter.trigger('scene.goto', 24));
  assert.throws(() => adapter.set('scene.current', 24));
  adapter.dispose();
});

test('preflight rejects any collision before adding params; dispose removes only adapter listeners/defs', () => {
  const host = { params: new LegacyHostParams() }, system = fakeSystem();
  host.params.define({ id: 'scene.current', default: 24 });
  const originalListener = () => {};
  host.params.onChange('scene.current', originalListener);
  host.params.define({ id: 'parte2.transport.rate', default: 30 });
  const size = host.params.defs.size;
  assert.throws(() => new Parte2HostAdapter(host, system), /ya contiene/);
  assert.equal(host.params.defs.size, size);
  host.params.defs.delete('parte2.transport.rate');
  const adapter = new Parte2HostAdapter(host, system);
  adapter.dispose(); adapter.dispose();
  assert.deepEqual([...host.params.defs.keys()], ['scene.current']);
  assert.equal(host.params._changeListeners.get('scene.current')[0], originalListener);
  assert.equal(host.params._changeListeners.has('parte2.scene.current'), false);
  assert.equal(host.params._actionListeners.has('parte2.scene.goto'), false);
  system.params.set('scene.current', 80); // No stale host callback after unmount.
  assert.equal(host.params.get('scene.current'), 24);
  assert.equal(system.disposed, 0); // The caller owns the supplied system.
});

test('host owns the tick; paused output renders without advancing, and texture requires identical GPUDevice', () => {
  const host = { params: new LegacyHostParams() }, system = fakeSystem();
  const adapter = new Parte2HostAdapter(host, system);
  adapter.render(1 / 120); adapter.render(1 / 120);
  assert.deepEqual(system.frames.map((f) => f.steps), [0, 1]);
  system.params.set('transport.playing', false);
  adapter.render(0.2);
  assert.equal(system.frames.at(-1).steps, 0);
  assert.equal(adapter.getTextureFor(system.engine.device).texture, system.output.texture);
  assert.throws(() => adapter.getTextureFor({}), /mismo GPUDevice/);
  assert.throws(() => adapter.render(-1));
  const msg = { kind: 'note', channel: 10, note: 70, velocity: 100, on: true };
  assert.deepEqual(adapter.dispatch(msg), ['mapped']);
  assert.equal(system.messages[0], msg);
  adapter.dispose();
  assert.throws(() => adapter.render(0));
});

test('factory forces hosted/no autonomous IO options, injects GPU device, disposes only owned systems', async () => {
  const host = { params: new LegacyHostParams() }, system = fakeSystem();
  let options;
  const adapter = await createParte2HostAdapter(host, { canvas: {}, device: system.engine.device,
    systemOptions: { autoStart: true, hosted: false },
    createSystem: async (_canvas, config) => { options = config; return system; } });
  assert.equal(options.hosted, true);
  assert.equal(options.autoStart, false);
  assert.equal(options.connectOSC, false);
  assert.equal(options.bridge, false);
  assert.equal(options.connectMidi, false);
  assert.equal(options.gpu.device, system.engine.device);
  adapter.dispose();
  assert.equal(system.disposed, 1);
});

test('Vite proxy forwards Parte 2 assets/API while preserving unrelated Parte 1 APIs', () => {
  const proxy = createParte2ViteProxy();
  const accepted = (path) => Object.keys(proxy).some((pattern) => new RegExp(pattern).test(path));
  for (const path of ['/api/catalog', '/api/catalog?refresh=1', '/api/media/remap', '/api/osc/events', '/media/clip-00/1.dds', '/ink/000060.dds', '/assets/part2-overlay.png']) assert.equal(accepted(path), true, path);
  for (const path of ['/api/scenes', '/api/catalogue', '/api/media/anything', '/assets/logo.png', '/scene/25', '/vis-bus']) assert.equal(accepted(path), false, path);
  assert.ok(Object.values(proxy).every((entry) => entry.target === 'http://127.0.0.1:8787'));
  assert.throws(() => createParte2ViteProxy('file:///tmp'));
});
