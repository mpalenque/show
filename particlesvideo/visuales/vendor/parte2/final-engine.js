/**
 * Fifth input of 2D/milky FULL.v4p, referencing ../milky final.v4p.
 * Independent one-frame histories: vertical, internal Growth (16F), exported
 * Growth (UNORM), main Unsharp, main Displace, and auxiliary ring Unsharp.
 * Native signal sources /fx1 /fx2 /fx4 /BOTON and Kick are exposed in the UI.
 * Loop is a demo transport convenience; the patch itself expects BOTON.
 */
export function inkFrameFor(state, settings) {
  const progress = settings.inkProgress ?? (settings.button ? Math.min(1, state.inkTime / (settings.attack ?? 3.04)) : 0);
  // Map(-.014..1), then Map(60..600), Float extrapolation. Integer frame lookup.
  return Math.max(0, Math.min(1066, Math.floor(52.44 + 547.56 * progress)));
}

export function createFinalState(engine, p, { inkOnly = false } = {}) {
  const scale = engine.width / 800;
  const state = { p, textures: [], width: Math.round(3840 * scale), height: Math.round(1200 * scale),
    index: 0, frame: 0, time: 0, inkTime: 0, inkFrame: inkOnly ? 60 : 52, narrow: false, ringExtra: true, rng: 0x71c431a9,
    inkEnvelope: 0, inkHoldUntil: -1, growthResetUntil: -1 };
  const make = (name, w = state.width, h = state.height, format = 'rgba8unorm', mipmaps = true) => {
    const t = engine.texture(`final/${name}`, w, h, format, mipmaps); state.textures.push(t); return t;
  };
  const pair = (name, w, h, format, mipmaps) => [make(`${name}0`, w, h, format, mipmaps), make(`${name}1`, w, h, format, mipmaps)];
  if (!inkOnly) {
    state.history = pair('history');
    state.displacementHistory = pair('displacement', undefined, undefined, 'rgba8unorm', false);
    for (const name of ['seed', 'dither', 'secondary', 'normal', 'blend', 'color', 'finalOutput']) state[name] = make(name);
  }
  // Original dimensions remain independent of the wide main feedback.
  const iw = Math.round(1280 * scale), ih = Math.round(720 * scale);
  state.vertical = pair('vertical', iw, ih);
  state.growth = pair('growth', iw, ih);
  state.growthFeed = pair('growthFeed', iw, ih, 'rgba16float', false);
  for (const name of ['inkInput', 'inkNormal', 'inkDisplace', 'hsv', 'sharpInk', 'growthMap', 'growthNormal', 'growthDisplace', 'distort']) state[name] = make(name, iw, ih);
  const rw = Math.round(960 * scale), rh = Math.round(320 * scale);
  if (!inkOnly) {
    state.ring = pair('ring', rw, rh);
    for (const name of ['ringSeed', 'ringNormal', 'ringDisplace', 'ringSecondary', 'ringBlend']) state[name] = make(name, rw, rh);
  }
  state.output = inkOnly ? state.distort : state.history[0];
  const encoder = engine.device.createCommandEncoder();
  for (const t of state.textures) {
    // Every missing FrameDelay resource resolves to WhiteTexture, including
    // the internal Growth shader feedback. No native reset bang is connected.
    const white = [state.history?.[0], state.displacementHistory?.[0], state.ring?.[0],
      state.vertical[0], state.growth[0], state.growthFeed[0]].includes(t) ? 1 : 0;
    const alpha = 1;
    for (const view of t.levels) {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store',
        clearValue: { r: white, g: white, b: white, a: alpha } }] }); pass.end();
    }
  }
  engine.device.queue.submit([encoder.finish()]);
  return state;
}

export function stepFinal(e, t, dt) {
  const inkOnly = t.p.inkOnly;
  const s = inkOnly ? e.settings.ink : e.settings.final;
  const frame = inkOnly ? inkDrippingFrameFor(t, s) : inkFrameFor(t, s);
  const ink = e.ink.peek(frame);
  e.ink.loading = !ink;
  if (!ink) {
    if (t.loadingFrame !== frame) {
      t.loadingFrame = frame;
      e.ink.get(frame).catch(error => { if (!e.destroyed) e.onError(error); })
        .finally(() => { t.loadingFrame = null; });
    }
    return; // WaitForFrame: do not advance this preset until its DDS is ready.
  }
  // Fetch future displayed frames, not all 1,067 DDS files. Simulation clock
  // stays independent of requestAnimationFrame and network latency.
  if (inkOnly) {
    e.ink.preload(Array.from({ length: 8 }, (_, i) => inkDrippingFrameFor(t, s, dt * (i + 1))));
  } else if (s.inkProgress === null && s.button) {
    const frames = [];
    for (let i = 1; i <= 8; i++) {
      const nextTime = t.inkTime + i * dt;
      const duration = s.loopDuration ?? 4.5;
      frames.push(inkFrameFor({ inkTime: s.loop && nextTime > duration ? nextTime % duration : nextTime }, s));
    }
    e.ink.preload(frames).catch(error => { if (!e.destroyed) e.onError(error); });
  }
  const i = t.index, n = 1 - i, w = t.width, h = t.height;
  const iw = t.inkInput.width, ih = t.inkInput.height;
  const pass = (...args) => e.pass(...args);
  pass('inkInput', t.inkInput, ink);
  pass('vertical', t.vertical[n], t.inkInput, t.vertical[i], [s.verticalScale ?? .013, s.verticalFeedback ?? .97]);
  pass('normal', t.inkNormal, t.vertical[n], e.dummy, [1, s.inkDepth ?? 2.36, 0, 0, iw, ih]);
  pass('displace', t.inkDisplace, t.vertical[n], t.inkNormal, [s.inkDisplace ?? .61, 1, 1, 0, iw, ih, 1]);
  pass('hsvPrep', t.hsv, t.inkDisplace); e.mips(t.hsv);
  pass('unsharpHsv', t.sharpInk, t.hsv, t.inkDisplace, [s.hsvAmount ?? 2, s.hsvShape ?? -1.46, s.hsvHue ?? -1.42, s.hsvSaturation ?? .5, 1, iw, ih]);
  pass('transform', t.growthMap, t.growth[i], e.dummy, [1, 1, s.growthTranslate ?? .001, 0, 0]);
  // Switch index saved as 2, modulo its two inputs => processed ink brush.
  // The old Boolean IOBox is a presentation type, not an explicit conversion.
  pass('growth', t.growthFeed[n], t.growthMap, t.growthFeed[i],
    [s.growthSpeed ?? 100, s.growthFade ?? .12, s.growthShape ?? -.4, s.growthEdge ?? 1,
      inkOnly ? (s.hideBrush ? 1 : 0) : e.random(t) >= .5 ? 1 : 0,
      inkOnly && t.time < t.growthResetUntil ? 1 : 0, iw, ih], { c: t.sharpInk });
  pass('growthColor', t.growth[n], t.growthFeed[n], e.dummy, [1, 1]);
  pass('normal', t.growthNormal, t.growth[n], e.dummy, [1, 2.36, 0, 0, iw, ih]);
  pass('displace', t.growthDisplace, t.growth[n], t.growthNormal, [s.growthDisplace ?? .54, 1, 1, 0, iw, ih, 1]);
  // Blend43=Normal, opacity1 -> its second input. HSCB20 disabled.
  pass('levels', t.distort, t.growthDisplace, e.dummy, [s.inputBlack ?? .38629, 1, s.outputBlack ?? .24456, 1, 1, 0, 1, 0, 1, 1]);
  if (inkOnly) {
    t.inkEnvelope = inkDrippingEnvelope(t, s, dt);
    t.output = t.distort; t.inkFrame = frame; t.index = n; t.frame++; t.time += dt;
    return;
  }
  pass('finalSeed', t.seed, t.distort, e.dummy, [t.narrow ? 1 : 0]);

  // Main graph: resolutions are inherited from Blend155's 3840x1200 output.
  let source = t.history[i];
  const feedback = s.sceneGate === false || s.button;
  if (feedback) { pass('dither', t.dither, source, e.dummy, [s.threshold ?? 6, 0, 0, 0, w, h]); source = t.dither; }
  const fx2 = (s.fx2 - .3515625) / (1 - .3515625);
  pass('displace', t.secondary, source, t.displacementHistory[i],
    [(s.secondaryAmount ?? .105) * e.settings.warp, s.fx1, fx2 * .8, .22, w, h, 0], { bMip: 0 });
  e.mips(t.secondary);
  pass('normal', t.normal, t.secondary, e.dummy, [s.normalRadius ?? 12, 1 - fx2, 0, 0, w, h]);
  pass('displace', t.displacementHistory[n], t.secondary, t.normal,
    [(s.displaceAmount ?? -.047) * e.settings.warp, -.66, -.66, 0, w, h, 0]);
  if (feedback) pass('blend', t.blend, t.seed, t.displacementHistory[n], [e.settings.opacity ?? s.opacity ?? .94, 2]);
  else pass('copy', t.blend, t.seed);
  e.mips(t.blend);
  pass('unsharp', t.history[n], t.blend, e.dummy, [(s.unsharpAmount ?? 1.75) * e.settings.detail, s.unsharpShape ?? .03, s.saturation ?? .55, 0, 1, 0, w, h]);
  const contrast = s.flash && (t.time / (s.flashPeriod ?? .19)) % 1 >= .5 ? (s.contrast ?? 4) : 0;
  pass('hscb', t.color, t.history[n], e.dummy, [0, 1, contrast, s.brightness ?? 2.34]);

  const rw = t.ringSeed.width, rh = t.ringSeed.height;
  pass('ringSeed', t.ringSeed, e.dummy, e.dummy, [.47, .7846, 60, 0, rw, rh]);
  e.mips(t.ring[i]);
  pass('normal', t.ringNormal, t.ring[i], e.dummy, [9.77, -.1, 0, 0, rw, rh]);
  pass('displace', t.ringDisplace, t.ring[i], t.ringNormal, [s.ringAmount ?? 4.67, .00411449677, .00566311896, 0, rw, rh, 0]);
  let ringSource = t.ringDisplace;
  if (t.ringExtra) { pass('displace', t.ringSecondary, ringSource, e.white, [3, .002, .002, 0, rw, rh, 0]); ringSource = t.ringSecondary; }
  pass('blend', t.ringBlend, t.ringSeed, ringSource, [s.ringOpacity ?? .87, 2]); e.mips(t.ringBlend);
  pass('unsharp', t.ring[n], t.ringBlend, e.dummy, [s.ringSharp ?? .35, s.fx1, 0, 0, 1, 0, rw, rh]);
  // NormalMap103 is disabled; the previous ring image itself controls NormalMap warp.
  pass('displace', t.finalOutput, t.color, t.ring[i], [1.3 * s.fx4 * e.settings.warp, 1, 1, 0, w, h, 1]);
  t.output = s.view === 'ink' ? t.inkInput : s.view === 'distort' ? t.distort : t.finalOutput;
  t.inkFrame = frame; t.index = n; t.frame++; t.time += dt;
  if (s.button) t.inkTime += dt; else t.inkTime = 0;
  if (s.loop && t.inkTime > (s.loopDuration ?? 4.5)) t.inkTime %= s.loopDuration ?? 4.5;
}

// INK dripping2 has its own FrameDelays. Its 4-second Monoflop drives a
// 15-second linear attack; FilterTime=15 is an obsolete pin in beta42.
// Decay=1s remains an exposed assumption until the native default is measured.
function inkDrippingEnvelope(state, settings, advance) {
  const rising = Math.max(0, Math.min(advance, state.inkHoldUntil - state.time));
  const falling = advance - rising;
  const raised = Math.min(1, state.inkEnvelope + rising / Math.max(.000001, settings.attack ?? 15));
  return falling > 0 ? Math.max(0, raised - falling / Math.max(.000001, settings.decay ?? 1)) : raised;
}
export function inkDrippingFrameFor(state, settings, advance = 0) {
  return Math.floor(60 + 540 * inkDrippingEnvelope(state, settings, advance) + 1e-8);
}

export const finalGeometrySource = /* wgsl */ `
@fragment fn finalSeedFrag(input: VertexOutput) -> @location(0) vec4f {
  if (params.a.x < 0.5) { return sourceAt(input.uv, 0.0); }
  // Renderer156: full-height textured quad, scale X=.4, then white Quad
  // scale X=.006, Y=2.05. The latter is .003 of viewport width.
  let x = (input.uv.x - 0.5) / 0.4 + 0.5;
  var color = vec4f(0.0, 0.0, 0.0, 1.0);
  if (x >= 0.0 && x <= 1.0) { color = sourceAt(vec2f(x, input.uv.y), 0.0); }
  if (abs(input.uv.x - 0.5) <= 0.0015) { color = vec4f(1.0); }
  return color;
}
@fragment fn ringSeedFrag(input: VertexOutput) -> @location(0) vec4f {
  let aspect = params.b.x / params.b.y;
  let point = (input.uv * 2.0 - vec2f(1.0)) * vec2f(min(1.0, aspect), min(1.0, 1.0 / aspect));
  // FeralTic Segment uses Resolution vertices, with the last closing the ring.
  let sector = 6.283185307179586 / (params.a.z - 1.0);
  let angle = atan2(point.y, point.x);
  let polygonRadius = 0.5 * params.a.x * cos(sector * 0.5) / cos((angle / sector - floor(angle / sector)) * sector - sector * 0.5);
  let radius = length(point);
  let inside = radius <= polygonRadius && radius >= polygonRadius * params.a.y;
  return vec4f(vec3f(select(0.0, 1.0, inside)), 1.0);
}
`;
