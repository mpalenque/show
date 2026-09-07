import { ScenesPanel } from './panels/ScenesPanel.js';
import { ParamsPanel } from './panels/ParamsPanel.js';
import { MappingsPanel } from './panels/MappingsPanel.js';
import { MonitorPanel } from './panels/MonitorPanel.js';

// El editor no tiene estado propio: refleja lo que manda la ventana de salida.
const state = {
  registry: [], values: {}, scenes: [], mappings: [], midiInputs: [],
  currentScene: null, osc: { connected: false, udpPort: 9000 }, stats: null,
};

const channel = new BroadcastChannel('vis-bus');
const bus = {
  post: (obj) => channel.postMessage(obj),
  set: (id, value) => channel.postMessage({ t: 'set', id, value }),
  trigger: (id, arg) => channel.postMessage({ t: 'trigger', id, arg }),
};

const panels = {
  scenes: new ScenesPanel(state, bus),
  params: new ParamsPanel(state, bus),
  mappings: new MappingsPanel(state, bus),
  monitor: new MonitorPanel(state, bus),
};

channel.onmessage = (e) => {
  const m = e.data;
  switch (m.t) {
    case 'hello':
      Object.assign(state, {
        registry: m.registry, values: m.values, scenes: m.scenes, mappings: m.mappings,
        midiInputs: m.midiInputs, currentScene: m.currentScene, osc: m.osc ?? state.osc,
      });
      panels.scenes.render();
      panels.params.rebuild();
      panels.mappings.render();
      break;
    case 'values':
      Object.assign(state.values, m.values);
      panels.params.refreshValues(m.values);
      break;
    case 'stats': state.stats = m; panels.scenes.renderStats(); break;
    case 'scene': state.currentScene = m.id; panels.scenes.render(); break;
    case 'mappings': state.mappings = m.mappings; panels.mappings.render(); panels.params.renderReference(); break;
    case 'midiInputs': state.midiInputs = m.midiInputs; panels.scenes.render(); break;
    case 'oscStatus': state.osc = { connected: m.connected, udpPort: m.udpPort }; panels.scenes.render(); break;
    case 'midi': case 'osc': panels.monitor.push(m); break;
    default: break;
  }
};

for (const p of Object.values(panels)) p.init?.();

// La salida es la dueña del estado: si todavía no está abierta, insistir y avisarlo.
const waiting = document.getElementById('waiting');
const askHello = () => {
  bus.post({ t: 'hi' });
  const connected = state.registry.length > 0;
  waiting.hidden = connected;
  if (!connected) setTimeout(askHello, 1500);
};
askHello();
