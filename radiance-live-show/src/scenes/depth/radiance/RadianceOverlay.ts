import * as THREE from 'three';
import { AmitabhaRadianceField } from './AmitabhaRadianceField';

const SOURCE_ASPECT = 16 / 9;
const FIELD_RESOLUTION = 512;

const passVertexShader = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const emitterFragmentShader = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 outColour;
  uniform sampler2D uSource;
  uniform vec4 uFrameRect;
  uniform vec4 uFieldViewport;
  uniform float uGain;
  uniform float uEmitterCutoff;
  uniform float uAbsorption;
  uniform float uVariant;

  void main() {
    // vUv belongs to the square HRC target. Map it back to top-left browser
    // coordinates before sampling the rectangular WebGPU canvas.
    vec2 fieldUvTop = vec2(vUv.x, 1.0 - vUv.y);
    vec2 viewportMin = uFieldViewport.xy;
    vec2 viewportMax = viewportMin + uFieldViewport.zw;
    vec2 insideMin = step(viewportMin, fieldUvTop);
    vec2 insideMax = step(fieldUvTop, viewportMax);
    float insideViewport = insideMin.x * insideMin.y * insideMax.x * insideMax.y;
    if (insideViewport < 0.5) {
      outColour = vec4(0.0);
      return;
    }

    vec2 screenUv = clamp(
      (fieldUvTop - viewportMin) / max(uFieldViewport.zw, vec2(0.0001)),
      vec2(0.0),
      vec2(1.0)
    );
    float insideFrameX = step(uFrameRect.x, screenUv.x)
      * step(screenUv.x, uFrameRect.z);
    if (uVariant < 0.5) {
      vec4 source = texture(uSource, vec2(screenUv.x, 1.0 - screenUv.y));

      // Waterfall ABI: only material below the image edge participates.
      float belowFrame = step(uFrameRect.w, screenUv.y);
      float coverage = clamp(source.a, 0.0, 1.0) * insideFrameX * belowFrame;
      if (coverage <= 0.0001) {
        outColour = vec4(0.0);
        return;
      }

      vec3 materialColour = clamp(source.rgb / max(source.a, 0.0001), 0.0, 1.0);
      float sourceLuma = dot(materialColour, vec3(0.2126, 0.7152, 0.0722));
      float emitterRole = smoothstep(
        uEmitterCutoff - 0.06,
        uEmitterCutoff + 0.06,
        sourceLuma
      );
      vec3 emission = materialColour * coverage * emitterRole * uGain;
      float darkDensity = clamp(uAbsorption, 0.0, 1.0);
      float absorption = coverage * darkDensity * mix(1.0, 0.52, emitterRole);
      outColour = vec4(emission, clamp(absorption, 0.0, 1.0));
      return;
    }

    // Radiance 2 ABI: sample the two-panel WebGPU atlas. The left half is
    // exact sorted-pixel emission; the right half is hue-derived absorption.
    float insideFrameY = step(uFrameRect.y, screenUv.y)
      * step(screenUv.y, uFrameRect.w);
    float insideFrame = insideFrameX * insideFrameY;
    if (insideFrame < 0.5) {
      outColour = vec4(0.0);
      return;
    }
    vec2 frameUv = clamp(
      (screenUv - uFrameRect.xy) / max(uFrameRect.zw - uFrameRect.xy, vec2(0.0001)),
      vec2(0.0),
      vec2(1.0)
    );
    vec2 atlasSize = vec2(textureSize(uSource, 0));
    vec2 halfTexel = 0.5 / max(atlasSize, vec2(1.0));
    float atlasY = clamp(1.0 - frameUv.y, halfTexel.y, 1.0 - halfTexel.y);
    vec2 emissionUv = vec2(
      clamp(frameUv.x * 0.5, halfTexel.x, 0.5 - halfTexel.x),
      atlasY
    );
    vec2 absorptionUv = vec2(
      clamp(0.5 + frameUv.x * 0.5, 0.5 + halfTexel.x, 1.0 - halfTexel.x),
      atlasY
    );
    vec3 emitterSample = texture(uSource, emissionUv).rgb;
    vec3 emission = emitterSample * max(uGain, 0.0);
    float imageAbsorption = texture(uSource, absorptionUv).r
      * clamp(uAbsorption, 0.0, 1.0);
    // RGB and alpha are intentionally independent: sorting emits, while only
    // the hue-selected source image absorbs. Pure-emission seeding happens in
    // the route-specific HRC seed path, not through a fake opaque body.
    outColour = vec4(emission, imageAbsorption);
  }
`;

export interface RadianceOverlaySettings {
  strength: number;
  reach: number;
  spread: number;
  emitterCutoff: number;
  absorption: number;
  ambient: number;
  bounce: number;
  effectAmount: number;
  persistence: number;
}

export type RadianceOverlayMode = 'waterfall' | 'image';

/**
 * Exact HRC transport from visuales-piano-en-vivo, driven by an external
 * emissivity texture instead of Box2D bodies. The WebGPU sorter paints only
 * the overhanging pixel cores; this layer transports their coloured light.
 */
export class RadianceOverlay {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly field: AmitabhaRadianceField;
  private readonly sourceTexture: THREE.CanvasTexture;
  private readonly emitterTargets: [
    THREE.WebGLRenderTarget<THREE.Texture>,
    THREE.WebGLRenderTarget<THREE.Texture>,
  ];
  private readonly emitterMaterial: THREE.ShaderMaterial;
  private readonly emitterGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly emitterScene = new THREE.Scene();
  private readonly displayScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly displayGeometry = new THREE.PlaneGeometry(2, 2);
  private emitterReadIndex = 0;
  private frameIndex = 0;
  private fieldRevision = 0;
  private temporalBlend = 1;
  private temporalStep = 1 / 8;
  private disposed = false;
  private suspended = false;
  private readonly previousDisplayFilter: string;

  constructor(
    private readonly sourceCanvas: HTMLCanvasElement,
    private readonly outputCanvas: HTMLCanvasElement,
    private readonly mode: RadianceOverlayMode = 'waterfall',
    private readonly displayCanvas: HTMLCanvasElement = sourceCanvas,
    quality: 'high' | 'safe' = 'high',
  ) {
    this.previousDisplayFilter = displayCanvas.style.filter;
    this.renderer = new THREE.WebGLRenderer({
      canvas: outputCanvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
      precision: 'highp',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);

    this.sourceTexture = new THREE.CanvasTexture(sourceCanvas);
    this.sourceTexture.colorSpace = THREE.SRGBColorSpace;
    // Waterfall carries premultiplied cores in alpha. Radiance 2 uses an
    // opaque two-panel atlas whose channels remain independent.
    this.sourceTexture.premultiplyAlpha = this.mode === 'waterfall';
    this.sourceTexture.minFilter = THREE.NearestFilter;
    this.sourceTexture.magFilter = THREE.NearestFilter;
    this.sourceTexture.generateMipmaps = false;

    const makeEmitterTarget = () => new THREE.WebGLRenderTarget<THREE.Texture>(
      FIELD_RESOLUTION, FIELD_RESOLUTION, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      },
    );
    this.emitterTargets = [makeEmitterTarget(), makeEmitterTarget()];
    this.emitterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSource: { value: this.sourceTexture },
        uFrameRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uFieldViewport: { value: new THREE.Vector4(0, 0, 1, 1) },
        uGain: { value: 1 },
        uEmitterCutoff: { value: 0.56 },
        uAbsorption: { value: 0.9 },
        uVariant: { value: this.mode === 'image' ? 1 : 0 },
      },
      vertexShader: passVertexShader,
      fragmentShader: emitterFragmentShader,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const emitterMesh = new THREE.Mesh(this.emitterGeometry, this.emitterMaterial);
    emitterMesh.frustumCulled = false;
    this.emitterScene.add(emitterMesh);

    this.field = new AmitabhaRadianceField(this.renderer, quality);
    this.field.setBodies([]);
    this.field.setExternalScene(this.emitterTargets[0].texture);
    this.field.setBackgroundEnabled(false);
    this.field.setTransparentOutput(this.mode === 'image');
    this.field.setPureExternalEmission(this.mode === 'image');
    this.field.setExternalBounceGain(this.mode === 'image' ? 0.03 : 0.24);

    this.camera.position.z = 1;
    const displayMesh = new THREE.Mesh(this.displayGeometry, this.field.displayMaterial);
    displayMesh.frustumCulled = false;
    this.displayScene.add(displayMesh);
    this.resize();
  }

  setQuality(quality: 'high' | 'safe'): void {
    this.field.setQuality(quality);
  }

  suspend(suspended: boolean): void {
    this.suspended = suspended;
  }

  get telemetry(): { drawCalls: number; memoryMb: number; updateHz: number; resolution: number } {
    const stats = this.field.stats;
    return {
      drawCalls: stats.drawCalls + 2,
      memoryMb: stats.targetMemoryBytes / (1024 * 1024),
      updateHz: stats.updateHz,
      resolution: stats.resolution,
    };
  }

  setSettings(settings: RadianceOverlaySettings): void {
    const effectAmount = Math.max(0, Math.min(1, settings.effectAmount));
    const requestedAmbient = Math.max(0, Math.min(1, settings.ambient));
    const imageAmbient = 1 - effectAmount * (1 - requestedAmbient);
    this.temporalStep = 1 / (2 + Math.max(0, Math.min(1, settings.persistence)) * 18);
    // Radiance 2 uses one intensity control only. The canvas remains at full
    // compositing opacity, avoiding the old quadratic strength * opacity fade.
    this.emitterMaterial.uniforms.uGain.value = Math.max(
      0,
      this.mode === 'image' ? settings.strength / 2.2 : settings.strength / 1.5,
    );
    this.emitterMaterial.uniforms.uEmitterCutoff.value = Math.max(0.05, Math.min(0.95, settings.emitterCutoff));
    this.emitterMaterial.uniforms.uAbsorption.value = Math.max(0, Math.min(1, settings.absorption));
    this.field.setExternalBounceGain(this.mode === 'image' ? settings.bounce : 0.24);
    this.field.setTransportReach(this.mode === 'image' ? settings.reach : 1.5);
    this.field.setTransparentComposite(
      this.mode === 'image' ? 0.48 : 1,
      this.mode === 'image'
        ? effectAmount * Math.min(0.85, (1 - requestedAmbient) * 0.9 + settings.absorption * 0.32)
        : 0,
    );
    this.field.setDisplaySharpness(this.mode === 'image'
      ? Math.max(0.18, Math.min(0.5, 0.5 - settings.spread * 0.22))
      : Math.max(0.08, Math.min(0.72, 0.68 - settings.spread * 0.32)));
    this.field.setDisplayBlurRadius(this.mode === 'image'
      ? 1 + Math.max(0, Math.min(1.5, settings.spread)) * 2
      : 1);
    this.outputCanvas.style.opacity = this.mode === 'image'
      ? '1'
      : String(Math.max(0, Math.min(0.85, settings.strength * 0.55)));
    if (this.mode === 'image') {
      // A real shadow must be darker than the unlit source. Keep the image as
      // controllable ambient light, then let HRC restore brightness only where
      // sorted emitters can reach through the hue material field.
      const inherited = this.previousDisplayFilter && this.previousDisplayFilter !== 'none'
        ? `${this.previousDisplayFilter} `
        : '';
      this.displayCanvas.style.filter = `${inherited}brightness(${imageAmbient})`;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.displayCanvas.style.filter = this.previousDisplayFilter;
    this.field.dispose();
    this.sourceTexture.dispose();
    this.emitterTargets.forEach((target) => target.dispose());
    this.emitterMaterial.dispose();
    this.emitterGeometry.dispose();
    this.displayGeometry.dispose();
    this.renderer.dispose();
  }

  frame(): void {
    if (this.disposed || this.suspended) return;
    this.resize();
    this.frameIndex += 1;

    const canvasAspect = Math.max(this.displayCanvas.width, 1) / Math.max(this.displayCanvas.height, 1);
    let frameMinX = 0;
    let frameMinY = 0;
    let frameExtentX = 1;
    let frameExtentY = 1;
    if (canvasAspect > SOURCE_ASPECT) {
      frameExtentX = SOURCE_ASPECT / canvasAspect;
      frameMinX = (1 - frameExtentX) * 0.5;
    } else {
      frameExtentY = canvasAspect / SOURCE_ASPECT;
      frameMinY = (1 - frameExtentY) * (this.mode === 'waterfall' ? 0.18 : 0.5);
    }
    const frameMaxY = frameMinY + frameExtentY;
    this.emitterMaterial.uniforms.uFrameRect.value.set(
      frameMinX,
      frameMinY,
      frameMinX + frameExtentX,
      frameMaxY,
    );

    // Preserve square HRC world units while covering a rectangular viewport.
    const fieldExtentX = canvasAspect < 1 ? canvasAspect : 1;
    const fieldExtentY = canvasAspect > 1 ? 1 / canvasAspect : 1;
    const fieldMinX = (1 - fieldExtentX) * 0.5;
    const fieldMinY = (1 - fieldExtentY) * 0.5;
    this.emitterMaterial.uniforms.uFieldViewport.value.set(
      fieldMinX,
      fieldMinY,
      fieldExtentX,
      fieldExtentY,
    );
    this.field.setDisplayViewport(fieldMinX, fieldMinY, fieldExtentX, fieldExtentY);

    if (this.mode === 'waterfall') {
      const feather = Math.min(0.014, frameMinY * 0.18);
      const bottomStart = Math.min(1, frameMaxY + feather);
      const mask = `linear-gradient(to bottom, transparent 0%, transparent ${frameMaxY * 100}%, black ${bottomStart * 100}%, black 100%)`;
      this.outputCanvas.style.maskImage = mask;
      this.outputCanvas.style.webkitMaskImage = mask;
      this.outputCanvas.style.clipPath = 'none';
    } else {
      this.outputCanvas.style.maskImage = 'none';
      this.outputCanvas.style.webkitMaskImage = 'none';
      const right = Math.max(0, 1 - frameMinX - frameExtentX);
      const bottom = Math.max(0, 1 - frameMaxY);
      this.outputCanvas.style.clipPath = `inset(${frameMinY * 100}% ${right * 100}% ${bottom * 100}% ${frameMinX * 100}%)`;
    }

    // HRC remains the exact four-frustum cascade solver. We distribute its
    // passes over display frames so it shares the GPU with the WebGPU sorter
    // without lowering the sort/video cadence.
    if (this.frameIndex % 2 === 0) {
      this.sourceTexture.needsUpdate = true;
      const emitterWriteIndex = 1 - this.emitterReadIndex;
      const emitterWriteTarget = this.emitterTargets[emitterWriteIndex];
      this.renderer.setRenderTarget(emitterWriteTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.emitterScene, this.camera);
      this.emitterReadIndex = emitterWriteIndex;
      this.field.setExternalScene(emitterWriteTarget.texture);
      this.renderer.setRenderTarget(null);
      this.field.render(1);
    }
    if (this.field.revision !== this.fieldRevision) {
      this.fieldRevision = this.field.revision;
      this.temporalBlend = 0;
    } else {
      this.temporalBlend = Math.min(1, this.temporalBlend + this.temporalStep);
    }
    const smoothBlend = this.temporalBlend * this.temporalBlend * (3 - 2 * this.temporalBlend);
    this.field.setTemporalBlend(smoothBlend);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.displayScene, this.camera);
  }

  private resize(): void {
    const width = Math.max(1, this.outputCanvas.clientWidth || this.displayCanvas.clientWidth);
    const height = Math.max(1, this.outputCanvas.clientHeight || this.displayCanvas.clientHeight);
    // The transported field contains 512² samples. Rendering its display pass
    // above 768 px on either axis only resamples the same information and
    // competes with the WebGPU video path for fill rate.
    const displayScale = Math.min(1, 768 / width, 768 / height);
    const renderWidth = Math.max(1, Math.round(width * displayScale));
    const renderHeight = Math.max(1, Math.round(height * displayScale));
    if (this.outputCanvas.width === renderWidth && this.outputCanvas.height === renderHeight) return;
    this.renderer.setSize(renderWidth, renderHeight, false);
  }
}
