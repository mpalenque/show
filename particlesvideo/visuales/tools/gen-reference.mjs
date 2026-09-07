// Genera REFERENCIA-MIDI-OSC.md y .csv desde el registro real de parámetros de la salida.
// Es lo mismo que hace el botón "Exportar hoja de referencia" del editor, pero en línea de
// comandos para poder versionar la hoja con el proyecto. Necesita `npm run dev` corriendo.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9337',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-ref-'))}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9337/json/list')).json()).find((t) => t.type === 'page'); } catch {}
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
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, (m) => res(m.result ?? m.error));
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${BASE}/` });
await sleep(9000);

const res = await send('Runtime.evaluate', {
  expression: `(async () => {
    const m = await import('/src/editor/reference.js');
    return {
      md: m.buildReferenceMarkdown(vis.params.list(), vis.mapper.mappings, vis.scenes.list()),
      csv: m.buildReferenceCsv(vis.params.list(), vis.mapper.mappings),
    };
  })()`,
  returnByValue: true,
  awaitPromise: true,
});

const value = res?.result?.value;
if (!value) {
  console.error('No se pudo generar la hoja:', JSON.stringify(res).slice(0, 600));
  chrome.kill();
  process.exit(1);
}

writeFileSync('REFERENCIA-MIDI-OSC.md', value.md);
writeFileSync('REFERENCIA-MIDI-OSC.csv', value.csv);
console.log(`REFERENCIA-MIDI-OSC.md (${value.md.length} bytes) y .csv (${value.csv.split('\r\n').length} filas)`);

ws.close();
chrome.kill();
process.exit(0);
