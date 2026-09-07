// Prueba real de WebGPU: intervalos entre frames completados, con ráfagas de rayos.
// Uso: node tools/check-show-performance.mjs [salida] [segundos por caso]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'performance-check'));
const duration = Number(process.argv[3] ?? 20) * 1000;
if (!Number.isFinite(duration) || duration < 1000 || duration > 30000) throw new Error('Duración: 1..30 segundos por caso');
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = await createServer({ root, configFile: false, cacheDir: 'node_modules/.vite-performance',
  server: { host: '127.0.0.1', port: 5187, hmr: false } });
await server.listen();
const profile = mkdtempSync(join(tmpdir(), 'vis-performance-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--enable-unsafe-webgpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=2688,1008', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let ws;
const deadline = setTimeout(() => { chrome.kill(); process.exit(2); }, 180000);
try {
  let port;
  for (let i = 0; i < 100; i++) {
    const path = join(profile, 'DevToolsActivePort');
    if (existsSync(path)) { port = Number(readFileSync(path, 'utf8').split('\n')[0]); break; }
    await sleep(100);
  }
  if (!port) throw new Error('Chrome no abrió DevTools');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
  const target = targets.find(t => t.type === 'page');
  if (!target) throw new Error('Chrome no creó una pestaña');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let next = 0;
  const pending = new Map(), errors = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((r, j) => {
    const id = ++next;
    const timeout = setTimeout(() => { pending.delete(id); j(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, m => { clearTimeout(timeout); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 2688, height: 1008, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/` });
  for (let i = 0; i < 150; i++) { if (await ev('!!window.vis')) break; await sleep(100); }
  if (!await ev('!!window.vis')) throw new Error('El show no arrancó: ' + JSON.stringify(errors));
  console.log('WebGPU listo', await ev('({backend:vis.renderer.backend.constructor.name,count:vis.params.get("particles.count")})'));
  await ev(`vis.scenes.goto('11',{transition:0}); vis.params.trigger('particles.resetInBox')`);
  await sleep(1500);
  await ev(`window.__samples=[]; window.__sampleOn=false; window.__previous=0;
    const original=vis.engine._updateFps.bind(vis.engine);
    vis.engine._updateFps=function(dt){const now=performance.now();
      if(window.__sampleOn && window.__previous) window.__samples.push({dt:now-window.__previous,sim:this.simMs,render:this.renderMs,cpu:this.frameMs});
      window.__previous=now; original(dt);};`);
  const results = { mode: 'after', tests: [], errors };
  for (const scene of ['20', '21']) {
    await ev(`vis.scenes.goto('${scene}');`);
    await sleep(2500);
    for (const rays of [false, true]) {
      await ev(`window.__samples=[]; window.__sampleOn=true; window.__previous=0;
        ${rays ? "window.__rayTimer=setInterval(()=>{vis.params.trigger('ray.spawn'); if(vis.scenes.current==='21'){vis.params.trigger('vortex.axisFlipXY');vis.params.trigger('particles.kick');}},69);" : ''}`);
      await sleep(duration);
      const samples = await ev(`window.__sampleOn=false; clearInterval(window.__rayTimer); window.__samples`);
      const sorted = samples.map(s => s.dt).sort((a,b) => a-b);
      const sum = samples.reduce((a,s)=>a+s.dt,0);
      const report = { scene, rays, frames: samples.length, fps: 1000*samples.length/sum,
        p95: sorted[Math.floor(sorted.length*.95)], p99: sorted[Math.floor(sorted.length*.99)],
        worst: sorted.at(-1), over20ms: sorted.filter(t=>t>20).length,
        simCpu: samples.reduce((a,s)=>a+s.sim,0)/samples.length,
        renderCpu: samples.reduce((a,s)=>a+s.render,0)/samples.length,
        outliers: samples.filter(s=>s.dt>20) };
      results.tests.push(report); console.log(JSON.stringify(report));
      if (rays) {
        const shot = await send('Page.captureScreenshot', { format:'png' });
        writeFileSync(join(out, `${scene}-${results.mode}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  {
    const shoot = async name => {
      const shot = await send('Page.captureScreenshot', { format:'png' });
      writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, 'base64'));
    };
    await ev(`vis.scenes.goto('11',{transition:0}); vis.params.trigger('particles.resetInBox')`);
    await sleep(1000);
    await ev(`vis.scenes.goto('21',{transition:0})`);
    await sleep(300);
    await shoot('21-entry');
    await sleep(3700);
    await shoot('21-turn');
    await ev(`vis.params.trigger('vortex.axisFlipXY'); vis.params.trigger('particles.kick')`);
    await sleep(200);
    await shoot('21-axis-flip');
    const particles = await ev(`(async()=>{
      const s=vis.layer3d.sim, b=s.particleBuffer;
      const data=new Float32Array(await vis.renderer.getArrayBufferAsync(b.buffer.value));
      let finite=0, inside=0, speed=0;
      for(let i=0;i<s.numParticles;i++){
        const o=i*b.structSize, p=o+b.layout.position.offset,v=o+b.layout.velocity.offset;
        const xyz=[data[p]*.1-5.5,data[p+1]*.1-.5,data[p+2]*.1-5.5];
        if(xyz.every(Number.isFinite)&&[data[v],data[v+1],data[v+2]].every(Number.isFinite)) finite++;
        if(xyz[0]>-4&&xyz[0]<4&&xyz[1]>0&&xyz[1]<3)inside++;
        speed+=Math.hypot(data[v],data[v+1],data[v+2]);
      }
      return {count:s.numParticles,finite,inside,meanSpeed:speed/s.numParticles,axis:vis.params.get('vortex.axis')};
    })()`);
    results.particles=particles; console.log('Partículas:', JSON.stringify(particles));
    await ev(`vis.scenes.goto('20',{transition:0}); vis.scenes.goto('7')`);
    for (let i=0;i<3;i++) { await sleep(i===0?200:4300); await shoot('7-reveal-'+i); }
  }
  writeFileSync(join(out, `${results.mode}.json`), JSON.stringify(results, null, 2));
  console.log('Errores:', errors.length);
} finally {
  clearTimeout(deadline); ws?.close(); chrome.kill(); await server.close();
}
