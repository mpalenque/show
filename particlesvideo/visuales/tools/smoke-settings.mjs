// Verifica que los ajustes guardados que quedaron VIEJOS se descarten solos al arrancar.
//
// Complemento de smoke-persist.mjs: aquel prueba que un ajuste del editor sobreviva a la
// recarga; este prueba lo contrario, que un ajuste guardado contra un valor de fábrica que el
// código ya cambió NO sobreviva. Si no, tocar un default en el código no tiene efecto en la
// máquina donde ese param se movió alguna vez a mano, y hay que acordarse de ir a borrar los
// ajustes — que es justo lo que no queremos.
//
// Uso: node tools/smoke-settings-viejos.mjs [url] [puerto-cdp]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const PORT = process.argv[3] ?? 9342;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vis-set-'))}`, '--enable-unsafe-webgpu',
  '--enable-features=Vulkan', '--use-angle=default', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu-sandbox', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(300);
}
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map(); const info = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (t.includes('ajustes')) info.push(t);
  }
});
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, (x) => res(x.result ?? x.error)); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) console.log('ERR', r.exceptionDetails.exception?.description); return r?.result?.value; };
const esperarVis = async () => { for (let i = 0; i < 60; i++) { if (await ev('!!window.vis')) return true; await sleep(500); } return false; };

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE });
await esperarVis();
await sleep(1000);   // que termine cualquier guardado diferido del primer arranque

const ok = [];
const chequear = (nombre, real, esperado) => ok.push(`${real === esperado ? 'OK  ' : 'MAL '} ${nombre}: ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`);

// --- 1. formato viejo: mezcla de obsoletos y de ajustes legítimos
await ev(`localStorage.setItem('vis.settings', JSON.stringify({
  'ao.distance': 0.35, 'particles.emissive': 0.15, 'particles.wrapTop': 3.5,
  'light.key': 5.0, 'bloom.strength': 1.4, 'param.que.ya.no.existe': 7
}))`);
info.length = 0;
await send('Page.reload'); await esperarVis(); await sleep(500);
chequear('v1 obsoleto ao.distance vuelve al default', await ev("vis.params.get('ao.distance')"), 0.10);
chequear('v1 obsoleto particles.emissive vuelve al default', await ev("vis.params.get('particles.emissive')"), 0.08);
chequear('v1 obsoleto particles.wrapTop vuelve al default', await ev("vis.params.get('particles.wrapTop')"), 0.5);
chequear('v1 legítimo light.key sobrevive', await ev("vis.params.get('light.key')"), 5.0);
chequear('v1 legítimo bloom.strength sobrevive', await ev("vis.params.get('bloom.strength')"), 1.4);
chequear('light.key también pisa el DEFAULT', await ev("vis.params.def('light.key').default"), 5.0);
chequear('se migró a formato 2', await ev("JSON.parse(localStorage.getItem('vis.settings')).__formato"), 2);
chequear('el obsoleto se borró del storage', await ev("'ao.distance' in JSON.parse(localStorage.getItem('vis.settings')).overrides"), false);
chequear('el param inexistente se borró del storage', await ev("'param.que.ya.no.existe' in JSON.parse(localStorage.getItem('vis.settings')).overrides"), false);
console.log('consola v1:', info.join(' | '));

// --- 2. formato 2 con un `d` que ya no coincide (simula un cambio de default futuro)
await ev(`localStorage.setItem('vis.settings', JSON.stringify({ __formato: 2, overrides: {
  'ao.distance': { v: 0.5, d: 0.35 },
  'bloom.strength': { v: 1.4, d: 0.9 }
}}))`);
info.length = 0;
await send('Page.reload'); await esperarVis(); await sleep(500);
chequear('v2 con default cambiado se descarta', await ev("vis.params.get('ao.distance')"), 0.10);
chequear('v2 con default vigente se aplica', await ev("vis.params.get('bloom.strength')"), 1.4);
console.log('consola v2:', info.join(' | '));

// --- 3. ida y vuelta: guardar desde el editor y releer
await ev("vis.settings.record('ao.distance', 0.2)");
await sleep(600);
chequear('record guarda con su valor de fábrica', await ev("JSON.parse(localStorage.getItem('vis.settings')).overrides['ao.distance'].d"), 0.10);
await send('Page.reload'); await esperarVis(); await sleep(500);
chequear('lo recién guardado sobrevive a la recarga', await ev("vis.params.get('ao.distance')"), 0.2);

// --- 4. lo que manda la escena NUNCA se guarda ni pisa el default de las demas escenas.
// Este es el que rompia el show: tocabas la atraccion del bloque rojo estando en la 14 y la
// escena 7 (que solo tiene que mostrar el piso) se quedaba con particulas, bloque y atractor
// colgados para siempre, incluso tras recargar.
await ev("vis.settings.clear()");
await send('Page.reload'); await esperarVis(); await sleep(800);
const enLa7 = async () => {
  await ev("vis.scenes.goto('7',{transition:0})"); await sleep(700);
  return ev(`[vis.params.get('particles.opacity'), vis.params.get('redBlock.attract'),
             vis.params.get('vortex.swirl'), vis.layer3d.sim.forces.attractors[0].w].join(',')`);
};
chequear('escena 7 limpia de entrada', await enLa7(), '0,0,0,0');
await ev(`(() => {
  const bus = new BroadcastChannel('vis-bus');
  vis.scenes.goto('14', { transition: 0 });
  bus.postMessage({ t: 'set', id: 'redBlock.attract', value: 6 });
  bus.postMessage({ t: 'set', id: 'particles.opacity', value: 1 });
  bus.postMessage({ t: 'set', id: 'vortex.swirl', value: 1.5 });
})()`);
await sleep(1200);
chequear('escena 7 sigue limpia tras tocar la 14', await enLa7(), '0,0,0,0');
await send('Page.reload'); await esperarVis(); await sleep(800);
chequear('escena 7 sigue limpia tras recargar', await enLa7(), '0,0,0,0');
chequear('no se guardo nada de la escena', await ev("Object.keys(JSON.parse(localStorage.getItem('vis.settings') ?? '{}').overrides ?? {}).length"), 0);

console.log(ok.join('\n'));
const todoOk = ok.every((l) => l.startsWith('OK'));
console.log(todoOk ? '\nOK: la escena manda, y los ajustes viejos se descartan' : '\nFALLA');
ws.close(); chrome.kill(); process.exit(todoOk ? 0 : 1);
