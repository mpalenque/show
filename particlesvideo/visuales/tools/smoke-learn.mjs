// Prueba del MIDI learn POR PARÁMETRO (el botón Learn de cada fila de la lista de referencia).
// Abre salida + editor en el mismo Chrome, toca el botón y manda un MIDI falso por el bus.
// Uso: node tools/smoke-learn.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9341', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-learn-'))}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--window-size=1400,900',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

async function httpJson(path) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:9341${path}`); if (r.ok) return await r.json(); } catch {}
    await sleep(300);
  }
  throw new Error('CDP no respondió');
}

class Tab {
  constructor(t) { this.t = t; this.id = 0; this.pending = new Map(); this.logs = []; }
  async open() {
    this.ws = new WebSocket(this.t.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') this.logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.logs.push('[ERROR] ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    return this;
  }
  send(method, params = {}) {
    return new Promise((res) => { const i = ++this.id; this.pending.set(i, (m) => res(m.result ?? m.error)); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  async ev(e) { return (await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value; }
}

await httpJson('/json/list');
const salida = await new Tab((await httpJson('/json/list')).find((t) => t.type === 'page')).open();
await salida.send('Page.navigate', { url: `${BASE}/` });
await sleep(9000);
// Target.createTarget en vez de `/json/new`: desde Chrome 111 esa ruta pide PUT y con GET da 405.
await salida.send('Target.createTarget', { url: `${BASE}/editor.html` });
await sleep(1200);
const editor = await new Tab((await httpJson('/json/list')).find((t) => t.type === 'page' && t.url.includes('editor'))).open();
await sleep(3500);

let fallos = 0;
const check = (nombre, ok, extra = '') => { console.log(`${ok ? ' OK ' : 'FALLA'}  ${nombre}${extra ? '  → ' + extra : ''}`); if (!ok) fallos++; };
const filtrar = async (texto) => {
  await editor.ev(`document.getElementById('ref-filter').value=${JSON.stringify(texto)}; document.getElementById('ref-filter').dispatchEvent(new Event('input'))`);
  await sleep(200);
};
const fake = async (msg) => {
  await editor.ev(`(window.__bc ??= new BroadcastChannel('vis-bus')).postMessage({t:'fakeMidi', msg:${JSON.stringify(msg)}})`);
  await sleep(700);
};
// mappings.default.json trae filas de ejemplo SIN fuente para varios destinos, así que hay que
// buscar la que quedó ASIGNADA, no la primera que apunte al parámetro.
const mapeoDe = async (id) => JSON.parse(await salida.ev(`JSON.stringify(vis.mapper.mappings.find(m=>m.target===${JSON.stringify(id)} && m.source?.kind) ?? null)`) ?? 'null');

const filas = await editor.ev("document.querySelectorAll('#ref-list .ref-row').length");
const botones = await editor.ev("document.querySelectorAll('#ref-list .learn-btn').length");
check('hay un botón Learn por parámetro', filas > 100 && filas === botones, `${filas} filas / ${botones} botones`);

// CC sobre un float → modo range con el rango del propio parámetro.
await filtrar('particles.turbulence');
await editor.ev("document.querySelector('#ref-list .ref-row .learn-btn').click()");
await sleep(400);
check('el botón queda armado esperando el MIDI',
  await editor.ev("document.querySelector('#ref-list .learn-btn').classList.contains('learning')") === true);

await fake({ kind: 'cc', channel: 3, cc: 42, value: 100 });
const f = await mapeoDe('particles.turbulence');
check('se creó el mapeo apuntando al parámetro', f?.target === 'particles.turbulence', JSON.stringify(f));
check('la fuente es el CC que se movió', f?.source?.kind === 'cc' && f.source.cc === 42 && f.source.channel === 3, JSON.stringify(f?.source));
check('el modo se dedujo solo (CC → range)', f?.mode === 'range', f?.mode);
check('el rango sale del propio parámetro (0..2)', f?.min === 0 && f?.max === 2, `${f?.min}..${f?.max}`);
check('el botón se desarma solo al aprender',
  await editor.ev("!document.querySelector('#ref-list .learn-btn').classList.contains('learning')") === true);
const muestra = await editor.ev("document.querySelector('#ref-list .ref-row .src').textContent");
check('la fila muestra la fuente aprendida', /CC 42/.test(muestra ?? ''), muestra);

await fake({ kind: 'cc', channel: 3, cc: 42, value: 127 });
check('el CC mueve el parámetro (127 → tope del rango)',
  await salida.ev("+vis.params.target('particles.turbulence').toFixed(2)") === 2);

// Nota sobre una acción → modo trigger.
await filtrar('particles.kick');
await editor.ev("[...document.querySelectorAll('#ref-list .ref-row')].find(r=>r.firstChild.textContent==='particles.kick').querySelector('.learn-btn').click()");
await sleep(400);
await fake({ kind: 'note', channel: 2, note: 36, velocity: 110, on: true });
const acc = await mapeoDe('particles.kick');
check('acción + nota → modo trigger', acc?.mode === 'trigger' && acc?.source?.note === 36, JSON.stringify(acc));

// Escape cancela sin dejar filas vacías dando vueltas.
const antes = await salida.ev('vis.mapper.mappings.length');
await editor.ev("document.querySelector('#ref-list .ref-row .learn-btn').click()");
await sleep(300);
await editor.ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
await sleep(500);
check('Escape cancela sin dejar mapeos vacíos', antes === await salida.ev('vis.mapper.mappings.length'), String(antes));

// El × borra los mapeos de ese parámetro.
await filtrar('particles.turbulence');
await editor.ev("document.querySelector('#ref-list .ref-row .forget-btn').click()");
await sleep(500);
check('el × borra los mapeos del parámetro',
  await salida.ev("vis.mapper.mappings.filter(m=>m.target==='particles.turbulence' && m.source?.kind).length") === 0);

check('el mapeo aprendido queda guardado',
  await salida.ev("JSON.parse(localStorage.getItem('vis.mappings')||'{}').mappings?.some(m=>m.target==='particles.kick')") === true);

const errores = [...salida.logs, ...editor.logs].filter((l) => !l.includes('Web MIDI'));
check('sin errores de consola', errores.length === 0, errores.join(' | '));

console.log(`\n${fallos ? fallos + ' FALLAS' : 'todo en verde'}`);
chrome.kill();
process.exit(fallos ? 1 : 0);
