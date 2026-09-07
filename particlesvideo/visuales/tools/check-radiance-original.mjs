import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browser, metrics, root, sleep } from './radiance-browser.mjs';

const out = join(root, 'radiance-check', 'original');
mkdirSync(out, { recursive: true });
const page = await browser({ directory: resolve(root, '../../radiance-live-show'), port: 5192, original: true, base: '/fluids' });
const deadline = setTimeout(() => { void page.close(); process.exit(2); }, 240000);
try {
  await page.waitFor(`!!document.querySelector('.fs-btn-arm') && !document.body.textContent.includes('Preparando motor')`);
  await sleep(4000);
  await page.ev(`document.querySelector('.fs-btn-arm').click()`);
  await page.waitFor(`!document.querySelector('.fs-btn-arm')`);
  await page.ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='SHOW').click()`);
  await page.ev(`window.__frames=[]; window.__last=0; window.__record=true;
    const sample=t=>{if(window.__record&&window.__last)window.__frames.push(t-window.__last);window.__last=t;requestAnimationFrame(sample)};requestAnimationFrame(sample);
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='PLAY').click()`);
  const started = Date.now();
  for (const t of [5, 13, 42, 59, 81, 123, 152.9]) {
    await sleep(Math.max(0, t * 1000 - (Date.now() - started)));
    await page.shot(join(out, `t-${t}.png`));
    console.log('Referencia Fluids', t, await page.ev(`document.body.innerText.slice(0,400)`));
  }
  const frames = await page.ev(`window.__record=false;window.__frames`);
  const report = { metrics: metrics(frames), errors: page.errors, logs: page.logs.slice(-30), snapshotsAffectTiming: true };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { clearTimeout(deadline); await page.close(); }
