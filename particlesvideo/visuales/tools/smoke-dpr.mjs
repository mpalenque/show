// Verifica que el cuadro salga 1:1 en la pantalla aunque Windows tenga la escala en algo
// distinto de 100%.
//
// El buffer de dibujo SIEMPRE mide 2688 x 1008 pixeles reales, pero `canvas.style.width` esta
// en pixeles CSS, que solo son lo mismo con la escala al 100%. `fitStage` divide el tamano CSS
// por el devicePixelRatio para compensarlo; esto comprueba que el resultado en pixeles FISICOS
// siga siendo 2688 x 1008 exacto con escala 100, 130, 150 y 200%.
//
// Uso: node tools/smoke-dpr.mjs [url] [puerto-cdp]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const PORT = process.argv[3] ?? 9343;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-dpr-'))}`, '--enable-unsafe-webgpu',
  '--enable-features=Vulkan', '--use-angle=default', '--no-first-run', '--disable-gpu-sandbox',
  '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let t = null;
for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(300); }
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, (x) => res(x.result ?? x.error)); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

await send('Runtime.enable'); await send('Page.enable');
const ok = [];
const chequear = (n, real, esp) => ok.push(`${real === esp ? 'OK  ' : 'MAL '} ${n}: ${JSON.stringify(real)} (esperado ${JSON.stringify(esp)})`);

// El monitor de la LED: 2688 x 1008 físicos. Se prueba con la escala de Windows al 130%,
// o sea el viewport en CSS mide 2068 x 775.
for (const escala of [1, 1.3, 1.5, 2]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: Math.round(2688 / escala), height: Math.round(1008 / escala),
    deviceScaleFactor: escala, mobile: false,
  });
  await send('Page.navigate', { url: BASE });
  for (let i = 0; i < 60; i++) { if (await ev('!!window.vis')) break; await sleep(500); }
  await sleep(1200);
  const m = await ev(`(() => {
    const c = document.querySelector('#stage canvas');
    const r = c.getBoundingClientRect();
    return { dpr: devicePixelRatio, bufW: c.width, bufH: c.height,
             fisicoW: Math.round(r.width * devicePixelRatio), fisicoH: Math.round(r.height * devicePixelRatio) };
  })()`);
  chequear(`escala ${escala}: buffer de dibujo`, `${m.bufW}x${m.bufH}`, '2688x1008');
  chequear(`escala ${escala}: píxeles FÍSICOS en pantalla`, `${m.fisicoW}x${m.fisicoH}`, '2688x1008');
}
console.log(ok.join('\n'));
const todo = ok.every((l) => l.startsWith('OK'));
console.log(todo ? '\nOK: el cuadro sale 1:1 en pantalla con cualquier escala' : '\nFALLA');
ws.close(); chrome.kill(); process.exit(todo ? 0 : 1);
