/**
 * The four non-A branches selected by 2D/milky FULL.v4p, in its exact order.
 * Three original Dropbox paths are unavailable; their same-name local
 * patches are recovered explicitly below. They are not the *A presets.
 *
 * Integration: registerPreset(each FULL_PRESETS), then at the start of the
 * engine's step(state,dt): if (state.p.fullLegacy) return stepFull(this,state,dt).
 * Existing engine state allocation and shared WGSL entry points are reused.
 *
 * The FULL wrapper generates a gray rotated quad at 3840x1280. Its normal
 * input selector is 0 for every preset, selecting this quad, not the DDS.
 * To expose its external-input option, put the wrapper's preprocessed DDS
 * texture in engine.settings.externalSeeds[id]. That preprocessing is
 * HSCB {hue:0,saturation:1,contrast:.93,brightness:0} in the parent wrapper.
 * Parent output mixing is separate: Exclusion(Milky, preprocessed DDS), with
 * Opacity=0 by default. The wrapper bypass returns the preprocessed DDS.
 */
const common = {
  fullLegacy: true,
  originalResolution: [3840, 1280],
  originalTextureFormat: 'rgba8unorm',
  blendMode: 'exclusion',
  normalTechnique: 'normalMap',
  displaceTechnique: 'redGreenXY',
  displaceMapSmooth: 0,
  secondaryTechnique: 'redGreenXY',
  secondaryMapSmooth: 0,
  seed: 'quad', seedColor: [.33164, .33164, .33164, 1],
  seedRotation: .125, seedScale: .41, seedAspectAlignment: 'fitIn',
  seedPulsePeriod: 1, seedPulseFrames: 1,
  seedBackground: [0, 0, 0, 1], seedSelection: 'internal',
  outputStage: 'unsharp', feedbackSource: 'unsharp', hscb: null,
  ditherEnabled: true, postBlendEnabled: true, secondaryEnabled: true,
  flowBlur: .5, flowIterations: 1,
  normalRadius: 12, normalDepth: .46,
  unsharpAmount: 1, unsharpShape: .04, saturation: .55,
  ditherThreshold: 5.49, postBlendOpacity: 1,
  randomSequenceVerified: false,
};

export const FULL_PRESETS = [
  {
    ...common, id: 'full1', name: 'FULL · MILKY 1', graph: '1a', fullIndex: 0,
    description: 'Quad gris en wireframe continuo; Glow y DistortFlow originales.',
    sourcePatch: 'milky 1.v4p', referenceStatus: 'exact-relative-path',
    opacity: .79, normalRadius: 1, normalDepth: -.14,
    displaceAmount: .31, direction: [.01, .01],
    unsharpAmount: .83, unsharpShape: .24, saturation: 1,
    ditherThreshold: 5, postBlendMode: 'glow', postBlendBase: 'feedback',
    secondaryMode: 'flow', secondaryAmount: .001, secondaryDirection: [1, 1],
    flowBlur: .59, seedWireframe: true, seedTrigger: 'continuous',
    hasSecondaryFeedback: false,
  },
  {
    ...common, id: 'full3', name: 'FULL · MILKY 3', graph: '3a', fullIndex: 1,
    description: 'Pulso al seleccionar; doble feedback con direcciones fijas.',
    sourcePatch: 'Milky/milky 3.v4p', referenceStatus: 'recovered-same-name-local-patch',
    missingReference: '../../Users/SG13/Dropbox/0000001 NEW SET/milky 3.v4p',
    opacity: .82, displaceAmount: .032, direction: [0, 0],
    postBlendMode: 'disabled', postBlendEnabled: false, savedPostBlendMode: 'reflect',
    secondaryMode: 'displace', secondaryAmount: -.005, secondaryDirection: [1, 1],
    seedWireframe: false, seedTrigger: 'selection',
    hasSecondaryFeedback: true, eventDirections: false,
  },
  {
    ...common, id: 'full2', name: 'FULL · MILKY 2', graph: 'full2', fullIndex: 2,
    description: 'Exclusion y desplazamiento de dirección aleatoria; Dither/Glow/Flow en bypass.',
    sourcePatch: 'Milky/milky 2.v4p', referenceStatus: 'recovered-same-name-local-patch',
    missingReference: '../../Users/SG13/Dropbox/0000001 NEW SET/milky 2.v4p',
    opacity: .64, normalRadius: 1, normalDepth: -.14,
    displaceAmount: .2, direction: [0, 0],
    primaryDirectionAnimation: 'randomSpread', randomDirectionWidth: .04, randomDirectionPeriod: 1,
    unsharpAmount: .83, unsharpShape: .27, saturation: .36,
    ditherThreshold: 4.85, ditherEnabled: false,
    postBlendMode: 'glow', postBlendEnabled: false, postBlendBase: 'feedback',
    secondaryMode: 'flow', secondaryAmount: .1, secondaryDirection: [1, 1], secondaryEnabled: false,
    flowBlur: 0, seedScale: 1.26, seedWireframe: false, seedTrigger: 'periodic', seedPulsePeriod: 1,
    hasSecondaryFeedback: false,
  },
  {
    ...common, id: 'fullsplash', name: 'FULL · MILKY SPLASH', graph: 'splash', fullIndex: 3,
    description: 'Pulsos de medio segundo; Reflect y doble feedback con dirección animada.',
    sourcePatch: 'Milky/milky SPLASH.v4p', referenceStatus: 'recovered-same-name-local-patch',
    missingReference: '../../Users/SG13/Dropbox/0000001 NEW SET/milky SPLASH.v4p',
    opacity: .82, displaceAmount: .03, direction: [-.4, -.4],
    postBlendMode: 'reflect', postBlendBase: 'dither',
    secondaryMode: 'displace', secondaryAmount: .105, secondaryDirection: [.36, -.138495583785698],
    secondaryDirectionAnimation: 'randomSpread', randomDirectionWidth: 1, randomDirectionPeriod: 1,
    seedScale: 1, seedWireframe: false, seedTrigger: 'periodic', seedPulsePeriod: .5,
    hasSecondaryFeedback: true,
  },
];

export const FULL_WRAPPER = {
  sourcePatch: '2D/milky FULL.v4p',
  order: [...FULL_PRESETS.map(preset => preset.id), 'final'],
  inputHscb: { hue: 0, saturation: 1, contrast: .93, brightness: 0 },
  mixMode: 'exclusion', defaultMixOpacity: 0,
  defaultExternalInput: false,
  seedRendererSize: [3840, 1280],
};

const blendModes = { normal: 0, add: 1, exclusion: 2, glow: 3, reflect: 4 };

export function stepFull(engine, state, dt) {
  const p = state.p, settings = engine.settings;
  const previous = state.history[state.index], nextIndex = 1 - state.index;
  const next = state.history[nextIndex];
  const previousDisplace = state.displacementHistory[state.index], currentDisplace = state.displacementHistory[nextIndex];
  const w = state.seed.width, h = state.seed.height;
  const period = Math.max(.000001, p.seedPulsePeriod || 1);
  const seedCycle = Math.floor((state.time + 1e-7) / period);
  const periodPulse = state.lastFullSeedCycle !== seedCycle;
  const selectedPulse = state.fullSelected === true || state.frame === 0;
  const automatic = p.seedTrigger === 'continuous' ? true : p.seedTrigger === 'selection' ? selectedPulse : periodPulse;
  const seedOn = state.manualSeed || (settings.autoSeed && automatic);
  const brush = settings.brush || [.5, .5, .025, 0];
  engine.pass('seed', state.seed, engine.dummy, engine.dummy,
    [p.seedWireframe ? 2 : 1, p.seedRotation, p.seedScale, seedOn ? 1 : 0,
      w, h, 1, 1, ...p.seedColor.slice(0, 3), 0, ...brush]);
  if (settings.externalSeeds[p.id]) engine.pass('copy', state.seed, settings.externalSeeds[p.id]);
  state.lastFullSeedCycle = seedCycle; state.manualSeed = false; state.fullSelected = false;

  // Restore fixed native directions each frame. The A-version kick/snare
  // event wiring is absent from these FULL files, including full3.
  if (!p.primaryDirectionAnimation) state.direction = [...p.direction];
  if (!p.secondaryDirectionAnimation) state.secondaryDirection = [...p.secondaryDirection];
  if (p.primaryDirectionAnimation || p.secondaryDirectionAnimation) {
    const cycle = Math.floor(state.time / (p.randomDirectionPeriod || 1));
    if (cycle !== state.lastFullRandomCycle) {
      const width = p.randomDirectionWidth ?? 1;
      const direction = [(engine.random(state) - .5) * width, (engine.random(state) - .5) * width];
      if (p.primaryDirectionAnimation) state.direction = direction;
      else state.secondaryDirection = direction;
      state.lastFullRandomCycle = cycle;
    }
  }

  let dither = previous;
  if (p.ditherEnabled) {
    engine.pass('dither', state.dither, previous, engine.dummy, [p.ditherThreshold, 0, 0, 0, w, h]);
    dither = state.dither;
  }
  let input = p.postBlendBase === 'feedback' ? previous : dither;
  if (p.postBlendEnabled && p.postBlendMode !== 'disabled') {
    engine.pass('blend', state.post, p.postBlendBase === 'feedback' ? previous : dither,
      p.postBlendBase === 'feedback' ? dither : previous, [p.postBlendOpacity, blendModes[p.postBlendMode]]);
    input = state.post;
  }
  let mapSource = input;
  if (p.secondaryEnabled) {
    if (p.secondaryMode === 'flow') {
      engine.mips(dither);
      engine.pass('flow', state.secondary, input, dither,
        [p.secondaryAmount * settings.warp, p.flowBlur, p.flowIterations, 0, w, h], { sourceMip: 0 });
    } else {
      engine.pass('displace', state.secondary, input, previousDisplace,
        [p.secondaryAmount * settings.warp, ...state.secondaryDirection, p.secondaryMapSmooth, w, h, 0]);
    }
    mapSource = state.secondary;
  }
  engine.mips(mapSource);
  engine.pass('normal', state.normal, mapSource, engine.dummy, [p.normalRadius, p.normalDepth, 0, 0, w, h]);
  engine.pass('displace', currentDisplace, mapSource, state.normal,
    [p.displaceAmount * settings.warp, ...state.direction, p.displaceMapSmooth, w, h, 0]);
  engine.pass('blend', state.blend, state.seed, currentDisplace, [settings.opacity ?? p.opacity, blendModes[p.blendMode]]);
  engine.mips(state.blend);
  engine.pass('unsharp', next, state.blend, engine.dummy,
    [p.unsharpAmount * settings.detail, p.unsharpShape, p.saturation, 0, 1, 0, w, h]);
  state.output = next; state.index = nextIndex; state.frame++; state.time += dt;
}
