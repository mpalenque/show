// Verifica que los ajustes hechos en el editor sobrevivan a recargar la página:
// ajusta params por el bus (como hace el editor), recarga, y comprueba que volvieron.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9341',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-persist-'))}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9341/json/list')).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(300);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, (m) => res(m.result ?? m.error));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalIn = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) return { __error: r.exceptionDetails.exception?.description };
  return r?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${BASE}/?clean` });
await sleep(9000);

// Ajustes como los haría el editor.
await evalIn(`(() => {
  const bus = new BroadcastChannel('vis-bus');
  bus.postMessage({ t: 'set', id: 'light.key', value: 7.5 });
  bus.postMessage({ t: 'set', id: 'floor.dashWidth', value: 0.24 });
  bus.postMessage({ t: 'set', id: 'ao.amount', value: 0.33 });
  bus.postMessage({ t: 'set', id: 'redBlock.height', value: 9 });
})()`);
await sleep(1000);
const antes = await evalIn(`JSON.stringify({
  luz: vis.params.get('light.key'), dash: vis.params.get('floor.dashWidth'),
  ao: vis.params.get('ao.amount'), bloque: vis.params.get('redBlock.height'),
})`);

// Recarga de verdad.
await send('Page.reload');
await sleep(9000);
const despues = await evalIn(`JSON.stringify({
  luz: vis.params.get('light.key'), dash: vis.params.get('floor.dashWidth'),
  ao: vis.params.get('ao.amount'), bloque: vis.params.get('redBlock.height'),
})`);

// Y que el botón de restaurar realmente los borre.
await evalIn(`new BroadcastChannel('vis-bus').postMessage({ t: 'resetSettings' })`);
await sleep(500);
await send('Page.reload');
await sleep(9000);
const trasReset = await evalIn(`JSON.stringify({
  luz: vis.params.get('light.key'), dash: vis.params.get('floor.dashWidth'),
  ao: vis.params.get('ao.amount'), bloque: vis.params.get('redBlock.height'),
})`);

console.log('antes de recargar :', antes);
console.log('tras recargar     :', despues);
console.log('tras restaurar    :', trasReset);
console.log(antes === despues ? '\nOK: los ajustes sobreviven la recarga' : '\nFALLA: se perdieron al recargar');

ws.close();
chrome.kill();
process.exit(antes === despues ? 0 : 1);
