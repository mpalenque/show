/**
 * Effective values traced through the actual links in Milky/milky *A.v4p and
 * Milky/sUPER MILKY MULTI.v4p. A connected IOBox overrides a saved shader pin.
 *
 * F is the previous frame's UNSHARP output, never the displayed HSCB output.
 * G (3A / SPLASHA only) is the previous PRIMARY DISPLACE output, before Blend.
 * All primary and secondary Displace nodes use the RedGreenXY technique:
 * mix(uv, control.rg, directionXY * amount), not a centered normal warp.
 *
 * 1A: D = Dither(F); B = Glow(F, D); S = Flow(B, control D);
 *     N = NormalMap(S); Gnew = Displace(S, N);
 *     Fnew = Unsharp(Exclusion(seed, Gnew)); output = Fnew.
 * 3A: D = Dither(F); [Reflect DISABLED, bypass returns D];
 *     S = Displace(D, control G); N = NormalMap(S);
 *     Gnew = Displace(S, N); Fnew = Unsharp(Exclusion(seed, Gnew));
 *     output = Fnew. Both F and G are independently delayed by one frame.
 * 2A: [Darken DISABLED, bypass returns F]; S = Flow(F, control F);
 *     D = Dither(S); N = NormalMap(D); Gnew = Displace(D, N);
 *     Fnew = Unsharp(Add(seed, Gnew)); output = HSCB(Fnew).
 * SPLASHA: D = Dither(F); B = Reflect(D, F); S = Displace(B, control G);
 *     N = NormalMap(S); Gnew = Displace(S, N);
 *     Fnew = Unsharp(Exclusion(seed, Gnew)); output = Fnew.
 *     Its Reflect saved Enabled=0 is OVERRIDDEN by external Enabled=1.
 *
 * The two old Displace pins "Control Blur" and "Iterations" in 3A/SPLASHA
 * are absent from the installed Displace.tfx; they have no runtime effect.
 * Every renderer seed is 800 x 1280. Input selection for 1A is reversed inside
 * its patch: Switch=0 still selects the quad supplied as its exposed Input 2.
 */

const common = {
  originalResolution: [800, 1280],
  // DLL IL: RenderTargetManager.CreateFormat defaults to R8G8B8A8_UNorm;
  // DX11ImageShaderNode.Update inherits the input format unless overridden.
  originalTextureFormat: 'rgba8unorm',
  blendMode: 'exclusion',
  normalTechnique: 'normalMap',
  displaceTechnique: 'redGreenXY',
  displaceMapSmooth: 0,
  secondaryTechnique: 'redGreenXY',
  secondaryMapSmooth: 0,
  flowBlur: 0.5,
  flowIterations: 1,
  seed: 'quad',
  seedScale: 0.81,
  seedColor: [1, 1, 1, 1],
  seedBackground: [0, 0, 0, 1],
  seedAspectAlignment: 'fitIn',
  seedPulsePeriod: 1,
  seedPulseFrames: 1,
  feedbackSource: 'unsharp',
  outputStage: 'unsharp',
  hasSecondaryFeedback: false,
  hscb: null,
};

export const PRESETS = [
  {
    ...common,
    id: '1a',
    name: 'MILKY 1A',
    description: 'Exclusion, Glow y feedback con DistortFlow.',
    sourcePatch: 'Milky/milky 1A.v4p',
    graph: '1a',
    opacity: 0.79,
    normalRadius: 1,
    normalDepth: -0.14,
    displaceAmount: 0.31,
    direction: [0.01, 0.01],
    unsharpAmount: 0.83,
    unsharpShape: 0.24,
    saturation: 1,
    ditherThreshold: 4.85,
    secondaryMode: 'flow',
    secondaryAmount: 0.001,
    secondaryDirection: [1, 1],
    secondaryControl: 'dither',
    postBlendMode: 'glow',
    postBlendOpacity: 0.84,
    postBlendBase: 'feedback',
    postBlendSource: 'dither',
    ditherBeforeSecondary: true,
  },
  {
    ...common,
    id: '3a',
    name: 'MILKY 3A',
    description: 'Doble feedback y direcciones que cambian con kick y snare.',
    sourcePatch: 'Milky/milky 3A.v4p',
    graph: '3a',
    opacity: 0.65,
    normalRadius: 12,
    normalDepth: 0.46,
    displaceAmount: 0.032,
    // Deterministic cold start: selector 0. Saved IOBox index 2 is wired from
    // Random and cannot establish its live startup output without native state.
    direction: [-0.05, -0.05],
    snareDirections: [[-0.05, -0.05], [2, 2], [-2, -2]],
    // Random(Value) help documents integer Scale as an inclusive maximum.
    eventRandomIntegerMaximum: 3,
    unsharpAmount: 1,
    unsharpShape: 0.04,
    saturation: 0.55,
    ditherThreshold: 5.49,
    secondaryMode: 'displace',
    secondaryAmount: -0.005,
    secondaryDirection: [0, 0],
    kickDirections: [[0, 0], [0, 1], [1, 0]],
    secondaryControl: 'previousPrimaryDisplace',
    hasSecondaryFeedback: true,
    secondaryFeedbackSource: 'primaryDisplace',
    postBlendMode: 'disabled',
    savedPostBlendMode: 'reflect',
    postBlendOpacity: 1,
    postBlendBase: 'dither',
    postBlendSource: 'feedback',
    ditherBeforeSecondary: true,
  },
  {
    ...common,
    id: '2a',
    name: 'MILKY 2A',
    description: 'Grilla roja, mezcla Add, DistortFlow y salida HSCB.',
    sourcePatch: 'Milky/milky 2A.v4p',
    graph: '2a',
    blendMode: 'add',
    opacity: 0.77,
    normalRadius: 1,
    normalDepth: -0.14,
    displaceAmount: 0.54,
    direction: [0.004, 0.01],
    unsharpAmount: 0.36,
    unsharpShape: 2.34,
    saturation: 0.96,
    ditherThreshold: 7,
    secondaryMode: 'flow',
    secondaryAmount: 0.100000001490116,
    secondaryDirection: [1, 1],
    secondaryControl: 'feedback',
    postBlendMode: 'disabled',
    savedPostBlendMode: 'darken',
    postBlendOpacity: 1,
    postBlendBase: 'feedback',
    postBlendSource: 'feedback',
    ditherBeforeSecondary: false,
    seed: 'grid',
    seedScale: 0.73,
    seedColor: [1, 0, 0, 1],
    seedPulsePeriod: 0,
    seedRotationPeriod: 12,
    // DLL metadata: Grid defaults to Size=(1,1), Resolution X=Y=2.
    // Grid is two triangles, not a dense lattice. Vertex order bottom row
    // left/right, top row left/right; indices [0,2,1, 1,2,3].
    seedGridResolution: [2, 2],
    seedGridSubdivisions: 1,
    seedGridDiagonal: 'bottomRightToTopLeft',
    seedExternalSwitchPeriod: 22,
    seedExternalSwitchFrames: 1,
    // Shader input null resolves to WhiteTexture in DX11ImageShaderNode.
    seedExternalFallback: [1, 1, 1, 1],
    outputStage: 'hscb',
    hscb: { hue: 0, saturation: 1, brightness: 2.2, contrast: 0 },
  },
  {
    ...common,
    id: 'splash',
    name: 'MILKY SPLASHA',
    description: 'Reflect, doble desplazamiento y dirección aleatoria por ciclo.',
    sourcePatch: 'Milky/milky SPLASHA.v4p',
    graph: 'splash',
    opacity: 0.82,
    normalRadius: 12,
    normalDepth: 0.46,
    displaceAmount: 0.03,
    direction: [-0.4, -0.4],
    unsharpAmount: 1,
    unsharpShape: 0.04,
    saturation: 0.55,
    ditherThreshold: 5.49,
    secondaryMode: 'displace',
    secondaryAmount: 0.105,
    // Saved IOBox value; RandomSpread's wire supplies the live value.
    secondaryDirection: [0.36, -0.138495583785698],
    secondaryDirectionAnimation: 'randomSpread',
    randomDirectionPeriod: 1,
    randomDirectionRange: [-0.5, 0.5],
    randomDirectionCount: 2,
    // The native RandomSpread algorithm and startup LFO phase are not stored
    // in XML. A browser PRNG reproduces the behavior, not the same sequence.
    randomSequenceVerified: false,
    secondaryControl: 'previousPrimaryDisplace',
    hasSecondaryFeedback: true,
    secondaryFeedbackSource: 'primaryDisplace',
    postBlendMode: 'reflect',
    postBlendOpacity: 1,
    postBlendBase: 'dither',
    postBlendSource: 'feedback',
    ditherBeforeSecondary: true,
  },
];

PRESETS.push({
  ...common, id: 'final', name: 'MILKY FINAL · INK',
  description: 'La quinta rama: tinta DDS, Growth, feedback Milky y deformación final. Escenas 69–80.',
  sourcePatch: 'milky final.v4p', graph: 'final', opacity: .94,
  originalResolution: [3840, 1200], inkResolution: [1280, 720], ringResolution: [960, 320],
  seed: 'ink', direction: [-.66, -.66], secondaryDirection: [0, 0],
});

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((preset) => [preset.id, preset]));
