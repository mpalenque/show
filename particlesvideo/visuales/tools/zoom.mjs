// Captura un recorte del canvas a resolución NATIVA (1 píxel del canvas = 1 píxel del PNG),
// para juzgar antialiasing sin que el escalado CSS de la ventana meta ruido.
// Uso: node tools/zoom.mjs <salida.png> <x> <y> <w> <h> "<expr previa>" [escala]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const OUT = process.argv[2] ?? 'zoom.png';
const X = Number(process.argv[3] ?? 0);
const Y = Number(process.argv[4] ?? 700);
const W = Number(process.argv[5] ?? 420);
const H = Number(process.argv[6] ?? 300);
const EXPR = process.argv[7] ?? '';
const SCALE = Number(process.argv[8] ?? 1);
const BASE = 'http://localhost:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9339',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-zoom-'))}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9339/json/list')).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(300);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, (m) => res(m.result ?? m.error)); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
// Viewport de 2688 × 1008: la escala CSS queda en 1 y el canvas se ve 1:1.
await send('Emulation.setDeviceMetricsOverride', { width: 2688, height: 1008, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?clean` });
await sleep(8000);

if (EXPR) { await evalIn(EXPR); await sleep(3000); }

const rect = await evalIn("(()=>{const r=document.querySelector('#stage canvas').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
console.log(`canvas en pantalla: ${rect.width} × ${rect.height} (nativo 2688 × 1008 → escala ${(rect.width / 2688).toFixed(3)})`);

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: rect.x + X, y: rect.y + Y, width: W, height: H, scale: SCALE },
  captureBeyondViewport: true,
});
if (shot?.data) writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log(`recorte ${W}×${H} desde (${X},${Y}) → ${OUT}`);

ws.close();
chrome.kill();
process.exit(0);
