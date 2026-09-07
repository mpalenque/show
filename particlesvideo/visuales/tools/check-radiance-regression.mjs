import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browser, metrics, root, sleep } from './radiance-browser.mjs';

const out = join(root, 'radiance-check', 'regression');
mkdirSync(out, { recursive: true });
const page = await browser({ base: '/?clean' });
const ev = page.ev;
const report = { tests: [], performance: [], errors: page.errors };
const deadline = setTimeout(() => { void page.close(); process.exit(2); }, 180000);
try {
  await page.waitFor('!!window.vis', 90000);
  for (let scene = 1; scene <= 23; scene++) {
    await ev(`vis.scenes.goto('${scene}',{transition:0})`);
    await sleep(180);
    assert.equal(await ev('vis.scenes.current'), String(scene));
    assert.equal(await ev('vis.radiance.ownsFrame'), false);
  }
  report.tests.push('pasada 1–23 sin errores ni activación de Radiance');
  await ev(`vis.scenes.goto('2',{transition:0})`);
  await sleep(250);
  await page.shot(join(out, 'scene-2.png'));
  assert.equal(await ev('vis.params.get("line.opacity")'), 1);
  assert.equal(await ev('vis.params.get("line.orientation")'), 'vertical');
  await ev(`vis.scenes.goto('20',{transition:0});vis.scenes.goto('7')`);
  const reveal0 = await ev('vis.params.get("floor.revealDist")');
  await sleep(400);
  await page.shot(join(out, 'scene-7-start.png'));
  await sleep(3000);
  const reveal1 = await ev('vis.params.get("floor.revealDist")');
  assert.ok(reveal0 < reveal1 && reveal1 < 60);
  await page.shot(join(out, 'scene-7-growing.png'));
  await ev(`vis.scenes.goto('20',{transition:0});vis.scenes.goto('7')`);
  assert.ok(await ev('vis.params.get("floor.revealDist")') < reveal1);
  assert.equal(await ev('vis.params.get("floor.revealDuration")'), 9);
  report.tests.push('línea vertical escena 2 y despliegue progresivo repetible de piso 7');
  await ev(`vis.scenes.goto('11',{transition:0});vis.params.trigger('particles.resetInBox')`);
  await sleep(1000);
  await ev(`window.__samples=[];window.__record=false;
    const orig=vis.engine._updateFps.bind(vis.engine);vis.engine._updateFps=function(dt){if(window.__record)window.__samples.push(dt*1000);orig(dt)};`);
  for (const scene of ['20', '21']) {
    await ev(`vis.scenes.goto('${scene}')`);
    await sleep(2300);
    for (const rays of [false, true]) {
      await ev(`window.__samples=[];window.__record=true;
        ${rays ? "window.__rays=setInterval(()=>{vis.params.trigger('ray.spawn');if(vis.scenes.current==='21'){vis.params.trigger('vortex.axisFlipXY');vis.params.trigger('particles.kick')}},69)" : ''}`);
      await sleep(10000);
      const samples = await ev('window.__record=false;clearInterval(window.__rays);window.__samples');
      const result = { scene, rays, ...metrics(samples) };
      report.performance.push(result);
      console.log(JSON.stringify(result));
    }
    await page.shot(join(out, `scene-${scene}.png`));
  }
  assert.equal(await ev('vis.params.get("rays.width")'), .014);
  assert.equal(await ev('vis.params.get("vortex.response")'), 45);
  assert.equal(await ev('vis.radiance.runtime.telemetry().renderedFrames'), 0);
  report.tests.push('rayos 0,014 m, torbellino inmediato y ningún frame Fluid en 1–23');
  assert.equal(page.errors.length, 0, JSON.stringify(page.errors));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.stack;
  report.logs = page.logs.slice(-30);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  throw error;
} finally { clearTimeout(deadline); await page.close(); }
