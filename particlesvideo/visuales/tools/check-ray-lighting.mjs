// Chrome/WebGPU aislado: luz de rayos, AO del mismo frame y rendimiento del show.
// Uso: node tools/check-ray-lighting.mjs [directorio] [segundos por caso, default 5]
// Las imágenes y el JSON quedan ignorados dentro del directorio de artefactos.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { browser, metrics, root, sleep } from './radiance-browser.mjs';

const out = resolve(process.argv[2] ?? join(root, 'performance-check/ray-lighting'));
const duration = Number(process.argv[3] ?? 5) * 1000;
if (!Number.isFinite(duration) || duration < 1000 || duration > 30000) throw new Error('Duración: 1..30 segundos');
mkdirSync(out, { recursive: true });
const report = { date: new Date().toISOString(), durationMs: duration, checks: [], performance: [], errors: [] };
const check = (name, pass, actual) => {
  report.checks.push({ name, pass: Boolean(pass), actual });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ': ' + JSON.stringify(actual)}`);
};

// PNG RGB/RGBA de Chrome, filtros estándar; no requiere instalar paquetes para
// comparar píxeles. Se compara luminancia sRGB de salida, no radiancia física.
function pixels(png) {
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('PNG de Chrome no soportado');
    } else if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * channels;
  const decoded = new Uint8Array(height * stride), luminance = new Float32Array(width * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0, offset = 0; y < height; y++) {
    const filter = raw[offset++];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x, a = x >= channels ? decoded[index - channels] : 0;
      const b = y ? decoded[index - stride] : 0, c = y && x >= channels ? decoded[index - stride - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      if (predictor === undefined) throw new Error('Filtro PNG desconocido');
      decoded[index] = (raw[offset++] + predictor) & 255;
    }
  }
  let sum = 0, lit = 0, max = 0;
  for (let i = 0; i < luminance.length; i++) {
    const v = decoded[i * channels] * .2126 + decoded[i * channels + 1] * .7152 + decoded[i * channels + 2] * .0722;
    luminance[i] = v; sum += v; if (v > 3) lit++; max = Math.max(max, v);
  }
  return { width, height, luminance, stats: { mean: sum / luminance.length, lit, max } };
}
function difference(brighter, darker) {
  if (brighter.width !== darker.width || brighter.height !== darker.height) throw new Error('Resoluciones distintas');
  let sum = 0, darkerPixels = 0, brighterPixels = 0, unchanged = 0;
  for (let i = 0; i < brighter.luminance.length; i++) {
    const delta = brighter.luminance[i] - darker.luminance[i]; sum += delta;
    if (delta > 2) darkerPixels++; else if (delta < -2) brighterPixels++; else unchanged++;
  }
  return { meanReduction: sum / brighter.luminance.length, darkerPixels, brighterPixels, unchanged };
}

let b;
try {
  b = await browser({ port: 5197, base: '/?clean' });
  const { ev, waitFor } = b;
  await waitFor('!!window.vis');
  // Ableton puede seguir emitiendo notas mientras se mide; este navegador de
  // prueba no debe aceptar entradas físicas ni OSC de la sesión del usuario.
  await ev('vis.mapper.dispatch = () => {};');
  report.environment = await ev(`({ backend: vis.renderer.backend.constructor.name,
    viewport: [innerWidth, innerHeight], canvas: [vis.renderer.domElement.width, vis.renderer.domElement.height],
    particles: vis.params.get('particles.count'), userAgent: navigator.userAgent })`);
  check('WebGPU real', /WebGPU/.test(report.environment.backend), report.environment);
  check('Salida 2688 × 1008', report.environment.canvas.join('x') === '2688x1008', report.environment.canvas);
  check('131072 palitos', report.environment.particles === 131072, report.environment.particles);
  await ev(`window.__rays = vis.layer3d.elements.find(el => el.constructor.name === 'Rays');
    if (!__rays?.lights || !vis.params.has('particles.raysOnly')) throw new Error('Falta implementar iluminación de rayos');
    window.__lightDefault = vis.params.def('rays.lightIntensity').default;
    window.__seed = 112358;
    Math.random = () => { __seed = (Math.imul(__seed, 1664525) + 1013904223) >>> 0; return __seed / 4294967296; };
    window.__lightIds = __rays.lights.map(l => l.id);
    window.__samples = []; window.__record = false; window.__previous = 0;
    const originalFps = vis.engine._updateFps.bind(vis.engine);
    vis.engine._updateFps = function(dt) {
      const now = performance.now();
      if (__record && __previous) __samples.push({ dt: now - __previous, sim: this.simMs,
        render: this.renderMs, cpu: this.frameMs, rays: __rays.rays.length,
        lights: __rays.lights.filter(l => l.intensity > 0).length,
        materialVersion: vis.layer3d.sticks.material.version, scene: vis.scenes.current });
      __previous = now; originalFps(dt);
    };`);
  report.defaults = await ev(`Object.fromEntries(['rays.width', 'rays.lightIntensity', 'rays.lightRange',
    'ao.amount', 'ao.contrast', 'ao.distance', 'ao.samples', 'ao.resolutionScale'].map(id => [id, vis.params.def(id).default]))`);
  check('Ancho de rayos triplicado (0.042 m)', Math.abs(report.defaults['rays.width'] - .042) < 1e-9, report.defaults['rays.width']);

  const seedScene = async () => {
    await ev(`clearInterval(window.__rayTimer); __record = false; __seed = 112358;
      vis.scenes.goto('11', { transition: 0 }); vis.params.trigger('particles.resetInBox');`);
    await sleep(1200);
    await ev(`vis.scenes.goto('21', { transition: 0 });`);
    await sleep(1000);
  };
  const capture = async name => {
    const result = await b.send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(result.data, 'base64');
    writeFileSync(join(out, `${name}.png`), png);
    return pixels(png);
  };
  const render = async () => ev(`(async () => {
    vis.engine.compositor.update(); await vis.engine.compositor.render(); await vis.renderer.waitForGPU();
  })()`);
  const frozenState = async () => ev(`(async () => {
    const raw = new Uint8Array(await vis.renderer.getArrayBufferAsync(vis.layer3d.sim.particleBuffer.buffer.value));
    let hash = 2166136261; for (const byte of raw) hash = Math.imul(hash ^ byte, 16777619);
    return { time: vis.engine.time, hash: hash >>> 0, count: vis.layer3d.sim.numParticles };
  })()`);

  await seedScene();
  await ev(`(async () => { vis.engine.stop(); await vis.engine.whenIdle(); })()`);
  report.pool = await ev(`({ size: __rays.lights.length,
    pointLights: __rays.lights.every(l => l.isPointLight), shadows: __rays.lights.some(l => l.castShadow),
    allVisible: __rays.lights.every(l => l.visible), allMounted: __rays.lights.every(l => l.parent === vis.layer3d.scene) })`);
  check('Pool fijo de 32 PointLights sin sombras', report.pool.size === 32 && report.pool.pointLights && !report.pool.shadows, report.pool);
  check('Pool montado y visible para no cambiar shaders', report.pool.allVisible && report.pool.allMounted, report.pool);
  report.tornado = await ev(`({ raysOnly: vis.params.get('particles.raysOnly'),
    emissive: vis.layer3d.sticks.u.emissive.value, bloom: vis.layer3d.sticks.u.bloom.value })`);
  check('Escena 21 apaga emisión y bloom de palitos', report.tornado.raysOnly && report.tornado.emissive === 0 && report.tornado.bloom === 0, report.tornado);

  // Rayo situado dentro de la nube para obtener un fixture visible y repetible;
  // se cambia su posición sólo en este navegador de prueba, con física detenida.
  report.follow = await ev(`(() => {
    vis.params.trigger('ray.spawn', 0); const ray = __rays.rays[0]; ray.y = 1.65; ray.z = -1.4;
    __rays.update(0); const light = __rays.lights[ray.slot], bar = __rays.bars[ray.slot];
    return { ray: [ray.x, ray.y, ray.z], light: light.position.toArray(), intensity: light.intensity,
      range: light.distance, width: bar.scale.x, depth: bar.scale.z, castShadow: light.castShadow };
  })()`);
  check('Luz sigue el centro del rayo', report.follow.ray.every((v, i) => Math.abs(v - report.follow.light[i]) < 1e-6), report.follow);
  check('Luz puntual activa con alcance limitado', report.follow.intensity > 0 && report.follow.range > 0, report.follow);
  check('Geometría con ancho y profundidad de 0.042 m', Math.abs(report.follow.width - .042) < 1e-9 && Math.abs(report.follow.depth - .042) < 1e-9, report.follow);
  await render();
  await capture('21-full-lit-ao');
  // Ocultar la geometría ajena permite demostrar que la luz modifica los palitos,
  // sin confundir el brillo del propio rayo, piso o esquirlas con iluminación.
  await ev(`window.__visibility = [];
    vis.layer3d.scene.traverse(object => {
      if ((object.isMesh || object.isLine || object.isPoints) && object !== vis.layer3d.sticks.object) {
        __visibility.push([object, object.visible]); object.visible = false;
      }
    });`);
  const before = await frozenState();
  await render();
  const litAo = await capture('21-sticks-lit-ao');
  await ev(`vis.params.set('ao.enabled', false, { immediate: true });`);
  await render();
  const litNoAo = await capture('21-sticks-lit-no-ao');
  await ev(`vis.params.set('ao.enabled', true, { immediate: true });
    window.__savedIntensities = __rays.lights.map(l => l.intensity);
    __rays.lights.forEach(l => { l.intensity = 0; });`);
  await render();
  const dark = await capture('21-sticks-no-ray-light');
  const after = await frozenState();
  report.visual = { before, after, litAo: litAo.stats, litNoAo: litNoAo.stats, dark: dark.stats,
    lightContribution: difference(litAo, dark), aoContribution: difference(litNoAo, litAo) };
  check('Comparaciones mantienen física y frame idénticos', before.hash === after.hash && before.time === after.time, { before, after });
  check('Palitos visibles sólo con luz de rayos', litAo.stats.lit > 100 && dark.stats.lit === 0, report.visual);
  check('AO oscurece contactos visibles del mismo frame', report.visual.aoContribution.darkerPixels > 100 && report.visual.aoContribution.meanReduction > .001, report.visual.aoContribution);
  await ev(`__rays.lights.forEach((l, i) => { l.intensity = __savedIntensities[i]; });
    __visibility.forEach(([object, visible]) => { object.visible = visible; });`);
  report.fading = await ev(`(() => {
    const ray = __rays.rays[0], light = __rays.lights[ray.slot], full = light.intensity;
    ray.y = vis.params.get('rays.length') / 2; ray.shock = vis.params.get('rays.impactTime') / 2;
    __rays.update(0); const half = light.intensity;
    __rays.update(vis.params.get('rays.impactTime'));
    return { full, half, end: light.intensity, rays: __rays.rays.length };
  })()`);
  check('Luz de impacto decae y libera el slot', report.fading.full > report.fading.half && report.fading.half > 0 && report.fading.end === 0 && report.fading.rays === 0, report.fading);
  report.saturation = await ev(`(() => {
    for (let i = 0; i < 40; i++) vis.params.trigger('ray.spawn', i / 10 - 2);
    __rays.update(0); const occupied = __rays.rays.map(r => r.slot);
    const active = __rays.lights.filter(l => l.intensity > 0).length;
    const sameIds = __rays.lights.every((l, i) => l.id === __lightIds[i]);
    vis.params.set('layer3d.opacity', 0, { immediate: true }); __rays.update(0);
    const hiddenIntensity = __rays.lights.reduce((sum, l) => sum + l.intensity, 0);
    vis.params.set('layer3d.opacity', 1, { immediate: true }); __rays.update(0);
    vis.scenes.goto('11', { transition: 0 }); vis.layer3d.update(0, vis.engine.time);
    return { occupied: occupied.length, unique: new Set(occupied).size, active, sameIds, hiddenIntensity,
      exit: { rays: __rays.rays.length, intensity: __rays.lights.reduce((s, l) => s + l.intensity, 0),
        repulsors: vis.forces.repulsorParams.filter(p => p.x !== 0).length,
        bars: __rays.bars.filter(b => b.visible).length, raysOnly: vis.params.get('particles.raysOnly'),
        emissive: vis.layer3d.sticks.u.emissive.value } };
  })()`);
  check('40 disparos conservan 32 slots únicos y las mismas luces', report.saturation.occupied === 32 && report.saturation.unique === 32 && report.saturation.active === 32 && report.saturation.sameIds, report.saturation);
  check('Opacidad 3D cero apaga luces', report.saturation.hiddenIntensity === 0, report.saturation);
  const exited = report.saturation.exit;
  check('Salir limpia rayos, luces, barras y repulsores', !exited.rays && !exited.intensity && !exited.repulsors && !exited.bars, exited);
  check('Salir restaura emisión normal de palitos', !exited.raysOnly && exited.emissive > 0, exited);
  report.orbTransition = await ev(`(() => {
    vis.scenes.goto('20', { transition: 0 }); vis.params.trigger('orb.flash');
    vis.layer3d.update(vis.params.get('orb.attack'), vis.engine.time);
    const orb = vis.layer3d.elements.find(el => el.constructor.name === 'Orb');
    const before = orb.light.intensity;
    vis.scenes.goto('21'); vis.layer3d.update(0, vis.engine.time);
    return { before, after: orb.light.intensity, raysOnly: vis.params.get('particles.raysOnly') };
  })()`);
  check('20 → 21 apaga la luz residual del orbe al entrar', report.orbTransition.before > 0 && report.orbTransition.after === 0 && report.orbTransition.raysOnly, report.orbTransition);
  await ev(`vis.engine.clock.getDelta(); vis.engine.start();`);

  // Cada caso vuelve a sembrar la misma población. Los pares cambian sólo la
  // intensidad de las luces; rayos, fuerzas, geometría, AO y bloom siguen activos.
  for (const pattern of ['quiet', 'single', 'burst']) {
    for (const lighting of [false, true]) {
      await seedScene();
      await ev(`vis.params.set('rays.lightIntensity', ${lighting ? '__lightDefault' : '0'}, { immediate: true });
        window.__spawnCount = 0;
        window.__spawn = () => {
          const x = ((Math.imul(++__spawnCount, 17) % 39) / 38 * 2 - 1) * 3.5;
          vis.params.trigger('ray.spawn', x);
        };
        ${pattern === 'quiet' ? '' : `__spawn(); window.__rayTimer = setInterval(__spawn, ${pattern === 'single' ? 1500 : '1000 / 14.5'});`}`);
      await sleep(750);
      const initialVersion = await ev(`vis.layer3d.sticks.material.version`);
      await ev(`__samples = []; __previous = 0; __record = true;`);
      await sleep(duration);
      const samples = await ev(`__record = false; clearInterval(window.__rayTimer); __samples`);
      const result = { pattern, lighting, ...metrics(samples),
        simCpu: samples.reduce((sum, s) => sum + s.sim, 0) / samples.length,
        renderCpu: samples.reduce((sum, s) => sum + s.render, 0) / samples.length,
        maxRays: Math.max(...samples.map(s => s.rays)), maxLights: Math.max(...samples.map(s => s.lights)),
        scenes: [...new Set(samples.map(s => s.scene))],
        materialVersions: [...new Set(samples.map(s => s.materialVersion))],
        outliers: samples.filter(s => s.dt > 20) };
      report.performance.push(result);
      check(`${pattern}/${lighting ? 'lit' : 'unlit'} produce frames completos`, samples.length > duration / 1000 * 5 && Number.isFinite(result.fps), result);
      check(`${pattern}/${lighting ? 'lit' : 'unlit'} no invalida material al disparar`, result.materialVersions.length === 1 && result.materialVersions[0] === initialVersion, result.materialVersions);
      check(`${pattern}/${lighting ? 'lit' : 'unlit'} mantiene escena 21`, result.scenes.length === 1 && result.scenes[0] === '21', result.scenes);
      check(`${pattern}/${lighting ? 'lit' : 'unlit'} respeta slots y luces`,
        (pattern === 'quiet' ? result.maxRays === 0 : result.maxRays > 0 && result.maxRays <= (pattern === 'single' ? 1 : 32)) &&
        (lighting ? (pattern === 'quiet' || result.maxLights > 0) : result.maxLights === 0), result);
      console.log(JSON.stringify(result));
      if (lighting && pattern === 'burst') await capture('21-burst-running');
    }
  }
  report.comparisons = ['quiet', 'single', 'burst'].map(pattern => {
    const unlit = report.performance.find(t => t.pattern === pattern && !t.lighting);
    const lit = report.performance.find(t => t.pattern === pattern && t.lighting);
    return { pattern, unlitFps: unlit.fps, litFps: lit.fps, fpsChangePercent: (lit.fps / unlit.fps - 1) * 100,
      unlitP95: unlit.p95, litP95: lit.p95, unlitWorst: unlit.worst, litWorst: lit.worst };
  });
  report.errors = b.errors;
  check('Sin errores de navegador/WebGPU', report.errors.length === 0, report.errors);
} catch (error) {
  report.fatal = error.stack ?? String(error);
  report.errors = b?.errors ?? [];
  console.error(report.fatal);
  process.exitCode = 1;
} finally {
  report.passed = !report.fatal && report.checks.every(c => c.pass);
  if (!report.passed) process.exitCode = 1;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await b?.close();
  console.log(`Artefactos: ${out}`);
}
