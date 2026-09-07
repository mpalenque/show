import * as THREE from 'three';
import { AMITABHA_WORLD_BOUNDS } from './AmitabhaRadianceField';

/**
 * Motion-graphics overlay for the Tres Masas show. Instanced quads are drawn
 * twice: into the HRC source target (RGB = emission, alpha = optical density,
 * same contract as the fluid particles) and into the visible composition,
 * where occluder bodies sample the irradiance field so their lit faces and
 * shadows come from the real radiance transport instead of painted shading.
 */

export interface GeoInstance {
  /** Center as a fraction of the solver width/height. */
  x: number;
  y: number;
  /** Half extents as fractions of the solver height (square stays square). */
  w: number;
  h: number;
  rot: number;
  color: number;
  /** HRC emission strength; 0 for pure occluders. */
  emit: number;
  /** HRC optical density (final source alpha for this single layer). */
  absorb: number;
  /** Visible body brightness/alpha driver. */
  shade: number;
  shape: 0 | 1;
  /** Drawn above particles and display field (shutter masks). */
  top?: boolean;
  /**
   * 0 keeps the narrow one-pixel edge; 1 asks for the wide multi-texel source
   * feather. Only the faro needs the wide one: its long, shallow diagonal is
   * the case where a sub-two-texel density edge forces the transport's 50%
   * contour onto texel rows and stair-steps. Compact bodies want the narrow
   * edge, because widening theirs softens their shadow into a blob.
   */
  wideFeather?: boolean;
}

const CAPACITY = 160;

/**
 * Half-width of the coverage transition, in pixels of the target being
 * rasterized.
 *
 * In the HRC source pass one texel is ~2.7 output pixels and the transport
 * point-samples that grid once per texel at texel centres, so by Nyquist the
 * transition has to span two to three texels before the 50% contour can land
 * anywhere other than on a texel row. Three is measured: at feather 1.2 the
 * optical transition is 1.07 texels and along-edge banding is 44% of the edge
 * contrast; at 3.0 it is 2.17 texels and 1.5%. Lower this to 2.25 (4.5 px,
 * 5.2%) if the softer cut reads wrong on stage.
 *
 * In the composited passes one target pixel is half an output pixel, where a
 * sub-pixel band is already correct.
 */
const SOURCE_FEATHER_TEXELS = 3.0;
/**
 * What every body that did NOT ask for the wide feather gets in the source
 * pass: one texel, enough to antialias its own silhouette without softening a
 * compact occluder's shadow into a blob.
 */
const BASE_FEATHER_TEXELS = 1.0;
const VISIBLE_FEATHER_PIXELS = 1.2;

const sharedVertexBody = /* glsl */ `
  attribute vec2 iPos;
  attribute vec2 iHalf;
  attribute float iRot;
  attribute vec3 iColor;
  attribute vec4 iOptics; // emit, absorb, shade, shape
  attribute float iTop;
  attribute float iFeather;
  uniform vec2 uPixels;
  uniform vec2 uWorldSize;
  uniform vec4 uWorldBounds;
  uniform vec2 uTargetScale;
  uniform float uFeatherTexels;
  uniform float uFeatherBase;
  varying vec2 vLocal;
  varying vec3 vColor;
  varying vec4 vOptics;
  varying vec2 vFieldUv;
  varying vec2 vHalfBand;

  vec2 worldPosition() {
    vec2 corner = position.xy;
    vColor = iColor;
    vOptics = iOptics;

    // Half extents of this instance in the pixels of the target this pass
    // rasterizes into. Derived on the CPU per pass, so it is exact for both
    // the square HRC source grid and the orthographic composition, and unlike
    // fwidth() it does not grow by up to sqrt(2) as the quad rotates — which
    // is why the faro's feather width used to breathe as it turned.
    vec2 halfTarget = max(iHalf * uTargetScale, vec2(1.0e-4));
    float band = iOptics.w > 0.5 ? 0.22 : 0.16;
    // Only instances that ask for it get the wide source feather. Applying it
    // to every body softened compact occluders — the grid cells in 1C — until
    // their shadows read as blobs instead of directional corridors.
    float request = mix(uFeatherBase, uFeatherTexels, clamp(iFeather, 0.0, 1.0));
    // A sub-pixel instance must stay sub-pixel.
    float feather = min(request, 2.0 * min(halfTarget.x, halfTarget.y));
    vHalfBand = max(vec2(band * 0.5), vec2(feather) / halfTarget);

    // Grow the quad so the OUTER half of the transition has fragments to live
    // in. Without this the rasterizer cuts the band off at |vLocal| = 1, where
    // smoothstep still sits at exactly 0.5 for any band width at any rotation.
    // Half of every density edge therefore landed as a hard step on the
    // target's own texel grid, and the cascade — which point-samples that grid
    // once per texel — had no sub-texel edge position left to carry. That is
    // what no amount of downstream reconstruction could recover.
    //
    // The 50% contour stays at |vLocal| = 1, so no silhouette moves; only the
    // tail that used to be discarded now exists. Padding uses the
    // anti-aliasing band alone plus half a pixel of guard, so the authored tip
    // band keeps its current truncation and tip length is untouched.
    vec2 pad = min((vec2(feather) + 0.5) / halfTarget, vec2(3.0));
    vec2 grow = 1.0 + pad;
    if (iOptics.w > 0.5) grow = vec2(max(grow.x, grow.y));

    vec2 expanded = corner * grow;
    vLocal = expanded;
    vec2 lp = expanded * iHalf;
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 px = iPos + vec2(lp.x * c - lp.y * s, lp.x * s + lp.y * c);
    vec2 suv = px / uPixels;
    vec2 world = vec2(
      (suv.x - 0.5) * uWorldSize.x,
      (0.5 - suv.y) * uWorldSize.y
    );
    vFieldUv = (world - uWorldBounds.xy) / (uWorldBounds.zw - uWorldBounds.xy);
    return world;
  }
`;

const sourceVertexShader = /* glsl */ `
  ${sharedVertexBody}
  void main() {
    vec2 world = worldPosition();
    gl_Position = vec4(vFieldUv * 2.0 - 1.0, 0.0, 1.0);
    // Shutter masks are display-only: never inject or absorb HRC energy.
    if (iTop > 0.5) gl_Position = vec4(2.0e6, 2.0e6, 2.0e6, 1.0);
  }
`;

const coverageChunk = /* glsl */ `
  /**
   * Edge coverage for the instanced quads, resolved against the target that is
   * currently being rasterized rather than against the quad's own size.
   *
   * vHalfBand carries the half-width of the transition in local units,
   * computed per instance in the vertex shader from that target's pixel scale;
   * the vertex shader also grows the quad to match, so the whole band is
   * actually rasterized. Centering the transition on the true edge (|a| = 1)
   * keeps it an area coverage estimate, so widening it moves no silhouette and
   * does not drain the flux the quad injects into the HRC.
   *
   * Keep smoothstep: a linear/box coverage ramp measured worse.
   */
  float featherEdge(float a, float halfBand) {
    return 1.0 - smoothstep(1.0 - halfBand, 1.0 + halfBand, a);
  }

  float coverage() {
    if (vOptics.w > 0.5) {
      return featherEdge(length(vLocal), max(vHalfBand.x, vHalfBand.y));
    }
    vec2 a = abs(vLocal);
    return featherEdge(a.x, vHalfBand.x) * featherEdge(a.y, vHalfBand.y);
  }
`;

const sourceFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vLocal;
  varying vec3 vColor;
  varying vec4 vOptics;
  varying vec2 vFieldUv;
  varying vec2 vHalfBand;
  uniform float uGain;
  ${coverageChunk}

  void main() {
    float cov = coverage();
    if (cov <= 0.002) discard;

    // Round emitters inject their flux through a smooth radial profile rather
    // than as a flat disc. The lamp in 4A is only ~6 source texels across, so
    // against the transport's finite angular resolution each ray either hits
    // it or misses it outright, and those discrete hits read as a starburst of
    // spokes. 4C looks flat by comparison only because its light comes from
    // thousands of scattered particles whose individual spokes average out.
    // A gradual radial falloff turns that binary test into a partial one, so
    // rays clipping the emitter contribute proportionally and the spokes blend
    // into continuous light. The 3.0 restores the flux the softer profile
    // would otherwise lose: the quartic kernel integrates to a third of the
    // flat disc over the same radius, so the lamp keeps its authored output.
    float emission = vOptics.x;
    if (vOptics.w > 0.5) {
      float radial = 1.0 - min(dot(vLocal, vLocal), 1.0);
      emission *= 3.0 * radial * radial;
    }
    gl_FragColor = vec4(vColor * emission * uGain * cov, vOptics.y * cov);
  }
`;

const visibleVertexShader = /* glsl */ `
  ${sharedVertexBody}
  uniform float uTopPass;
  void main() {
    vec2 world = worldPosition();
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.05, 1.0);
    if (abs(iTop - uTopPass) > 0.5) gl_Position = vec4(2.0e6, 2.0e6, 2.0e6, 1.0);
  }
`;

const visibleFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vLocal;
  varying vec3 vColor;
  varying vec4 vOptics;
  varying vec2 vFieldUv;
  varying vec2 vHalfBand;
  uniform sampler2D uIrradiance;
  uniform float uExposure;
  ${coverageChunk}

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  void main() {
    float cov = coverage();
    if (cov <= 0.002) discard;
    vec3 irradiance = texture2D(
      uIrradiance,
      clamp(vFieldUv, vec2(0.002), vec2(0.998))
    ).rgb * uExposure;
    float irradianceLuma = dot(max(irradiance, vec3(0.0)), LUMA);
    float localLight = clamp(sqrt(irradianceLuma) * 1.9, 0.0, 1.0);
    float emitVisible = clamp(vOptics.x * 1.5, 0.0, 1.0);
    vec3 emissiveFace = vColor * (1.05 + vOptics.x * 0.55);
    // Occluder bodies: a faint self shade plus whatever the field lends them,
    // so the shadow corridor of a monolith reads on the grid automatically.
    vec3 bodyFace = vColor * (vOptics.z * 0.22) + vColor * localLight * 0.9;
    vec3 linear = mix(bodyFace, emissiveFace, emitVisible);
    vec3 mapped = linear / (1.0 + max(linear, vec3(0.0)));
    vec3 display = pow(clamp(mapped, 0.0, 1.0), vec3(1.0 / 2.2));
    float alpha = cov * clamp(max(vOptics.z, emitVisible), 0.0, 1.0);
    gl_FragColor = vec4(display, alpha);
  }
`;

const makeGeometryUniforms = () => ({
  uPixels: { value: new THREE.Vector2(1, 1) },
  uWorldSize: { value: new THREE.Vector2(16, 10) },
  uWorldBounds: { value: AMITABHA_WORLD_BOUNDS.clone() },
  uTargetScale: { value: new THREE.Vector2(1, 1) },
  uFeatherTexels: { value: VISIBLE_FEATHER_PIXELS },
  uFeatherBase: { value: VISIBLE_FEATHER_PIXELS },
  uGain: { value: 1 },
  uExposure: { value: 1 },
  uTopPass: { value: 0 },
  uIrradiance: { value: null as THREE.Texture | null },
});

export class TresMasasGeometry {
  readonly sourceObject: THREE.Mesh;
  readonly visibleObject: THREE.Mesh;
  readonly topObject: THREE.Mesh;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly pos = new Float32Array(CAPACITY * 2);
  private readonly half = new Float32Array(CAPACITY * 2);
  private readonly rot = new Float32Array(CAPACITY);
  private readonly color = new Float32Array(CAPACITY * 3);
  private readonly optics = new Float32Array(CAPACITY * 4);
  private readonly top = new Float32Array(CAPACITY);
  private readonly feather = new Float32Array(CAPACITY);
  private readonly sourceUniforms = makeGeometryUniforms();
  private readonly visibleUniforms = makeGeometryUniforms();
  private readonly topUniforms = makeGeometryUniforms();
  private readonly workColour = new THREE.Color();
  private disposed = false;

  constructor() {
    const base = new THREE.PlaneGeometry(2, 2);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute('position', base.getAttribute('position'));
    this.geometry.instanceCount = 0;
    const add = (name: string, array: Float32Array, itemSize: number) => {
      const attribute = new THREE.InstancedBufferAttribute(array, itemSize);
      attribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute);
    };
    add('iPos', this.pos, 2);
    add('iHalf', this.half, 2);
    add('iRot', this.rot, 1);
    add('iColor', this.color, 3);
    add('iOptics', this.optics, 4);
    add('iTop', this.top, 1);
    add('iFeather', this.feather, 1);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const sourceMaterial = new THREE.ShaderMaterial({
      uniforms: this.sourceUniforms,
      vertexShader: sourceVertexShader,
      fragmentShader: sourceFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // The pixel→world mapping flips Y, which inverts triangle winding;
      // without DoubleSide the whole layer is silently backface-culled.
      side: THREE.DoubleSide,
      // Match the particle source pass: RGB adds emission, alpha adds density.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const visibleMaterial = new THREE.ShaderMaterial({
      uniforms: this.visibleUniforms,
      vertexShader: visibleVertexShader,
      fragmentShader: visibleFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const topMaterial = visibleMaterial.clone();
    topMaterial.uniforms = this.topUniforms;
    this.topUniforms.uTopPass.value = 1;

    this.sourceObject = new THREE.Mesh(this.geometry, sourceMaterial);
    this.sourceObject.frustumCulled = false;
    this.visibleObject = new THREE.Mesh(this.geometry, visibleMaterial);
    this.visibleObject.frustumCulled = false;
    this.visibleObject.renderOrder = 1;
    this.topObject = new THREE.Mesh(this.geometry, topMaterial);
    this.topObject.frustumCulled = false;
    this.topObject.renderOrder = 6;
  }

  setGain(gain: number): void {
    const value = Math.max(0, Math.min(4, Number.isFinite(gain) ? gain : 1));
    this.sourceUniforms.uGain.value = value;
  }

  setInstances(instances: GeoInstance[], width: number, height: number): void {
    const count = Math.min(CAPACITY, instances.length);
    for (let index = 0; index < count; index += 1) {
      const item = instances[index];
      this.pos[index * 2] = item.x * width;
      this.pos[index * 2 + 1] = item.y * height;
      this.half[index * 2] = Math.max(0.1, item.w * height);
      this.half[index * 2 + 1] = Math.max(0.1, item.h * height);
      this.rot[index] = item.rot;
      this.workColour.setHex(Math.max(0, Math.min(0xffffff, Math.round(item.color))));
      this.color[index * 3] = this.workColour.r;
      this.color[index * 3 + 1] = this.workColour.g;
      this.color[index * 3 + 2] = this.workColour.b;
      this.optics[index * 4] = Math.max(0, item.emit);
      this.optics[index * 4 + 1] = Math.max(0, Math.min(1.2, item.absorb));
      this.optics[index * 4 + 2] = Math.max(0, Math.min(2, item.shade));
      this.optics[index * 4 + 3] = item.shape;
      this.top[index] = item.top ? 1 : 0;
      this.feather[index] = item.wideFeather ? 1 : 0;
    }
    this.geometry.instanceCount = count;
    for (const name of ['iPos', 'iHalf', 'iRot', 'iColor', 'iOptics', 'iTop', 'iFeather']) {
      (this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

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
  }): void {
    const width = Math.max(1, context.width);
    const height = Math.max(1, context.height);
    for (const uniforms of [this.sourceUniforms, this.visibleUniforms, this.topUniforms]) {
      uniforms.uPixels.value.set(width, height);
      uniforms.uWorldSize.value.set(context.worldWidth, context.worldHeight);
      uniforms.uIrradiance.value = context.irradiance;
      uniforms.uExposure.value = context.exposure;
    }
    // Target pixels per authoring pixel, per axis, and it genuinely differs
    // per pass — which is why the feather cannot be resolved from the fragment
    // shader alone. The source pass positions through vFieldUv, so it scales
    // by the square field bounds; the composited passes go through the
    // orthographic camera, where the factor reduces exactly to the pixel ratio
    // regardless of the world span. Using the field bounds for the visible
    // pass would be wrong by 17.6/6.45 in y.
    const fieldSpan = AMITABHA_WORLD_BOUNDS.z - AMITABHA_WORLD_BOUNDS.x;
    const extent = Math.max(1, context.sourceExtent);
    this.sourceUniforms.uTargetScale.value.set(
      (extent / fieldSpan) * (context.worldWidth / width),
      (extent / fieldSpan) * (context.worldHeight / height),
    );
    this.sourceUniforms.uFeatherTexels.value = SOURCE_FEATHER_TEXELS;
    this.sourceUniforms.uFeatherBase.value = BASE_FEATHER_TEXELS;
    const ratio = Math.max(0.05, context.pixelRatio);
    for (const uniforms of [this.visibleUniforms, this.topUniforms]) {
      uniforms.uTargetScale.value.set(ratio, ratio);
      // The composited passes rasterize at drawing-buffer resolution, where a
      // one-pixel edge is already correct for every body.
      uniforms.uFeatherTexels.value = VISIBLE_FEATHER_PIXELS;
      uniforms.uFeatherBase.value = VISIBLE_FEATHER_PIXELS;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    (this.sourceObject.material as THREE.Material).dispose();
    (this.visibleObject.material as THREE.Material).dispose();
    (this.topObject.material as THREE.Material).dispose();
  }
}

export default TresMasasGeometry;
