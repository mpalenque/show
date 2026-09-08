import { shaderSource } from '../shaders.js';
import { compositionShaderSource } from './composition-shaders.js';

const BASE_FULL = { x: 0, y: .8057, width: 2, height: .7061 };
const BASE_VIEW = { scaleY: 1.57, y: -.82 };
const CROP_TOP = .5 - (BASE_FULL.y * BASE_VIEW.scaleY + BASE_VIEW.y + BASE_FULL.height * BASE_VIEW.scaleY / 2) / 2;
const CROP_HEIGHT = BASE_FULL.height * BASE_VIEW.scaleY / 2;
const LAYER = { enabled: true, opacity: 1, brightness: 1, ...BASE_FULL,
  rotation: 0, uvScaleX: 1, uvScaleY: 1, uvX: 0, uvY: 0, uvRotation: 0, blend: 'normal', wrap: false };

export const COMPOSITION_ASSETS = [{
  id: 'part2-overlay', url: '/assets/part2-overlay.png',
  source: 'C:/Users/mpale/Downloads/Group 1 (1).png', width: 3840, height: 2160,
  bytes: 37626, purpose: 'Quad 32457: original grey/red calibration overlay',
}];

export const DEFAULT_COMPOSITION = {
  fullVideo: { ...LAYER, enabled: false, uvScaleY: .82, uvY: .06 },
  fullMilky: { ...LAYER },
  // Six 448×1008 blocks fill the requested 2688×1008 LED wall.
  stripes: { enabled: true, x: 0, y: BASE_FULL.y, width: 2,
    stripWidth: 2 / 6, height: BASE_FULL.height, rotation: 0,
    videoOpacity: [0, 0, 0, 0, 0, 0], milkyOpacity: [0, 0, 0, 0, 0, 0],
    videoBrightness: 1, milkyBrightness: 1, blend: 'normal',
    uvScaleX: .28, uvScaleY: 1, uvX: 0, uvY: 0, uvRotation: 0,
    rotations: [0, 0, 0, 0, 0, 0], flips: [1, 1, 1, 1, 1, 1],
  },
  view: { mode: 'show-strip', ...BASE_VIEW, x: 0, scaleX: 1,
    outputX: 0, outputY: -.43, outputScaleX: 1, outputScaleY: 1 },
  warp: { enabled: false, amount: -.31, directionX: 1, directionY: 1,
    depth: 1, shape: 0, radius: 1, full: true,
    mask: [0, 0, 0, 0, 0, 0], maskMode: 'legacy-overlap' },
  ink: { ...LAYER, enabled: false, x: 0, y: .41, width: .66, height: 1.63 },
  overlay: { ...LAYER, enabled: false, opacity: .20517, brightness: .82677,
    x: 0, y: 0, width: 2, height: 2 },
};

export function cloneCompositionDefaults() { return structuredClone(DEFAULT_COMPOSITION); }

function merge(defaults, input) {
  const result = {};
  for (const [key, value] of Object.entries(defaults)) {
    const next = input?.[key];
    result[key] = Array.isArray(value) ? [...(Array.isArray(next) ? next : value)]
      : value && typeof value === 'object' ? merge(value, next) : next ?? value;
  }
  return result;
}

const getDefault = path => path.split('.').reduce((value, key) => value[key], DEFAULT_COMPOSITION);
const parameter = (path, label, type, group, details = {}) => ({ path, label, type, group, default: getDefault(path), ...details });
const numeric = (path, label, group, min, max, step = .01) => parameter(path, label, 'number', group, { min, max, step });
const choices = (path, label, group, options) => parameter(path, label, 'select', group, { options });
const blendOptions = ['normal', 'add', 'multiply', 'screen'];
const layerParameters = (prefix, group) => [
  parameter(`${prefix}.enabled`, 'Activo', 'boolean', group),
  numeric(`${prefix}.opacity`, 'Opacidad', group, 0, 1), numeric(`${prefix}.brightness`, 'Brillo', group, 0, 2),
  numeric(`${prefix}.x`, 'Posición X', group, -2, 2), numeric(`${prefix}.y`, 'Posición Y', group, -2, 2),
  numeric(`${prefix}.width`, 'Ancho', group, .01, 4), numeric(`${prefix}.height`, 'Alto', group, .01, 4),
  numeric(`${prefix}.rotation`, 'Rotación', group, -.5, .5, .001),
  numeric(`${prefix}.uvScaleX`, 'Escala de textura X', group, -3, 3),
  numeric(`${prefix}.uvScaleY`, 'Escala de textura Y', group, -3, 3),
  numeric(`${prefix}.uvX`, 'Recorte de textura X', group, -1, 1),
  numeric(`${prefix}.uvY`, 'Recorte de textura Y', group, -1, 1),
  numeric(`${prefix}.uvRotation`, 'Rotación de textura', group, -.5, .5, .001),
  choices(`${prefix}.blend`, 'Mezcla', group, blendOptions),
  parameter(`${prefix}.wrap`, 'Repetir textura', 'boolean', group),
];
export const COMPOSITION_PARAMETERS = [
  ...layerParameters('fullVideo', 'Video completo'), ...layerParameters('fullMilky', 'Milky completo'),
  parameter('stripes.enabled', 'Franjas activas', 'boolean', 'Seis franjas'),
  numeric('stripes.x', 'Posición X', 'Seis franjas', -2, 2),
  numeric('stripes.y', 'Posición Y', 'Seis franjas', -2, 2),
  numeric('stripes.width', 'Distribución horizontal', 'Seis franjas', .01, 4),
  numeric('stripes.stripWidth', 'Ancho por franja', 'Seis franjas', .01, 1),
  numeric('stripes.height', 'Alto de las franjas', 'Seis franjas', .01, 3),
  numeric('stripes.rotation', 'Rotación de las franjas', 'Seis franjas', -.5, .5, .001),
  numeric('stripes.videoBrightness', 'Brillo de videos', 'Seis franjas', 0, 2),
  numeric('stripes.milkyBrightness', 'Brillo de Milky', 'Seis franjas', 0, 2),
  choices('stripes.blend', 'Mezcla', 'Seis franjas', blendOptions),
  numeric('stripes.uvScaleX', 'Escala de textura X', 'Seis franjas', -3, 3),
  numeric('stripes.uvScaleY', 'Escala de textura Y', 'Seis franjas', -3, 3),
  numeric('stripes.uvX', 'Recorte X', 'Seis franjas', -1, 1),
  numeric('stripes.uvY', 'Recorte Y', 'Seis franjas', -1, 1),
  numeric('stripes.uvRotation', 'Rotación de videos', 'Seis franjas', -.5, .5, .001),
  ...Array.from({ length: 6 }, (_, index) => [
    numeric(`stripes.videoOpacity.${index}`, `Video ${index + 1}`, 'Seis franjas', 0, 1),
    numeric(`stripes.milkyOpacity.${index}`, `Milky ${index + 1}`, 'Seis franjas', 0, 1),
    numeric(`stripes.rotations.${index}`, `Rotación Milky ${index + 1}`, 'Seis franjas', -.5, .5, .001),
    numeric(`stripes.flips.${index}`, `Espejo Milky ${index + 1}`, 'Seis franjas', -1, 1, 2),
    numeric(`warp.mask.${index}`, `Máscara ${index + 1}`, 'Deformación global', 0, 1),
  ]).flat(),
  parameter('warp.enabled', 'Deformación activa', 'boolean', 'Deformación global'),
  numeric('warp.amount', 'Intensidad', 'Deformación global', -1, 1, .001),
  numeric('warp.directionX', 'Dirección X', 'Deformación global', -2, 2),
  numeric('warp.directionY', 'Dirección Y', 'Deformación global', -2, 2),
  numeric('warp.depth', 'Profundidad', 'Deformación global', 0, 4),
  numeric('warp.shape', 'Forma', 'Deformación global', -2, 2),
  numeric('warp.radius', 'Radio', 'Deformación global', 0, 1),
  parameter('warp.full', 'Control sobre toda la imagen', 'boolean', 'Deformación global'),
  choices('warp.maskMode', 'Distribución de máscara', 'Deformación global', ['legacy-overlap', 'stripes']),
  ...layerParameters('ink', 'Tinta adicional'), ...layerParameters('overlay', 'Guía original'),
  choices('view.mode', 'Encuadre', 'Salida', ['show-strip', 'reference']),
  numeric('view.x', 'Cámara X', 'Salida', -2, 2), numeric('view.y', 'Cámara Y', 'Salida', -2, 2),
  numeric('view.scaleX', 'Escala de cámara X', 'Salida', .1, 4), numeric('view.scaleY', 'Escala de cámara Y', 'Salida', .1, 4),
  numeric('view.outputX', 'Salida X', 'Salida', -2, 2), numeric('view.outputY', 'Salida Y', 'Salida', -2, 2),
  numeric('view.outputScaleX', 'Escala de salida X', 'Salida', .1, 3), numeric('view.outputScaleY', 'Escala de salida Y', 'Salida', .1, 3),
];

export function sceneComposition(scene, kickWarp = false) {
  return { warpEnabled: scene >= 65 && scene <= 68 && Boolean(kickWarp), inkEnabled: scene === 66,
    outputEnabled: true, activeScene: scene >= 60 && scene <= 80, windowExpanded: scene >= 60 && scene <= 80,
    fullVideoFadeTrigger: scene >= 67, fullVideoAttackSeconds: 60 };
}
export const sceneAutomation = sceneComposition;

export function snareComposition(params, random = Math.random) {
  for (let i = 0; i < 6; i++) {
    if (random() >= .5) params.stripes.rotations[i] = params.stripes.rotations[i] ? 0 : .5;
    if (random() >= .5) params.stripes.flips[i] = params.stripes.flips[i] < 0 ? 1 : -1;
  }
  return params;
}

/** Record into engine.encoder between engine.begin() and the caller's submit. */
export class Compositor {
  constructor(engine, { width = 2688, height = 1008 } = {}) {
    this.engine = engine; this.width = width; this.height = height;
    this.textures = new Set(); this.mode = null; this.output = null;
    this.overlayTexture = null;
  }

  async init() {
    const e = this.engine, d = e.device;
    const module = d.createShaderModule({ label: 'PARTE 2 compositor', code: shaderSource + compositionShaderSource });
    const diagnostics = await module.getCompilationInfo();
    const failures = diagnostics.messages.filter(message => message.type === 'error');
    if (failures.length) throw new Error(failures.map(message => `Compositor línea ${message.lineNum}: ${message.message}`).join('\n'));
    const layout = d.createPipelineLayout({ bindGroupLayouts: [e.layout] });
    const normalBlend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const blends = {
      normal: normalBlend,
      add: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: normalBlend.alpha },
      multiply: { color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: normalBlend.alpha },
      screen: { color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' }, alpha: normalBlend.alpha },
    };
    const pipelines = [
      ...Object.entries(blends).map(([name, blend]) => ({ name: `comp_${name}`, entry: 'comp_layerFrag', blend })),
      ...['glow', 'mask', 'warp'].map(name => ({ name: `comp_${name}`, entry: `comp_${name}Frag` })),
    ];
    for (const spec of pipelines) {
      e.pipelines[spec.name] = await d.createRenderPipelineAsync({ label: spec.name, layout,
        vertex: { module, entryPoint: 'vsMain' },
        fragment: { module, entryPoint: spec.entry, targets: [{ format: 'rgba8unorm', ...(spec.blend ? { blend: spec.blend } : {}) }] },
        primitive: { topology: 'triangle-list' } });
    }
    this.resize(this.width, this.height);
    return this;
  }

  make(name, width, height, mipmaps = false) {
    const texture = this.engine.texture(`composition/${name}`, width, height, 'rgba8unorm', mipmaps);
    this.textures.add(texture); return texture;
  }
  release(texture) {
    if (!texture) return;
    texture.texture.destroy(); this.textures.delete(texture); this.engine.bindCache.clear();
  }
  resize(width, height) {
    if (this.width === width && this.height === height && this.output) return;
    this.width = width; this.height = height;
    this.release(this.output); this.output = this.make('output', width, height);
    this.mode = null;
  }
  ensureMode(mode) {
    if (this.mode === mode && this.composition?.width === this.width) return;
    for (const key of ['composition', 'warped', 'mask']) this.release(this[key]);
    const height = mode === 'reference' ? Math.round(this.width * 2160 / 3840) : this.height;
    this.composition = this.make('layers', this.width, height);
    this.warped = this.make('warped', this.width, height);
    this.mask = this.make('mask6', 400, 300);
    this.mode = mode;
  }

  project(layer, p) {
    const view = p.view;
    let x = .5 + (layer.x * view.scaleX + view.x) / 2;
    let y = .5 - (layer.y * view.scaleY + view.y) / 2;
    let width = layer.width * view.scaleX / 2;
    let height = layer.height * view.scaleY / 2;
    if (view.mode === 'show-strip') { y = (y - CROP_TOP) / CROP_HEIGHT; height /= CROP_HEIGHT; }
    return [x, y, width, height];
  }

  layer(texture, settings, p, target = this.composition, rect = this.project(settings, p)) {
    if (!texture || settings.enabled === false || settings.opacity <= 0) return;
    if (Math.abs(rect[2]) < 1e-7 || Math.abs(rect[3]) < 1e-7) return;
    if (texture.texture === target.texture) throw new Error('Una capa no puede leer y escribir la misma textura.');
    const brightness = settings.brightness ?? 1;
    const values = [...rect, settings.uvScaleX ?? 1, settings.uvScaleY ?? 1, settings.uvRotation ?? 0, settings.opacity ?? 1,
      settings.rotation ?? 0, settings.uvX ?? 0, settings.uvY ?? 0, settings.wrap ? 1 : 0, brightness, brightness, brightness, 0];
    const blend = blendOptions.includes(settings.blend) ? settings.blend : 'normal';
    this.engine.pass(`comp_${blend}`, target, texture, this.engine.dummy, values, { load: 'load', sourceMip: 0 });
  }

  stripeSettings(index, p, milky = false) {
    const s = p.stripes;
    return { ...LAYER, x: s.x + ((index + .5) / 6 - .5) * s.width,
      y: s.y, width: s.stripWidth, height: s.height, rotation: s.rotation,
      opacity: (milky ? s.milkyOpacity : s.videoOpacity)[index] ?? 0,
      brightness: milky ? s.milkyBrightness : s.videoBrightness, blend: s.blend,
      uvScaleX: milky ? s.flips[index] : s.uvScaleX,
      uvScaleY: milky ? 1 : s.uvScaleY,
      uvX: milky ? 0 : s.uvX, uvY: milky ? 0 : s.uvY,
      uvRotation: milky ? s.rotations[index] : s.uvRotation,
    };
  }

  control(source, p) {
    const e = this.engine;
    if (!this.normal || this.normal.width !== source.width || this.normal.height !== source.height) {
      this.release(this.normal); this.release(this.masked);
      this.normal = this.make('normal-glow', source.width, source.height);
      this.masked = this.make('masked-control', source.width, source.height, true);
    }
    if (!p.warp.full) {
      e.pass('copy', this.mask, e.dummy);
      for (let i = 0; i < 6; i++) {
        const settings = { ...LAYER, opacity: 1, brightness: p.warp.mask[i] ?? 0 };
        const rect = p.warp.maskMode === 'stripes' ? this.project(this.stripeSettings(i, p), p) : [.5, .5, .5, .5];
        this.layer(e.white, settings, p, this.mask, rect);
      }
      e.pass('comp_mask', this.masked, source, this.mask);
      source = this.masked;
    }
    e.mips(source);
    e.pass('comp_glow', this.normal, source, e.dummy,
      [p.warp.depth, p.warp.shape, p.warp.radius, 0, source.width, source.height]);
    return this.normal;
  }

  render({ fullVideo, fullMilky, warpSource = fullMilky, stripes = [], inkDripping, overlay, params } = {}) {
    const e = this.engine, p = merge(DEFAULT_COMPOSITION, params);
    this.ensureMode(p.view.mode);
    e.pass('copy', this.composition, e.dummy);
    // Group171 layer2 Milky, then layer5 DDS; Group5 layer2 Milky six,
    // layer4 DDS six, layer5 INK dripping. Empty wired group slots add nothing.
    this.layer(fullMilky, p.fullMilky, p);
    this.layer(fullVideo, p.fullVideo, p);
    if (p.stripes.enabled) {
      for (let i = 0; i < 6; i++) this.layer(stripes[i]?.milky, this.stripeSettings(i, p, true), p);
      for (let i = 0; i < 6; i++) this.layer(stripes[i]?.video, this.stripeSettings(i, p, false), p);
    }
    this.layer(inkDripping, p.ink, p);
    let composed = this.composition;
    if (p.warp.enabled && warpSource) {
      const control = this.control(warpSource, p);
      e.pass('comp_warp', this.warped, this.composition, control,
        [p.warp.amount, p.warp.directionX, p.warp.directionY]);
      composed = this.warped;
    }
    e.pass('copy', this.output, e.dummy);
    // show-strip compensates the reference output shift after extracting the
    // full quad's active image. Both modes retain editable output placement.
    const shift = p.view.outputY + (p.view.mode === 'show-strip' ? .43 : 0);
    const rect = [.5 + p.view.outputX / 2, .5 - shift / 2, p.view.outputScaleX, p.view.outputScaleY];
    this.layer(composed, LAYER, p, this.output, rect);
    const guide = overlay || this.overlayTexture;
    this.layer(guide, p.overlay, p, this.output,
      [.5 + p.overlay.x / 2, .5 - p.overlay.y / 2, p.overlay.width / 2, p.overlay.height / 2]);
    return this.output;
  }

  async loadOverlay(url = COMPOSITION_ASSETS[0].url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo cargar la guía original (${response.status}).`);
    const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    this.release(this.overlayTexture);
    const texture = this.make('original-overlay', bitmap.width, bitmap.height);
    this.engine.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: texture.texture }, [bitmap.width, bitmap.height]);
    bitmap.close(); this.overlayTexture = texture;
    return texture;
  }

  dispose() { for (const texture of [...this.textures]) this.release(texture); this.output = null; }
}
