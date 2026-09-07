import * as THREE from 'three';
import type { QualityLevel, SceneFrame, SceneRuntimeTelemetry, VisualScene } from '../../core/types';

const MAX_CELLS = 160;
const MIN_CELLS = 5;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform int uCount;
  // Position and light are packed together to stay below conservative
  // WebGL2 fragment-uniform limits even at the 160-cell manifest maximum.
  uniform vec3 uCells[${MAX_CELLS}];
  uniform float uAspect;
  uniform vec2 uPixels;
  uniform float uTime;
  uniform float uMotion;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uPulse;
  uniform float uDensity;
  uniform int uLook;
  varying vec2 vUv;

  vec3 spectral(float index, float energy) {
    vec3 phase = vec3(0.0, 2.094, 4.188);
    return .48 + .52 * cos(phase + index * .73 + uTime * .08 + energy);
  }

  void main() {
    float nearest = 1000.0;
    float secondNearest = 1000.0;
    float nearestIndex = 0.0;
    float nearestLight = 0.0;
    for (int index = 0; index < ${MAX_CELLS}; index++) {
      if (index < uCount) {
        vec2 delta = vUv - uCells[index].xy;
        delta.x *= uAspect;
        float distanceSquared = dot(delta, delta);
        if (distanceSquared < nearest) {
          secondNearest = nearest;
          nearest = distanceSquared;
          nearestIndex = float(index);
          nearestLight = uCells[index].z;
        } else if (distanceSquared < secondNearest) {
          secondNearest = distanceSquared;
        }
      }
    }

    float edgeGap = sqrt(secondNearest) - sqrt(nearest);
    float pixel = 2.0 / max(uPixels.y, 1.0);
    float width = max(fwidth(edgeGap) * 1.55, pixel);
    float line = 1.0 - smoothstep(width * .08, width * 1.22, edgeGap);
    float halo = 1.0 - smoothstep(width, width * 8.0, edgeGap);
    float phase = nearestIndex * 1.6180339;
    vec2 drift = vec2(sin(uTime * .071 + phase), cos(uTime * .057 + phase * 1.31)) * uMotion;
    float tileIndex = mod(nearestIndex, 64.0);
    vec2 tile = vec2(mod(tileIndex, 8.0), 7.0 - floor(tileIndex / 8.0));
    vec2 tileLocal = clamp((vUv - .5) / (1.07 + .02 * sin(uTime * .09 + phase)) + .5 + drift, vec2(.025), vec2(.975));
    vec3 forest = texture2D(uAtlas, (tile + tileLocal) / 8.0).rgb;
    forest = pow(max(forest, vec3(0.0)), vec3(.74));
    vec3 colour;
    if (uLook == 0) {
      colour = forest * (.14 + uDensity * .1 + nearestLight * (1.2 + uDensity * .3) + uPulse * .28);
    } else if (uLook == 1) {
      colour = spectral(nearestIndex, nearestLight * 2.0) * (.08 + uDensity * .05 + nearestLight * (1.0 + uDensity * .2) + uPulse * .2);
      colour += forest * .08;
    } else {
      float luma = dot(forest, vec3(.2126, .7152, .0722));
      colour = vec3(luma) * (.07 + uDensity * .05 + nearestLight * (1.15 + uDensity * .25) + uPulse * .22);
    }
    colour *= 1.0 + halo * nearestLight * .38;
    colour = mix(vec3(.5), colour, uContrast);
    colour *= uBrightness;
    colour = mix(colour, vec3(1.0) * (1.0 + nearestLight * .45), max(line, smoothstep(.97, 1.0, uPulse) * line));
    float frame = 1.0 - smoothstep(.3, 1.7, min(min(vUv.x, 1.0-vUv.x) * uPixels.x, min(vUv.y, 1.0-vUv.y) * uPixels.y));
    colour = mix(colour, vec3(1.0), frame);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

interface Cell {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

const hash = (seed: number): number => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

class VoronoiScene implements VisualScene {
  readonly id = 'voronoi' as const;
  private renderer!: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private material!: THREE.ShaderMaterial;
  private mesh!: THREE.Mesh;
  private texture!: THREE.Texture;
  private readonly cells: Cell[] = [];
  private readonly cellUniforms = Array.from({ length: MAX_CELLS }, () => new THREE.Vector3(0.5, 0.5, 0));
  private readonly lights = new Float32Array(MAX_CELLS);
  private readonly uniforms = {
    uAtlas: { value: null as THREE.Texture | null }, uCount: { value: 5 },
    uCells: { value: this.cellUniforms },
    uAspect: { value: 1 }, uPixels: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 }, uMotion: { value: .007 }, uBrightness: { value: 1 },
    uContrast: { value: 1 }, uPulse: { value: 0 }, uDensity: { value: 0.85 }, uLook: { value: 0 },
  };
  private width = 1;
  private height = 1;
  private dpr = 1;
  private look = 'forest';
  private noteDelta = 0;
  private lastAudioSequence = -1;
  private chase = 0;
  private suspended = false;
  private disposed = false;

  async init(host: HTMLElement, quality: QualityLevel): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'safe', powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    host.appendChild(this.renderer.domElement);
    try {
      this.texture = await new THREE.TextureLoader().loadAsync('/voronoi/forest-satellite-atlas-8x8.jpg');
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.minFilter = THREE.LinearMipmapLinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    } catch {
      this.texture = new THREE.DataTexture(new Uint8Array([18, 28, 21, 255]), 1, 1);
      this.texture.needsUpdate = true;
    }
    this.uniforms.uAtlas.value = this.texture;
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    for (let index = 0; index < 62; index += 1) this.addCell(index);
  }

  enter(look: string): void {
    this.look = look === 'spectral' || look === 'mono' ? look : 'forest';
    this.uniforms.uLook.value = this.look === 'forest' ? 0 : this.look === 'spectral' ? 1 : 2;
  }

  frame(frame: SceneFrame): void {
    if (this.suspended || this.disposed) return;
    const { params, audio } = frame;
    if (audio.sequence !== this.lastAudioSequence) {
      this.lastAudioSequence = audio.sequence;
      for (const note of audio.notes) {
        if (note.midi >= 65) this.noteDelta += 1;
        else this.noteDelta -= 1;
        this.noteDelta = Math.max(-48, Math.min(48, this.noteDelta));
        const index = Math.abs(note.midi * 17 + audio.sequence * 7) % Math.max(1, this.cells.length);
        const cell = this.cells[index];
        if (cell) {
          const angle = note.midi * 0.71;
          cell.vx += Math.cos(angle) * note.strength * .12;
          cell.vy += Math.sin(angle) * note.strength * .12;
          this.lights[index] = Math.max(this.lights[index], .72 + note.strength * .28);
          this.chase = index;
        }
      }
    }
    const desired = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.round(params.cells + this.noteDelta)));
    while (this.cells.length < desired) this.addCell(this.cells.length + audio.sequence);
    while (this.cells.length > desired) {
      this.cells.pop();
      this.lights[this.cells.length] = 0;
    }

    const speed = params.speed;
    const turbulence = params.turbulence;
    const tension = params.tension;
    this.cells.forEach((cell, index) => {
      const wobble = .003 + turbulence * .009;
      const targetX = cell.baseX + Math.sin(frame.now * (.11 + speed * .16) + cell.phase) * wobble;
      const targetY = cell.baseY + Math.cos(frame.now * (.09 + speed * .13) + cell.phase * 1.3) * wobble;
      cell.vx += (targetX - cell.x) * (2.5 + tension * 3.2) * frame.dt;
      cell.vy += (targetY - cell.y) * (2.5 + tension * 3.2) * frame.dt;
      const drag = Math.exp(-(2.2 + tension * 1.6) * frame.dt);
      cell.vx *= drag; cell.vy *= drag;
      cell.x = Math.max(.012, Math.min(.988, cell.x + cell.vx * frame.dt));
      cell.y = Math.max(.012, Math.min(.988, cell.y + cell.vy * frame.dt));
      this.lights[index] *= Math.exp(-frame.dt * (1.05 + index * .002));
      this.cellUniforms[index].set(cell.x, cell.y, this.lights[index]);
    });
    if (this.cells.length) {
      const chaseSpeed = Math.max(1, Math.round(1 + speed * 3));
      this.chase = (this.chase + (frame.now * chaseSpeed % 1 < frame.dt * chaseSpeed ? 1 : 0)) % this.cells.length;
      this.lights[this.chase] = Math.max(this.lights[this.chase], .55 + audio.harmonic * .4);
      this.cellUniforms[this.chase].z = this.lights[this.chase];
    }
    this.uniforms.uCount.value = this.cells.length;
    this.uniforms.uTime.value = frame.now;
    this.uniforms.uMotion.value = .002 + turbulence * .011;
    this.uniforms.uBrightness.value = params.brightness;
    this.uniforms.uContrast.value = params.contrast;
    this.uniforms.uPulse.value = Math.min(1, audio.onset + params.pulse * audio.onset);
    this.uniforms.uDensity.value = Math.max(0, Math.min(2, params.density));
    this.renderer.toneMappingExposure = .82 + params.brightness * .25;
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number, dpr: number): void {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const nextDpr = Math.max(0.5, Math.min(3, dpr || 1));
    if (nextWidth === this.width && nextHeight === this.height && nextDpr === this.dpr && this.renderer.domElement.width > 1) return;
    this.width = nextWidth; this.height = nextHeight; this.dpr = nextDpr;
    this.renderer.setPixelRatio(nextDpr);
    this.renderer.setSize(nextWidth, nextHeight, false);
    this.uniforms.uAspect.value = nextWidth / nextHeight;
    this.uniforms.uPixels.value.set(nextWidth * nextDpr, nextHeight * nextDpr);
  }

  suspend(suspended: boolean): void { this.suspended = suspended; }

  snapshot(): string | null {
    try { return this.renderer.domElement.toDataURL('image/png'); } catch { return null; }
  }

  telemetry(): SceneRuntimeTelemetry {
    return { renderer: 'Three.js · analytic Voronoi', drawCalls: this.renderer.info.render.calls, particles: this.cells.length };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.texture?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.domElement.remove();
  }

  private addCell(seed: number): void {
    if (this.cells.length >= MAX_CELLS) return;
    let bestX = .5;
    let bestY = .5;
    let bestDistance = -1;
    for (let candidate = 0; candidate < 22; candidate += 1) {
      const x = .025 + hash(seed * 31.3 + candidate * 17.1) * .95;
      const y = .025 + hash(seed * 19.7 + candidate * 29.9 + 5.2) * .95;
      let nearest = 10;
      for (const cell of this.cells) {
        const dx = (x - cell.baseX) * (this.width / Math.max(1, this.height));
        const dy = y - cell.baseY;
        nearest = Math.min(nearest, dx * dx + dy * dy);
      }
      if (nearest > bestDistance) { bestDistance = nearest; bestX = x; bestY = y; }
    }
    const phase = hash(seed * 7.11) * Math.PI * 2;
    this.cells.push({ baseX: bestX, baseY: bestY, x: bestX, y: bestY, vx: 0, vy: 0, phase });
  }
}

export const createVoronoiScene = async (host: HTMLElement, quality: QualityLevel): Promise<VisualScene> => {
  const scene = new VoronoiScene();
  try {
    await scene.init(host, quality);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
};
