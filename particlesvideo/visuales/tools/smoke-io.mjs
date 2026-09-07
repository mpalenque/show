// Prueba de la Fase 2: abre salida + editor en el mismo Chrome, verifica el puente
// BroadcastChannel, el mapper (MIDI falso), OSC real por UDP y la hoja de referencia.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import osc from 'osc';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'vis-io-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`,
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--window-size=1400,600',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

async function httpJson(path) {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(`http://127.0.0.1:9334${path}`)).json(); } catch {}
    await sleep(300);
  }
  throw new Error('CDP no respondió');
}

class Tab {
  constructor(target) { this.target = target; this.id = 0; this.pending = new Map(); this.logs = []; }
  async open() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); return; }
      if (m.method === 'Runtime.consoleAPICalled') {
        this.logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push(`[EXCEPTION] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      }
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    return this;
  }
  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, (m) => resolve(m.result ?? m.error));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) return { __error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
    return r?.result?.value;
  }
  async goto(url) { await this.send('Page.navigate', { url }); }
}

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail }; };

// --- salida ---
const outTarget = (await httpJson('/json/list')).find((t) => t.type === 'page');
const out = await new Tab(outTarget).open();
await out.goto(`${BASE}/`);
await sleep(6000);

const booted = await out.eval("({params: window.vis?.params?.list()?.length, maps: window.vis?.mapper?.mappings?.length, backend: window.vis?.renderer?.backend?.constructor?.name})");
check('salida arranca con mapeos default', booted?.maps > 0 && booted?.params > 0, booted);

// --- editor en otra pestaña ---
const created = await out.send('Target.createTarget', { url: `${BASE}/editor.html` });
await sleep(1500);
const edTarget = (await httpJson('/json/list')).find((t) => t.type === 'page' && t.url.includes('editor'));
const ed = await new Tab(edTarget).open();
await sleep(3000);

const edState = await ed.eval("({scenes: document.querySelectorAll('#scenes-list button').length, refRows: document.querySelectorAll('.ref-row').length, mapRows: document.querySelectorAll('.map-row').length, panes: document.querySelectorAll('#pane .tp-fldv').length})");
check('editor recibe hello (escenas, params, mapeos)', edState?.scenes > 0 && edState?.refRows > 0 && edState?.mapRows > 0, edState);

// --- cambiar de escena desde el editor ---
await ed.eval("document.querySelectorAll('#scenes-list button')[1].click()");
await sleep(600);
check('click de escena en el editor cambia la salida', (await out.eval('window.vis.scenes.current')) === 'testB', await out.eval('window.vis.scenes.current'));

// --- learn + MIDI falso: aprender una nota y que dispare ---
await ed.eval(`(()=>{ const s=window; const rows=document.querySelectorAll('.map-row'); return true; })()`);
await out.eval("window.vis.mapper.setMappings([{id:'t1', source:{}, mode:'trigger', target:'scene.goto', arg:'testA'}, {id:'t2', source:{}, mode:'range', target:'master.brightness', min:0, max:1, curve:'linear'}])");
await out.eval("window.vis.mapper.learn('t1')");
await out.eval("window.vis.mapper.dispatch({kind:'note', channel:1, note:60, velocity:100, on:true})");
const learned = await out.eval("JSON.stringify(window.vis.mapper.mappings[0])");
check('learn asigna la fuente y el modo', learned?.includes('"note":60') && learned?.includes('"channel":1'), learned);

await out.eval("window.vis.params.trigger('scene.goto','testB')");
await out.eval("window.vis.mapper.dispatch({kind:'note', channel:1, note:60, velocity:100, on:true})");
await sleep(300);
check('la nota aprendida cambia de escena', (await out.eval('window.vis.scenes.current')) === 'testA');

// --- CC en modo range ---
await out.eval("window.vis.mapper.learn('t2')");
await out.eval("window.vis.mapper.dispatch({kind:'cc', channel:2, cc:21, value:0})");
await out.eval("window.vis.mapper.dispatch({kind:'cc', channel:2, cc:21, value:64})");
await sleep(200);
const bright = await out.eval("window.vis.params.target('master.brightness')");
check('CC en modo range mueve el valor', Math.abs(bright - 64 / 127) < 0.02, bright);

// --- fan-out: una nota, dos destinos ---
await out.eval(`window.vis.mapper.setMappings([
  {id:'f1', source:{kind:'note',channel:3,note:40}, mode:'trigger', target:'master.blackout', arg:true},
  {id:'f2', source:{kind:'note',channel:3,note:40}, mode:'velocity', target:'bloom.strength', min:0, max:2}
])`);
await out.eval("window.vis.mapper.dispatch({kind:'note', channel:3, note:40, velocity:127, on:true})");
await sleep(200);
const fan = await out.eval("({blackout: window.vis.params.target('master.blackout'), strength: window.vis.params.target('bloom.strength')})");
check('fan-out: una nota dispara dos destinos', fan?.blackout === true && Math.abs(fan.strength - 2) < 0.05, fan);

// --- filtro por escena ---
await out.eval(`window.vis.mapper.setMappings([{id:'s1', source:{kind:'note',channel:1,note:50}, mode:'trigger', target:'master.blackout', arg:false, scenes:['testZ']}])`);
await out.eval("window.vis.params.set('master.blackout', true)");
await out.eval("window.vis.mapper.dispatch({kind:'note', channel:1, note:50, velocity:100, on:true})");
await sleep(200);
check('filtro por escena bloquea el mapeo', (await out.eval("window.vis.params.target('master.blackout')")) === true);

// --- persistencia ---
await out.eval("window.vis.mapper.save()");
const persisted = await out.eval("JSON.parse(localStorage.getItem('vis.mappings')).mappings.length");
check('los mapeos persisten en localStorage', persisted === 1, persisted);

// --- OSC real por UDP ---
await out.eval("window.vis.params.set('master.brightness', 1)");
const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, metadata: true });
await new Promise((r) => { udp.on('ready', r); udp.open(); });
udp.send({ address: '/p/master/brightness', args: [{ type: 'f', value: 0.42 }] }, '127.0.0.1', 9000);
udp.send({ address: '/pn/bloom/strength', args: [{ type: 'f', value: 0.5 }] }, '127.0.0.1', 9000);
udp.send({ address: '/scene', args: [{ type: 's', value: 'testB' }] }, '127.0.0.1', 9000);
await sleep(1200);
const oscState = await out.eval("({connected: window.vis.osc.connected, brightness: window.vis.params.target('master.brightness'), strength: window.vis.params.target('bloom.strength'), scene: window.vis.scenes.current})");
check('OSC /p/ fija el valor nativo', Math.abs(oscState?.brightness - 0.42) < 0.001, oscState);
check('OSC /pn/ fija el normalizado', Math.abs(oscState?.strength - 1.0) < 0.001, oscState?.strength);
check('OSC /scene cambia de escena', oscState?.scene === 'testB', oscState?.scene);
udp.close();

// --- hoja de referencia ---
const ref = await ed.eval(`(async()=>{ const m = await import('/src/editor/reference.js'); const st = {registry: window.__state?.registry}; return 'ok'; })()`);
const refMd = await ed.eval(`(async()=>{
  const m = await import('/src/editor/reference.js');
  const registry = [{id:'particles.turbulence', label:'Turbulencia', group:'particles', type:'float', min:0, max:2, default:0.6},
                    {id:'ray.spawn', label:'Disparar rayo', group:'rays', isAction:true, argHint:'x'}];
  const mappings = [{id:'m1', target:'particles.turbulence', source:{kind:'cc',channel:2,cc:21}}];
  const md = m.buildReferenceMarkdown(registry, mappings, [{id:'1',name:'Placa'}]);
  const csv = m.buildReferenceCsv(registry, mappings);
  return {mdHasOsc: md.includes('/p/particles/turbulence'), mdHasAction: md.includes('/a/rays/spawn') || md.includes('/a/ray/spawn'), mdHasSource: md.includes('CC 21 ch2'), csvLines: csv.split('\\r\\n').length};
})()`);
check('hoja de referencia lista OSC, acciones y fuentes', refMd?.mdHasOsc && refMd?.mdHasAction && refMd?.mdHasSource && refMd?.csvLines === 3, refMd);

// --- panel Probar del editor ---
await out.eval("window.vis.mapper.setMappings([{id:'p1', source:{kind:'note',channel:5,note:70}, mode:'trigger', target:'scene.goto', arg:'testA'}])");
await out.eval("window.vis.params.trigger('scene.goto','testB')");
await ed.eval(`(()=>{ document.getElementById('test-kind').value='note'; document.getElementById('test-channel').value='5'; document.getElementById('test-num').value='70'; document.getElementById('test-value').value='100'; document.getElementById('test-send').click(); return true; })()`);
await sleep(600);
check('panel Probar del editor dispara el mapeo', (await out.eval('window.vis.scenes.current')) === 'testA', await out.eval('window.vis.scenes.current'));
const monitorRows = await ed.eval("document.getElementById('monitor').innerHTML.length");
check('el monitor registra los mensajes', monitorRows > 0, monitorRows);

await ed.send('Page.bringToFront');
await ed.eval("document.querySelectorAll('#pane .tp-fldv')[0]?.querySelector('.tp-fldv_b')?.click()");
await sleep(500);
const shot = await ed.send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) writeFileSync(process.env.SHOT ?? 'editor.png', Buffer.from(shot.data, 'base64'));
await out.send('Page.bringToFront');
await sleep(2000);
const fps = await out.eval('window.vis.engine.fps');
check('fps sostenidos', fps >= 50, fps);

console.log('\n=== RESULTADOS FASE 2 ===');
let allOk = true;
for (const [name, r] of Object.entries(results)) {
  if (!r.ok) allOk = false;
  console.log(`${r.ok ? 'OK  ' : 'FALLA'}  ${name}${r.ok ? '' : '   → ' + JSON.stringify(r.detail)}`);
}
console.log('\n=== CONSOLA SALIDA ===');
console.log(out.logs.filter((l) => l.includes('EXCEPTION') || l.includes('error')).join('\n') || '(sin errores)');
console.log('=== CONSOLA EDITOR ===');
console.log(ed.logs.filter((l) => l.includes('EXCEPTION') || l.includes('error')).join('\n') || '(sin errores)');

chrome.kill();
process.exit(allOk ? 0 : 1);
