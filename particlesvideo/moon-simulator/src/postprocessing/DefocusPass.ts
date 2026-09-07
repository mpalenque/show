/**
 * Lens defocus: samples a uniform disc (circle of confusion) rather than a
 * Gaussian, so a bright edge softens into the flat-topped blur a real
 * out-of-focus lens produces instead of looking like a glow.
 *
 * Sits before bloom in the chain, matching the optical order: the sensor sees an
 * already-defocused image, so the bleed comes from the blurred highlights.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const TAP_COUNT = 48;

const DefocusShader = {
  name: 'DefocusShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Blur radius as a fraction of frame height. 0 disables the pass. */
    uAmount: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uAspect;

    const int TAPS = ${TAP_COUNT};
    const float GOLDEN_ANGLE = 2.39996323;

    void main() {
      if (uAmount <= 0.0) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Per-pixel rotation so the sampling spiral does not print its own pattern.
      float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;

      vec4 sum = vec4(0.0);
      for (int i = 0; i < TAPS; i++) {
        float t = (float(i) + 0.5) / float(TAPS);
        // sqrt keeps the taps uniform per unit area, i.e. a flat disc.
        float radius = sqrt(t) * uAmount;
        float angle = float(i) * GOLDEN_ANGLE + jitter;
        vec2 offset = vec2(cos(angle) / uAspect, sin(angle)) * radius;
        sum += texture2D(tDiffuse, vUv + offset);
      }

      gl_FragColor = sum / float(TAPS);
    }
  `,
};

export interface DefocusPass {
  pass: ShaderPass;
  /** Radius as a fraction of frame height; 0 turns the pass off entirely. */
  setAmount: (amount: number) => void;
  setSize: (width: number, height: number) => void;
}

export function createDefocusPass(amount = 0, width = 1, height = 1): DefocusPass {
  const pass = new ShaderPass(DefocusShader);
  // ShaderPass clones the uniform block, so work through its own copy.
  const uniforms = pass.uniforms as typeof DefocusShader.uniforms;
  uniforms.uAmount.value = amount;
  uniforms.uAspect.value = width / Math.max(height, 1);
  pass.enabled = amount > 0;

  return {
    pass,
    setAmount: (next: number) => {
      uniforms.uAmount.value = next;
      pass.enabled = next > 0;
    },
    setSize: (nextWidth: number, nextHeight: number) => {
      uniforms.uAspect.value = nextWidth / Math.max(nextHeight, 1);
    },
  };
}
