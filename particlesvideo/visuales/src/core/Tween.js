export function smoothstep(u) {
  const t = Math.min(Math.max(u, 0), 1);
  return t * t * (3 - 2 * t);
}

export function linear(u) {
  return Math.min(Math.max(u, 0), 1);
}

// Arranca rápido y frena al llegar. Para un corrimiento disparado a mano lee mejor que
// `smooth`, que es simétrica y por eso empieza despacio (se siente como retardo).
export function easeOut(u) {
  const t = Math.min(Math.max(u, 0), 1);
  return 1 - (1 - t) ** 3;
}

export const EASINGS = { smooth: smoothstep, linear, out: easeOut };

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// Suavizado exponencial independiente del framerate.
export function damp(current, target, smoothSeconds, dt) {
  if (smoothSeconds <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / smoothSeconds));
}
