import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browser, sleep } from './radiance-browser.mjs';

const output = resolve('performance-check/parte2'); mkdirSync(output, { recursive: true });
const duration = Number(process.env.PARTE2_TEST_SECONDS || process.argv.find(arg => arg.startsWith('--seconds='))?.split('=')[1] || 15);
const production = process.argv.includes('--production');
const resizeRun = process.argv.includes('--resize');
const report = { date: new Date().toISOString(), production, resizeRun, duration, checks: [], samples: [] };
const check = (name, actual, predicate = Boolean) => {
  const pass = predicate(actual); report.checks.push({ name, pass, actual });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(actual)}`);
};
const b = await browser({ port: production ? 5198 : 5197, production, configLoader: 'native', base: '/?clean',
  profilePrefix: 'vis-parte2-', cleanupProfile: true, disableCache: true,
  initScript: `navigator.requestMIDIAccess = async () => ({ inputs: new Map(), onstatechange: null });
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class { constructor(url,...args) { if (!String(url).includes(':8081')) return new OriginalWebSocket(url,...args); this.readyState=3; } send(){} close(){} };` });
try {
  await b.waitFor('!!window.vis', 60000);
  check('Hosted system initialized', await b.ev('({status:vis.parte2.status,error:vis.parte2.error})'), x => x.status === 'ready');
  if (await b.ev('!vis.parte2.system')) throw new Error('Parte 2 did not initialize');
  check('444 controls registered before editor hello', await b.ev("vis.params.list().filter(p=>p.id.startsWith('parte2.')).length"), x => x === 444);
  check('No independent loop or input connections', await b.ev('({hosted:vis.parte2.system.hosted,raf:!!vis.parte2.system.raf,midi:!!vis.parte2.system.midi.access,osc:!!vis.parte2.system.osc,bus:!!vis.parte2.system.bus})'), x => x.hosted && !x.raf && !x.midi && !x.osc && !x.bus);
  const catalog = await (await fetch(new URL('parte2/api/catalog', b.url))).json();
  check('63 complete clips resolved exclusively on E:', { totals: catalog.totals, roots: catalog.roots.filter(r => r.clips).map(r => r.path) }, x => x.totals.completeClips === 63 && x.roots.every(p => /^E:/i.test(p)));
  const overlay = await fetch(new URL('parte2/assets/part2-overlay.png', b.url));
  check('Local overlay served', overlay.status, x => x === 200);
  const ink = await fetch(new URL('parte2/ink/000000.dds', b.url));
  check('INK served from external fast disk', { status: ink.status, bytes: (await ink.arrayBuffer()).byteLength }, x => x.status === 200 && x.bytes > 900000);
  check('INK response forbids sequence copies in browser disk cache', ink.headers.get('cache-control'), x => x === 'no-store');
  const dds = await fetch(new URL('parte2/media/clip-00/0.dds', b.url), { method: 'HEAD' });
  check('DDS response forbids sequence copies in browser disk cache', { status: dds.status, cache: dds.headers.get('cache-control') }, x => x.status === 200 && x.cache === 'no-store');

  await b.ev("vis.midi._parse({data:[0x9c,0,127]});vis.midi._parse({data:[0x99,72,127]});");
  await b.waitFor("vis.scenes.current === 'parte2:72' && vis.parte2.system.frames > 30", 20000);
  check('Scene 72 and video note arriving before cue', await b.ev("({scene:vis.scenes.current,clip:vis.params.get('parte2.players.0.clip'),gate:vis.params.get('parte2.mix.stripes.0.video')})"), x => x.scene === 'parte2:72' && x.clip === 0 && x.gate === 1);
  const time = await b.ev('vis.parte2.system.time');
  await b.ev('vis.midi._parse({data:[0x99,72,127]});vis.midi._parse({data:[0x89,72,0]});'); await sleep(150);
  check('Repeated scene cue preserves running time', await b.ev('vis.parte2.system.time'), x => x > time);
  await b.ev('vis.midi._parse({data:[0x8c,0,0]})'); await sleep(80);
  check('Video Note Off releases gate', await b.ev("vis.params.get('parte2.mix.stripes.0.video')"), x => x === 0);

  await b.ev("const f=document.createElement('iframe'); f.id='test-editor'; f.src='./parte2.html'; f.style.cssText='position:fixed;left:-3000px;width:1344px;height:900px'; document.body.append(f)");
  await b.waitFor("document.getElementById('test-editor').contentWindow.parte2Editor?.manifest?.clips?.length === 68", 20000);
  await b.ev("document.getElementById('test-editor').contentWindow.parte2Editor.params.set('transport.rate',30)");
  await b.waitFor("vis.params.get('parte2.transport.rate') === 30");
  check('Remote editor writes numeric enum through host', await b.ev("vis.parte2.system.params.get('transport.rate')"), x => x === 30);
  await b.ev("vis.params.set('parte2.transport.rate',60)");
  await b.waitFor("document.getElementById('test-editor').contentWindow.parte2Editor.params.get('transport.rate') === 60");
  check('Host changes reach remote editor', true);
  await b.ev("const main=document.createElement('iframe');main.id='test-main-editor';main.src='./editor.html';main.style.cssText='position:fixed;left:-5000px;width:1920px;height:1080px';document.body.append(main)");
  await b.waitFor("typeof document.getElementById('test-main-editor').contentDocument?.getElementById('show-editor-parte2')?.onclick === 'function'");
  await b.ev("document.getElementById('test-main-editor').contentDocument.getElementById('show-editor-parte2').click()");
  await b.waitFor("document.getElementById('test-main-editor').contentDocument.getElementById('parte2-editor').contentWindow.parte2Editor?.manifest.clips.length === 68");
  check('Parte 2 mixer opens inside the main editor tab', true);
  await b.ev("document.getElementById('test-main-editor').remove()");
  const invalid = await b.ev("(async()=>{const e=document.getElementById('test-editor').contentWindow.parte2Editor; const before=vis.params.get('parte2.final.fx1');try {await e.importSession({version:1,system:'parte2',parameters:{'final.fx1':0.7,'unknown.param':1}});return false;}catch{return vis.params.get('parte2.final.fx1')===before}})()");
  check('Invalid session rejected atomically through remote editor', invalid);

  await b.ev("vis.parte2.system.mapper.learn('vvvv.video.0.clip');vis.midi._parse({data:[0x99,67,127]})");
  check('Learn consumes scene note', await b.ev("vis.scenes.current"), x => x === 'parte2:72');
  await b.ev('vis.parte2.system.mapper.resetToDefault()');
  await b.ev("vis.midi._parse({data:[0x99,2,127]})");
  await b.waitFor("vis.scenes.current === '2' && !vis.parte2.ownsFrame");
  check('Return to primary scene releases Parte 2 gates', await b.ev("({scene:vis.scenes.current,gate:vis.params.get('parte2.mix.stripes.0.video'),visible:vis.parte2.canvas.style.visibility})"), x => x.scene === '2' && x.gate === 0 && x.visible === 'hidden');
  const line = await b.ev("vis.params.get('line.x')"); await sleep(350);
  check('Scene 2 line keeps autonomous motion', await b.ev("vis.params.get('line.x')"), x => Math.abs(x - line) > 10);
  await b.ev("vis.midi._parse({data:[0x99,7,127]})"); await sleep(250);
  const floor = await b.ev("vis.params.get('floor.revealDist')");
  check('Scene 7 floor starts undeployed', floor, x => x < 10);
  await sleep(500); await b.ev('vis.midi._parse({data:[0x99,7,127]})'); await sleep(80);
  check('Scene 7 repeats its floor deployment', await b.ev("vis.params.get('floor.revealDist')"), x => x < 2);

  await b.ev("vis.params.set('fluids.audioMode','external');vis.midi._parse({data:[0x99,24,127]})");
  await b.waitFor("vis.scenes.current === '24' && vis.radiance.active", 45000);
  check('Fluids remains reachable', true);
  await b.ev("vis.midi._parse({data:[0x99,67,127]});vis.midi._parse({data:[0x9c,1,64]})");
  await b.waitFor("vis.scenes.current === 'parte2:67' && vis.parte2.active", 20000);
  check('Fluids suspends when entering Parte 2', await b.ev('({active:vis.radiance.active,playing:vis.radiance.session.playing})'), x => !x.active && !x.playing);
  await b.ev("vis.midi._parse({data:[0x99,70,127]});vis.midi._parse({data:[0x99,2,127]})");
  await sleep(150);
  check('Cancelled Parte 2 cue cannot override newer scene', await b.ev('vis.scenes.current'), x => x === '2');
  await b.ev("vis.midi._parse({data:[0x99,68,127]})");
  await b.waitFor("vis.scenes.current === 'parte2:68'");
  await b.ev("vis.params.set('parte2.players.0.seek',.2)");
  await sleep(180);
  await b.ev("vis.params.set('parte2.players.0.seek',.2)");
  check('Repeated seek resets the real deck', await b.ev('vis.parte2.system.decks[1].phase'), x => Math.abs(x - .2) < .003);
  await b.ev("vis.parte2.system.runLook('mixed');vis.params.set('master.blackout',true)"); await sleep(150);
  check('Global blackout reaches Parte 2 pixels', await b.ev('(async()=>{const p=await vis.parte2.system.readback();let max=0;for(let i=0;i<p.length;i+=4)max=Math.max(max,p[i],p[i+1],p[i+2]);return max;})()'), x => x === 0);
  await b.ev("vis.params.set('master.blackout',false);vis.params.set('master.brightness',1);vis.parte2.system.runLook('sixMilky');vis.params.set('parte2.mix.fullMilky',1);vis.params.set('parte2.milky.full.preset','final');vis.params.set('parte2.final.button',true);vis.params.set('parte2.final.loop',true);vis.params.set('parte2.ink.enabled',true);for(let i=0;i<6;i++)vis.params.set('parte2.mix.stripes.'+i+'.video',1);vis.params.set('parte2.mix.fullVideo',1)");
  await sleep(1500);
  await b.shot(resolve(output, production ? 'production.png' : 'integrated.png'));
  check('Rendered output contains visible pixels', await b.ev('(async()=>{const p=await vis.parte2.system.readback();let lit=0;for(let i=0;i<p.length;i+=4)if(p[i]+p[i+1]+p[i+2]>10)lit++;return lit;})()'), x => x > 1000);

  if (!production) {
    report.cropReference = await b.ev(`(async()=>{
      const {decodeDDS,parseDDSHeader}=await import('/vendor/parte2/system/dds-format.js');
      const s=vis.parte2.system, clip=s.library.clip(27);
      const raw=new Uint8Array(await (await fetch(s.options.mediaBase+'/media/'+clip.id+'/0.dds')).arrayBuffer());
      const header=parseDDSHeader(raw), expected=decodeDDS(raw,header), texture=await s.library.get(clip.id,0);
      const pitch=Math.ceil(header.width*4/256)*256, device=s.engine.device;
      const buffer=device.createBuffer({size:pitch*header.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:texture.texture},{buffer,bytesPerRow:pitch},[header.width,header.height]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const actual=new Uint8Array(buffer.getMappedRange());let total=0,max=0,alphaMismatch=0;
      for(let y=0;y<header.height;y++)for(let x=0;x<header.width*4;x++){const d=Math.abs(actual[y*pitch+x]-expected[y*header.width*4+x]);total+=d;max=Math.max(max,d);if(x%4===3&&d)alphaMismatch++;}
      buffer.unmap();buffer.destroy();return {width:texture.width,height:texture.height,meanDifference:total/expected.length,maxDifference:max,alphaMismatch};
    })()`);
    check('GPU crop preserves original 2046×1080 pixels and alpha', report.cropReference,
      x => x.width === 2046 && x.height === 1080 && x.meanDifference === 0 && x.maxDifference === 0 && x.alphaMismatch === 0);
  }

  await b.ev("for(const [i,clip] of [27,28,29,30,31,49].entries())vis.params.set('parte2.players.'+i+'.clip',clip)");
  await sleep(8000);
  report.resizeClips = await b.ev('({fps:vis.engine.fps,frameMs:vis.engine.frameMs,decks:vis.parte2.system.stats.decks,errors:vis.parte2.system.diagnostics().errors})');
  check('Six 2046×1080 sequences load without errors', report.resizeClips, x => x.errors.length === 0 && x.decks.every(d => !d.error));
  if (!resizeRun) await b.ev("for(let i=0;i<6;i++)vis.params.set('parte2.players.'+i+'.clip',i+1)");
  await sleep(1200);
  await b.ev(`window.parte2FrameSamples=[];const originalTick=vis.engine._tick.bind(vis.engine);let last=performance.now();
    vis.engine._tick=async function(){if(this._busy)return originalTick();const now=performance.now();const dt=now-last;last=now;await originalTick();if(window.parte2FrameSamples.length<100000)window.parte2FrameSamples.push({dt,ms:this.frameMs});};`);

  const until = Date.now() + duration * 1000;
  while (Date.now() < until) {
    await sleep(Math.min(5000, until - Date.now()));
    const sample = await b.ev('({at:performance.now(),fps:vis.engine.fps,frameMs:vis.engine.frameMs,pendingGPU:vis.parte2.pendingGPU,stats:vis.parte2.system.stats,errors:vis.parte2.system.diagnostics().errors})');
    report.samples.push(sample);
    if (report.samples.length % 6 === 0) console.log(`PERFORMANCE ${report.samples.length * 5}s: ${sample.fps} fps`);
  }
  check('Bounded GPU submissions', report.samples.map(s => s.pendingGPU), a => a.every(n => n <= 2));
  check('No Parte 2 runtime/GPU errors', report.samples.flatMap(s => s.errors), a => a.length === 0);
  report.timing = await b.ev(`(()=>{const samples=window.parte2FrameSamples;const summarize=key=>{const a=samples.map(s=>s[key]).sort((a,b)=>a-b);return {count:a.length,mean:a.reduce((n,x)=>n+x,0)/a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};return {interval:summarize('dt'),cpu:summarize('ms')};})()`);
  await b.ev("vis.params.set('parte2.final.fx1',.37)"); await sleep(400);
  await b.ev('window.vis=null'); await b.send('Page.reload');
  await b.waitFor('!!window.vis?.parte2?.system', 60000);
  check('Parte 2 controls persist across full output reload', await b.ev("vis.params.get('parte2.final.fx1')"), x => x === .37);
  report.browserErrors = b.errors; report.logs = b.logs;
  check('No uncaught browser exceptions', b.errors.filter(e => typeof e !== 'string' || !/WebSocket|OSC|ws:\/\//i.test(e)), a => a.length === 0);
} catch (error) { report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally {
  report.browserErrors = b.errors;
  try { writeFileSync(resolve(output, production ? 'production.json' : resizeRun ? 'validation-resize.json' : 'validation.json'), JSON.stringify(report, null, 2)); }
  finally { await b.close(); }
}
if (report.checks.some(c => !c.pass)) process.exitCode = 1;
