import * as THREE from 'three';
import {
  AMITABHA_WORLD_BOUNDS,
  AmitabhaRadianceField,
} from './AmitabhaRadianceField';

export type FluidRendererQuality = 'safe' | 'balanced' | 'high';

/**
 * Optional motion-graphics layer rendered inside the same HRC transport as
 * the fluid: `sourceObject` injects emission/absorption into the radiance
 * source target, `visibleObject` composites under the particles and
 * `topObject` above everything (display masks). The renderer feeds it the
 * pixel→world mapping and the live irradiance texture every frame.
 */
export interface RendererOverlay {
  readonly sourceObject: THREE.Object3D;
  readonly visibleObject: THREE.Object3D;
  readonly topObject: THREE.Object3D;
  updateContext(context: {
    width: number;
    height: number;
    worldWidth: number;
    worldHeight: number;
    irradiance: THREE.Texture | null;
    exposure: number;
    /** Square extent of the HRC source target, in texels. */
    sourceExtent: number;
    /** Drawing-buffer pixels per authoring pixel, for the composited passes. */
    pixelRatio: number;
  }): void;
}

export interface FluidRendererStats {
  resolution: number;
  frustumsPerFrame: number;
  updateHz: number;
  targetMemoryBytes: number;
  drawCalls: number;
}

const MAX_PARTICLES = 40_000;
const HRC_SOURCE_EXTENT = 1024;
// A 7 CSS-pixel particle projects to a little over two texels in the 512px
// transport field. An eight-texel energy-normalized source kernel prevents a
// point sample from locking onto one HRC ray and producing a visible streak.
// The foreground particle remains exactly 7px; this is transport AA, not bloom.
const MIN_HRC_EMITTER_DIAMETER = 12;
// Azure is the only optical source. The transport kernel is wider than its
// 7px face solely for antialiasing; flux is area-normalized below.
const SPARSE_HRC_EMISSION_GAIN = 18.0;
// Target emitted luminance for dense fluids. The shader divides this by each
// pigment's luminance so red, orange and tangerine illuminate equally instead
// of darker hues silently receiving less HRC energy.
const FLUID_HRC_EMISSION_GAIN = 0.22;
// Keep the transport unambiguous: light is injected only by the two Azure
// particles. Secondary diffuse bounce is disabled so no other fluid becomes a
// hidden source.
const AZURE_HRC_BOUNCE_GAIN = 0.0;
const MATERIAL_COLOURS = [
  new THREE.Color('#ff1744'), // full red
  new THREE.Color('#ff7a00'), // full orange
  new THREE.Color('#ffb000'), // full tangerine
  new THREE.Color('#1265ff'), // full electric blue
];
const MATERIAL_COLOUR_UNIFORMS = ['uColour0', 'uColour1', 'uColour2', 'uColour3'] as const;
const EMISSIVE_MATERIAL_NAMES = ['Ruby', 'Amber', 'Tangerine', 'Azure'];
const EMITTER_CROSSFADE_SECONDS = 1.25;
// In all-particles mode the complete material shares one fixed optical-energy
// budget. Every particle contributes equally; there are no hidden key lights.
const ALL_MODE_TOTAL_WEIGHT = 4.0;

const sourceVertexShader = /* glsl */ `
  attribute float aMaterial;
  attribute float aEmitter;
  attribute float aEmitterScale;
  attribute float aMotionEnergy;
  uniform vec4 uWorldBounds;
  uniform vec2 uResolution;
  uniform vec2 uWorldSize;
  uniform float uPointSize;
  uniform float uBlockerPointSize;
  uniform float uEmitterPointSize;
  uniform float uEmissiveMaterial;
  uniform float uNextEmissiveMaterial;
  uniform float uCurrentEmission;
  uniform float uNextEmission;
  varying float vMaterial;
  varying float vEmitter;
  varying float vMotionEnergy;

  void main() {
    vMaterial = aMaterial;
    vEmitter = aEmitter;
    vMotionEnergy = aMotionEnergy;
    vec2 screenUv = position.xy / uResolution;
    vec2 worldPosition = vec2(
      (screenUv.x - 0.5) * uWorldSize.x,
      (0.5 - screenUv.y) * uWorldSize.y
    );
    vec2 uv = (worldPosition - uWorldBounds.xy)
      / (uWorldBounds.zw - uWorldBounds.xy);
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    float currentMatch = 1.0 - step(
      0.45,
      abs(aMaterial - uEmissiveMaterial)
    );
    float nextMatch = 1.0 - step(
      0.45,
      abs(aMaterial - uNextEmissiveMaterial)
    );
    float activeEmitter = step(0.5, aEmitter) * step(
      0.001,
      currentMatch * uCurrentEmission + nextMatch * uNextEmission
    );
    gl_PointSize = mix(
      uBlockerPointSize,
      uEmitterPointSize * aEmitterScale,
      activeEmitter
    );
  }
`;

const opticalFunctions = /* glsl */ `
  uniform vec3 uColour0;
  uniform vec3 uColour1;
  uniform vec3 uColour2;
  uniform vec3 uColour3;
  uniform float uEmissiveMaterial;
  uniform float uNextEmissiveMaterial;
  uniform float uCurrentEmission;
  uniform float uNextEmission;

  vec3 materialColour(float material) {
    if (material < 0.5) return uColour0;
    if (material < 1.5) return uColour1;
    if (material < 2.5) return uColour2;
    return uColour3;
  }

  float emissionWeight(float material) {
    float currentMatch = 1.0 - step(
      0.45,
      abs(material - uEmissiveMaterial)
    );
    float nextMatch = 1.0 - step(
      0.45,
      abs(material - uNextEmissiveMaterial)
    );
    return clamp(
      currentMatch * uCurrentEmission + nextMatch * uNextEmission,
      0.0,
      1.0
    );
  }

  float emissionRole(float material) {
    return step(0.001, emissionWeight(material));
  }

  float absorptionRole(float emitterWeight) {
    // HRC is a participating-medium transport: an emitter needs finite
    // optical density to inject radiance. Dense blocker layers accumulate
    // many particles; each isolated Azure point needs a finite seed density.
    // These are densely packed samples of one continuous fluid, not 20k
    // separate opaque discs. A small per-sample coefficient integrates into
    // strong optical depth across a layer while preserving light gradients
    // and silhouettes instead of trapping all energy in the emitter cell.
    float emitter = smoothstep(0.0, 0.14, emitterWeight);
    float emitterDensity = 0.6;
    // Dense fluids are genuinely opaque to the HRC field, so each illuminated
    // rim has a readable umbra and penumbra rather than a flat colour wash.
    return mix(0.085, emitterDensity, emitter);
  }
`;

const sourceFragmentShader = /* glsl */ `
  precision highp float;
  varying float vMaterial;
  varying float vEmitter;
  varying float vMotionEnergy;
  uniform float uEmission;
  uniform float uAbsorption;
  uniform float uEmitterFluxScale;
  uniform float uSparseEmissionGain;
  uniform float uFluidEmissionGain;
  uniform float uVelocityEmission;
  uniform float uVelocityEmissionFloor;
  uniform float uVelocityEmissionRange;
  uniform float uAmbientVelocityEmission;
  uniform float uAmbientEmissionScale;
  uniform float uAmbientRedBlueOnly;
  ${opticalFunctions}

  const vec3 SOURCE_LUMA = vec3(0.2126, 0.7152, 0.0722);

  void main() {
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    float radius = length(centered);
    float coverage = 1.0 - smoothstep(0.62, 1.0, radius);
    if (coverage <= 0.001) discard;
    float velocityCurve = mix(
      uVelocityEmissionFloor,
      uVelocityEmissionRange,
      smoothstep(0.02, 1.0, vMotionEnergy)
    );
    float velocityGain = mix(1.0, velocityCurve, uVelocityEmission);
    float specialEmitter = step(0.000001, vEmitter);
    float primaryWeight = emissionWeight(vMaterial) * vEmitter * velocityGain;
    float redMatch = 1.0 - step(0.45, abs(vMaterial));
    float blueMatch = 1.0 - step(0.45, abs(vMaterial - 3.0));
    float redBlueWeight = clamp(redMatch + blueMatch, 0.0, 1.0);
    float ambientPalette = mix(1.0, redBlueWeight, uAmbientRedBlueOnly);
    // Cue 04 keeps its three Azure sources steady while every other body is
    // allowed to inject its own pigment only when it actually moves.
    float ambientWeight = uAmbientVelocityEmission
      * (1.0 - specialEmitter) * velocityCurve
      * ambientPalette * uAmbientEmissionScale;
    float emitterWeight = primaryWeight + ambientWeight;
    float primaryEmitter = step(0.5, vEmitter);
    float fluxScale = mix(1.0, uEmitterFluxScale, primaryEmitter);
    vec3 sourceColour = materialColour(vMaterial);
    float pigmentLuma = dot(sourceColour, SOURCE_LUMA);
    float denseEmissionGain = uFluidEmissionGain / max(pigmentLuma, 0.12);
    // Hundreds of moving receivers share the dense-fluid energy budget.
    // Only the three authored key particles use the sparse-source boost.
    float emissionGain = mix(denseEmissionGain, uSparseEmissionGain, specialEmitter);
    gl_FragColor = vec4(
      sourceColour
        * uEmission * emissionGain * fluxScale
        * emitterWeight * coverage,
      // During the short hand-off only the current and next materials inject
      // RGB; every other material contributes optical density only.
      absorptionRole(emitterWeight) * uAbsorption * coverage * 0.95
    );
  }
`;

const visibleVertexShader = /* glsl */ `
  attribute float aMaterial;
  attribute float aEmitter;
  attribute float aEmitterScale;
  attribute float aMotionEnergy;
  uniform vec4 uWorldBounds;
  uniform vec2 uResolution;
  uniform vec2 uWorldSize;
  uniform float uPointSize;
  uniform float uEmitterVisualScale;
  varying float vMaterial;
  varying float vEmitter;
  varying float vMotionEnergy;
  varying vec2 vFieldUv;

  void main() {
    vMaterial = aMaterial;
    vEmitter = aEmitter;
    vMotionEnergy = aMotionEnergy;
    vec2 screenUv = position.xy / uResolution;
    vec2 worldPosition = vec2(
      (screenUv.x - 0.5) * uWorldSize.x,
      (0.5 - screenUv.y) * uWorldSize.y
    );
    vFieldUv = (worldPosition - uWorldBounds.xy)
      / (uWorldBounds.zw - uWorldBounds.xy);
    gl_Position = projectionMatrix * modelViewMatrix
      * vec4(worldPosition, 0.02, 1.0);
    gl_PointSize = uPointSize * mix(
      1.0,
      uEmitterVisualScale * aEmitterScale,
      step(0.000001, aEmitter)
    );
  }
`;

const visibleFragmentShader = /* glsl */ `
  precision highp float;
  varying float vMaterial;
  varying float vEmitter;
  varying float vMotionEnergy;
  varying vec2 vFieldUv;
  uniform sampler2D uIrradiance;
  uniform float uEmission;
  uniform float uExposure;
  uniform float uLightOnly;
  uniform float uBodyAmbient;
  uniform float uAllEmitters;
  uniform float uVelocityEmission;
  uniform float uVelocityEmissionFloor;
  uniform float uVelocityEmissionRange;
  uniform float uAmbientVelocityEmission;
  uniform float uAmbientEmissionScale;
  uniform float uAmbientRedBlueOnly;
  uniform vec2 uFieldTexel;
  ${opticalFunctions}

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec3 toneMapPreservingHue(vec3 colour) {
    colour = max(colour, vec3(0.0));
    float sourceLuminance = dot(colour, LUMA);
    if (sourceLuminance <= 0.000001) return vec3(0.0);
    float mappedLuminance = sourceLuminance / (1.0 + sourceLuminance);
    vec3 mapped = colour * (mappedLuminance / sourceLuminance);
    float peak = max(max(mapped.r, mapped.g), mapped.b);
    return peak > 1.0 ? mapped / peak : mapped;
  }

  vec3 sampleStableHrc(vec2 uv) {
    vec2 dx = vec2(uFieldTexel.x, 0.0);
    vec2 dy = vec2(0.0, uFieldTexel.y);
    vec3 center = texture2D(uIrradiance, uv).rgb;
    vec3 cardinal =
      texture2D(uIrradiance, uv - dx).rgb
      + texture2D(uIrradiance, uv + dx).rgb
      + texture2D(uIrradiance, uv - dy).rgb
      + texture2D(uIrradiance, uv + dy).rgb;
    vec3 diagonal =
      texture2D(uIrradiance, uv - dx - dy).rgb
      + texture2D(uIrradiance, uv + dx - dy).rgb
      + texture2D(uIrradiance, uv - dx + dy).rgb
      + texture2D(uIrradiance, uv + dx + dy).rgb;
    return (center * 4.0 + cardinal + diagonal * 0.5) / 10.0;
  }

  void main() {
    float velocityCurve = mix(
      uVelocityEmissionFloor,
      uVelocityEmissionRange,
      smoothstep(0.02, 1.0, vMotionEnergy)
    );
    float velocityGain = mix(1.0, velocityCurve, uVelocityEmission);
    float selectedWeight = mix(
      vEmitter,
      1.0,
      uAllEmitters
    );
    float specialEmitter = step(0.000001, vEmitter);
    float redMatch = 1.0 - step(0.45, abs(vMaterial));
    float blueMatch = 1.0 - step(0.45, abs(vMaterial - 3.0));
    float redBlueWeight = clamp(redMatch + blueMatch, 0.0, 1.0);
    float ambientPalette = mix(1.0, redBlueWeight, uAmbientRedBlueOnly);
    float emitterWeight = emissionWeight(vMaterial) * selectedWeight * velocityGain
      + uAmbientVelocityEmission * (1.0 - specialEmitter) * velocityCurve
        * ambientPalette * uAmbientEmissionScale;
    float emitterIntensity = clamp(uEmission / 0.82, 0.0, 1.6);
    float visibleEmitterWeight = emitterWeight * emitterIntensity;
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    float radius = length(centered);
    float coverage = 1.0 - smoothstep(0.62, 1.0, radius);
    if (coverage <= 0.001) discard;
    float core = 1.0 - smoothstep(0.0, 0.5, radius);
    vec3 base = materialColour(vMaterial);
    vec3 irradiance = sampleStableHrc(
      clamp(vFieldUv, uFieldTexel, vec2(1.0) - uFieldTexel)
    ) * uExposure;
    float irradianceLuma = dot(max(irradiance, vec3(0.0)), LUMA);
    float localLight = clamp(sqrt(irradianceLuma) * 1.9, 0.0, 1.0);
    // Lighting changes value only: the pigment hue stays full and saturated
    // instead of washing toward grey/pastel under the blue HRC field.
    float emissiveVisibility = clamp(
      visibleEmitterWeight * 1.6,
      0.0,
      1.0
    );
    vec3 emissiveFace = base * (
      1.25 + visibleEmitterWeight * (0.75 + core * 0.75)
    );
    // How much of its own pigment a non-emitting body shows with no light on
    // it. 0.12 keeps unlit fluid readable on ordinary displays (the former
    // 0.02 floor sat below the default 0.06 black point and erased the whole
    // receiving fluid); near 0 the bodies read as black silhouettes that still
    // occlude and cast shadow, and only take colour where light reaches them.
    // Light-only mode still preserves exact darkness.
    float ambientLevel = mix(uBodyAmbient, 0.0, uLightOnly);
    vec3 blockerFace = base * (
      ambientLevel
        + localLight * 1.05
        + core * 0.05
        + min(irradianceLuma, 1.5) * 0.1
    );
    vec3 linearColour = mix(
      blockerFace,
      emissiveFace,
      emissiveVisibility
    );
    float illuminatedVisibility = smoothstep(
      0.0005,
      0.04,
      irradianceLuma
    );
    float receiverVisibility = mix(
      1.0,
      illuminatedVisibility,
      uLightOnly
    );
    float visibleAmount = max(receiverVisibility, emissiveVisibility)
      * mix(1.0, redBlueWeight, uAmbientRedBlueOnly);
    vec3 displayColour = pow(
      toneMapPreservingHue(linearColour),
      vec3(1.0 / 2.2)
    );
    gl_FragColor = vec4(
      displayColour,
      coverage * visibleAmount * mix(0.9, 0.98, emissiveVisibility)
    );
  }
`;

// Final, GPU-only colour grade. It operates after the HRC display mesh and
// particles have been composited, so the controls affect the whole image
// consistently instead of only recolouring the fluid sprites.
const postVertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const postFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uScene;
  uniform vec2 uSceneResolution;
  uniform float uHue;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uBrightness;
  uniform float uBlackPoint;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec3 hueRotate(vec3 colour, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    mat3 rotation = mat3(
      0.213 + c * 0.787 - s * 0.213,
      0.715 - c * 0.715 - s * 0.715,
      0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143,
      0.715 + c * 0.285 + s * 0.140,
      0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787,
      0.715 - c * 0.715 + s * 0.715,
      0.072 + c * 0.928 + s * 0.072
    );
    return rotation * colour;
  }

  float gradientNoise(vec2 pixel) {
    // Stable interleaved-gradient dither: one sub-LSB variation breaks visible
    // 8-bit contour bands without temporal shimmer or texture lookups.
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec3 colour = texture2D(uScene, gl_FragCoord.xy / uSceneResolution).rgb;
    colour = hueRotate(colour, uHue);
    float luminance = dot(colour, LUMA);
    colour = mix(vec3(luminance), colour, uSaturation);
    colour = (colour - 0.5) * uContrast + 0.5 + uBrightness;
    // Lift the black clip rather than dimming exposure: no-radiance regions
    // can become exact black while the directly lit range remains available.
    colour = max(colour - uBlackPoint, vec3(0.0)) / max(0.0001, 1.0 - uBlackPoint);
    // A short filmic toe makes the transition into exact black continuous,
    // avoiding a hard contour where the black-point clip begins.
    colour = colour * colour / max(colour + vec3(0.012), vec3(0.0001));
    colour = clamp(colour, 0.0, 1.0);
    float finalLuma = dot(colour, LUMA);
    float gradientMask = smoothstep(0.002, 0.035, finalLuma)
      * (1.0 - smoothstep(0.94, 1.0, finalLuma));
    float dither = (gradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
    colour = clamp(colour + vec3(dither * gradientMask), 0.0, 1.0);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

const makeUniforms = () => ({
  uWorldBounds: { value: AMITABHA_WORLD_BOUNDS.clone() },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uWorldSize: { value: new THREE.Vector2(16, 10) },
  uPointSize: { value: 6 },
  uEmitterVisualScale: { value: 1 },
  uBlockerPointSize: { value: 6 },
  uEmitterPointSize: { value: 6 },
  uEmitterFluxScale: { value: 1 },
  uEmissiveMaterial: { value: 3 },
  uNextEmissiveMaterial: { value: 0 },
  uCurrentEmission: { value: 1 },
  uNextEmission: { value: 0 },
  uEmission: { value: 0.82 },
  uSparseEmissionGain: { value: SPARSE_HRC_EMISSION_GAIN },
  uFluidEmissionGain: { value: FLUID_HRC_EMISSION_GAIN },
  uAbsorption: { value: 0.8 },
  uExposure: { value: 1.15 },
  uLightOnly: { value: 1 },
  uBodyAmbient: { value: 0.12 },
  uAllEmitters: { value: 0 },
  uVelocityEmission: { value: 0 },
  uVelocityEmissionFloor: { value: 0.04 },
  uVelocityEmissionRange: { value: 2.2 },
  uAmbientVelocityEmission: { value: 0 },
  uAmbientEmissionScale: { value: 1 },
  uAmbientRedBlueOnly: { value: 0 },
  uIrradiance: { value: null as THREE.Texture | null },
  uFieldTexel: { value: new THREE.Vector2(
    1 / HRC_SOURCE_EXTENT,
    1 / HRC_SOURCE_EXTENT,
  ) },
  uColour0: { value: MATERIAL_COLOURS[0].clone() },
  uColour1: { value: MATERIAL_COLOURS[1].clone() },
  uColour2: { value: MATERIAL_COLOURS[2].clone() },
  uColour3: { value: MATERIAL_COLOURS[3].clone() },
});

const makeTransportTarget = (extent: number) => new THREE.WebGLRenderTarget(
  extent,
  extent,
  {
    // Keep low, physically-scaled emission alive until HRC samples it.
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  },
);

/**
 * Velocity-emission curve, expressed as a fraction of the output height so it
 * is resolution independent. Both values reproduce the original constants at
 * the 1008-pixel-tall show master they were authored against.
 */
const MOTION_REFERENCE_SPEED = 2.8 / 1008;
const MOTION_DEAD_ZONE = 0.04 / 1008;
const DEFAULT_DISPLAY_SHARPNESS = 0.68;

const makeCompositionTarget = () => new THREE.WebGLRenderTarget(1, 1, {
  format: THREE.RGBAFormat,
  // Preserve the HRC gradient through HSCB. Quantizing this intermediate to
  // RGBA8 was the main source of posterization after contrast/black point.
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
});

export class ParticleRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly mode = 'amitabha-hrc-webgl2';
  readonly error: string | null = null;
  width = 1;
  height = 1;
  pixelRatio = 1;
  count = 0;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly emitterMask = new Float32Array(MAX_PARTICLES);
  private readonly emitterScale = new Float32Array(MAX_PARTICLES).fill(1);
  private readonly motionEnergy = new Float32Array(MAX_PARTICLES);
  private readonly previousMotionPositions = new Float32Array(MAX_PARTICLES * 2);
  private readonly emitterIndices = Array.from({ length: 4 }, () => [-1, -1]);
  private readonly sourceUniforms = makeUniforms();
  private readonly visibleUniforms = makeUniforms();
  private readonly sourceMaterial: THREE.ShaderMaterial;
  private readonly visibleMaterial: THREE.ShaderMaterial;
  private readonly sourceScene = new THREE.Scene();
  private readonly visibleScene = new THREE.Scene();
  private readonly passCamera = new THREE.Camera();
  private readonly camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0, 10);
  private readonly sourceTarget = makeTransportTarget(HRC_SOURCE_EXTENT);
  private readonly compositionTarget = makeCompositionTarget();
  private readonly postUniforms = {
    uScene: { value: this.compositionTarget.texture as THREE.Texture },
    uSceneResolution: { value: new THREE.Vector2(1, 1) },
    uHue: { value: 0 },
    uSaturation: { value: 1 },
    uContrast: { value: 1.35 },
    uBrightness: { value: 0 },
    uBlackPoint: { value: 0.16 },
  };
  private readonly postMaterial = new THREE.ShaderMaterial({
    uniforms: this.postUniforms,
    vertexShader: postVertexShader,
    fragmentShader: postFragmentShader,
    depthWrite: false,
    depthTest: false,
  });
  private readonly postScene = new THREE.Scene();
  private readonly postMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
  private readonly field: AmitabhaRadianceField;
  private readonly displayMesh: THREE.Mesh;
  private readonly hrcBackgroundTexture: THREE.DataTexture;
  private worldWidth = 16;
  private worldHeight = 10;
  private frameIndex = 0;
  private auditedMaterialCount = -1;
  private azureEmitterCount = 0;
  private emissiveMaterial = 3;
  private nextEmissiveMaterial = 3;
  private currentEmission = 1;
  private nextEmission = 0;
  private emissionCycleName = 'Azure';
  private emissionTransitionStartedAt = -Infinity;
  private reactiveOverlayApplied = false;
  private motionSampleTime = performance.now();
  private motionSampleCount = 0;
  private motionEpoch = 0;
  private readonly materialColourHexes = MATERIAL_COLOURS.map((colour) => colour.getHex());
  private quality: FluidRendererQuality = 'high';
  private motionSensitivity = 1;
  /**
   * 1 = velocidad cuadro a cuadro (el comportamiento histórico). Menor que 1,
   * la posición previa pasa a ser un ancla suavizada (media móvil) y lo que se
   * mide es TRANSPORTE: una partícula que viaja a v mantiene su ancla a v/k de
   * distancia y la estima exacta (d·k = v), mientras que una que vibra en el
   * lugar —el jitter de presión dentro de un blob denso— queda acotada por su
   * amplitud y se suprime por k. Es lo que evita que un blob quieto pero
   * agitado internamente se ilumine como si corriera.
   */
  private motionSmoothing = 1;
  private displaySharpness = DEFAULT_DISPLAY_SHARPNESS;
  private frustumsPerFrame = 4;
  private radianceResolution = HRC_SOURCE_EXTENT;
  private requestedDpr = 1;
  private overlay: RendererOverlay | null = null;

  constructor(canvas: HTMLCanvasElement) {
    if (!canvas) throw new TypeError('ParticleRenderer requires a canvas element.');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 2));
    this.geometry.setAttribute('aMaterial', new THREE.BufferAttribute(new Uint8Array(0), 1));
    const emitterAttribute = new THREE.BufferAttribute(this.emitterMask, 1);
    emitterAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aEmitter', emitterAttribute);
    const emitterScaleAttribute = new THREE.BufferAttribute(this.emitterScale, 1);
    emitterScaleAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aEmitterScale', emitterScaleAttribute);
    const motionAttribute = new THREE.BufferAttribute(this.motionEnergy, 1);
    motionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aMotionEnergy', motionAttribute);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry.setDrawRange(0, 0);

    this.sourceMaterial = new THREE.ShaderMaterial({
      uniforms: this.sourceUniforms,
      vertexShader: sourceVertexShader,
      fragmentShader: sourceFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // One + One preserves RGB emission and alpha absorption independently.
      // AdditiveBlending would multiply both by alpha a second time.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.visibleMaterial = new THREE.ShaderMaterial({
      uniforms: this.visibleUniforms,
      vertexShader: visibleVertexShader,
      fragmentShader: visibleFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    const sourcePoints = new THREE.Points(this.geometry, this.sourceMaterial);
    sourcePoints.frustumCulled = false;
    this.sourceScene.add(sourcePoints);
    const visiblePoints = new THREE.Points(this.geometry, this.visibleMaterial);
    visiblePoints.frustumCulled = false;
    visiblePoints.renderOrder = 2;

    this.field = new AmitabhaRadianceField(this.renderer);
    this.field.setQuality('high');
    this.field.setBodies([]);
    this.field.setExternalScene(this.sourceTarget.texture);
    // Keep diffuse re-lighting subtle; the rotating active material remains
    // the only direct RGB source in the external scene.
    (this.field as any).sceneMaterial.uniforms.uBounceGain.value = AZURE_HRC_BOUNCE_GAIN;
    this.removeRedundantHrcClears();
    this.hrcBackgroundTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 255]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.hrcBackgroundTexture.colorSpace = THREE.NoColorSpace;
    this.hrcBackgroundTexture.needsUpdate = true;
    this.field.setBackgroundTexture(this.hrcBackgroundTexture);
    this.field.setBackgroundEnabled(true);
    (this.field as any).displayMaterial.uniforms.uBackgroundOpacity.value = 1;
    this.displayMesh = this.field.createDisplayMesh();
    // Present the HRC itself behind the particles. Amitabha's display pass is
    // edge-adaptive and reconstructs the four frusta into continuous light,
    // making the penumbrae and occlusion readable without a fake bloom layer.
    this.displayMesh.visible = true;
    // Keep the penumbra reconstruction tight: unoccluded direct light stays
    // bright, while occluded directions fall to black instead of becoming a
    // broad, low-contrast grey wash.
    this.field.setDisplaySharpness(DEFAULT_DISPLAY_SHARPNESS);
    this.visibleScene.add(this.displayMesh);
    this.visibleScene.add(visiblePoints);
    this.postScene.add(this.postMesh);
    this.camera.position.z = 5;
    this.visibleUniforms.uIrradiance.value = this.field.texture;

    // The output scheduler owns canvas sizing.  Watching the CSS preview here
    // would overwrite its fixed 3360×1008 render target after a window resize.
    this.resize();
  }

  resize(width?: number, height?: number, dpr = window.devicePixelRatio || 1): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(width ?? (rect.width || this.canvas.clientWidth || 1)));
    this.height = Math.max(1, Math.round(height ?? (rect.height || this.canvas.clientHeight || 1)));
    this.requestedDpr = Math.max(0.5, dpr || 1);
    // The cap only bites when the caller asks for more than 1:1. The show
    // Output always requests DPR 1, so it is unaffected; dedicated pages ask
    // for whatever makes the drawing buffer match the device pixels they are
    // actually displayed at, plus supersampling on top, so the headroom here
    // has to cover a HiDPI or zoomed viewport rather than just 2x.
    const dprCap = this.quality === 'high' ? 3 : this.quality === 'balanced' ? 1.25 : 1;
    this.pixelRatio = Math.min(dprCap, this.requestedDpr);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    const drawingBufferSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.compositionTarget.setSize(drawingBufferSize.x, drawingBufferSize.y);
    this.postUniforms.uSceneResolution.value.copy(drawingBufferSize);

    const aspect = this.width / this.height;
    if (aspect >= 1) {
      this.worldWidth = Math.min(17.2, 10 * aspect);
      this.worldHeight = this.worldWidth / aspect;
    } else {
      this.worldHeight = 10;
      this.worldWidth = this.worldHeight * aspect;
    }
    this.camera.left = -this.worldWidth * 0.5;
    this.camera.right = this.worldWidth * 0.5;
    this.camera.top = this.worldHeight * 0.5;
    this.camera.bottom = -this.worldHeight * 0.5;
    this.camera.updateProjectionMatrix();
    for (const uniforms of [this.sourceUniforms, this.visibleUniforms]) {
      uniforms.uResolution.value.set(this.width, this.height);
      uniforms.uWorldSize.value.set(this.worldWidth, this.worldHeight);
    }
  }

  setQuality(quality: FluidRendererQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.radianceResolution = quality === 'high' ? 1024 : quality === 'balanced' ? 512 : 256;
    this.frustumsPerFrame = quality === 'safe' ? 2 : 4;
    this.field.setQuality(quality);
    this.sourceTarget.setSize(this.radianceResolution, this.radianceResolution);
    this.resize(this.width, this.height, this.requestedDpr);
  }

  get stats(): FluidRendererStats {
    const fieldStats = this.field.stats;
    return {
      resolution: fieldStats.resolution,
      frustumsPerFrame: this.frustumsPerFrame,
      updateHz: fieldStats.updateHz,
      targetMemoryBytes: fieldStats.targetMemoryBytes,
      drawCalls: fieldStats.drawCalls + this.renderer.info.render.calls,
    };
  }

  resetRadiance(): void {
    this.field.reset();
    this.motionEnergy.fill(0);
    this.motionSampleCount = 0;
    this.motionSampleTime = performance.now();
  }

  /** Startup only: finish shader compilation/draws before the show clock starts. */
  finishWarmup(): void {
    this.renderer.getContext().finish();
  }

  setOverlay(overlay: RendererOverlay | null): void {
    if (overlay === this.overlay) return;
    if (this.overlay) {
      this.sourceScene.remove(this.overlay.sourceObject);
      this.visibleScene.remove(this.overlay.visibleObject);
      this.visibleScene.remove(this.overlay.topObject);
    }
    this.overlay = overlay;
    if (overlay) {
      this.sourceScene.add(overlay.sourceObject);
      this.visibleScene.add(overlay.visibleObject);
      this.visibleScene.add(overlay.topObject);
    }
  }

  render(solver: any, state: Record<string, number> = {}): void {
    this.count = Math.min(MAX_PARTICLES, Math.max(0, Math.floor(solver?.count ?? 0)));
    const sourcePositions = solver?.positions;
    const sourceMaterials = solver?.materialIds ?? solver?.materialId;
    const hasParticles = Boolean(sourcePositions && sourceMaterials && this.count > 0);
    if (!hasParticles && !this.overlay) {
      this.renderer.setRenderTarget(null);
      const emptyBackground = Number(state.blackOutput ?? state.backgroundBlack ?? 0) > 0.5
        ? 0x000000
        : 0x000000;
      this.renderer.setClearColor(emptyBackground, 1);
      this.renderer.clear();
      return;
    }

    if (hasParticles) {
      const positionAttribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (positionAttribute.array !== sourcePositions) {
        const next = new THREE.BufferAttribute(sourcePositions, 2);
        next.setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute('position', next);
      } else {
        positionAttribute.needsUpdate = true;
      }
      const materialAttribute = this.geometry.getAttribute('aMaterial') as THREE.BufferAttribute;
      if (materialAttribute.array !== sourceMaterials) {
        const next = new THREE.BufferAttribute(sourceMaterials, 1);
        next.setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute('aMaterial', next);
      } else {
        materialAttribute.needsUpdate = true;
      }
    }
    const requestedMotionEpoch = Math.max(0, Math.round(Number(state.motionEpoch ?? 0)));
    if (requestedMotionEpoch !== this.motionEpoch) {
      this.motionEpoch = requestedMotionEpoch;
      this.motionEnergy.fill(0);
      this.motionSampleCount = 0;
      this.motionSampleTime = performance.now();
    }
    if (hasParticles) {
      this.updateMotionEnergy(sourcePositions);
      this.geometry.setDrawRange(0, this.count);
      if (this.count !== this.auditedMaterialCount || this.frameIndex % 120 === 0) {
        this.azureEmitterCount = 0;
        for (let index = 0; index < this.count; index += 1) {
          if (sourceMaterials[index] === 3) this.azureEmitterCount += 1;
        }
        this.auditedMaterialCount = this.count;
      }
    } else {
      this.geometry.setDrawRange(0, 0);
      this.azureEmitterCount = 0;
      this.auditedMaterialCount = 0;
    }

    const particleSize = Math.max(2, Math.min(32, Number(state.particleSize ?? 6)));
    const emission = Math.max(0, Math.min(2.5, Number(state.radiance ?? 0.82)));
    const absorption = Math.max(0, Math.min(1.5, Number(state.radianceAbsorption ?? 0.8)));
    const exposure = Math.max(0, Math.min(2, Number(state.radianceExposure ?? 1.15)));
    const hue = Math.max(-180, Math.min(180, Number(state.gradeHue ?? 0)));
    const saturation = Math.max(0, Math.min(2.5, Number(state.gradeSaturation ?? 1)));
    const contrast = Math.max(0.25, Math.min(3, Number(state.gradeContrast ?? 1.35)));
    const brightness = Math.max(-0.5, Math.min(0.5, Number(state.gradeBrightness ?? 0)));
    const blackPoint = Math.max(0, Math.min(0.65, Number(state.gradeBlackPoint ?? 0.16)));
    const resolveSharpness = Math.max(0, Math.min(1, Number(state.radianceSpread ?? 0.78)));
    const emitterVisualScale = Math.max(0.5, Math.min(6, Number(
      state.emitterVisualScale ?? 1,
    )));
    const emitterFluxScale = Math.max(0, Math.min(4, Number(state.emitterFluxScale ?? 1)));
    const openingEmitterCount = Math.max(0, Math.min(3, Math.round(Number(
      state.openingEmitterCount ?? 0,
    ))));
    const openingEmitterScales = Array.from({ length: 3 }, (_, index) => Math.max(
      0.35,
      Math.min(3.5, Number(state[`openingEmitterScale${index}`] ?? 1)),
    ));
    const velocityEmissionFloor = Math.max(0, Math.min(1, Number(
      state.velocityEmissionFloor ?? 0.04,
    )));
    // Brightness reached by a body at full motion. Together with the floor this
    // is the whole dynamic range of velocity-driven emission.
    const velocityEmissionRange = Math.max(0, Math.min(8, Number(
      state.velocityEmissionRange ?? 2.2,
    )));
    // How readily motion counts as motion. Raising it reaches the top of that
    // range at lower speeds, which is what spreads the variation out instead
    // of leaving a slow fluid pinned near the floor.
    this.motionSensitivity = Math.max(0.05, Math.min(20, Number(
      state.velocityEmissionSensitivity ?? 1,
    )));
    this.motionSmoothing = Math.max(0.05, Math.min(1, Number(
      state.velocityEmissionSmoothing ?? 1,
    )));
    const displaySharpness = Math.max(0, Math.min(1, Number(
      state.displaySharpness ?? DEFAULT_DISPLAY_SHARPNESS,
    )));
    if (displaySharpness !== this.displaySharpness) {
      this.displaySharpness = displaySharpness;
      this.field.setDisplaySharpness(displaySharpness);
    }
    const ambientVelocityEmission = Number(state.ambientVelocityEmission ?? 0) > 0.5;
    const ambientEmissionScale = Math.max(0, Math.min(1, Number(
      state.ambientEmissionScale ?? 1,
    )));
    const ambientRedBlueOnly = Number(state.ambientRedBlueOnly ?? 0) > 0.5;
    const backgroundColour = 0x000000;
    const blackOutput = Number(state.blackOutput ?? 0) > 0.5;
    this.updateMaterialColours(state);
    // A reactive secondary source borrows the normal hand-off uniforms for a
    // single frame. Restore their persistent state before advancing the real
    // primary-material transition so `/reactive/` cannot alter the behaviour
    // of the regular material picker.
    if (this.reactiveOverlayApplied) {
      this.nextEmissiveMaterial = this.emissiveMaterial;
      this.nextEmission = 0;
      this.reactiveOverlayApplied = false;
    }
    const requestedEmissiveMaterial = Math.max(
      0,
      Math.min(3, Math.round(Number(state.emissiveMaterial ?? 3))),
    );
    if (Number(state.instantEmissionRole ?? 0) > 0.5) {
      this.emissiveMaterial = requestedEmissiveMaterial;
      this.nextEmissiveMaterial = requestedEmissiveMaterial;
      this.currentEmission = 1;
      this.nextEmission = 0;
      this.emissionCycleName = EMISSIVE_MATERIAL_NAMES[requestedEmissiveMaterial];
      this.emissionTransitionStartedAt = -Infinity;
    } else {
      this.updateEmissionRole(
        performance.now() * 0.001,
        requestedEmissiveMaterial,
        Math.max(0.1, Math.min(5, Number(
          state.emitterCrossfadeSeconds ?? EMITTER_CROSSFADE_SECONDS,
        ))),
      );
    }
    const requestedSecondaryMaterial = Math.round(Number(
      state.reactiveSecondaryMaterial ?? -1,
    ));
    const requestedSecondaryStrength = Math.max(0, Math.min(0.85, Number(
      state.reactiveSecondaryStrength ?? 0,
    )));
    const primaryTransitionActive = this.nextEmission > 0.001
      && this.nextEmissiveMaterial !== this.emissiveMaterial;
    if (
      !primaryTransitionActive
      && requestedSecondaryMaterial >= 0
      && requestedSecondaryMaterial <= 3
      && requestedSecondaryMaterial !== this.emissiveMaterial
      && requestedSecondaryStrength > 0.001
    ) {
      this.nextEmissiveMaterial = requestedSecondaryMaterial;
      this.nextEmission = requestedSecondaryStrength;
      this.reactiveOverlayApplied = true;
    }
    const fieldWorldWidth = AMITABHA_WORLD_BOUNDS.z - AMITABHA_WORLD_BOUNDS.x;
    const sourcePointSize = Math.max(
      1.0,
      particleSize
        * this.worldWidth / Math.max(1, this.width)
        * this.sourceTarget.width / fieldWorldWidth,
    );
    const emitterPointSize = Math.max(
      sourcePointSize,
      MIN_HRC_EMITTER_DIAMETER,
    ) * emitterVisualScale;
    // A particle footprint is only ~2 transport texels at 512². Expand the
    // blocker mask modestly (never the foreground face) so a packed liquid
    // forms a continuous participating medium instead of pinholes of light.
    const blockerPointSize = Math.max(sourcePointSize * 1.45, 3.25);
    this.sourceUniforms.uPointSize.value = sourcePointSize;
    this.sourceUniforms.uBlockerPointSize.value = blockerPointSize;
    this.sourceUniforms.uEmitterPointSize.value = emitterPointSize;
    this.sourceUniforms.uEmitterFluxScale.value = Math.min(
      1,
      (sourcePointSize * sourcePointSize)
        / (emitterPointSize * emitterPointSize),
    ) * emitterFluxScale;
    for (const uniforms of [this.sourceUniforms, this.visibleUniforms]) {
      uniforms.uEmissiveMaterial.value = this.emissiveMaterial;
      uniforms.uNextEmissiveMaterial.value = this.nextEmissiveMaterial;
      uniforms.uCurrentEmission.value = this.currentEmission;
      uniforms.uNextEmission.value = this.nextEmission;
    }
    this.sourceUniforms.uEmission.value = emission;
    this.sourceUniforms.uAbsorption.value = absorption;
    this.visibleUniforms.uPointSize.value = particleSize * this.pixelRatio;
    this.visibleUniforms.uEmitterVisualScale.value = emitterVisualScale;
    this.visibleUniforms.uEmission.value = emission;
    this.visibleUniforms.uExposure.value = exposure;
    const resolveRadius = (0.65 + resolveSharpness * 0.75) / this.radianceResolution;
    this.visibleUniforms.uFieldTexel.value.set(resolveRadius, resolveRadius);
    this.visibleUniforms.uLightOnly.value = Number(state.lightOnly ?? 1) > 0.5
      ? 1
      : 0;
    const bodyAmbient = Number(state.bodyAmbient);
    this.visibleUniforms.uBodyAmbient.value = Number.isFinite(bodyAmbient)
      ? Math.max(0, Math.min(1, bodyAmbient))
      : 0.12;
    const allEmitters = Number(state.allEmitters ?? 0) > 0.5;
    // Dense all-emitter mode needs motion energy to illuminate the field;
    // otherwise it only draws bright particle outlines over an empty black
    // transport buffer, which reads as a broken output.
    const velocityEmission = allEmitters || Number(state.velocityEmission ?? 0) > 0.5;
    this.visibleUniforms.uAllEmitters.value = allEmitters ? 1 : 0;
    this.sourceUniforms.uVelocityEmission.value = velocityEmission ? 1 : 0;
    this.visibleUniforms.uVelocityEmission.value = velocityEmission ? 1 : 0;
    this.sourceUniforms.uVelocityEmissionFloor.value = velocityEmissionFloor;
    this.visibleUniforms.uVelocityEmissionFloor.value = velocityEmissionFloor;
    this.sourceUniforms.uVelocityEmissionRange.value = velocityEmissionRange;
    this.visibleUniforms.uVelocityEmissionRange.value = velocityEmissionRange;
    this.sourceUniforms.uAmbientVelocityEmission.value = ambientVelocityEmission ? 1 : 0;
    this.visibleUniforms.uAmbientVelocityEmission.value = ambientVelocityEmission ? 1 : 0;
    this.sourceUniforms.uAmbientEmissionScale.value = ambientEmissionScale;
    this.visibleUniforms.uAmbientEmissionScale.value = ambientEmissionScale;
    this.sourceUniforms.uAmbientRedBlueOnly.value = ambientRedBlueOnly ? 1 : 0;
    this.visibleUniforms.uAmbientRedBlueOnly.value = ambientRedBlueOnly ? 1 : 0;
    const reactiveSecondaryFraction = Math.max(0.01, Math.min(1, Number(
      state.reactiveSecondaryFraction ?? 1,
    )));
    if (hasParticles) {
      this.updateEmitterMask(
        sourcePositions,
        sourceMaterials,
        allEmitters,
        this.reactiveOverlayApplied ? this.nextEmissiveMaterial : -1,
        reactiveSecondaryFraction,
        openingEmitterCount,
        openingEmitterScales,
      );
    }
    this.postUniforms.uHue.value = hue * Math.PI / 180;
    this.postUniforms.uSaturation.value = saturation;
    this.postUniforms.uContrast.value = contrast;
    this.postUniforms.uBrightness.value = brightness;
    this.postUniforms.uBlackPoint.value = blackPoint;

    // Publish all four directional frusta atomically every display frame.
    // At 512² the measured HRC cost stays inside the GPU budget, and removing
    // the redundant clears below makes the shadows track the interpolated
    // fluid at the same cadence instead of trailing it by several frames.
    this.overlay?.updateContext({
      width: this.width,
      height: this.height,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      irradiance: this.field.texture,
      exposure,
      // Read the live target, not radianceResolution: setQuality can early
      // return, and the two would then drift apart.
      sourceExtent: this.sourceTarget.width,
      pixelRatio: this.pixelRatio,
    });
    this.renderRadianceSource();
    this.field.render(this.frustumsPerFrame);
    this.visibleUniforms.uIrradiance.value = this.field.texture;
    this.overlay?.updateContext({
      width: this.width,
      height: this.height,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      irradiance: this.field.texture,
      exposure,
      // Read the live target, not radianceResolution: setQuality can early
      // return, and the two would then drift apart.
      sourceExtent: this.sourceTarget.width,
      pixelRatio: this.pixelRatio,
    });

    this.renderer.setRenderTarget(this.compositionTarget);
    this.renderer.setClearColor(backgroundColour, 1);
    this.renderer.clear();
    this.renderer.render(this.visibleScene, this.camera);
    this.renderer.setRenderTarget(null);
    if (blackOutput) {
      // Cue 01 is a physical scene in darkness, not an empty simulation. Keep
      // advancing HRC with zero sources above so old light is flushed, but
      // guarantee an immediate exact-black show output during the hand-off.
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
    } else {
      this.renderer.render(this.postScene, this.passCamera);
    }
    this.canvas.dataset.rendererMode = this.mode;
    this.canvas.dataset.rendererCount = String(this.count);
    this.canvas.dataset.radianceResolution = String(this.field.stats.resolution);
    this.canvas.dataset.radianceCadence = '4-frustums-per-frame;full-field-60hz';
    this.canvas.dataset.radianceComposition = 'material-lighting-only';
    const nextEmissionName = EMISSIVE_MATERIAL_NAMES[this.nextEmissiveMaterial];
    const overlapActive = this.nextEmission > 0.001;
    this.canvas.dataset.opticalRoles = overlapActive
      ? `${this.emissionCycleName.toLowerCase()}-${nextEmissionName.toLowerCase()}-crossfade;other-materials-occluders`
      : `${this.emissionCycleName.toLowerCase()}-emitter;other-materials-occluders`;
    this.canvas.dataset.azureEmitterCount = String(this.azureEmitterCount);
    this.canvas.dataset.emitterDiameterPixels = String(Math.round(particleSize));
    this.canvas.dataset.hrcEmitterSplatTexels = emitterPointSize.toFixed(2);
    this.canvas.dataset.hrcEmitterFluxNormalized = 'true';
    this.canvas.dataset.emissionColour = overlapActive
      ? `${this.emissionCycleName} + ${nextEmissionName}`
      : this.emissionCycleName;
    this.canvas.dataset.emissionColourCount = overlapActive ? '2' : '1';
    this.canvas.dataset.emissionStrength = this.currentEmission.toFixed(3);
    this.canvas.dataset.nextEmissionStrength = this.nextEmission.toFixed(3);
    this.canvas.dataset.reactiveSecondaryMaterial = this.reactiveOverlayApplied
      ? String(this.nextEmissiveMaterial)
      : '-1';
    this.canvas.dataset.reactiveSecondaryFraction = this.reactiveOverlayApplied
      ? reactiveSecondaryFraction.toFixed(3)
      : '0.000';
    const emissionMaterialName = EMISSIVE_MATERIAL_NAMES[this.emissiveMaterial].toLowerCase();
    this.canvas.dataset.emissionCycle = `${emissionMaterialName}-${allEmitters ? 'all-particles' : 'two-sources'}`;
    this.canvas.dataset.lightOnly = this.visibleUniforms.uLightOnly.value > 0.5
      ? 'true'
      : 'false';
    this.canvas.dataset.emitterMode = allEmitters ? 'all-particles' : 'two-sources';
    this.canvas.dataset.velocityEmission = velocityEmission ? 'true' : 'false';
    this.canvas.dataset.velocityEmissionFloor = velocityEmissionFloor.toFixed(3);
    this.canvas.dataset.ambientVelocityEmission = ambientVelocityEmission ? 'true' : 'false';
    this.canvas.dataset.ambientEmissionScale = ambientEmissionScale.toFixed(3);
    this.canvas.dataset.ambientPalette = ambientRedBlueOnly ? 'red-blue-only' : 'all-materials';
    this.canvas.dataset.openingEmitterCount = String(openingEmitterCount);
    this.canvas.dataset.openingBlackOutput = blackOutput ? 'true' : 'false';
    this.canvas.dataset.materialColours = this.materialColourHexes
      .map((hex) => `#${hex.toString(16).padStart(6, '0')}`)
      .join(',');
    this.canvas.dataset.radianceParameters = [emission, resolveSharpness, absorption, exposure]
      .map((value) => value.toFixed(4))
      .join(',');
    this.canvas.dataset.gradeParameters = [hue, saturation, contrast, brightness, blackPoint]
      .map((value) => value.toFixed(4))
      .join(',');
    const emitterRadiusWorld = particleSize
      * this.worldWidth / Math.max(1, this.width) * 0.5;
    this.canvas.dataset.emitterRadiusWorld = emitterRadiusWorld.toFixed(5);
    this.canvas.dataset.hrcEmitterRadiusWorld = emitterRadiusWorld.toFixed(5);
    this.frameIndex += 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.sourceMaterial.dispose();
    this.visibleMaterial.dispose();
    this.sourceTarget.dispose();
    this.compositionTarget.dispose();
    this.postMesh.geometry.dispose();
    this.postMaterial.dispose();
    this.hrcBackgroundTexture.dispose();
    this.displayMesh.geometry.dispose();
    this.field.dispose();
    this.renderer.dispose();
  }

  private renderRadianceSource(): void {
    const previousTarget = this.renderer.getRenderTarget();
    const previousColour = this.renderer.getClearColor(new THREE.Color()).clone();
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.sourceTarget);
    this.renderer.clear();
    this.renderer.render(this.sourceScene, this.passCamera);
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousColour, previousAlpha);
  }

  private updateEmissionRole(
    elapsedSeconds: number,
    selectedMaterial: number,
    transitionSeconds = EMITTER_CROSSFADE_SECONDS,
  ): void {
    // The material picker also picks the optical source. Azure therefore has
    // its two fixed emitters, while selecting another pigment promotes all of
    // that pigment's fluid particles into the HRC source map.
    if (selectedMaterial === this.emissiveMaterial) {
      this.nextEmissiveMaterial = selectedMaterial;
      this.currentEmission = 1;
      this.nextEmission = 0;
      this.emissionCycleName = EMISSIVE_MATERIAL_NAMES[selectedMaterial];
      return;
    }

    if (selectedMaterial !== this.nextEmissiveMaterial) {
      // When the user changes selection during an existing handoff, retain
      // the strongest source and begin a fresh overlap from it.
      if (this.nextEmission > this.currentEmission) {
        this.emissiveMaterial = this.nextEmissiveMaterial;
      }
      this.nextEmissiveMaterial = selectedMaterial;
      this.currentEmission = 1;
      this.nextEmission = 0;
      this.emissionTransitionStartedAt = elapsedSeconds;
    }

    const t = Math.max(0, Math.min(1,
      (elapsedSeconds - this.emissionTransitionStartedAt) / transitionSeconds,
    ));
    const smooth = (edge0: number, edge1: number) => {
      const x = Math.max(0, Math.min(1, (t - edge0) / (edge1 - edge0)));
      return x * x * (3 - 2 * x);
    };
    // The new source is fully present before the previous source starts to
    // dim, preventing a black frame or a visible illumination drop.
    this.nextEmission = smooth(0, 0.58);
    this.currentEmission = 1 - smooth(0.42, 1);
    this.emissionCycleName = EMISSIVE_MATERIAL_NAMES[this.emissiveMaterial];

    if (t >= 1) {
      this.emissiveMaterial = this.nextEmissiveMaterial;
      this.currentEmission = 1;
      this.nextEmission = 0;
      this.emissionCycleName = EMISSIVE_MATERIAL_NAMES[this.emissiveMaterial];
    }
  }

  private updateMaterialColours(state: Record<string, number>): void {
    for (let index = 0; index < MATERIAL_COLOUR_UNIFORMS.length; index += 1) {
      const value = Number(state[`materialColor${index}`]);
      if (!Number.isFinite(value)) continue;
      const hex = Math.max(0, Math.min(0xffffff, Math.round(value)));
      if (hex === this.materialColourHexes[index]) continue;
      this.materialColourHexes[index] = hex;
      const uniform = MATERIAL_COLOUR_UNIFORMS[index];
      this.sourceUniforms[uniform].value.setHex(hex);
      this.visibleUniforms[uniform].value.setHex(hex);
    }
  }

  private updateEmitterMask(
    positions: Float32Array,
    materials: Uint8Array,
    allEmitters = false,
    reactiveSecondaryMaterial = -1,
    reactiveSecondaryFraction = 1,
    openingEmitterCount = 0,
    openingEmitterScales: number[] = [1, 1, 1],
  ): void {
    this.emitterMask.fill(0, 0, this.count);
    this.emitterScale.fill(1, 0, this.count);
    if (openingEmitterCount > 0) {
      let selected = 0;
      for (let index = 0; index < this.count && selected < openingEmitterCount; index += 1) {
        if (materials[index] !== 3) continue;
        // Keep the physical trio identifiable even in cue 05, where it stops
        // injecting blue and the moving Ruby field owns the optical role.
        this.emitterMask[index] = 1;
        this.emitterScale[index] = openingEmitterScales[selected] ?? 1;
        selected += 1;
      }
    }
    const sourceMaterials = [this.emissiveMaterial];
    if (this.nextEmission > 0.001 && this.nextEmissiveMaterial !== this.emissiveMaterial) {
      sourceMaterials.push(this.nextEmissiveMaterial);
    }

    for (const material of sourceMaterials) {
      if (openingEmitterCount > 0 && material === 3) {
        continue;
      }
      if (allEmitters) {
        const partialSecondary = material === reactiveSecondaryMaterial
          && reactiveSecondaryFraction < 0.999;
        let materialCount = 0;
        for (let index = 0; index < this.count; index += 1) {
          if (materials[index] !== material) continue;
          if (partialSecondary && !this.isReactiveSecondaryParticle(index, reactiveSecondaryFraction)) {
            continue;
          }
          materialCount += 1;
        }
        const distributedWeight = ALL_MODE_TOTAL_WEIGHT / Math.max(1, materialCount);
        for (let index = 0; index < this.count; index += 1) {
          if (materials[index] !== material) continue;
          if (partialSecondary && !this.isReactiveSecondaryParticle(index, reactiveSecondaryFraction)) {
            continue;
          }
          this.emitterMask[index] = distributedWeight;
        }
        // Every matching particle is now an equal HRC source. Do not restore
        // the two cached key emitters in this mode.
        continue;
      }
      let [leftIndex, rightIndex] = this.emitterIndices[material];
      const invalid = leftIndex < 0
        || rightIndex < 0
        || leftIndex >= this.count
        || rightIndex >= this.count
        || materials[leftIndex] !== material
        || materials[rightIndex] !== material;

      if (invalid) {
        leftIndex = -1;
        rightIndex = -1;
        // Pick two actual particles nearest the same balanced source layout
        // used by Azure. They stay inside the composition (not behind the UI
        // or at the extreme border) and then travel naturally with the fluid.
        const sourceTargets = [
          [this.width * 0.38, this.height * 0.52],
          [this.width * 0.68, this.height * 0.52],
        ];
        let leftDistance = Infinity;
        let rightDistance = Infinity;
        for (let index = 0; index < this.count; index += 1) {
          if (materials[index] !== material) continue;
          const x = positions[index * 2];
          const y = positions[index * 2 + 1];
          const leftCandidateDistance = (x - sourceTargets[0][0]) ** 2
            + (y - sourceTargets[0][1]) ** 2;
          const rightCandidateDistance = (x - sourceTargets[1][0]) ** 2
            + (y - sourceTargets[1][1]) ** 2;
          if (leftCandidateDistance < leftDistance) {
            leftDistance = leftCandidateDistance;
            leftIndex = index;
          }
          if (rightCandidateDistance < rightDistance) {
            rightDistance = rightCandidateDistance;
            rightIndex = index;
          }
        }
        if (rightIndex < 0) rightIndex = leftIndex;
        this.emitterIndices[material] = [leftIndex, rightIndex];
      }

      if (leftIndex >= 0) this.emitterMask[leftIndex] = 1;
      if (rightIndex >= 0) this.emitterMask[rightIndex] = 1;
    }
    (this.geometry.getAttribute('aEmitter') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aEmitterScale') as THREE.BufferAttribute).needsUpdate = true;
  }

  private isReactiveSecondaryParticle(index: number, fraction: number): boolean {
    // Stable integer hash: a musical event lights a scattered portion of the
    // liquid instead of a visibly contiguous array slice. Keeping it stable
    // for the event avoids shimmer while particles continue moving normally.
    const mixed = Math.imul(index + 1, 0x45d9f3b) >>> 0;
    const hashed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b) >>> 0;
    return (hashed ^ (hashed >>> 16)) / 0x1_0000_0000 < fraction;
  }

  private updateMotionEnergy(positions: Float32Array): void {
    const now = performance.now();
    const deltaMs = Math.max(1, Math.min(50, now - this.motionSampleTime));
    const frameNormalization = 16.667 / deltaMs;
    // A worker reset can replace every body between two display frames. Treat
    // a changed population as a fresh sample so cue 04 does not interpret the
    // layout hand-off itself as physical velocity/emission.
    const firstSample = this.motionSampleCount === 0 || this.motionSampleCount !== this.count;
    // Speed arrives in solver pixels per frame, so a fixed threshold silently
    // means something different at every output size: the same choreography
    // measured 20% slower when this show moved from a 3360-wide master to
    // 2688, which pinned a slow fluid near the emission floor and flattened
    // the velocity response. Scale the curve by the output instead, so a cue
    // reads identically at any resolution, and divide by the sensitivity so
    // the operator can widen the usable part of the range per cue.
    const speedRange = (MOTION_REFERENCE_SPEED * this.height) / this.motionSensitivity;
    const deadZone = MOTION_DEAD_ZONE * this.height;
    // Con smoothing < 1 la "posición previa" es un ancla suavizada y el delta
    // contra ella, escalado por k, estima el transporte real: exacto para una
    // partícula que viaja, y ~amplitud·k para una que sólo vibra. Con k = 1 se
    // reduce al delta cuadro a cuadro de siempre.
    const k = this.motionSmoothing;
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * 2;
      const x = positions[offset];
      const y = positions[offset + 1];
      const ax = this.previousMotionPositions[offset];
      const ay = this.previousMotionPositions[offset + 1];
      const dx = firstSample ? 0 : (x - ax) * frameNormalization * k;
      const dy = firstSample ? 0 : (y - ay) * frameNormalization * k;
      const speed = Math.sqrt(dx * dx + dy * dy);
      const normalized = Math.max(0, Math.min(1, (speed - deadZone) / speedRange));
      const target = normalized * normalized * (3 - 2 * normalized);
      this.motionEnergy[index] += (target - this.motionEnergy[index]) * 0.22;
      if (firstSample || k >= 1) {
        this.previousMotionPositions[offset] = x;
        this.previousMotionPositions[offset + 1] = y;
      } else {
        this.previousMotionPositions[offset] = ax + (x - ax) * k;
        this.previousMotionPositions[offset + 1] = ay + (y - ay) * k;
      }
    }
    for (let index = this.count; index < this.motionSampleCount; index += 1) {
      this.motionEnergy[index] = 0;
    }
    this.motionSampleCount = this.count;
    this.motionSampleTime = now;
    (this.geometry.getAttribute('aMotionEnergy') as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * Every HRC pass is an opaque fullscreen draw with no discard. Clearing the
   * same target immediately beforehand only burns bandwidth, so override this
   * instance's private pass helper while leaving the shared visuales renderer
   * untouched.
   */
  private removeRedundantHrcClears(): void {
    const field = this.field as any;
    field.renderPass = (
      material: THREE.ShaderMaterial,
      target: THREE.WebGLRenderTarget,
    ): void => {
      field.drawCalls += 1;
      field.passMesh.material = material;
      this.renderer.setRenderTarget(target);
      this.renderer.render(field.passScene, field.passCamera);
    };
  }
}

export default ParticleRenderer;
