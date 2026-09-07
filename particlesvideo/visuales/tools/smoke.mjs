// Smoke test: abre la página en Chrome headless con WebGPU, junta consola/errores,
// evalúa una expresión y saca screenshot. Uso: node smoke.mjs <url> <out.png> [segundos] [expr]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const URL_ = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.argv[3] ?? 'shot.png';
const SECONDS = Number(process.argv[4] ?? 8);
const EXPR = process.argv[5] ?? 'null';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'vis-smoke-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`,
  '--enable-unsafe-webgpu', '--enable-dawn-features=allow_unsafe_apis', '--disable-gpu-vsync', '--disable-frame-rate-limit',
  '--enable-features=Vulkan',
  '--use-angle=default',
  '--window-size=1600,600',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu-sandbox',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(300);
  }
  throw new Error('no arrancó el CDP');
}

const page = await cdpTargets();
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));

let msgId = 0;
const pending = new Map();
const logs = [];

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? '')).join(' ');
    logs.push(`[${m.params.type}] ${text}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${d.exception?.description ?? d.text}`);
  }
  if (m.method === 'Log.entryAdded') {
    logs.push(`[log:${m.params.entry.level}] ${m.params.entry.text}`);
  }
});

const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, (m) => resolve(m.result ?? m.error));
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(SECONDS * 1000);

const evaled = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data && OUT !== '/dev/null') writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
// DUMP: si la evaluación devuelve {__files}, se escriben a disco
const val = evaled?.result?.value;
if (val && val.__files) { for (const [f, c] of Object.entries(val.__files)) writeFileSync(f, c); console.log('archivos escritos:', Object.keys(val.__files).join(', ')); }

console.log('=== CONSOLA ===');
console.log(logs.join('\n') || '(vacía)');
console.log('=== EVAL ===');
console.log(JSON.stringify(evaled?.result?.value ?? evaled, null, 2));

ws.close();
chrome.kill();
process.exit(0);
