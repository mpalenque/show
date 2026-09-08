import { Parte2System } from './controller.js';
import { mountSystemUI } from './ui.js';

const query = new URLSearchParams(location.search);
const loading = document.getElementById('system-loading');
const errorPanel = document.getElementById('system-error');
try {
  const system = await Parte2System.create(document.getElementById('system-canvas'), {
    restore: !query.has('clean'), autoStart: !query.has('test'), connectMidi: !query.has('test'),
    showMidi: !query.has('test') && !query.has('look') && query.get('mode') !== 'manual',
  });
  window.parte2 = system;
  if (query.has('resolution') && system.params.def('output.resolution').options.includes(query.get('resolution'))) system.params.set('output.resolution', query.get('resolution'));
  if (['final', 'fullDDS', 'sixDDS', 'sixMilky', 'mixed'].includes(query.get('look'))) {
    system.runLook(query.get('look')); system.params.set('transport.playing', true);
  }
  if (query.has('test')) system.params.set('transport.playing', false);
  const ui = mountSystemUI(system);
  if (loading) loading.hidden = true;
  system.on('error', ({ message, fatal }) => {
    if (fatal) { errorPanel.hidden = false; document.getElementById('system-error-message').textContent = message; }
  });
  await system.prepare(1 / 60); system.render(query.has('test') ? 0 : 1);
  window.addEventListener('pagehide', () => { ui.dispose(); system.dispose(); }, { once: true });
} catch (error) {
  if (loading) loading.hidden = true;
  if (errorPanel) errorPanel.hidden = false;
  const message = document.getElementById('system-error-message');
  if (message) message.textContent = error.message;
  console.error(error);
}
