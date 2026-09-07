import * as THREE from 'three';
import {
  Box,
  Circle,
  Edge,
  Vec2,
  World,
  type Body,
  type Contact,
  type Fixture,
} from 'planck-js';
import type {
  DetectedNote,
  QualityLevel,
  SceneFrame,
  SceneRuntimeTelemetry,
  VisualScene,
} from '../../core/types';
import { actionCounterDelta } from '../../core/action-counter';
import { isNativeOutputTarget } from '../../core/output-target';
import {
  AMITABHA_DISPLAY_Z,
  AMITABHA_WORLD_BOUNDS,
  AmitabhaRadianceField,
  type AmitabhaBody,
} from './AmitabhaRadianceField';

const MAX_PACKING_BLOCKS = 220;
const BLOCK_HALF_WIDTH = 4.45;
const BLOCK_BOTTOM = -2.75;
const BLOCK_TOP = 2.85;
const PACKING_FLOOR_HALF_WIDTH = 4.8;
const PACKING_ROTATION_DURATION = 0.82;
const PACKING_FLOOR_WAVE_DURATION = 5;
const PACKING_FLOOR_WAVE_AMPLITUDE = 0.34;
const LEGACY_MATERIAL_CYCLE_SECONDS = 12;
const LEGACY_EMITTER_MIN = 3;
const LEGACY_EMITTER_MAX = 7;
const LEGACY_EMITTER_SCALE_DURATION = 10;
const LEGACY_EMITTER_SCALE_MIN = 1;
const LEGACY_EMITTER_SCALE_MAX = 3;
const LEGACY_PHYSICS_SCALE_STEP = 0.025;
const LEGACY_OPAQUE_COLOURS = [0x7d8795, 0x8b6f7e, 0x657d83, 0x897d62] as const;
const LEGACY_EMITTER_COLOURS = [
  { body: 0xff6b50, emission: [1, 0.08, 0.025] as const },
  { body: 0x599fff, emission: [0.035, 0.15, 1] as const },
  { body: 0xffce68, emission: [1, 0.72, 0.24] as const },
  { body: 0x78e7c7, emission: [0.08, 1, 0.62] as const },
] as const;
const ACTION_IDS = [
  'testNote',
  'toggleGravity',
  'rotate90',
  'toggleEmitterScale',
  'resetBlocks',
] as const;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));

const damp = (current: number, target: number, speed: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-speed * dt));

const pseudoRandom = (seed: number): number => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const cloudTextureUrl = `${import.meta.env.BASE_URL}radiance/blocks/nube.webp`;

interface PackingBlock {
  kind: 'block' | 'circle';
  note: DetectedNote;
  body: Body;
  fixture: Fixture | null;
  physicsScale: number;
  baseMass: number;
  width: number;
  height: number;
  color: number;
  sides: number;
  morphPhase: number;
  morphSeed: number;
  imageAnchorX: number;
  imageAnchorY: number;
  emissive: boolean;
  emissionRed: number;
  emissionGreen: number;
  emissionBlue: number;
  emissionStrength: number;
  transportOrder: number;
}

export interface BlocksRuntimeTelemetry extends SceneRuntimeTelemetry {
  hrcResolution: number;
  hrcUpdateHz: number;
  hrcFrustumsPerFrame: number;
  hrcDrawCalls: number;
  hrcTargetMemoryBytes: number;
  emitterCount: number;
  gravityEnabled: boolean;
  cameraRotationDegrees: number;
  emitterScale: number;
  emitterScaleTarget: 1 | 3;
}

class BlocksScene implements VisualScene {
  readonly id = 'blocks' as const;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private readonly world = new World(Vec2(0, -14));
  private readonly floor = this.world.createKinematicBody({
    position: Vec2(0, BLOCK_BOTTOM),
    userData: { kind: 'floor' },
  });
  private readonly packingGroup = new THREE.Group();
  private readonly packingIrradiance = { value: null as THREE.Texture | null };
  private readonly packingImage = { value: null as THREE.Texture | null };
  private readonly packingImageRoll = { value: 0 };
  private readonly worldBoundsUniform = { value: AMITABHA_WORLD_BOUNDS.clone() };
  private readonly blockEmissionData = new Float32Array(MAX_PACKING_BLOCKS * 4);
  private readonly blockImageAnchorData = new Float32Array(MAX_PACKING_BLOCKS * 2);
  private readonly circleEmissionData = new Float32Array(MAX_PACKING_BLOCKS * 4);
  private readonly circleImageAnchorData = new Float32Array(MAX_PACKING_BLOCKS * 2);
  private readonly blockMatrix = new THREE.Matrix4();
  private readonly blockPosition = new THREE.Vector3();
  private readonly blockQuaternion = new THREE.Quaternion();
  private readonly blockRotationAxis = new THREE.Vector3(0, 0, 1);
  private readonly blockScale = new THREE.Vector3();
  private readonly blockColor = new THREE.Color();
  private readonly actionValues = new Map<string, number>();

  private renderer: THREE.WebGLRenderer | null = null;
  private field: AmitabhaRadianceField | null = null;
  private display: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private cloudTexture: THREE.Texture | null = null;
  private blockGeometry: THREE.PlaneGeometry | null = null;
  private circleGeometry: THREE.CircleGeometry | null = null;
  private blockMaterial: THREE.MeshBasicMaterial | null = null;
  private blockMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private circleMesh: THREE.InstancedMesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null;
  private frameGeometry: THREE.BufferGeometry | null = null;
  private frameMaterial: THREE.LineBasicMaterial | null = null;
  private frameLine: THREE.Line | null = null;
  private packingBlocks: PackingBlock[] = [];
  private quality: QualityLevel = 'high';
  private width = 1;
  private height = 1;
  private dpr = 1;
  private suspended = false;
  private disposed = false;
  private contextState: 'ready' | 'lost' = 'ready';
  private restorePending = false;
  private lastAudioSequence = -1;
  private blockSequence = 0;
  private physicsAccumulator = 0;
  private lastTransportMs = 0;

  private packingDensity = 0.2;
  private packingDensityTarget = 0.2;
  private packingTurbulence = 0.1;
  private packingTurbulenceTarget = 0.1;
  private packingTension = 0.1;
  private packingTensionTarget = 0.1;
  private zoom = 1;

  private packingTurnElapsed = 0;
  private packingTurnActive = false;
  private packingTurnAngle = 0;
  private packingCameraRotation = 0;
  private packingTurnStartRotation = 0;
  private packingTurnDirection = 1;
  private packingIdleDirection = 1;
  private packingReceivedNoteSinceTurn = false;
  private lastPackingMidi = 60;
  private packingGravityEnabled = true;

  private legacyMaterialCycleElapsed = 0;
  private legacyMaterialCycle = 0;
  private legacyEmitterScale = LEGACY_EMITTER_SCALE_MIN;
  private legacyEmitterScaleStart = LEGACY_EMITTER_SCALE_MIN;
  private legacyEmitterScaleTarget: 1 | 3 = LEGACY_EMITTER_SCALE_MIN;
  private legacyEmitterScaleStartedAt = -Infinity;

  private packingFloorY = BLOCK_BOTTOM;
  private packingFloorWaveActive = false;
  private packingFloorWaveElapsed = 0;
  private packingFloorWaitElapsed = 0;
  private packingFloorNextWave = 8.5;

  private readonly onBeginContact = (contact: Contact): void => {
    this.handleContact(contact.getFixtureA().getBody(), contact.getFixtureB().getBody());
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextState = 'lost';
  };

  private readonly onContextRestored = (): void => {
    this.contextState = 'ready';
    this.restorePending = true;
  };

  async init(host: HTMLElement, quality: QualityLevel): Promise<void> {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      precision: 'highp',
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x030307, 1);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.dataset.scene = 'blocks-impulse-03';
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    host.appendChild(this.renderer.domElement);

    this.field = new AmitabhaRadianceField(this.renderer);
    this.field.setQuality(quality);
    this.field.setDisplaySharpness(0.25);
    this.field.setBackgroundEnabled(false);
    this.field.setExternalScene(null);

    this.cloudTexture = await new THREE.TextureLoader().loadAsync(cloudTextureUrl);
    if (this.disposed) return;
    this.cloudTexture.colorSpace = THREE.SRGBColorSpace;
    this.cloudTexture.minFilter = THREE.LinearFilter;
    this.cloudTexture.magFilter = THREE.LinearFilter;
    this.cloudTexture.generateMipmaps = true;
    this.field.setBackgroundTexture(this.cloudTexture);
    this.packingImage.value = this.cloudTexture;
    this.packingIrradiance.value = this.field.texture;

    this.display = this.field.createDisplayMesh();
    this.display.visible = true;
    this.scene.add(this.display);

    this.createPackingMeshes();
    this.camera.position.z = 8.5;
    this.scene.add(this.packingGroup);
    this.floor.createFixture(
      Edge(Vec2(-PACKING_FLOOR_HALF_WIDTH, 0), Vec2(PACKING_FLOOR_HALF_WIDTH, 0)),
      { friction: 0.82, restitution: 0.04 },
    );
    this.world.on('begin-contact', this.onBeginContact);
  }

  enter(_look: string): void {
    // ImpulseMode 3 has one authored look. Legacy cloud/amber/ice IDs remain
    // harmless aliases while stored show files migrate to `impulse-03`.
  }

  frame(frame: SceneFrame): void {
    if (this.suspended || this.disposed || this.contextState === 'lost') return;
    if (!this.renderer || !this.field || !this.blockMesh || !this.circleMesh) return;

    if (frame.quality !== this.quality) {
      this.quality = frame.quality;
      this.field.setQuality(frame.quality);
      this.packingIrradiance.value = this.field.texture;
    }
    if (this.restorePending) {
      this.field.reset();
      this.packingIrradiance.value = this.field.texture;
      this.restorePending = false;
    }

    this.packingDensityTarget = this.readDensity(frame.params.density);
    this.packingTurbulenceTarget = clamp(frame.params.turbulence ?? 0.1, 0, 1);
    this.packingTensionTarget = clamp(frame.params.tension ?? 0.1, 0, 1);
    this.consumeActions(frame.params, frame.now);

    if (frame.audio.sequence !== this.lastAudioSequence) {
      this.lastAudioSequence = frame.audio.sequence;
      frame.audio.notes.forEach((note) => this.spawnPackingBurst(note));
    }

    const dt = Math.min(frame.dt, 0.1);
    this.packingDensity = damp(this.packingDensity, this.packingDensityTarget, 3.2, dt);
    this.packingTurbulence = damp(this.packingTurbulence, this.packingTurbulenceTarget, 2.8, dt);
    this.packingTension = damp(this.packingTension, this.packingTensionTarget, 3.6, dt);
    this.zoom = damp(this.zoom, clamp(frame.params.zoom ?? 1, 0.65, 1.85), 5.2, dt);

    this.updatePackingTurn(dt);
    this.updateLegacyEmitterScale(frame.now);
    this.syncLegacyEmitterPhysics();

    const transportStartedAt = performance.now();
    this.stepPhysics(dt);
    this.updatePackingFloor(dt);
    this.removeEscapedPackingBlocks();
    this.updateLegacyBlockMaterials(dt);
    this.updateAmitabhaField(frame.now);
    this.updateInstances();
    this.lastTransportMs = performance.now() - transportStartedAt;

    const cameraTargetZ = 8.9 - (this.zoom - 1) * 2.2;
    this.camera.position.z = damp(this.camera.position.z, cameraTargetZ, 3.6, dt);
    this.syncAmitabhaDisplayToCamera();
    this.renderer.setClearColor(0x030307, 1);
    this.renderer.render(this.scene, this.camera);
    this.updateDebugDataset();
  }

  resize(width: number, height: number, dpr: number): void {
    if (!this.renderer || this.disposed) return;
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    // The authored High preset supersamples at 1.5× on a small preview, but
    // never scales the 3360×1008 show master beyond its requested resolution.
    const requestedDpr = dpr || 1;
    const highMinimumDpr = isNativeOutputTarget(nextWidth, nextHeight) ? 1 : 1.5;
    const nextDpr = this.quality === 'high'
      ? clamp(Math.max(highMinimumDpr, requestedDpr), 0.5, 2)
      : clamp(requestedDpr, 0.5, this.quality === 'balanced' ? 1.5 : 1);
    if (nextWidth === this.width && nextHeight === this.height && nextDpr === this.dpr) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.dpr = nextDpr;
    this.renderer.setPixelRatio(nextDpr);
    this.renderer.setSize(nextWidth, nextHeight, false);
    this.camera.aspect = nextWidth / nextHeight;
    this.camera.updateProjectionMatrix();
  }

  suspend(suspended: boolean): void {
    this.suspended = suspended;
    if (!suspended) this.physicsAccumulator = 0;
  }

  snapshot(): string | null {
    try {
      return this.renderer?.domElement.toDataURL('image/png') ?? null;
    } catch {
      return null;
    }
  }

  telemetry(): BlocksRuntimeTelemetry {
    const hrc = this.field?.stats ?? {
      resolution: this.quality === 'high' ? 1024 : this.quality === 'balanced' ? 512 : 256,
      frustumsPerFrame: 0,
      updateHz: 0,
      targetMemoryBytes: 0,
      drawCalls: 0,
    };
    return {
      renderer: `Three.js WebGL2 · Planck · Amitabha HRC ${hrc.resolution}²`,
      drawCalls: (this.renderer?.info.render.calls ?? 0) + hrc.drawCalls,
      particles: this.packingBlocks.length,
      solverMs: this.lastTransportMs,
      memoryMb: hrc.targetMemoryBytes / (1024 * 1024),
      warning: this.contextState === 'lost' ? 'Contexto WebGL perdido.' : null,
      hrcResolution: hrc.resolution,
      hrcUpdateHz: hrc.updateHz,
      hrcFrustumsPerFrame: hrc.frustumsPerFrame,
      hrcDrawCalls: hrc.drawCalls,
      hrcTargetMemoryBytes: hrc.targetMemoryBytes,
      emitterCount: this.packingBlocks.filter((block) => block.emissive).length,
      gravityEnabled: this.packingGravityEnabled,
      cameraRotationDegrees: this.packingCameraRotation * 180 / Math.PI,
      emitterScale: this.legacyEmitterScale,
      emitterScaleTarget: this.legacyEmitterScaleTarget,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.off('begin-contact', this.onBeginContact);
    this.clearPhysicsBodies();
    this.world.destroyBody(this.floor);

    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener('webglcontextlost', this.onContextLost);
    canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.blockGeometry?.dispose();
    this.circleGeometry?.dispose();
    this.blockMaterial?.dispose();
    this.frameGeometry?.dispose();
    this.frameMaterial?.dispose();
    this.display?.geometry.dispose();
    this.field?.dispose();
    this.cloudTexture?.dispose();
    this.scene.clear();
    this.renderer?.renderLists.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    canvas?.remove();

    this.blockMesh = null;
    this.circleMesh = null;
    this.display = null;
    this.field = null;
    this.renderer = null;
  }

  private createPackingMeshes(): void {
    this.blockGeometry = new THREE.PlaneGeometry(1, 1);
    this.circleGeometry = new THREE.CircleGeometry(0.5, 32);
    this.blockGeometry.setAttribute(
      'aEmission',
      new THREE.InstancedBufferAttribute(this.blockEmissionData, 4),
    );
    this.blockGeometry.setAttribute(
      'aPackingImageAnchor',
      new THREE.InstancedBufferAttribute(this.blockImageAnchorData, 2),
    );
    this.circleGeometry.setAttribute(
      'aEmission',
      new THREE.InstancedBufferAttribute(this.circleEmissionData, 4),
    );
    this.circleGeometry.setAttribute(
      'aPackingImageAnchor',
      new THREE.InstancedBufferAttribute(this.circleImageAnchorData, 2),
    );

    this.blockMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.97,
      depthWrite: false,
    });
    this.configurePackingMaterial(this.blockMaterial);
    this.blockMesh = new THREE.InstancedMesh(
      this.blockGeometry,
      this.blockMaterial,
      MAX_PACKING_BLOCKS,
    );
    this.circleMesh = new THREE.InstancedMesh(
      this.circleGeometry,
      this.blockMaterial,
      MAX_PACKING_BLOCKS,
    );
    for (const mesh of [this.blockMesh, this.circleMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.packingGroup.add(mesh);
    }

    this.frameGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-PACKING_FLOOR_HALF_WIDTH, BLOCK_BOTTOM, -0.1),
      new THREE.Vector3(PACKING_FLOOR_HALF_WIDTH, BLOCK_BOTTOM, -0.1),
    ]);
    this.frameMaterial = new THREE.LineBasicMaterial({
      color: 0x8c879f,
      transparent: true,
      opacity: 0.55,
    });
    this.frameLine = new THREE.Line(this.frameGeometry, this.frameMaterial);
    this.packingGroup.add(this.frameLine);
  }

  private configurePackingMaterial(material: THREE.MeshBasicMaterial): void {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uPackingIrradiance = this.packingIrradiance;
      shader.uniforms.uPackingImage = this.packingImage;
      shader.uniforms.uPackingImageRoll = this.packingImageRoll;
      shader.uniforms.uPackingWorldBounds = this.worldBoundsUniform;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aEmission;
          attribute vec2 aPackingImageAnchor;
          uniform float uPackingImageRoll;
          uniform vec4 uPackingWorldBounds;
          varying vec2 vPackingPosition;
          varying vec2 vPackingLocal;
          varying vec4 vPackingEmission;
          varying vec2 vPackingImageUv;`,
        )
        .replace(
          '#include <project_vertex>',
          `vPackingEmission = aEmission;
          vPackingLocal = transformed.xy;
          #ifdef USE_INSTANCING
            vec4 packingPosition = instanceMatrix * vec4(transformed, 1.0);
            vec2 packingCenter = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xy;
          #else
            vec4 packingPosition = vec4(transformed, 1.0);
            vec2 packingCenter = vec2(0.0);
          #endif
          vPackingPosition = packingPosition.xy;
          float imageRollCos = cos(uPackingImageRoll);
          float imageRollSin = sin(uPackingImageRoll);
          vec2 screenPosition = vec2(
            imageRollCos * packingPosition.x + imageRollSin * packingPosition.y,
            -imageRollSin * packingPosition.x + imageRollCos * packingPosition.y
          );
          vec2 anchorOffset = aPackingImageAnchor - packingCenter;
          vec2 screenAnchorOffset = vec2(
            imageRollCos * anchorOffset.x + imageRollSin * anchorOffset.y,
            -imageRollSin * anchorOffset.x + imageRollCos * anchorOffset.y
          );
          vPackingImageUv = clamp(
            (screenPosition + screenAnchorOffset - uPackingWorldBounds.xy)
              / (uPackingWorldBounds.zw - uPackingWorldBounds.xy),
            vec2(0.001),
            vec2(0.999)
          );
          #include <project_vertex>`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vPackingPosition;
          varying vec2 vPackingLocal;
          varying vec4 vPackingEmission;
          varying vec2 vPackingImageUv;
          uniform sampler2D uPackingIrradiance;
          uniform sampler2D uPackingImage;
          uniform vec4 uPackingWorldBounds;

          float packingShapeCoverage() {
            float interior = 0.5 - max(abs(vPackingLocal.x), abs(vPackingLocal.y));
            float width = max(fwidth(interior) * 1.35, 0.0005);
            return smoothstep(0.0, width, interior);
          }

          vec3 applyAmitabhaLighting(vec3 baseColour) {
            vec3 imageCrop = texture2D(uPackingImage, vPackingImageUv).rgb;
            vec3 imageMask = mix(
              vec3(0.002, 0.006, 0.016),
              imageCrop * vec3(0.34, 0.54, 0.84),
              0.2
            );
            if (vPackingEmission.a > 0.001) {
              return mix(imageMask, vPackingEmission.rgb, 0.44)
                * (0.86 + vPackingEmission.a * 0.42);
            }
            vec2 fieldUv = (vPackingPosition - uPackingWorldBounds.xy)
              / (uPackingWorldBounds.zw - uPackingWorldBounds.xy);
            vec3 irradiance = texture2D(
              uPackingIrradiance,
              clamp(fieldUv, vec2(0.001), vec2(0.999))
            ).rgb;
            return imageMask + irradiance * 0.14 + baseColour * 0.0;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vPackingEmission.a > 0.001) diffuseColor.a = 1.0;
          diffuseColor.a *= packingShapeCoverage();`,
        )
        .replace(
          'vec3 outgoingLight = reflectedLight.indirectDiffuse;',
          `vec3 outgoingLight = reflectedLight.indirectDiffuse;
          outgoingLight = applyAmitabhaLighting(outgoingLight);`,
        );
    };
    material.customProgramCacheKey = () => 'piano-impulse-mode-03-hrc-image-material-v1';
  }

  private readDensity(value: number | undefined): number {
    if (!Number.isFinite(value)) return 0.2;
    // Compatibility with the first unified manifest, which temporarily used
    // 8..90 rather than the original normalized 0..1 macro.
    if ((value as number) > 1) return clamp(((value as number) - 8) / 82, 0, 1);
    return clamp(value as number, 0, 1);
  }

  private consumeActions(params: Record<string, number>, now: number): void {
    const deltas = new Map<string, number>();
    for (const id of ACTION_IDS) {
      const value = Math.round(clamp(params[id] ?? 0, 0, 999));
      const previous = this.actionValues.get(id);
      this.actionValues.set(id, value);
      const delta = actionCounterDelta(previous, value);
      if (delta > 0) deltas.set(id, delta);
    }

    for (let count = 0; count < (deltas.get('toggleGravity') ?? 0); count += 1) this.togglePackingGravity();
    for (let count = 0; count < (deltas.get('rotate90') ?? 0); count += 1) this.rotatePackingScene();
    for (let count = 0; count < (deltas.get('toggleEmitterScale') ?? 0); count += 1) this.toggleLitBlockScale(now);
    if (deltas.has('resetBlocks')) this.clearPackingBlocks();
    const noteCount = deltas.get('testNote') ?? 0;
    if (noteCount > 0) {
      const midi = Math.round(clamp(params.testMidi ?? 60, 21, 108));
      for (let count = 0; count < noteCount; count += 1) {
        this.spawnPackingBurst({
          midi,
          frequency: 440 * 2 ** ((midi - 69) / 12),
          strength: 0.85,
        });
      }
    }
  }

  private spawnPackingBurst(note: DetectedNote): void {
    const strength = clamp(note.strength, 0, 1);
    // 0.2 is the authored mode-03 neutral point: the multiplier is exactly
    // one there, preserving the original 2–5 bodies per note. The unified
    // density macro can now make future attacks sparser or denser.
    const densityMultiplier = 0.75 + this.packingDensityTarget * 1.25;
    const requested = Math.max(
      1,
      Math.round((2 + Math.floor(strength * 3)) * densityMultiplier),
    );
    const count = Math.min(requested, MAX_PACKING_BLOCKS - this.packingBlocks.length);
    for (let index = 0; index < count; index += 1) this.spawnPackingBlock(note);
  }

  private spawnPackingBlock(note: DetectedNote): void {
    if (this.packingBlocks.length >= MAX_PACKING_BLOCKS) return;
    this.lastPackingMidi = note.midi;
    this.packingReceivedNoteSinceTurn = true;
    this.blockSequence += 1;
    const seed = note.midi * 17.17 + note.strength * 31.7 + this.blockSequence * 7.31;
    const pitch = clamp((note.midi - 21) / 87, 0, 1);
    const strength = clamp(note.strength, 0, 1);
    const blockWidth = clamp(
      1.25 - pitch * 0.8 + (pseudoRandom(seed) - 0.5) * 0.26,
      0.3,
      1.38,
    );
    const blockHeight = clamp(
      0.22 + pitch * 0.56 + (pseudoRandom(seed + 19.4) - 0.5) * 0.2,
      0.18,
      0.92,
    );
    const isCircle = pseudoRandom(seed + 57.9) < 0.34;
    const circleDiameter = clamp((blockWidth + blockHeight) * 0.56, 0.28, 0.9);
    const width = isCircle ? circleDiameter : blockWidth;
    const height = isCircle ? circleDiameter : blockHeight;
    const currentEmitterCount = this.packingBlocks.reduce(
      (count, block) => count + (block.emissive ? 1 : 0),
      0,
    );
    const targetEmitterCount = this.legacyEmitterCount(this.packingBlocks.length + 1);
    const shouldEmit = currentEmitterCount < targetEmitterCount
      || (
        currentEmitterCount < LEGACY_EMITTER_MAX
        && strength > 0.68
        && pseudoRandom(seed + 301.7) < 0.48
      );
    const spawn = this.packingSpawn(seed, strength, height);
    const body = this.world.createDynamicBody({
      position: spawn.position,
      angle: (pseudoRandom(seed + 12.7) - 0.5) * 0.62,
      linearVelocity: spawn.velocity,
      angularVelocity: (pseudoRandom(seed + 91.6) - 0.5) * (3.4 + strength * 5.2),
      linearDamping: 0.05,
      angularDamping: 0.12,
      bullet: true,
    });
    const emitterPalette = LEGACY_EMITTER_COLOURS[
      Math.floor(pseudoRandom(seed + 228.4) * LEGACY_EMITTER_COLOURS.length)
    ];
    const opaqueColour = LEGACY_OPAQUE_COLOURS[
      Math.floor(pseudoRandom(seed + 184.2) * LEGACY_OPAQUE_COLOURS.length)
    ];
    const block: PackingBlock = {
      kind: isCircle ? 'circle' : 'block',
      note,
      body,
      fixture: null,
      physicsScale: 1,
      baseMass: 0,
      width,
      height,
      color: shouldEmit ? emitterPalette.body : opaqueColour,
      sides: isCircle ? 32 : 4,
      morphPhase: 0,
      morphSeed: pseudoRandom(seed + 118.2),
      imageAnchorX: spawn.position.x,
      imageAnchorY: spawn.position.y,
      emissive: shouldEmit,
      emissionRed: shouldEmit ? emitterPalette.emission[0] : 0,
      emissionGreen: shouldEmit ? emitterPalette.emission[1] : 0,
      emissionBlue: shouldEmit ? emitterPalette.emission[2] : 0,
      emissionStrength: shouldEmit ? 0.65 + strength * 0.55 : 0,
      transportOrder: this.blockSequence,
    };
    block.fixture = body.createFixture(
      isCircle ? Circle(width / 2) : Box(width / 2, height / 2),
      {
        density: isCircle ? 0.86 : 1,
        friction: isCircle ? 0.44 : 0.56,
        restitution: isCircle ? 0.28 : 0.1,
      },
    );
    block.baseMass = body.getMass();
    body.setUserData(block);
    this.packingBlocks.push(block);
  }

  private packingSpawn(seed: number, strength: number, height: number): {
    position: ReturnType<typeof Vec2>;
    velocity: ReturnType<typeof Vec2>;
  } {
    if (this.packingGravityEnabled) {
      return {
        position: Vec2(
          (pseudoRandom(seed + 43.8) - 0.5) * BLOCK_HALF_WIDTH * 1.85,
          BLOCK_TOP + height + 0.8,
        ),
        velocity: Vec2(
          (pseudoRandom(seed + 63.2) - 0.5) * (1.8 + strength * 3.5),
          -0.15 - strength * 0.35,
        ),
      };
    }

    const edge = pseudoRandom(seed + 43.8);
    const along = pseudoRandom(seed + 51.6);
    const position = edge < 0.34
      ? Vec2(-5.25, -1.6 + along * 4.7)
      : edge < 0.68
        ? Vec2(5.25, -1.6 + along * 4.7)
        : Vec2(-4.25 + along * 8.5, 3.75);
    const targetX = (pseudoRandom(seed + 77.4) - 0.5) * 1.1;
    const targetY = (pseudoRandom(seed + 84.1) - 0.5) * 0.9;
    const deltaX = targetX - position.x;
    const deltaY = targetY - position.y;
    const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
    const speed = 2.6 + strength * 3.4 + this.packingTurbulenceTarget * 2.2;
    const sideways = (pseudoRandom(seed + 93.8) - 0.5)
      * (0.35 + this.packingTurbulenceTarget * 1.2);
    return {
      position,
      velocity: Vec2(
        deltaX / distance * speed - deltaY / distance * sideways,
        deltaY / distance * speed + deltaX / distance * sideways,
      ),
    };
  }

  private stepPhysics(dt: number): void {
    // Preserve the authored damping at tension=0.1. Moving the macro below or
    // above that neutral point makes the same Planck bodies looser or more
    // constrained without changing the default visual.
    const linearDamping = clamp(0.05 + (this.packingTension - 0.1) * 0.3, 0.01, 0.32);
    const angularDamping = clamp(0.12 + (this.packingTension - 0.1) * 1.2, 0.01, 1.2);
    this.packingBlocks.forEach((block) => {
      block.body.setLinearDamping(linearDamping);
      block.body.setAngularDamping(angularDamping);
    });
    this.physicsAccumulator += dt;
    const fixedStep = 1 / 120;
    let subSteps = 0;
    while (this.physicsAccumulator >= fixedStep && subSteps < 12) {
      this.world.step(fixedStep, 8, 3);
      this.physicsAccumulator -= fixedStep;
      subSteps += 1;
    }
    if (subSteps === 12) this.physicsAccumulator = 0;
  }

  private updatePackingTurn(dt: number): void {
    if (!this.packingTurnActive) return;
    this.packingTurnElapsed += dt;
    const progress = Math.min(1, this.packingTurnElapsed / PACKING_ROTATION_DURATION);
    const eased = progress * progress * (3 - 2 * progress);
    this.packingCameraRotation = this.packingTurnStartRotation + this.packingTurnAngle * eased;
    this.camera.rotation.z = this.packingCameraRotation;
    if (progress >= 1) this.commitPackingTurn();
  }

  private updatePackingFloor(dt: number): void {
    if (!this.packingFloorWaveActive) {
      if (this.packingBlocks.length === 0) return;
      this.packingFloorWaitElapsed += dt;
      if (this.packingFloorWaitElapsed < this.packingFloorNextWave) return;
      this.packingFloorWaveActive = true;
      this.packingFloorWaveElapsed = 0;
    }

    this.packingFloorWaveElapsed += dt;
    const progress = Math.min(1, this.packingFloorWaveElapsed / PACKING_FLOOR_WAVE_DURATION);
    const envelope = Math.sin(Math.PI * progress);
    const displacement = Math.sin(Math.PI * 4 * progress)
      * envelope
      * PACKING_FLOOR_WAVE_AMPLITUDE;
    this.setPackingFloorY(BLOCK_BOTTOM + displacement);
    if (progress < 1) return;
    this.packingFloorWaveActive = false;
    this.packingFloorWaveElapsed = 0;
    this.packingFloorWaitElapsed = 0;
    this.packingFloorNextWave = 8 + pseudoRandom(this.blockSequence * 5.3) * 6;
    this.setPackingFloorY(BLOCK_BOTTOM);
  }

  private setPackingFloorY(y: number): void {
    if (Math.abs(y - this.packingFloorY) < 0.0001) return;
    this.packingFloorY = y;
    this.floor.setTransform(Vec2(0, y), 0);
    this.floor.setAwake(true);
    if (this.frameLine) this.frameLine.position.y = y - BLOCK_BOTTOM;
  }

  private updateLegacyBlockMaterials(dt: number): void {
    if (this.packingBlocks.length === 0) return;
    this.legacyMaterialCycleElapsed += dt;
    if (this.legacyMaterialCycleElapsed < LEGACY_MATERIAL_CYCLE_SECONDS) return;
    this.legacyMaterialCycleElapsed -= LEGACY_MATERIAL_CYCLE_SECONDS;
    this.legacyMaterialCycle += 1;
    const ordered = [...this.packingBlocks]
      .sort((left, right) => left.transportOrder - right.transportOrder);
    const emitterCount = this.legacyEmitterCount(ordered.length);
    const selected = new Set(
      [...ordered]
        .sort((left, right) => (
          pseudoRandom(left.transportOrder * 5.3 + this.legacyMaterialCycle * 11.7)
          - pseudoRandom(right.transportOrder * 5.3 + this.legacyMaterialCycle * 11.7)
        ))
        .slice(0, emitterCount),
    );
    ordered.forEach((block) => {
      if (selected.has(block)) this.makeLegacyBlockEmitter(block);
      else this.makeLegacyBlockOpaque(block);
    });
  }

  private legacyEmitterCount(bodyCount: number): number {
    return Math.min(
      LEGACY_EMITTER_MAX,
      Math.max(LEGACY_EMITTER_MIN, Math.ceil(bodyCount * 0.34)),
    );
  }

  private updateLegacyEmitterScale(now: number): void {
    if (!Number.isFinite(this.legacyEmitterScaleStartedAt)) return;
    const progress = clamp(
      (now - this.legacyEmitterScaleStartedAt) / LEGACY_EMITTER_SCALE_DURATION,
      0,
      1,
    );
    const eased = progress * progress * (3 - 2 * progress);
    this.legacyEmitterScale = this.legacyEmitterScaleStart
      + (this.legacyEmitterScaleTarget - this.legacyEmitterScaleStart) * eased;
    if (progress >= 1) this.legacyEmitterScaleStartedAt = -Infinity;
  }

  private syncLegacyEmitterPhysics(): void {
    for (const block of this.packingBlocks) {
      const targetScale = block.emissive ? this.legacyEmitterScale : 1;
      const scaleDelta = Math.abs(targetScale - block.physicsScale);
      const atEndpoint = Math.abs(targetScale - LEGACY_EMITTER_SCALE_MIN) < 0.0001
        || Math.abs(targetScale - LEGACY_EMITTER_SCALE_MAX) < 0.0001;
      if (
        block.fixture
        && scaleDelta < LEGACY_PHYSICS_SCALE_STEP
        && (!atEndpoint || scaleDelta < 0.0001)
      ) continue;

      if (block.fixture) block.body.destroyFixture(block.fixture);
      block.fixture = block.body.createFixture(
        block.kind === 'circle'
          ? Circle(block.width * targetScale * 0.5)
          : Box(block.width * targetScale * 0.5, block.height * targetScale * 0.5),
        {
          density: block.kind === 'circle' ? 0.86 : 1,
          friction: block.kind === 'circle' ? 0.44 : 0.56,
          restitution: block.kind === 'circle' ? 0.28 : 0.1,
        },
      );
      block.physicsScale = targetScale;
      block.body.setAwake(true);
    }
  }

  private makeLegacyBlockOpaque(block: PackingBlock): void {
    const index = Math.floor(
      pseudoRandom(block.transportOrder * 3.7 + this.legacyMaterialCycle * 9.1)
      * LEGACY_OPAQUE_COLOURS.length,
    );
    block.emissive = false;
    block.emissionRed = 0;
    block.emissionGreen = 0;
    block.emissionBlue = 0;
    block.emissionStrength = 0;
    block.color = LEGACY_OPAQUE_COLOURS[index];
  }

  private makeLegacyBlockEmitter(block: PackingBlock): void {
    const index = Math.floor(
      pseudoRandom(block.transportOrder * 5.3 + this.legacyMaterialCycle * 11.7)
      * LEGACY_EMITTER_COLOURS.length,
    );
    const palette = LEGACY_EMITTER_COLOURS[index];
    block.emissive = true;
    block.emissionRed = palette.emission[0];
    block.emissionGreen = palette.emission[1];
    block.emissionBlue = palette.emission[2];
    block.emissionStrength = 0.65 + block.note.strength * 0.55;
    block.color = palette.body;
  }

  private updateAmitabhaField(elapsed: number): void {
    if (!this.field) return;
    const bodies: AmitabhaBody[] = this.packingBlocks.map((block) => {
      const position = block.body.getPosition();
      this.blockColor.setHex(block.color);
      const pulse = block.emissive
        ? 0.94 + Math.sin(
          elapsed * (1.05 + block.morphSeed * 0.55) + block.morphPhase,
        ) * 0.06
        : 0;
      const emitterScale = block.emissive ? this.legacyEmitterScale : 1;
      return {
        x: position.x,
        y: position.y,
        halfWidth: block.width * emitterScale * 0.5,
        halfHeight: block.height * emitterScale * 0.5,
        angle: block.body.getAngle(),
        emission: [block.emissionRed, block.emissionGreen, block.emissionBlue] as const,
        emissionStrength: block.emissionStrength * pulse,
        albedo: block.emissive
          ? [0, 0, 0] as const
          : [
              this.blockColor.r * 0.72,
              this.blockColor.g * 0.72,
              this.blockColor.b * 0.72,
            ] as const,
        sides: block.kind === 'circle' ? block.sides : undefined,
        transportRole: 'body' as const,
        transportOrder: block.transportOrder,
      };
    });
    bodies.push({
      x: 0,
      y: this.packingFloorY - 0.055,
      halfWidth: PACKING_FLOOR_HALF_WIDTH,
      halfHeight: 0.055,
      angle: 0,
      emission: [0, 0, 0],
      emissionStrength: 0,
      albedo: [0.58, 0.58, 0.62],
      transportRole: 'floor',
      transportOrder: -1,
    });
    this.field.setBodies(bodies);
    this.field.render();
    this.packingIrradiance.value = this.field.texture;
  }

  private updateInstances(): void {
    if (!this.blockMesh || !this.circleMesh || !this.blockGeometry || !this.circleGeometry) return;
    let blockInstance = 0;
    let circleInstance = 0;
    for (const block of this.packingBlocks) {
      const position = block.body.getPosition();
      this.blockPosition.set(position.x, position.y, 0);
      this.blockQuaternion.setFromAxisAngle(this.blockRotationAxis, block.body.getAngle());
      const emitterScale = block.emissive ? this.legacyEmitterScale : 1;
      this.blockMatrix.compose(
        this.blockPosition,
        this.blockQuaternion,
        this.blockScale.set(block.width * emitterScale, block.height * emitterScale, 1),
      );
      const instance = block.kind === 'block' ? blockInstance : circleInstance;
      const mesh = block.kind === 'block' ? this.blockMesh : this.circleMesh;
      const emissions = block.kind === 'block' ? this.blockEmissionData : this.circleEmissionData;
      const anchors = block.kind === 'block' ? this.blockImageAnchorData : this.circleImageAnchorData;
      mesh.setMatrixAt(instance, this.blockMatrix);
      mesh.setColorAt(instance, this.blockColor.setHex(block.color));
      emissions[instance * 4] = block.emissionRed;
      emissions[instance * 4 + 1] = block.emissionGreen;
      emissions[instance * 4 + 2] = block.emissionBlue;
      emissions[instance * 4 + 3] = block.emissionStrength;
      anchors[instance * 2] = block.imageAnchorX;
      anchors[instance * 2 + 1] = block.imageAnchorY;
      if (block.kind === 'block') blockInstance += 1;
      else circleInstance += 1;
    }

    this.blockMesh.count = blockInstance;
    this.blockMesh.instanceMatrix.needsUpdate = true;
    if (this.blockMesh.instanceColor) this.blockMesh.instanceColor.needsUpdate = true;
    this.blockGeometry.getAttribute('aEmission').needsUpdate = true;
    this.blockGeometry.getAttribute('aPackingImageAnchor').needsUpdate = true;
    this.blockMesh.visible = blockInstance > 0;

    this.circleMesh.count = circleInstance;
    this.circleMesh.instanceMatrix.needsUpdate = true;
    if (this.circleMesh.instanceColor) this.circleMesh.instanceColor.needsUpdate = true;
    this.circleGeometry.getAttribute('aEmission').needsUpdate = true;
    this.circleGeometry.getAttribute('aPackingImageAnchor').needsUpdate = true;
    this.circleMesh.visible = circleInstance > 0;
  }

  private togglePackingGravity(): void {
    this.packingGravityEnabled = !this.packingGravityEnabled;
    this.world.setGravity(Vec2(0, this.packingGravityEnabled ? -14 : 0));
    if (this.frameMaterial) this.frameMaterial.opacity = this.packingGravityEnabled ? 0.55 : 0.18;
    this.packingBlocks.forEach((block, index) => {
      block.body.setAwake(true);
      if (!this.packingGravityEnabled) this.launchPackingBodyTowardCenter(block, index);
    });
  }

  private rotatePackingScene(): void {
    if (this.packingTurnActive) return;
    this.packingTurnActive = true;
    this.packingTurnElapsed = 0;
    this.packingTurnDirection = this.packingReceivedNoteSinceTurn
      ? (this.lastPackingMidi >= 60 ? 1 : -1)
      : this.packingIdleDirection;
    this.packingIdleDirection *= -1;
    this.packingReceivedNoteSinceTurn = false;
    this.packingTurnAngle = this.packingTurnDirection * Math.PI / 2;
    this.packingTurnStartRotation = this.packingCameraRotation;
  }

  private toggleLitBlockScale(now: number): void {
    if (!this.packingBlocks.some((block) => block.emissive)) return;
    this.legacyEmitterScaleStart = this.legacyEmitterScale;
    this.legacyEmitterScaleTarget = this.legacyEmitterScaleTarget === LEGACY_EMITTER_SCALE_MAX
      ? LEGACY_EMITTER_SCALE_MIN
      : LEGACY_EMITTER_SCALE_MAX;
    this.legacyEmitterScaleStartedAt = now;
  }

  private launchPackingBodyTowardCenter(block: PackingBlock, index: number): void {
    const position = block.body.getPosition();
    const velocity = block.body.getLinearVelocity();
    let deltaX = -position.x;
    let deltaY = -position.y;
    let distance = Math.hypot(deltaX, deltaY);
    if (distance < 0.2) {
      const angle = pseudoRandom(this.blockSequence * 3.7 + index * 9.1) * Math.PI * 2;
      deltaX = Math.cos(angle);
      deltaY = Math.sin(angle);
      distance = 1;
    }
    const speed = 1.15 + block.note.strength * 1.15 + this.packingTurbulenceTarget * 1.35;
    const tangent = (block.morphSeed - 0.5) * (0.45 + this.packingTurbulenceTarget * 1.1);
    block.body.setLinearVelocity(Vec2(
      velocity.x * 0.18 + deltaX / distance * speed - deltaY / distance * tangent,
      velocity.y * 0.18 + deltaY / distance * speed + deltaX / distance * tangent,
    ));
  }

  private commitPackingTurn(): void {
    this.packingCameraRotation = Math.atan2(
      Math.sin(this.packingTurnStartRotation + this.packingTurnAngle),
      Math.cos(this.packingTurnStartRotation + this.packingTurnAngle),
    );
    this.camera.rotation.z = this.packingCameraRotation;
    this.packingTurnActive = false;
    this.packingTurnElapsed = 0;
    this.packingTurnAngle = 0;
    this.packingTurnStartRotation = this.packingCameraRotation;
  }

  private syncAmitabhaDisplayToCamera(): void {
    if (!this.display || !this.field) return;
    const roll = this.camera.rotation.z;
    this.packingImageRoll.value = roll;
    const centerX = (AMITABHA_WORLD_BOUNDS.x + AMITABHA_WORLD_BOUNDS.z) * 0.5;
    const centerY = (AMITABHA_WORLD_BOUNDS.y + AMITABHA_WORLD_BOUNDS.w) * 0.5;
    const cosine = Math.cos(roll);
    const sine = Math.sin(roll);
    this.display.rotation.z = roll;
    this.display.position.set(
      cosine * centerX - sine * centerY,
      sine * centerX + cosine * centerY,
      AMITABHA_DISPLAY_Z,
    );
    this.field.setDisplayRoll(roll);
  }

  private handleContact(firstBody: Body, secondBody: Body): void {
    const first = this.asPackingBlock(firstBody.getUserData());
    const second = this.asPackingBlock(secondBody.getUserData());
    if (!first || !second) return;
    const firstDirection = Math.abs(first.body.getAngularVelocity()) > 0.2
      ? first.body.getAngularVelocity()
      : first.note.midi - 60;
    const secondDirection = Math.abs(second.body.getAngularVelocity()) > 0.2
      ? second.body.getAngularVelocity()
      : second.note.midi - 60;
    first.color = firstDirection >= 0 ? 0xef3155 : 0x3979ef;
    second.color = secondDirection >= 0 ? 0xef3155 : 0x3979ef;
    if (first.emissive) {
      first.emissionStrength = Math.max(first.emissionStrength, 3.4 + first.note.strength);
    }
    if (second.emissive) {
      second.emissionStrength = Math.max(second.emissionStrength, 3.4 + second.note.strength);
    }
  }

  private asPackingBlock(value: unknown): PackingBlock | null {
    if (typeof value !== 'object' || value === null || !('kind' in value)) return null;
    const kind = (value as { kind?: unknown }).kind;
    return kind === 'block' || kind === 'circle' ? value as PackingBlock : null;
  }

  private removeEscapedPackingBlocks(): void {
    const survivors: PackingBlock[] = [];
    for (const block of this.packingBlocks) {
      const position = block.body.getPosition();
      if (position.y < -10 || Math.abs(position.x) > 14 || position.y > 12) {
        this.world.destroyBody(block.body);
      } else survivors.push(block);
    }
    this.packingBlocks = survivors;
  }

  private clearPhysicsBodies(): void {
    this.packingBlocks.forEach((block) => this.world.destroyBody(block.body));
    this.packingBlocks = [];
  }

  private clearPackingBlocks(): void {
    this.clearPhysicsBodies();
    this.blockSequence = 0;
    this.physicsAccumulator = 0;
    this.packingTurnElapsed = 0;
    this.packingTurnActive = false;
    this.packingTurnAngle = 0;
    this.packingCameraRotation = 0;
    this.packingTurnStartRotation = 0;
    this.packingTurnDirection = 1;
    this.packingIdleDirection = 1;
    this.packingReceivedNoteSinceTurn = false;
    this.lastPackingMidi = 60;
    this.legacyMaterialCycleElapsed = 0;
    this.legacyMaterialCycle = 0;
    this.legacyEmitterScale = LEGACY_EMITTER_SCALE_MIN;
    this.legacyEmitterScaleStart = LEGACY_EMITTER_SCALE_MIN;
    this.legacyEmitterScaleTarget = LEGACY_EMITTER_SCALE_MIN;
    this.legacyEmitterScaleStartedAt = -Infinity;
    this.packingGravityEnabled = true;
    this.world.setGravity(Vec2(0, -14));
    if (this.frameMaterial) this.frameMaterial.opacity = 0.55;
    this.packingFloorWaveActive = false;
    this.packingFloorWaveElapsed = 0;
    this.packingFloorWaitElapsed = 0;
    this.packingFloorNextWave = 8.5;
    this.setPackingFloorY(BLOCK_BOTTOM);
    if (this.frameLine) this.frameLine.position.y = 0;
    this.camera.rotation.z = 0;
    this.field?.reset();
    if (this.field) this.packingIrradiance.value = this.field.texture;
    if (this.blockMesh) {
      this.blockMesh.count = 0;
      this.blockMesh.visible = false;
    }
    if (this.circleMesh) {
      this.circleMesh.count = 0;
      this.circleMesh.visible = false;
    }
  }

  private updateDebugDataset(): void {
    if (!this.renderer || !this.field) return;
    const emitterCount = this.packingBlocks.reduce(
      (count, block) => count + (block.emissive ? 1 : 0),
      0,
    );
    const dataset = this.renderer.domElement.dataset;
    dataset.blockCount = String(this.packingBlocks.length);
    dataset.emitterCount = String(emitterCount);
    dataset.gravityEnabled = String(this.packingGravityEnabled);
    dataset.cameraRotationDegrees = (this.packingCameraRotation * 180 / Math.PI).toFixed(2);
    dataset.emitterScale = this.legacyEmitterScale.toFixed(3);
    dataset.emitterScaleTarget = String(this.legacyEmitterScaleTarget);
    dataset.radianceResolution = String(this.field.stats.resolution);
    dataset.hrcUpdateHz = this.field.stats.updateHz.toFixed(2);
    dataset.density = this.packingDensity.toFixed(3);
    dataset.turbulence = this.packingTurbulence.toFixed(3);
    dataset.tension = this.packingTension.toFixed(3);
  }
}

export const createBlocksScene = async (
  host: HTMLElement,
  quality: QualityLevel,
): Promise<VisualScene> => {
  const scene = new BlocksScene();
  try {
    await scene.init(host, quality);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
};
