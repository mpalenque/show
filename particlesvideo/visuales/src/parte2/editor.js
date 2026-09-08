import { createSystemParameters } from '../../vendor/parte2/system/registry.js';
import { mountSystemUI } from '../../vendor/parte2/system/ui.js';

// Remote control only: no GPUDevice, Web MIDI access, audio or animation loop.
const channel = new BroadcastChannel('vis-bus');
const events = new Map(), pending = new Map();
const emit = (type, data) => { for (const fn of events.get(type) || []) fn(data); };
const on = (type, fn) => {
  if (!events.has(type)) events.set(type, new Set());
  events.get(type).add(fn); return () => events.get(type)?.delete(fn);
};
function call(method, ...args) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('La salida no respondió.')); }, 20000);
    pending.set(requestId, { resolve, reject, timer });
    channel.postMessage({ t: 'parte2:call', requestId, method, args });
  });
}
const send = (method, ...args) => { void call(method, ...args).catch(error => emit('warning', error.message)); };
const params = createSystemParameters();
const localSet = params.set.bind(params);
let applying = false, ready = false, ui, mappings = [], devices = [];
let editorVisible = true;
params.set = (id, value, meta) => {
  localSet(id, value, meta);
  if (!applying) send('set', id, params.get(id));
};
params.trigger = (id, arg) => send('trigger', id, arg);
const system = {
  params, on, stats: {}, manifest: { clips: [] }, sceneSnapshots: {}, controlMode: 'show',
  mapper: {
    list: () => structuredClone(mappings), on,
    setMappings: rows => send('setMappings', rows),
    learn: id => send('learn', id), learnTarget: (...args) => send('learnTarget', ...args),
    cancelLearn: () => send('cancelLearn'), resetToDefault: () => send('resetMappings'),
    exportJson: () => JSON.stringify({ version: 3, profile: 'parte2', mappings }, null, 2),
    importJson: text => { const document = JSON.parse(text); return call('setMappings', Array.isArray(document) ? document : document.mappings); },
  },
  midi: {
    listInputs: () => devices, setEnabled: ids => send('setEnabled', ids),
    status: () => ({ state: devices.some(d => d.listening) ? 'listening' : devices.length ? 'disabled' : 'missing',
      selectedNames: devices.filter(d => d.enabled).map(d => d.name), preferredName: 'Entradas del show principal', received: system.received || 0 }),
  },
  reset: () => call('reset'), capture: () => call('capture'),
  openOutput: () => { const output = window.open('./', 'vis-salida'); output?.focus(); return output; },
  runLook: name => call('runLook', name), connectMidi: () => call('connectMidi'),
  useVvvvMidi: () => call('useVvvvMidi'), connectOSC: () => call('connectOSC'), configureOSC: port => call('configureOSC', port),
  dispatchMidi: msg => send('dispatchMidi', msg), remapMedia: body => call('remapMedia', body),
  saveScene: scene => send('saveScene', scene), recallScene: scene => send('recallScene', scene),
  exportSession: () => ({ version: 1, system: 'parte2', displayProfile: system.displayProfile,
    parameters: params.snapshot({ persistent: true }), mappings: structuredClone(mappings), scenes: structuredClone(system.sceneSnapshots) }),
  importSession: data => call('importSession', data),
};
window.parte2Editor = system;
function receiveState(state) {
  applying = true;
  try { if (state.values) params.apply(state.values, { remote: true }); }
  finally { applying = false; }
  devices = state.midiInputs || devices;
  system.stats = state.stats || system.stats; system.controlMode = state.controlMode || system.controlMode;
  if (state.manifest) system.manifest = state.manifest;
  if (state.session) {
    mappings = state.session.mappings; system.sceneSnapshots = state.session.scenes;
    system.displayProfile = state.session.displayProfile;
  }
  if (!ready && state.registry) {
    ready = true; ui = mountSystemUI(system);
    document.getElementById('system-loading').hidden = true;
  }
  if (ready) {
    emit('stats', system.stats); emit('devices', devices); emit('control-mode', system.controlMode); emit('osc', state.osc);
    if (!state.active) document.getElementById('system-status').textContent = `Parte 2 en espera · salida en escena ${state.currentScene || '—'}`;
    if (state.error) emit('error', { message: state.error, fatal: true });
  }
}
channel.onmessage = async ({ data: m }) => {
  if (m.t === 'hello') channel.postMessage({ t: 'parte2:hi' });
  else if (m.t === 'parte2:hello' || m.t === 'parte2:state') receiveState(m.state);
  else if (m.t === 'parte2:reply') {
    const request = pending.get(m.requestId); if (!request) return;
    clearTimeout(request.timer); pending.delete(m.requestId);
    if (m.error) request.reject(new Error(m.error)); else request.resolve(m.result);
  } else if (m.t === 'parte2:event') {
    if (m.type === 'mappings') mappings = m.data;
    if (m.type === 'catalog') system.manifest = m.data;
    if (m.type === 'scenes') system.sceneSnapshots = m.data;
    if (m.type === 'session') { system.sceneSnapshots = m.data.scenes; mappings = m.data.mappings; system.displayProfile = m.data.displayProfile; }
    if (m.type === 'control-mode') system.controlMode = m.data;
    if (m.type === 'midi') system.received = (system.received || 0) + 1;
    emit(m.type, m.data);
  } else if (m.t === 'parte2:preview') {
    if (!editorVisible || document.hidden) return;
    const bitmap = await createImageBitmap(m.blob);
    const canvas = document.getElementById('system-canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
  }
};
function heartbeat() { if (editorVisible && !document.hidden) channel.postMessage({ t: ready ? 'parte2:ping' : 'parte2:hi' }); }
window.addEventListener('message', ({ data, origin, source }) => {
  if (origin !== location.origin || source !== window.parent || data?.t !== 'parte2:visibility') return;
  editorVisible = data.visible === true; if (editorVisible) heartbeat();
});
document.addEventListener('visibilitychange', heartbeat);
heartbeat(); const timer = setInterval(heartbeat, 1500);
window.addEventListener('pagehide', () => {
  clearInterval(timer); ui?.dispose(); channel.close();
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Editor cerrado')); }
}, { once: true });
