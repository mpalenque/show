export const MAX_FLUID_PARTICLES = 40_000;

export const DEFAULT_MATERIALS = Object.freeze([
  Object.freeze({ name: 'Ruby', color: '#ff1744', mass: 1.0 }),
  Object.freeze({ name: 'Amber', color: '#ff7a00', mass: 0.6 }),
  Object.freeze({ name: 'Tangerine', color: '#ffb000', mass: 0.36 }),
  Object.freeze({ name: 'Azure', color: '#1265ff', mass: 0.216 }),
]);

export const DEFAULT_PARAMETERS = Object.freeze({
  sameRestDensity: 6.5,
  differentRestDensity: 6.1,
  stiffness: 0.2,
  nearStiffness: 0.05,
  gravity: 0,
  drag: 0,
  // Cuánta velocidad pierde el fluido por subpaso. Ver el worker: es el
  // freno de verdad, el que el solver sí aplica.
  brake: 0,
  pointerForce: 0.5,
});
