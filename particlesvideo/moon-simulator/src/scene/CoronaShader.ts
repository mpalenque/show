import * as THREE from 'three';

const CORONA_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CORONA_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uAlignment;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 center = (vUv - 0.5) * 2.0;
    float dist = length(center);
    float angle = atan(center.y, center.x);

    float innerEdge = 0.33;
    float outerEdge = 1.0;
    float radialFalloff = 1.0 - smoothstep(innerEdge, outerEdge, dist);

    float streamerAngle = angle + uTime * 0.02;
    float streamer = fbm(vec2(streamerAngle * 2.5, dist * 5.0 + uTime * 0.05));

    float rays = 0.5 + 0.5 * sin(angle * 6.0 + fbm(vec2(angle * 3.0, uTime * 0.08)) * 2.0);

    float corona = radialFalloff * (0.35 + 0.4 * streamer + 0.25 * rays);

    float innerGlow = smoothstep(innerEdge + 0.12, innerEdge, dist) * 0.9;
    corona += innerGlow;

    vec3 innerColor = vec3(1.0, 0.97, 0.92);
    vec3 midColor = vec3(1.0, 0.78, 0.38);
    vec3 outerColor = vec3(0.85, 0.35, 0.12);

    float colorT = smoothstep(innerEdge, outerEdge, dist);
    vec3 color = mix(innerColor, mix(midColor, outerColor, colorT), colorT);

    float visibility = smoothstep(0.75, 0.95, uAlignment);

    float discMask = smoothstep(outerEdge + 0.02, outerEdge, dist);
    corona *= discMask;

    gl_FragColor = vec4(color, corona * visibility);
  }
`;

export interface CoronaMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uTime: { value: number };
    uAlignment: { value: number };
  };
}

export function createCoronaMaterial(): CoronaMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uAlignment: { value: 0.0 },
    },
    vertexShader: CORONA_VERTEX_SHADER,
    fragmentShader: CORONA_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }) as CoronaMaterial;
}
