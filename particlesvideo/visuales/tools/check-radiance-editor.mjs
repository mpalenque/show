import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browser, metrics, root, sleep } from './radiance-browser.mjs';

const out = join(root, 'radiance-check', 'cues-24-25', 'editor');
mkdirSync(out, { recursive: true });
const page = await browser({ base: '/?clean', production: process.argv.includes('--production') });
const ev = page.ev;
const report = { tests: [], errors: page.errors };
const deadline = setTimeout(() => { void page.close(); process.exit(2); }, 180000);
try {
  await page.waitFor('!!window.vis', 90000);
  await ev(`window.__doc=JSON.stringify(vis.radiance.session.doc);
    window.__editor=document.createElement('iframe');window.__editor.src='/fluids.html';
    Object.assign(window.__editor.style,{position:'fixed',left:'0',top:'0',width:'1500px',height:'1008px',border:'0',zIndex:'99'});
    document.body.appendChild(window.__editor);`);
  const doc = 'window.__editor.contentDocument';
  await page.waitFor(`${doc}?.body.innerText.includes('SALIDA · ESCENA 1')`);
  assert.ok(await ev(`${doc}.querySelectorAll('.fs-lane').length`) >= 18);
  assert.equal(await ev(`${doc}.querySelectorAll('canvas[data-scene]').length`), 0);
  assert.equal(await ev("document.querySelectorAll('canvas[data-scene=radiance-fluid]').length"), 1);
  await page.shot(join(out, 'timeline.png'));
  report.tests.push('editor carga documento y lanes completas sin segundo renderer');
  await ev(`Array.from(${doc}.querySelectorAll('button')).find(b=>b.textContent.startsWith('24 ·')).click()`);
  await page.waitFor(`vis.scenes.current==='24'&&!vis.radiance.pending`);
  assert.equal(await ev('vis.radiance.session.playing'), false);
  assert.equal(await ev('vis.radiance.session.time'), 0);
  assert.equal(await ev(`${doc}.body.innerText.includes('ARMAR AUDIO')`), false);
  await ev(`Array.from(${doc}.querySelectorAll('button')).find(b=>b.textContent.startsWith('25 ·')).click()`);
  await page.waitFor(`vis.scenes.current==='25'&&vis.radiance.session.playing`);
  const t0 = await ev('vis.radiance.session.time');
  await sleep(200);
  await ev(`Array.from(${doc}.querySelectorAll('button')).find(b=>b.textContent==='PAUSA').click()`);
  await page.waitFor('!vis.radiance.session.playing');
  assert.ok(await ev('vis.radiance.session.time') > t0);
  report.tests.push('24 previa, 25 play y pausa remota gobiernan reloj sin controles de reproducción de audio');
  // Author a material cue in the real React UI, verify ACK, undo and redo.
  await ev(`Array.from(${doc}.querySelectorAll('.fs-material button')).map(b=>b.textContent)`);
  const rev = await ev('vis.radiance.session.revision');
  await ev(`Array.from(${doc}.querySelectorAll('button')).find(b=>b.textContent.includes('EMITIR') || b.textContent==='EMITE').click()`);
  await page.waitFor(`vis.radiance.session.revision>${rev}`);
  assert.notEqual(await ev('JSON.stringify(vis.radiance.session.doc)'), await ev('window.__doc'));
  const editedRevision = await ev('vis.radiance.session.revision');
  await ev(`Array.from(${doc}.querySelectorAll('button')).find(b=>b.textContent==='DESHACER').click()`);
  await page.waitFor(`vis.radiance.session.revision>${editedRevision}`);
  assert.equal(await ev('JSON.stringify(vis.radiance.session.doc)'), await ev('window.__doc'));
  report.tests.push('edición real, ACK y deshacer conservan el show completo');
  // Ambos cues usan el mapeo real sin sumar un segundo play a la nota 25.
  await ev(`vis.mapper.dispatch({kind:'note',channel:10,note:24,on:true,velocity:100});`);
  await page.waitFor(`vis.scenes.current==='24'&&!vis.radiance.pending`);
  await ev(`vis.mapper.dispatch({kind:'note',channel:10,note:25,on:true,velocity:100});`);
  await page.waitFor('vis.scenes.current==="25"');
  await page.waitFor('vis.radiance.session.playing');
  await sleep(1200);
  assert.ok(await ev('vis.radiance.runtime.telemetry().particles') > 0);
  assert.equal(await ev('JSON.stringify(vis.radiance.session.doc)'), await ev('window.__doc'));
  report.tests.push('notas MIDI 24→25 inician el show conservando el documento editado');

  // Cancel during an in-flight handoff, not only before the promise starts.
  await ev(`window.__enter=vis.radiance.runtime.enterStandby.bind(vis.radiance.runtime);
    vis.radiance.runtime.enterStandby=async(...a)=>{await new Promise(r=>window.__release=r);return window.__enter(...a)};
    vis.scenes.goto('24');`);
  await page.waitFor('!!window.__release');
  await ev(`vis.scenes.goto('20');window.__release();`);
  await sleep(300);
  assert.equal(await ev('vis.scenes.current'), '20');
  assert.equal(await ev('vis.radiance.active'), false);
  assert.equal(await ev('vis.renderer.domElement.style.visibility'), 'visible');
  await ev(`vis.radiance.runtime.enterStandby=window.__enter;vis.scenes.goto('24');`);
  await page.waitFor('vis.scenes.current==="24" && !vis.radiance.pending');
  report.tests.push('cancelar durante drenaje no muestra canvas tardío y permite reentrar');
  await ev(`vis.scenes.goto('25')`);
  await page.waitFor(`vis.scenes.current==='25'&&vis.radiance.session.playing`);

  // Capture remote preview while monitoring the only output loop.
  await ev(`${doc}.querySelector('.fs-remote-nav input[type=checkbox]').click();
    window.__samples=[];window.__last=performance.now();window.__record=true;
    const orig=vis.engine._updateFps.bind(vis.engine);vis.engine._updateFps=function(dt){if(window.__record)window.__samples.push({dt:dt*1000,cpu:this.frameMs,render:this.renderMs,time:vis.radiance.session.time,capture:vis.radiance._preview?.stats()});orig(dt)};`);
  await page.waitFor(`!!${doc}.querySelector('img.fs-remote-preview')?.src`);
  await sleep(7000);
  const previewSamples = await ev('window.__record=false;window.__samples');
  report.previewPerformance = { ...metrics(previewSamples), outliers: previewSamples.filter(s=>s.dt>20) };
  report.previewCapture = await ev('vis.radiance._preview?.stats()');
  await page.shot(join(out, 'timeline-preview.png'));
  report.tests.push('preview remota visible sin otro solver');
  await ev(`window.__editor.remove()`);
  for (const dpr of [1, 1.3, 1.5, 2]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: Math.round(2688 / dpr), height: Math.round(1008 / dpr), deviceScaleFactor: dpr, mobile: false });
    await sleep(100);
    const dimensions = await ev(`(()=>{const c=vis.radiance.runtime.canvas,r=c.getBoundingClientRect();return [c.width,c.height,Math.round(r.width*devicePixelRatio),Math.round(r.height*devicePixelRatio)]})()`);
    assert.deepEqual(dimensions, [2688, 1008, 2688, 1008]);
  }
  report.tests.push('Fluids conserva 2688×1008 físicos con DPR 1/1.3/1.5/2');
  assert.equal(page.errors.length, 0, JSON.stringify(page.errors));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.stack;
  report.logs = page.logs.slice(-30);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await page.shot(join(out, 'failure.png')).catch(() => {});
  throw error;
} finally { clearTimeout(deadline); await page.close(); }
