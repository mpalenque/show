/**
 * Photographic halo around the Moon.
 *
 * Different tool than bloom: bloom is a screen-space bright-pass blur that only
 * touches pixels above a threshold, while this is a geometric halo that hugs the
 * silhouette — the atmospheric scatter you get photographing a bright moon.
 * Having both means you can dial "glare around the disc" and "bleed from the
 * bright limb" independently.
 *
 * A camera-facing quad sits just behind the Moon, so the sphere itself occludes
 * the halo's core through the depth test and only the outside rim shows.
 */
import * as THREE from 'three';

export interface MoonGlowOptions {
  moonRadius?: number;
  /** Quad half-size as a multiple of the lunar radius. */
  extent?: number;
  strength?: number;
  color?: THREE.ColorRepresentation;
  /** Tight lobe decay, in lunar radii from the lit limb. */
  coreFalloff?: number;
  /** Wide lobe decay, in lunar radii from the lit limb. */
  haloFalloff?: number;
  /** How tightly the halo hugs the sunlit arc. Higher = narrower. */
  focus?: number;
}

export interface MoonGlow {
  mesh: THREE.Mesh;
  /** litFraction 0-1 keeps the halo tied to how much sunlit Moon there is. */
  update: (
    moonWorldPos: THREE.Vector3,
    sunWorldPos: THREE.Vector3,
    camera: THREE.Camera,
    litFraction: number,
  ) => void;
  setStrength: (value: number) => void;
  setVisible: (visible: boolean) => void;
}

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uStrength;
uniform float uDiscEdge;
uniform float uCoreFalloff;
uniform float uHaloFalloff;
uniform vec2 uSunDir;
uniform float uSunAniso;
uniform float uFocus;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = length(p);
  if (d > 1.0 || uStrength <= 0.0) discard;

  // Glare is measured from the bright limb, not from the disc centre: measuring
  // radially is what turns the halo into an offset blob instead of a rim that
  // follows the lit arc.
  float ringDist = abs(d - uDiscEdge);
  // Past the cusps - the ends of the lit arc, 90 degrees off the Sun direction -
  // the nearest lit point is the cusp itself. That is what shapes the crescent.
  vec2 perp = vec2(-uSunDir.y, uSunDir.x);
  vec2 cusp = perp * (dot(p, perp) >= 0.0 ? uDiscEdge : -uDiscEdge);
  float arcDist = dot(p, uSunDir) >= 0.0 ? ringDist : length(p - cusp);
  // At full moon the Sun lies along the view axis and the whole limb is lit, so
  // the arc opens back up into a full ring.
  float dist = mix(ringDist, arcDist, uSunAniso) / uDiscEdge;

  float core = exp(-dist * uCoreFalloff);
  float halo = exp(-dist * uHaloFalloff);
  // Slight taper toward the cusps, where the lit limb is foreshortened.
  float facing = clamp(dot(normalize(p + 1e-6), uSunDir), 0.0, 1.0);
  float along = mix(1.0, 0.18 + 0.82 * pow(facing, uFocus), uSunAniso);
  // Fade before the quad border so the square never shows.
  float edge = 1.0 - smoothstep(0.8, 1.0, d);

  float glow = (core * 0.72 + halo * 0.28) * along * edge * uStrength;
  // Hash dither: additive exponentials this faint band visibly in 8-bit output.
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  glow = max(0.0, glow + noise * 0.003 * step(0.0004, glow));

  gl_FragColor = vec4(uColor * glow, glow);
}
`;

export function createMoonGlow(scene: THREE.Scene, options: MoonGlowOptions = {}): MoonGlow {
  const moonRadius = options.moonRadius ?? 0.55;
  const extent = options.extent ?? 3;

  const uniforms = {
    uColor: { value: new THREE.Color(options.color ?? 0xdfe8ff) },
    uStrength: { value: options.strength ?? 0.35 },
    // Where the lunar limb falls in quad coordinates, trimmed slightly so the
    // halo starts just inside the silhouette instead of leaving a dark seam.
    uDiscEdge: { value: (1 / extent) * 0.96 },
    uCoreFalloff: { value: options.coreFalloff ?? 9 },
    uHaloFalloff: { value: options.haloFalloff ?? 2.6 },
    uSunDir: { value: new THREE.Vector2(1, 0) },
    uSunAniso: { value: 1 },
    uFocus: { value: options.focus ?? 2.2 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const size = moonRadius * extent * 2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.renderOrder = 1;
  scene.add(mesh);

  const toCamera = new THREE.Vector3();
  const toSun = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const sunOnScreen = new THREE.Vector2();
  let baseStrength = options.strength ?? 0.35;

  const update = (
    moonWorldPos: THREE.Vector3,
    sunWorldPos: THREE.Vector3,
    camera: THREE.Camera,
    litFraction: number,
  ): void => {
    camera.updateMatrixWorld();

    // Sit a hair behind the Moon's centre so the sphere masks the halo's core.
    toCamera.copy(camera.position).sub(moonWorldPos).normalize();
    mesh.position.copy(moonWorldPos).addScaledVector(toCamera, -moonRadius * 0.25);
    mesh.quaternion.copy(camera.quaternion);

    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
    // Screen-space projection of the Sun direction. Its length is how far the
    // Sun lies off the view axis, which is exactly how directional the halo
    // should be; its direction is where the bright limb sits.
    toSun.copy(sunWorldPos).sub(moonWorldPos).normalize();
    sunOnScreen.set(toSun.dot(cameraRight), toSun.dot(cameraUp));
    uniforms.uSunAniso.value = THREE.MathUtils.clamp(sunOnScreen.length(), 0, 1);
    if (sunOnScreen.lengthSq() < 1e-8) {
      sunOnScreen.set(1, 0);
    }
    uniforms.uSunDir.value.copy(sunOnScreen).normalize();

    // No sunlit Moon, no halo. Slightly compressed so crescents still register.
    uniforms.uStrength.value = baseStrength * Math.pow(THREE.MathUtils.clamp(litFraction, 0, 1), 0.7);
  };

  const setStrength = (value: number): void => {
    baseStrength = value;
  };

  const setVisible = (visible: boolean): void => {
    mesh.visible = visible;
  };

  return { mesh, update, setStrength, setVisible };
}
