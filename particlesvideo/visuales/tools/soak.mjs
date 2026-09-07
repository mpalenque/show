// Prueba de estabilidad: deja la escena 22 corriendo con rayos cayendo y mide fps y heap
// a lo largo del tiempo para detectar caídas de rendimiento o fugas de memoria.
// Uso: node tools/soak.mjs [minutos] [escena]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const MINUTOS = Number(process.argv[2] ?? 10);
const ESCENA = process.argv[3] ?? '22';
const BASE = process.argv[4] ?? 'http://localhost:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9338',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-soak-'))}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--js-flags=--expose-gc',
  '--window-size=1400,600', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9338/json/list')).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(300);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
const errores = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, (m) => res(m.result ?? m.error)); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 2688, height: 1008, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/` });
await sleep(9000);

await evalIn(`vis.params.trigger('scene.goto','${ESCENA}')`);
// Rayos cayendo todo el tiempo, como en el show.
await evalIn("window.__soak = setInterval(() => vis.params.trigger('ray.spawn','random'), 400)");
await sleep(5000);

const muestras = [];
const pasos = MINUTOS * 4;                 // una muestra cada 15 s
for (let i = 0; i < pasos; i++) {
  await sleep(15000);
  const m = await evalIn("({fps: vis.engine.fps, ms: +vis.engine.frameMs.toFixed(2), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null, geoms: vis.renderer.info.memory?.geometries ?? null, escena: vis.scenes.current})");
  muestras.push(m);
  console.log(`${String((i + 1) * 15).padStart(4)}s  ${String(m.fps).padStart(3)} fps  ${String(m.ms).padStart(5)} ms  heap ${m.heap} MB  geoms ${m.geoms}`);
}

const fps = muestras.map((m) => m.fps);
const heap = muestras.map((m) => m.heap);
console.log(`\nfps  mín ${Math.min(...fps)}  máx ${Math.max(...fps)}`);
console.log(`heap primera ${heap[0]} MB → última ${heap[heap.length - 1]} MB (máx ${Math.max(...heap)})`);
console.log(`errores: ${errores.length ? [...new Set(errores)].join(' | ') : 'ninguno'}`);

ws.close();
chrome.kill();
process.exit(0);
