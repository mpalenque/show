// Verificación puntual de la transición 11 -> 12 (fade de particles.opacity). Borrar al terminar.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const OUT = process.argv[2] ?? '.';
const BASE = process.argv[3] ?? 'http://localhost:5176';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-shot-'))}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--window-size=1344,504',
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
const logs = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push(`[EXCEPTION] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, (m) => res(m.result ?? m.error)); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
const shoot = async (name) => {
  const rect = await evalIn("(()=>{const r=document.querySelector('#stage canvas').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: true });
  if (r?.data) writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 2688, height: 1008, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/` });
await sleep(7000);

await evalIn("vis.scenes.goto('11',{transition:0})");
await sleep(3000);
await shoot('00-escena11');

await evalIn("vis.scenes.goto('12')");
const waits = [100, 300, 600, 1000, 1500, 2200, 3000, 3600, 5000];
let acc = 0;
for (const w of waits) {
  await sleep(w - acc < 0 ? 50 : w - acc);
  acc = w;
  const opa = await evalIn("vis.params.get('particles.opacity')");
  await shoot(`t${String(w).padStart(4, '0')}-opa${opa.toFixed(2)}`);
}

const stats = await evalIn("({fps: vis.engine.fps, ms: +vis.engine.frameMs.toFixed(1), escena: vis.scenes.current})");
console.log(JSON.stringify(stats));
console.log(logs.join('\n') || '(sin excepciones)');
ws.close();
chrome.kill();
process.exit(0);
