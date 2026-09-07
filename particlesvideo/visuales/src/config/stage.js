export const STAGE = {
  width: 2688, height: 1008,
  physical: { widthM: 8.0, heightM: 3.0, bottomM: 0.0, pitchMm: 2.976 },
  blocks: 5,
  blockBounds: [0, 538, 1075, 1613, 2150, 2688],
  camera: { eyeX: 0, eyeY: 1.0, eyeZ: 4.0, near: 0.05, far: 60 },
  // El techo del dominio (y = 7 m) queda MUY por encima de la pantalla (3 m) a propósito:
  // el flujo vertical de la escena 12 tiene que poder salirse del cuadro y recién ahí reciclarse.
  // Con el techo en 3.5 m las partículas chocaban contra la pared del dominio dentro del encuadre.
  // El dominio es MÁS ANCHO que la pantalla (11 m contra 8) para que las cajas de las escenas
  // con la caja al costado (17 y 18) puedan irse bien a los costados sin pelearse con la pared
  // del escenario. Con los
  // ±4.5 de antes, la caja a la izquierda no podía pasar de x = −2.46: girada 45° mide 1.84 m
  // de medio ancho y más allá de eso el clamp del dominio y el de la caja se peleaban en el
  // borde. Ensanchar cuesta 20 celdas más en x (+22% de grilla) sobre un simulador que corre
  // en 0.2 ms, o sea nada.
  sim: { min: [-5.5, -0.5, -5.5], max: [5.5, 7.0, 0.5], cellSize: 0.1, maxParticles: 8192 * 64 },
  // Presets de ±2.1 → ±3.0: la caja se corre casi hasta el borde y se sale un poco de cuadro,
  // que es lo que Manuel pidió ("mucho más a la izquierda o derecha").
  box: { width: 2.6, height: 3.0, depth: 2.6, yawDeg: 45, y: 1.5, z: -1.84, presets: { left: -3.0, center: 0, right: 3.0 } },
};
