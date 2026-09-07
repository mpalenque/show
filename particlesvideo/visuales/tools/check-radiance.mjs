import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, metrics, root, sleep } from './radiance-browser.mjs';

const full = process.argv.includes('--full');
const production = process.argv.includes('--production');
const out = join(root, 'radiance-check', 'cues-24-25', production ? 'production' : full ? 'full' : 'smoke');
mkdirSync(out, { recursive: true });
// Ableton puede estar mandando notas mientras corre la prueba: sin aislar, el
// show cambia de escena solo y las comprobaciones dejan de medir lo que dicen.
const page = await browser({ production, base: '/?clean', initScript: `
  navigator.requestMIDIAccess = () => Promise.reject(new Error('MIDI apagado durante la prueba'));
  window.WebSocket = class { constructor(){ this.readyState = 3; } close(){} send(){} addEventListener(){} };
  window.__webAudioCalls=0;
  for (const key of ['AudioContext','webkitAudioContext']) if(window[key]) {
    window[key]=new Proxy(window[key],{construct(Target,args){window.__webAudioCalls++;return Reflect.construct(Target,args)}});
  }
  // Un ajuste guardado por una versión anterior no puede dejar el show mudo ni
  // romper el enum: 'local' ya no existe y tiene que caer en el default.
  localStorage.setItem('vis.settings',JSON.stringify({'fluids.audioMode':'local'}));
` });
const deadline = setTimeout(() => { void page.close(); process.exit(2); }, full ? 660000 : 180000);
const report = { production, tests: [], performance: [], errors: page.errors };
const ev = page.ev;
const goto = async id => {
  await ev(`vis.scenes.goto('${id}',{transition:0})`);
  await page.waitFor(`vis.scenes.current==='${id}' && !vis.radiance.pending && !vis.radiance._switching`);
};
try {
  await page.waitFor('!!window.vis', 90000);
  assert.ok(await ev('!!vis.radiance.runtime'), JSON.stringify(await ev('vis.radiance.state()')));
  assert.equal(await ev('vis.radiance.session.audioMode'), 'web');
  assert.equal(await ev('vis.params.get("fluids.audioMode")'), 'web');
  // El audio se arma en segundo plano para no demorar el arranque, así que acá
  // se espera a que termine en vez de darlo por hecho.
  const audioDesde = Date.now();
  await page.waitFor('vis.radiance.session.audioReady', 60000);
  report.audioReadyMs = Date.now() - audioDesde;
  assert.ok(await ev('window.__webAudioCalls') > 0, 'el show reproduce su propio audio');
  // La onda del editor sale del mismo buffer: decodificarla aparte sería
  // repetir medio minuto de CPU y 50 MB para dibujar lo mismo.
  assert.ok(await ev('!!vis.radiance.session.peaks()'));
  report.boot = await ev('vis.radiance.state()');
  assert.equal(await ev('vis.radiance.session.doc.events.length'), 256);
  assert.equal(await ev('Object.values(vis.radiance.session.doc.curves).reduce((n,c)=>n+c.keys.length,0)'), 400);
  await ev(`window.__docBefore=JSON.stringify(vis.radiance.session.doc);
    window.__legacyFrames=0; const update=vis.layer3d.update.bind(vis.layer3d);
    vis.layer3d.update=(...a)=>{window.__legacyFrames++;return update(...a)};
    window.__samples=[];window.__record=false;
    const fps=vis.engine._updateFps.bind(vis.engine);vis.engine._updateFps=function(dt){
      if(window.__record){const s=vis.radiance.runtime.telemetry();window.__samples.push({dt:dt*1000,render:this.renderMs,
        time:vis.radiance.session.time,solverFrame:s.solverFrame,solverMs:s.solverMs,age:s.snapshotAgeMs,particles:s.particles});}
      fps(dt);};`);

  // Requests made while async preparation is pending cannot resurrect an old cue.
  await ev(`vis.scenes.goto('24');vis.scenes.goto('1');`);
  await sleep(250);
  assert.equal(await ev('vis.scenes.current'), '1');
  assert.equal(await ev('vis.radiance.active'), false);
  report.tests.push('cancelar 24 pendiente conserva escena 1');

  await ev(`vis.radiance.command('loop',{from:2,to:5})`);
  await goto('24');
  assert.equal(await ev('vis.radiance.session.state().loop.on'), false);
  const before = await ev('({legacy:window.__legacyFrames,frame:vis.radiance.runtime.telemetry().solverFrame})');
  await sleep(1400);
  await ev(`vis.mapper.dispatch({kind:'note',channel:10,note:24,on:true,velocity:100});vis.params.trigger('fluids.live.burst',3000)`);
  assert.equal(await ev('vis.radiance.session.time'), 0);
  assert.equal(await ev('vis.radiance.session.playing'), false);
  assert.equal(await ev('vis.radiance.runtime.telemetry().particles'), 0);
  assert.equal(await ev('vis.radiance.runtime.telemetry().solverFrame'), before.frame);
  assert.equal(await ev('window.__legacyFrames'), before.legacy);
  report.standbyPixels = await ev(`(()=>{
    const r=vis.radiance.runtime,c=r.canvas,gl=c.getContext('webgl2');
    r.frame({now:performance.now()/1000,dt:1/60,time:0,playing:false});
    const p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);
    let minX=c.width,minY=c.height,maxX=-1,maxY=-1,lit=0,colored=0;
    for(let i=0;i<p.length;i+=4)if(Math.max(p[i],p[i+1],p[i+2])>4){
      const k=i/4,x=k%c.width,y=Math.floor(k/c.width);lit++;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      if(Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])>2)colored++;
    }
    // El buffer está supersampleado: la medida se devuelve en píxeles del
    // cuadro lógico de 2688x1008 para que no dependa de esa escala.
    const s=c.width/2688;
    return{scale:s,lit:Math.round(lit/(s*s)),colored,width:Math.round((maxX-minX+1)/s),
      height:Math.round((maxY-minY+1)/s),minX:Math.round(minX/s),minY:Math.round(minY/s)};
  })()`);
  assert.ok(report.standbyPixels.lit > 500 && report.standbyPixels.lit < 6000, JSON.stringify(report.standbyPixels));
  assert.ok(report.standbyPixels.height > 2 && report.standbyPixels.height < 20, 'La previa debe ser sólo una línea, sin cono de luz');
  assert.equal(report.standbyPixels.colored, 0);
  report.tests.push('24 espera en cero con física vacía detenida y motor anterior suspendido');
  await page.shot(join(out, '24-entry.png'));

  await ev(`window.__cue=performance.now()/1000;
    vis.mapper.dispatch({kind:'note',channel:10,note:25,on:true,velocity:100});`);
  await page.waitFor(`vis.scenes.current==='25' && vis.radiance.session.playing`);
  // Con el audio en la página el origen del reloj es el instante en que el track
  // empieza a sonar, no el sello del MIDI: queda un desfase de arranque que se
  // anota para poder vigilarlo.
  report.desfaseDelCueMs = Math.round(1000 * await ev('(performance.now()/1000-window.__cue)-vis.radiance.session.time'));
  assert.ok(Math.abs(report.desfaseDelCueMs) < 300, `desfase del cue ${report.desfaseDelCueMs} ms`);
  await sleep(1400);
  // El track suena y es el que manda el reloj: la secuencia tiene que seguir su
  // posición, no el tiempo de pared.
  const conAudio = await ev(`({...vis.radiance.session.state(), pista: vis.radiance.session._audio.time})`);
  assert.equal(conAudio.audioPlaying, true, JSON.stringify(conAudio));
  assert.ok(Math.abs(conAudio.time - conAudio.pista) < .05, JSON.stringify(conAudio));
  report.tests.push('el track de la página suena y es el reloj de la secuencia');
  const started = await ev('vis.radiance.session.time');
  await ev(`vis.mapper.dispatch({kind:'note',channel:10,note:25,on:true,velocity:100});
    vis.radiance.command('audio-mode','local');vis.radiance.command('arm');`);
  assert.ok(await ev('vis.radiance.session.time') >= started);
  assert.ok(await ev('vis.radiance.runtime.telemetry().particles') > 0);
  // Un valor desconocido cae en el default; no puede dejar el show sin audio.
  assert.equal(await ev('vis.radiance.session.audioMode'), 'web');
  assert.equal(await ev('JSON.stringify(vis.radiance.session.doc)===window.__docBefore'), true);
  report.tests.push('nota MIDI 25 inicia timeline alineado al cue y notas repetidas no reinician; comandos viejos no habilitan audio');
  await page.shot(join(out, '25-sequence.png'));
  await goto('24');
  assert.equal(await ev('vis.radiance.session.time'), 0);
  assert.equal(await ev('vis.radiance.runtime.telemetry().particles'), 0);
  report.tests.push('25→24 limpia partículas y vuelve a la previa sin reproducir');
  await goto('20');
  const solverFrame = await ev('vis.radiance.runtime.telemetry().solverFrame');
  await sleep(250);
  assert.ok(await ev('vis.radiance.runtime.telemetry().solverFrame') <= solverFrame + 1);
  await ev(`vis.radiance.command('loop',{from:2,to:5})`);
  await goto('25');
  assert.equal(await ev('vis.radiance.session.state().loop.on'), false);
  assert.ok(await ev('vis.radiance.session.time') < .5);
  await sleep(1200);
  assert.ok(await ev('vis.radiance.runtime.telemetry().particles') > 0);
  report.tests.push('volver a Parte 1 suspende Worker; entrada directa 25 inicia secuencia');
  await ev('vis.radiance.command("seek",152.6)');
  await sleep(350);
  const ended = await ev('vis.radiance.state()');
  assert.equal(ended.playing, false);
  assert.equal(ended.scene, '25');
  assert.equal(ended.time, ended.duration);
  // Terminada la secuencia el reloj se detiene pero el fluido SIGUE corriendo:
  // la imagen final ya no se congela hasta la próxima nota.
  const endedFrames = ended.stats.renderedFrames;
  const endedSolver = ended.stats.solverFrame;
  await sleep(600);
  const after = await ev('vis.radiance.runtime.telemetry()');
  assert.ok(after.renderedFrames > endedFrames + 10, JSON.stringify(after));
  assert.ok(after.solverFrame > endedSolver, 'la física tiene que seguir avanzando después del final');
  assert.equal(await ev('vis.radiance.session.time'), ended.duration);
  report.tests.push('el final detiene el reloj pero el fluido sigue corriendo');

  // Escena 26: el mismo motor sin documento, para tocar por MIDI.
  await ev(`vis.mapper.dispatch({kind:'note',channel:10,note:26,on:true,velocity:100})`);
  await page.waitFor(`vis.scenes.current==='26' && vis.radiance.mode==='live'`);
  assert.equal(await ev('vis.radiance.session.playing'), false, 'el motor libre no arrastra el timeline');
  assert.equal(await ev('vis.params.get("fluids.live.emission")'), 0.018);
  await sleep(1500);
  const liveParticles = await ev('vis.radiance.runtime.telemetry().particles');
  assert.ok(liveParticles > 0, 'la 26 tiene que emitir sola al entrar');
  await ev(`vis.params.set('fluids.live.emission',0,{immediate:true});vis.params.trigger('fluids.live.burst',900)`);
  await sleep(400);
  assert.ok(await ev('vis.radiance.runtime.telemetry().particles') > liveParticles, 'la ráfaga por MIDI agrega masa');
  await page.shot(join(out, '26-live.png'));
  await goto('1');
  assert.equal(await ev('vis.params.get("fluids.live.emission")'), 0);
  report.tests.push('26 entra al motor libre, emite y responde a los controles; al salir vuelve al reposo');

  if (full) {
    for (let pass = 1; pass <= 3; pass++) {
      await ev('vis.radiance.command("restart")');
      await page.waitFor('vis.radiance.session.playing && vis.radiance.session.time<2');
      await ev('window.__samples=[];window.__record=true');
      const start = Date.now();
      while (Date.now() - start < 157000) {
        await sleep(15000);
        console.log('Track', pass, await ev('({time:vis.radiance.session.time,...vis.radiance.runtime.telemetry()})'));
        if (!await ev('vis.radiance.session.playing')) break;
      }
      const samples = await ev('window.__record=false;window.__samples');
      const activeSamples = samples.filter(s => s.time < 152.694);
      const summary = { pass, ...metrics(activeSamples), maxWorkerMs: Math.max(...activeSamples.map(s => s.solverMs)),
        maxSnapshotAge: Math.max(...activeSamples.map(s => s.age)),
        outliers: activeSamples.filter(s => s.dt > 20), lastTime: samples.at(-1)?.time };
      report.performance.push(summary);
      writeFileSync(join(out, `pass-${pass}.json`), JSON.stringify({ summary, samples }, null, 2));
      console.log('Pasada completa', JSON.stringify(summary));
    }
  } else {
    await ev('vis.radiance.command("restart")');
    await page.waitFor('vis.radiance.session.playing && vis.radiance.session.time<2');
    await ev('window.__samples=[];window.__record=true');
    await sleep(8000);
    const samples = await ev('window.__record=false;window.__samples');
    report.performance.push({ ...metrics(samples), maxWorkerMs: Math.max(...samples.map(s => s.solverMs)),
      maxSnapshotAge: Math.max(...samples.map(s => s.age)), outliers: samples.filter(s => s.dt > 20) });
  }
  // MIDI/OSC registrations preserve scene mappings and the most recent ray width.
  // 0,042 m es el valor vigente desde la vuelta de rayos con luz del 2026-09-06
  // (docs/VALIDACION-RAYOS.md); esta comprobación había quedado en el anterior.
  assert.equal(await ev('vis.params.def("rays.width").default'), .042);
  assert.equal(await ev('JSON.stringify(vis.radiance.session.doc)===window.__docBefore'), true);
  const refs = production ? null : await ev(`(async()=>{const r=await import('/src/editor/reference.js');return {
    md:r.buildReferenceMarkdown(vis.params.list(),vis.mapper.mappings,vis.scenes.list()),
    csv:r.buildReferenceCsv(vis.params.list(),vis.mapper.mappings)}})()`).catch(() => null);
  if (refs && !production) {
    writeFileSync(join(root, 'REFERENCIA-MIDI-OSC.md'), refs.md);
    writeFileSync(join(root, 'REFERENCIA-MIDI-OSC.csv'), refs.csv);
  }
  report.state = await ev('vis.radiance.state()');
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  // El aviso de MIDI es el propio apagado de la prueba, no un fallo del show.
  const errors = page.errors.filter(e => !String(e?.text ?? e).includes('no se pudo abrir MIDI'));
  report.errors = errors;
  assert.equal(errors.length, 0, JSON.stringify(errors));
} catch (error) {
  report.failure = error.stack;
  report.logs = page.logs.slice(-60);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await page.shot(join(out, 'failure.png')).catch(() => {});
  throw error;
} finally { clearTimeout(deadline); await page.close(); }
