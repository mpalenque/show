import { shaderSource } from './shaders.js';
import { finalShaderSource } from './final-shaders.js';
import { finalGeometrySource, createFinalState, stepFinal, inkFrameFor, inkDrippingFrameFor } from './final-engine.js';
import { InkPlayer } from './ink-player.js';
import { PRESETS } from './presets.js';
import { stepFull } from './system/full-presets.js';

const MODES = { normal: 0, add: 1, exclusion: 2, glow: 3, reflect: 4 };
const MAX_PASSES = 8192;
const STRIDE = 256;
let resourceId = 0;

export class MilkyEngine {
  static async create(canvas, onError = console.error) {
    if (!navigator.gpu) throw new Error('WebGPU no está disponible. Abrí esta demo en Chrome o Edge actualizado, desde localhost, con aceleración gráfica activada.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('El navegador no encontró un adaptador WebGPU. Revisá la aceleración gráfica y el controlador de la GPU.');
    const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('texture-compression-bc') ? ['texture-compression-bc'] : [] });
    const engine = new MilkyEngine(canvas, adapter, device, onError);
    await engine.init();
    return engine;
  }

  constructor(canvas, adapter, device, onError, { ownsDevice = true } = {}) {
    this.canvas = canvas;
    this.adapter = adapter;
    this.device = device;
    this.ownsDevice = ownsDevice;
    this.onError = onError;
    this.format = 'rgba8unorm';
    this.presentFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context = canvas.getContext('webgpu');
    this.context.configure({ device, format: this.presentFormat, alphaMode: 'opaque' });
    this.errors = [];
    this._gpuError = event => { this.errors.push(event.error.message); onError(event.error); };
    device.addEventListener('uncapturederror', this._gpuError);
    device.lost.then(info => { if (!this.destroyed) onError(new Error(`Se perdió la conexión con la GPU: ${info.message}. Recargá la demo.`)); });
    this.states = new Map();
    this.extraPresets = new Map();
    this.uniformData = new Float32Array(MAX_PASSES * STRIDE / 4);
    this.bindCache = new Map();
    this.width = 800;
    this.height = 1280;
    this.frame = 0;
    this.settings = { autoSeed: true, warp: 1, detail: 1, opacity: null, brush: null, presetOverrides: {}, externalSeeds: {},
      final: { fx1: 0, fx2: 0, fx4: 0, button: true, loop: true, inkProgress: null, view: 'output', flash: true } };
    this.stats = { frames: 0, passes: 0, cpuMs: 0 };
  }

  async init() {
    const d = this.device;
    const info = this.adapter.info;
    this.gpuName = [info?.description || info?.device || '', info?.vendor || ''].filter(Boolean).join(' · ') || 'WebGPU';
    this.uniformBuffer = d.createBuffer({ label: 'Milky uniforms', size: this.uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.clamp = d.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.repeat = d.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 16 });
    this.layout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const module = d.createShaderModule({ label: 'Milky translated vvvv shaders', code: shaderSource + finalShaderSource + finalGeometrySource });
    const compilation = await module.getCompilationInfo();
    const failures = compilation.messages.filter(m => m.type === 'error');
    if (failures.length) throw new Error(failures.map(m => `Shader línea ${m.lineNum}: ${m.message}`).join('\n'));
    const pipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const names = ['copy', 'normal', 'displace', 'dither', 'flow', 'unsharp', 'blend', 'hscb', 'seed', 'display',
      'inkInput', 'vertical', 'hsvPrep', 'unsharpHsv', 'growth', 'growthColor', 'transform', 'levels', 'finalSeed', 'ringSeed'];
    this.pipelines = Object.fromEntries(await Promise.all(names.map(async name => [name, await d.createRenderPipelineAsync({
      label: name, layout: pipelineLayout, vertex: { module, entryPoint: 'vsMain' },
      fragment: { module, entryPoint: `${name}Frag`, targets: [{ format: name === 'display' ? this.presentFormat : name === 'growth' ? 'rgba16float' : this.format }] },
      primitive: { topology: 'triangle-list' },
    })])));
    this.dummy = this.texture('black', 1, 1);
    d.queue.writeTexture({ texture: this.dummy.texture }, new Uint8Array([0, 0, 0, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.white = this.texture('white', 1, 1);
    d.queue.writeTexture({ texture: this.white.texture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.ink = new InkPlayer(this);
    this.reset();
  }

  texture(label, width = this.width, height = this.height, format = this.format, mipmaps = true) {
    const count = mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    const texture = this.device.createTexture({ label, size: [width, height], format, mipLevelCount: count,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    const result = { id: ++resourceId, texture, width, height, count, view: texture.createView(), levels: [], version: 0, mipVersion: -1 };
    for (let i = 0; i < count; i++) result.levels.push(texture.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    return result;
  }

  state(presetId) {
    if (this.states.has(presetId)) return this.states.get(presetId);
    const definition = this.extraPresets.get(presetId) || PRESETS.find(x => x.id === presetId);
    const p = definition && { ...definition, ...this.settings.presetOverrides[presetId] };
    if (!p) throw new Error(`Preset desconocido: ${presetId}`);
    if (presetId === 'final' || p.inkOnly) { const state = createFinalState(this, p, { inkOnly: p.inkOnly }); this.states.set(presetId, state); return state; }
    const state = { p, textures: [], index: 0, frame: 0, time: 0, lastSeedSecond: -1, manualSeed: true, rng: 0x71c431a9,
      direction: [...p.direction], secondaryDirection: [...p.secondaryDirection], lastSplashCycle: -1, lastGridCycle: -1 };
    const scale = this.width / 800;
    const [originalWidth, originalHeight] = p.originalResolution || [800, 1280];
    const create = name => { const t = this.texture(`${presetId}/${name}`, Math.round(originalWidth * scale), Math.round(originalHeight * scale)); state.textures.push(t); return t; };
    state.history = [create('history0'), create('history1')];
    state.displacementHistory = [create('displaceHistory0'), create('displaceHistory1')];
    for (const name of ['seed', 'dither', 'post', 'secondary', 'normal', 'blend', 'color']) state[name] = create(name);
    state.output = state.history[0];
    const enc = this.device.createCommandEncoder();
    for (const t of state.textures) {
      // Native FrameDelay has no resource on its first evaluation. TextureFX
      // resolves this missing resource to WhiteTexture (confirmed in DX11 IL).
      const initial = t === state.history[0] || t === state.displacementHistory[0] ? 1 : 0;
      for (const view of t.levels) { const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: initial, g: initial, b: initial, a: 1 } }] }); pass.end(); }
    }
    this.device.queue.submit([enc.finish()]);
    this.states.set(presetId, state);
    return state;
  }

  reset(presetId) {
    for (const [id, state] of this.states) {
      if (presetId && presetId !== id) continue;
      for (const tex of state.textures) tex.texture.destroy();
      this.states.delete(id);
    }
    this.bindCache.clear();
    if (!presetId) this.frame = 0;
  }

  setResolution(width, height) { this.width = width; this.height = height; this.reset(); }
  registerPreset(preset) { this.extraPresets.set(preset.id, preset); }
  updatePreset(id, values) {
    this.settings.presetOverrides[id] = { ...this.settings.presetOverrides[id], ...values };
    const state = this.states.get(id);
    if (state) Object.assign(state.p, values);
  }
  random(state) { let x = state.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state.rng = x >>> 0; return state.rng / 4294967296; }
  trigger(type, ids = PRESETS.map(p => p.id)) {
    for (const id of ids) {
      const state = this.state(id);
      if (type === 'seed') state.manualSeed = true;
      if (id === 'final' && type === 'seed') { state.inkTime = 0; this.settings.final.inkProgress = null; this.settings.final.button = true; }
      if (id === 'final' && type === 'kick') { state.narrow = !state.narrow; state.ringExtra = this.random(state) > 0.5; }
      if ((state.p.graph || id) === '3a' && type === 'snare') { const v = [-0.05, 2, -2][Math.floor(this.random(state) * 4) % 3]; state.direction = [v, v]; }
      if ((state.p.graph || id) === '3a' && type === 'kick') state.secondaryDirection = [[0, 0], [0, 1], [1, 0]][Math.floor(this.random(state) * 4) % 3];
    }
  }

  begin() { this.passCount = 0; this.encoder = this.device.createCommandEncoder({ label: 'Milky frame' }); }
  bindings(a, b, mip = -1, c = this.dummy, bMip = -1) {
    const key = `${a.id}/${b.id}/${mip}/${c.id}/${bMip}`;
    if (!this.bindCache.has(key)) this.bindCache.set(key, this.device.createBindGroup({ layout: this.layout, entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer, offset: 0, size: 64 } },
      { binding: 1, resource: mip < 0 ? a.view : a.levels[mip] }, { binding: 2, resource: bMip < 0 ? b.view : b.levels[bMip] },
      { binding: 3, resource: this.clamp }, { binding: 4, resource: this.repeat },
      { binding: 5, resource: c.view },
    ] }));
    return this.bindCache.get(key);
  }

  pass(name, target, a = this.dummy, b = this.dummy, values = [], options = {}) {
    if (this.passCount >= MAX_PASSES) throw new Error('Demasiadas pasadas en un frame. Bajá la frecuencia de simulación.');
    const offset = this.passCount++ * (STRIDE / 4);
    this.uniformData.fill(0, offset, offset + 16);
    this.uniformData.set(values, offset);
    const view = options.view || target.levels[options.level || 0];
    const pass = this.encoder.beginRenderPass({ label: name, colorAttachments: [{ view, loadOp: options.load || 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.pipelines[name]);
    pass.setBindGroup(0, this.bindings(a, b, options.sourceMip ?? -1, options.c || this.dummy, options.bMip ?? -1), [offset * 4]);
    if (options.viewport) pass.setViewport(...options.viewport, 0, 1);
    pass.draw(3); pass.end();
    if (target) target.version++;
  }

  mips(texture) {
    if (texture.mipVersion === texture.version) return;
    for (let level = 1; level < texture.count; level++) this.pass('copy', texture, texture, this.dummy, [], { level, sourceMip: level - 1 });
    texture.mipVersion = texture.version;
  }

  step(state, dt) {
    if (state.p.fullLegacy) return stepFull(this, state, dt);
    if (state.p.id === 'final' || state.p.inkOnly) return stepFinal(this, state, dt);
    const p = state.p;
    const graph = p.graph || p.id;
    const previous = state.history[state.index];
    const nextIndex = 1 - state.index;
    const next = state.history[nextIndex];
    const previousDisplace = state.displacementHistory[state.index];
    const currentDisplace = state.displacementHistory[nextIndex];
    const w = state.seed.width, h = state.seed.height, s = this.settings;
    const second = Math.floor(state.time + 1e-7);
    const pulse = state.manualSeed || (s.autoSeed && second !== state.lastSeedSecond);
    state.lastSeedSecond = second;
    let seedOn = p.seed === 'grid' ? s.autoSeed || state.manualSeed : pulse;
    const gridCycle = Math.floor(state.time / 22);
    const whiteSeed = p.seed === 'grid' && s.autoSeed && gridCycle > 0 && gridCycle !== state.lastGridCycle;
    state.lastGridCycle = gridCycle;
    state.manualSeed = false;
    const brush = s.brush || [0.5, 0.5, 0.025, 0];
    this.pass('seed', state.seed, this.dummy, this.dummy,
      [whiteSeed ? 3 : p.seed === 'grid' ? 2 : 1, p.seed === 'grid' ? state.time / (p.seedRotationPeriod || 12) : 0, p.seedScale ?? (p.seed === 'grid' ? 0.73 : 0.81), seedOn ? 1 : 0,
       w, h, 1, 1, 1, p.seed === 'grid' && !whiteSeed ? 0 : 1, p.seed === 'grid' && !whiteSeed ? 0 : 1, 0, ...brush]);
    if (s.externalSeeds[p.id]) this.pass('copy', state.seed, s.externalSeeds[p.id]);
    if (graph === 'splash' && second !== state.lastSplashCycle) {
      state.secondaryDirection = [this.random(state) - 0.5, this.random(state) - 0.5];
      state.lastSplashCycle = second;
    }
    let mapSource;
    if (graph === '2a') {
      this.mips(previous);
      this.pass('flow', state.secondary, previous, previous, [p.secondaryAmount * s.warp, p.flowBlur, p.flowIterations, 0, w, h, 0, 0], { sourceMip: 0 });
      this.pass('dither', state.dither, state.secondary, this.dummy, [p.ditherThreshold, 0, 0, 0, w, h, 0, 0]);
      mapSource = state.dither;
    } else {
      this.pass('dither', state.dither, previous, this.dummy, [p.ditherThreshold, 0, 0, 0, w, h, 0, 0]);
      let input = state.dither;
      if (p.postBlendMode !== 'disabled') {
        this.pass('blend', state.post, graph === '1a' ? previous : state.dither, graph === '1a' ? state.dither : previous, [p.postBlendOpacity, MODES[p.postBlendMode], 0, 0]);
        input = state.post;
      }
      if (p.secondaryMode === 'flow') {
        this.mips(state.dither);
        // Original INITIAL has no generated mip chain; PASSRESULT0 (control) does.
        this.pass('flow', state.secondary, input, state.dither, [p.secondaryAmount * s.warp, p.flowBlur, p.flowIterations, 0, w, h, 0, 0], { sourceMip: 0 });
      } else {
        this.pass('displace', state.secondary, input, previousDisplace,
          [p.secondaryAmount * s.warp, ...state.secondaryDirection, p.secondaryMapSmooth || 0, w, h, 0, 0]);
      }
      mapSource = state.secondary;
    }
    this.mips(mapSource);
    this.pass('normal', state.normal, mapSource, this.dummy, [p.normalRadius, p.normalDepth, 0, 0, w, h, 0, 0]);
    this.pass('displace', currentDisplace, mapSource, state.normal,
      [p.displaceAmount * s.warp, ...state.direction, 0, w, h, 0, 0]);
    this.pass('blend', state.blend, state.seed, currentDisplace, [s.opacity ?? p.opacity, MODES[p.blendMode], 0, 0]);
    this.mips(state.blend);
    this.pass('unsharp', next, state.blend, this.dummy,
      [p.unsharpAmount * s.detail, p.unsharpShape, p.saturation, 0, 1, 0, w, h]);
    if (graph === '2a') { this.pass('hscb', state.color, next, this.dummy, [0, 1, 0, p.hscb?.brightness ?? 2.2]); state.output = state.color; }
    else state.output = next;
    state.index = nextIndex; state.frame++; state.time += dt;
  }

  resizeCanvas(gallery, states) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.viewports = [];
    const cols = gallery ? (width / height > 1.4 ? 3 : 2) : 1;
    const rows = gallery ? Math.ceil(states.length / cols) : 1;
    for (let i = 0; i < states.length; i++) {
      const cellW = width / cols, cellH = height / rows;
      const { width: outputWidth, height: outputHeight } = states[i].output;
      const scale = Math.min((cellW - (gallery ? 12 * dpr : 0)) / outputWidth, cellH / outputHeight);
      const drawW = Math.max(1, Math.floor(outputWidth * scale)), drawH = Math.max(1, Math.floor(outputHeight * scale));
      this.viewports.push([Math.floor((i % cols) * cellW + (cellW - drawW) / 2), Math.floor(Math.floor(i / cols) * cellH + (cellH - drawH) / 2), drawW, drawH]);
    }
  }

  render({ preset = '1a', gallery = false, steps = 1, dt = 1 / 60 } = {}) {
    const started = performance.now();
    const ids = gallery ? PRESETS.map(p => p.id) : [preset];
    const states = ids.map(id => this.state(id));
    this.begin();
    for (let i = 0; i < steps; i++) { for (const state of states) this.step(state, dt); this.frame++; }
    this.resizeCanvas(gallery, states);
    const view = this.context.getCurrentTexture().createView();
    for (let i = 0; i < states.length; i++) this.pass('display', null, states[i].output, this.dummy, [], { view, load: i ? 'load' : 'clear', viewport: this.viewports[i] });
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData.buffer, 0, this.passCount * STRIDE);
    this.device.queue.submit([this.encoder.finish()]);
    this.stats = { frames: this.frame, passes: this.passCount, cpuMs: performance.now() - started };
  }

  async readback(presetId) {
    const texture = this.state(presetId).output;
    const { width, height } = texture;
    const pitch = Math.ceil(width * 4 / 256) * 256;
    const buffer = this.device.createBuffer({ size: pitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: texture.texture }, { buffer, bytesPerRow: pitch }, [width, height]);
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * pitch, y * pitch + width * 4), y * width * 4);
    buffer.unmap(); buffer.destroy();
    return pixels;
  }

  async prepare(ids = ['final'], dt = 1 / 60) {
    if (ids.includes('inkdripping')) {
      const ink = this.state('inkdripping');
      await this.ink.get(inkDrippingFrameFor(ink, this.settings.ink));
    }
    if (!ids.includes('final')) return;
    const state = this.state('final');
    const frame = inkFrameFor(state, this.settings.final);
    this.ink.loading = !this.ink.peek(frame);
    try { await this.ink.get(frame); } finally { this.ink.loading = false; }
  }

  destroy() { this.destroyed = true; this.device.removeEventListener('uncapturederror', this._gpuError); this.ink?.dispose(); this.reset(); this.dummy?.texture.destroy(); this.white?.texture.destroy(); this.uniformBuffer?.destroy(); if (this.ownsDevice) this.device.destroy(); }
}
