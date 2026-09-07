// Recorre todas las escenas en orden, dispara la acción principal de cada una y reporta
// fps, ms y errores de consola. Es la prueba de que el show entero corre sin romperse.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const OUT = process.argv[2] ?? '';
const BASE = process.argv[3] ?? 'http://localhost:5173';
const SEGUNDOS_POR_ESCENA = Number(process.argv[4] ?? 4);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (OUT) mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-walk-'))}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--window-size=1400,600',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(300);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
const errores = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errores.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, (m) => res(m.result ?? m.error)); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 2688, height: 1008, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/` });
// Esperar a que `vis` exista en vez de contar segundos: el arranque decodifica
// el WAV del show y con eso una espera fija se queda corta en máquinas lentas.
const arranque = Date.now();
for (let i = 0; i < 300 && !(await evalIn('!!window.vis?.scenes')); i++) await sleep(250);
console.log(`arranque en ${((Date.now() - arranque) / 1000).toFixed(1)} s`);

const escenas = await evalIn('vis.scenes.list().map(s=>s.id)');
const filas = [];

for (const escena of escenas) {
  // Se entra por la acción scene.goto, igual que lo haría una nota de Ableton.
  await evalIn(`vis.params.trigger('scene.goto','${escena}')`);
  await sleep(600);
  // Disparar varias veces la acción principal, como haría la batería.
  await evalIn(`(()=>{const m=vis.scenes.mainAction; if(!m) return; const [a,g]=Array.isArray(m)?m:[m,undefined]; for(let i=0;i<4;i++) setTimeout(()=>vis.params.trigger(a,g), i*250);})()`);
  await sleep(SEGUNDOS_POR_ESCENA * 1000);

  const stats = await evalIn("({fps: vis.engine.fps, ms: +vis.engine.frameMs.toFixed(2), particulas: vis.params.get('particles.count')})");
  filas.push({ escena, ...stats });

  if (OUT) {
    const rect = await evalIn("(()=>{const r=document.querySelector('#stage canvas').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: true });
    if (shot?.data) writeFileSync(join(OUT, `escena-${escena}.png`), Buffer.from(shot.data, 'base64'));
  }
}

const mem = await evalIn('performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null');
console.log('escena  fps   ms     partículas');
for (const f of filas) console.log(`${String(f.escena).padEnd(7)} ${String(f.fps).padStart(3)}  ${String(f.ms).padStart(5)}  ${f.particulas}`);
console.log(`\nheap JS: ${mem} MB`);
console.log(`errores: ${errores.length ? '\n  ' + [...new Set(errores)].join('\n  ') : 'ninguno'}`);

ws.close();
chrome.kill();
process.exit(errores.length ? 1 : 0);
