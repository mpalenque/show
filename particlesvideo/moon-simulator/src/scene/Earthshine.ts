/**
 * Earthshine ("Da Vinci glow", the old moon in the new moon's arms).
 *
 * Sunlight bounced off Earth onto the Moon's night side. Three things make it
 * read as earthshine rather than as generic fill light:
 *
 *  1. It arrives from Earth's direction, not the Sun's.
 *  2. Its brightness follows Earth's phase as seen from the Moon, which is the
 *     complement of the Moon's phase: full Earth at new moon, new Earth at full
 *     moon. So the ashen disc fades in on the crescents and is gone at full.
 *  3. Lunar regolith backscatters, so the lit disc looks flat instead of like a
 *     shaded sphere. Lommel-Seeliger reproduces that.
 *
 * Implemented by patching MeshStandardMaterial's fragment shader, so the Moon
 * keeps its normal PBR sunlight response and this only adds to it.
 */
import * as THREE from 'three';

export interface EarthshineOptions {
  /** Peak radiance factor at full Earth. */
  intensity?: number;
  /** Earthshine is bluer than sunlight: Earth's albedo is ocean and cloud. */
  color?: THREE.ColorRepresentation;
  /** Earth spans ~2° from the Moon, so its terminator is soft, not a knife edge. */
  wrap?: number;
  /** 0 = Lambert sphere, 1 = full Lommel-Seeliger backscatter. */
  flatness?: number;
}

export interface Earthshine {
  /** Feeds the current geometry in; returns Earth's illuminated fraction (0-1). */
  update: (
    moonWorldPos: THREE.Vector3,
    earthWorldPos: THREE.Vector3,
    sunWorldPos: THREE.Vector3,
    camera: THREE.Camera,
  ) => number;
  setIntensity: (value: number) => void;
}

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 uEarthshineDir;
uniform vec3 uEarthshineColor;
uniform float uEarthshineStrength;
uniform float uEarthshineWrap;
uniform float uEarthshineFlatness;
`;

const FRAGMENT_BODY = /* glsl */ `
#include <aomap_fragment>
{
  vec3 esNormal = normalize(normal);
  vec3 esView = normalize(vViewPosition);
  float mu0 = dot(esNormal, uEarthshineDir);
  float mu = max(dot(esNormal, esView), 0.0);

  // Wrapped diffuse: Earth is an extended source, its terminator on the Moon is soft.
  float soft = clamp((mu0 + uEarthshineWrap) / (1.0 + uEarthshineWrap), 0.0, 1.0);
  // Lommel-Seeliger backscatter: brightness stays flat across the disc.
  float backscatter = soft / max(soft + mu, 1e-4);
  // Keep a hair of falloff at the silhouette so the disc edge is not a hard cut.
  float limb = smoothstep(0.0, 0.08, mu);
  float shape = mix(soft, backscatter, uEarthshineFlatness) * limb;

  reflectedLight.indirectDiffuse += diffuseColor.rgb * uEarthshineColor * (uEarthshineStrength * shape);
}
`;

/** Lambert-sphere phase function: 1 at full, 0 at new. */
const lambertSpherePhase = (phaseAngle: number): number =>
  (Math.sin(phaseAngle) + (Math.PI - phaseAngle) * Math.cos(phaseAngle)) / Math.PI;

export function attachEarthshine(moon: THREE.Mesh, options: EarthshineOptions = {}): Earthshine {
  const material = moon.material;

  if (!(material instanceof THREE.MeshStandardMaterial)) {
    throw new Error('Earthshine expects the Moon to use a MeshStandardMaterial');
  }

  const uniforms = {
    uEarthshineDir: { value: new THREE.Vector3(0, 0, 1) },
    uEarthshineColor: { value: new THREE.Color(options.color ?? 0xaec6e8) },
    uEarthshineStrength: { value: 0 },
    uEarthshineWrap: { value: options.wrap ?? 0.25 },
    uEarthshineFlatness: { value: options.flatness ?? 0.85 },
  };

  let intensity = options.intensity ?? 0.035;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      FRAGMENT_BODY,
    );
  };
  material.needsUpdate = true;

  const toEarth = new THREE.Vector3();
  const toSun = new THREE.Vector3();
  const viewMatrix = new THREE.Matrix4();

  const update = (
    moonWorldPos: THREE.Vector3,
    earthWorldPos: THREE.Vector3,
    sunWorldPos: THREE.Vector3,
    camera: THREE.Camera,
  ): number => {
    toEarth.copy(earthWorldPos).sub(moonWorldPos).normalize();
    toSun.copy(sunWorldPos).sub(moonWorldPos).normalize();

    // Earth's phase angle seen from the Moon is the supplement of the Moon's own.
    const earthPhaseAngle = Math.acos(THREE.MathUtils.clamp(-toEarth.dot(toSun), -1, 1));
    const earthLitFraction = (1 + Math.cos(earthPhaseAngle)) / 2;

    uniforms.uEarthshineStrength.value = intensity * lambertSpherePhase(earthPhaseAngle);

    camera.updateMatrixWorld();
    viewMatrix.copy(camera.matrixWorld).invert();
    uniforms.uEarthshineDir.value.copy(toEarth).transformDirection(viewMatrix);

    return earthLitFraction;
  };

  const setIntensity = (value: number): void => {
    intensity = value;
  };

  return { update, setIntensity };
}
