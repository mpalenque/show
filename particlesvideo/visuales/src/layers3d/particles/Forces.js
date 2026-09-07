import * as THREE from 'three/webgpu';
import { uniform, uniformArray, vec2, vec3, float, Loop, If, uint, max, min, floor, length, clamp, time, dot, abs, select, mix, normalize, cross, exp } from 'three/tsl';
import { triNoise3Dvec } from './noise.js';
import { STAGE } from '../../config/stage.js';

export const MAX_ATTRACTORS = 4;
// Un slot por rayo vivo, desde que empieza a caer hasta que se apaga su onda expansiva
// (~1 s con los valores por defecto). Eran 8, y con eso una batería a 218 BPM en semicorcheas
// (14.5 notas por segundo → ~15 rayos vivos a la vez) perdía el 45% de los disparos EN SILENCIO.
// Subirlo no cuesta nada porque `repulsorCount` ahora es la cantidad REAL de slots ocupados:
// con la escena sin rayos el loop del kernel ni siquiera se ejecuta (antes daba 8 vueltas por
// partícula y por frame aunque no hubiera un solo rayo en pantalla).
export const MAX_REPULSORS = 32;

// Fuerzas que se suman a la velocidad dentro del kernel g2p, en unidades de grilla por paso
// (misma escala que el original: gravedad 0.2, ruido 0.28). Los elementos 3D publican
// atractores y repulsores por su API de CPU; el resto sale de params.
export class Forces {
  static defineParams(params) {
    params.define({ id: 'particles.flowX', type: 'float', min: -3, max: 3, default: 0, label: 'Flujo X', group: 'particles' });
    params.define({ id: 'particles.flowY', type: 'float', min: -3, max: 3, default: 0, label: 'Flujo Y', group: 'particles' });
    params.define({ id: 'particles.flowZ', type: 'float', min: -3, max: 3, default: 0, label: 'Flujo Z', group: 'particles' });
    params.define({ id: 'particles.drag', type: 'float', min: 0, max: 1, default: 0, label: 'Rozamiento', group: 'particles' });
    // 'vertical' = sube y reaparece abajo. Lo usa la escena 12.
    // 'horizontal' = cruza la caja en el sentido de `particles.flowX` y renace en la pared de
    // enfrente al tocar el fondo. Hoy no lo usa nadie: fue la 14 en su segunda versión, y se
    // descartó porque un caudal parejo dentro de una caja se lee como un ladrillo uniforme.
    // 'radial' = FUGA: la partícula se aleja del centro y, al pasar el borde de la huella, renace
    // en el eje. Hoy tampoco lo usa nadie (fue la 15 en su segunda versión), pero es lo que
    // permite que se vayan lejos de verdad: sin reciclado terminan todas apelmazadas contra la
    // pared del escenario.
    params.define({ id: 'particles.wrapMode', type: 'enum', options: ['off', 'vertical', 'horizontal', 'radial'], default: 'off', label: 'Emisión continua', group: 'particles' });
    // Ya no es un techo absoluto: es cuántos metros por ENCIMA del borde superior del encuadre
    // se recicla la partícula. El simulador lo suma a la recta del borde (que sube con la
    // profundidad), así que el chorro siempre se sale de cuadro antes de reaparecer abajo.
    params.define({ id: 'particles.wrapTop', type: 'float', min: 0, max: 4, default: 0.5, label: 'Margen fuera de cuadro (m)', group: 'particles' });
    params.define({ id: 'particles.emitSpread', type: 'float', min: 0, max: 2, default: 0.4, label: 'Alto del emisor (m)', group: 'particles' });
    params.define({ id: 'particles.kickAmount', type: 'float', min: 0, max: 3, default: 1, label: 'Golpe', group: 'particles' });
    params.define({ id: 'particles.kickDecay', type: 'float', min: 0.05, max: 3, default: 0.4, label: 'Caída del golpe (s)', group: 'particles' });
    params.defineAction({ id: 'particles.kick', label: 'Golpe de turbulencia', group: 'particles' });

    // EMPUJE LOCAL: una esfera distinta en cada disparo peina solamente el grupo de palitos
    // que cae adentro. No es turbulencia global: el centro, el radio y la dirección se sortean
    // de nuevo con cada nota, y la fuerza se extingue sola después del golpe.
    params.define({ id: 'particles.localPushAmount', type: 'float', min: 0, max: 120, default: 40, label: 'Empuje local', group: 'particles' });
    params.define({ id: 'particles.localPushRadiusMin', type: 'float', min: 0.2, max: 3, default: 0.65, label: 'Empuje radio mínimo (m)', group: 'particles' });
    params.define({ id: 'particles.localPushRadiusMax', type: 'float', min: 0.2, max: 4, default: 1.5, label: 'Empuje radio máximo (m)', group: 'particles' });
    params.define({ id: 'particles.localPushDecay', type: 'float', min: 0.05, max: 2, default: 0.4, label: 'Empuje caída (s)', group: 'particles' });
    params.defineAction({ id: 'particles.localPush', label: 'Empujar zona al azar', group: 'particles' });

    // Techos subidos de 4 a 30: la escena 22 pide un torbellino mucho más fuerte y, con el
    // radio chico que lo hace fino, 4 no alcanzaba ni para cerrar la columna.
    // NEGATIVO = gira al revés. El mínimo se bajó de 0 a −30 para poder espejar una escena
    // entera: la 15 es la 14 dada vuelta, y para que lo sea de verdad el giro también tiene que
    // invertirse (si no, dos escenas espejadas giran para el mismo lado y el espejo no cierra).
    params.define({ id: 'vortex.swirl', type: 'float', min: -30, max: 30, default: 0, label: 'Torbellino giro (− = al revés)', group: 'vortex' });
    // NEGATIVO = REPULSIÓN: el vórtice deja de chupar y empuja hacia afuera, o sea que la misma
    // fuerza sirve para las dos cosas. Se agregó para la fuga que fue la 15 en su segunda versión
    // (con `swirl` encima salía en espiral en vez de en línea recta). Hoy no lo usa ninguna
    // escena, pero es una fuerza distinta a todo lo que hay y está a un param de distancia.
    params.define({ id: 'vortex.pull', type: 'float', min: -60, max: 60, default: 0, label: 'Torbellino atracción (− = repele)', group: 'vortex' });
    params.define({ id: 'vortex.lift', type: 'float', min: -2, max: 2, default: 0, label: 'Torbellino ascenso', group: 'vortex' });
    params.define({ id: 'vortex.radius', type: 'float', min: 0.2, max: 6, default: 2, label: 'Torbellino radio (m)', group: 'vortex' });
    // Frena solamente la velocidad que escapa del eje; conserva el giro y el movimiento hacia
    // adentro. En la 23 una atracción cada vez mayor por sí sola provoca rebotes de presión y
    // puede terminar expulsando todavía más palitos.
    params.define({ id: 'vortex.outwardDamping', type: 'float', min: 0, max: 1, default: 0, label: 'Cohesión radial', group: 'vortex' });
    params.define({ id: 'vortex.response', type: 'float', min: 0, max: 60, default: 0, label: 'Transformación directa (1/s)', group: 'vortex' });
    // 0 = alcance suave infinito (comportamiento histórico). Un valor positivo corta la fuerza
    // por completo a `radius × cutoff`, para que una escena pueda afectar sólo un sector.
    params.define({ id: 'vortex.cutoff', type: 'float', min: 0, max: 8, default: 0, label: 'Torbellino corte (× radio)', group: 'vortex' });
    params.define({ id: 'vortex.x', type: 'float', min: -4, max: 4, default: 0, label: 'Torbellino X (m)', group: 'vortex' });
    params.define({ id: 'vortex.z', type: 'float', min: -5, max: 0, default: STAGE.box.z, label: 'Torbellino Z (m)', group: 'vortex' });
    // EJE del torbellino, y es un cambio de lectura completo, no un detalle:
    //  · 'y' (el de siempre) gira en el plano XZ, o sea EN PLANTA. Desde la butaca no se ve
    //    girar nada: se ve una masa que se junta y se afina. Es lo que hacen la 20, 21 y 22.
    //  · 'x' gira en el plano YZ: la rueda queda acostada sobre el eje horizontal de la pantalla.
    //  · 'z' gira en el plano XY, de FRENTE a la cámara. Se ve la RUEDA: los palitos se orientan
    //    tangencialmente y dibujan círculos concéntricos que giran. Es la única forma de que un
    //    torbellino se lea como giro en una pantalla que se mira de frente.
    // `vortex.y` es el centro vertical de esa rueda; con el eje 'y' no se usa.
    params.define({ id: 'vortex.axis', type: 'enum', options: ['y', 'x', 'z'], default: 'y', label: 'Eje del torbellino', group: 'vortex' });
    params.defineAction({ id: 'vortex.axisFlipXY', label: 'Alternar eje Y/X', group: 'vortex' });
    params.define({ id: 'vortex.y', type: 'float', min: 0, max: 5, default: 1.5, label: 'Torbellino Y (m)', group: 'vortex' });
    // PASEO del torbellino (hoy sin uso en ninguna escena): el centro no se queda quieto, orbita alrededor de
    // (vortex.x, vortex.z). Las dos frecuencias están en relación 1 : 0.37 — irracional a
    // efectos prácticos — así que la trayectoria es una Lissajous que no se repite a ojo y
    // nunca se lee como un péndulo yendo y viniendo por la misma línea.
    //
    // Lo que esto agrega no es "un torbellino que se mueve": es la ESTELA. Con el centro
    // quieto la masa termina en régimen y ahí se queda; moviéndolo, las partículas lejanas no
    // llegan a seguirlo (su velocidad de arrastre tiene techo por el rozamiento) y quedan
    // atrás desarmándose, mientras las cercanas siguen girando. Con travelX/Z en 0 el centro
    // vuelve a ser fijo, o sea que las escenas de torbellino (20, 21, 22) no cambian en nada.
    params.define({ id: 'vortex.travelX', type: 'float', min: 0, max: 4, default: 0, label: 'Paseo X (m)', group: 'vortex' });
    params.define({ id: 'vortex.travelZ', type: 'float', min: 0, max: 2, default: 0, label: 'Paseo Z (m)', group: 'vortex' });
    params.define({ id: 'vortex.travelRate', type: 'float', min: 0, max: 0.5, default: 0.05, label: 'Paseo (Hz)', group: 'vortex' });
    // Estrobo del torbellino: corta la fuerza a intervalos en vez de bajarle el brillo a nada.
    // El efecto es físico, no visual — la columna se aprieta, se suelta y se vuelve a apretar,
    // así que en cada corte la masa se abre sola por inercia. `amount` 0 = siempre encendido,
    // 1 = corte total; `duty` es qué fracción del ciclo está encendido.
    params.define({ id: 'vortex.strobe', type: 'float', min: 0, max: 1, default: 0, label: 'Estrobo', group: 'vortex' });
    params.define({ id: 'vortex.strobeRate', type: 'float', min: 0.2, max: 40, default: 10, label: 'Estrobo (Hz)', group: 'vortex' });
    params.define({ id: 'vortex.strobeDuty', type: 'float', min: 0.05, max: 0.95, default: 0.4, label: 'Estrobo duty', group: 'vortex' });

    // CAMPO — el modificador para cuando las partículas vuelan libres (escena 19).
    //
    // El problema que resuelve: sin caja y sin fuerzas, la nube liberada se dispersa y en medio
    // minuto queda quieta y pareja; con un torbellino deja de estar libre (Manuel: "ya están
    // armando el torbellino"). El campo es el término medio: un ruido 3D del que se saca una
    // DIRECCIÓN en cada punto del espacio. Como la dirección varía suave con la posición, las
    // partículas vecinas terminan apuntando parecido y se arman filamentos y remolinos que
    // nacen y mueren solos — se lee como bandada, pero no hay vecinos ni O(n²): cada partícula
    // solo lee el campo donde está.
    //
    // `amount` empuja hacia el campo y `align` GIRA la velocidad hacia él sin cambiarle el
    // módulo. Son distintos a propósito: solo con `amount` la nube acelera y se desarma; con
    // `align` los palitos se peinan en la misma dirección conservando lo que traían, que es lo
    // que da la lectura de cardumen.
    //
    // `sectors` parte el escenario en franjas verticales (5 = una por bloque de la LED) y a
    // cada una le da OTRO trozo de ruido y otra velocidad: distintos sectores, distintos
    // comportamientos. Con `variation` y `speedSpread` en 0 el campo vuelve a ser uno solo.
    params.define({ id: 'field.amount', type: 'float', min: 0, max: 6, default: 0, label: 'Campo fuerza', group: 'field' });
    params.define({ id: 'field.align', type: 'float', min: 0, max: 12, default: 0, label: 'Campo alineación (1/s)', group: 'field' });
    params.define({ id: 'field.scale', type: 'float', min: 0.002, max: 0.06, default: 0.012, label: 'Campo escala', group: 'field' });
    params.define({ id: 'field.speed', type: 'float', min: 0, max: 3, default: 0.35, label: 'Campo velocidad', group: 'field' });
    params.define({ id: 'field.sectors', type: 'int', min: 1, max: 5, step: 1, default: 3, label: 'Sectores', group: 'field' });
    params.define({ id: 'field.variation', type: 'float', min: 0, max: 1, default: 0.7, label: 'Variación entre sectores', group: 'field' });
    params.define({ id: 'field.speedSpread', type: 'float', min: 0, max: 1, default: 0.5, label: 'Dif. de velocidad', group: 'field' });
  }

  constructor(params) {
    this.params = params;
    this.params.onAction('vortex.axisFlipXY', () => {
      const next = this.params.get('vortex.axis') === 'y' ? 'x' : 'y';
      this.params.set('vortex.axis', next, { immediate: true });
    });
    this.params.onAction('particles.localPush', () => this.triggerLocalPush());
    this.kick = 0;
    this.localPush = 0;
    this.strobeTime = 0;
    this.travelTime = 0;

    // [x, y, z, fuerza] y [radio, 0, 0, 0] en unidades de grilla.
    this.attractors = Array.from({ length: MAX_ATTRACTORS }, () => new THREE.Vector4());
    this.attractorRadii = Array.from({ length: MAX_ATTRACTORS }, () => new THREE.Vector4(1, 0, 0, 0));
    // [nx, ny, nz, mezcla]: normal del plano del atractor y cuánto pesa el modo plano (0 = punto).
    this.attractorDirs = Array.from({ length: MAX_ATTRACTORS }, () => new THREE.Vector4(0, 0, 1, 0));
    // [x, yBottom, z, yTop] y [fuerza, radio, 0, 0].
    this.repulsors = Array.from({ length: MAX_REPULSORS }, () => new THREE.Vector4());
    this.repulsorParams = Array.from({ length: MAX_REPULSORS }, () => new THREE.Vector4());

    this.u = {
      flow: uniform(new THREE.Vector3()),
      drag: uniform(0),
      kick: uniform(0),
      localPush: uniform(0),
      localPushCenter: uniform(new THREE.Vector3()),
      localPushDirection: uniform(new THREE.Vector3(1, 0, 0)),
      localPushRadius: uniform(1),
      attractorCount: uniform(0, 'uint'),
      attractorPos: uniformArray(this.attractors, 'vec4'),
      attractorRadius: uniformArray(this.attractorRadii, 'vec4'),
      attractorDir: uniformArray(this.attractorDirs, 'vec4'),
      repulsorCount: uniform(0, 'uint'),
      repulsorSeg: uniformArray(this.repulsors, 'vec4'),
      repulsorParams: uniformArray(this.repulsorParams, 'vec4'),
      vortexSwirl: uniform(0), vortexPull: uniform(0), vortexLift: uniform(0), vortexResponse: uniform(0),
      vortexRadius: uniform(1), vortexCutoff: uniform(0), vortexOutwardDamping: uniform(0), vortexCenter: uniform(new THREE.Vector2()),
      vortexCenterY: uniform(0), vortexAxis: uniform(0, 'uint'),
      wrapMode: uniform(0, 'uint'),
      noiseScale: uniform(0.015),
      noiseSpeed: uniform(0.5),
      campoAmount: uniform(0), campoAlign: uniform(0), campoScale: uniform(0.012),
      campoSpeed: uniform(0.35), campoSectors: uniform(1), campoVariation: uniform(0),
      campoSpeedSpread: uniform(0), campoDomainW: uniform(1),
    };
  }

  // Bloque TSL que se inserta en g2p después de la gravedad y la turbulencia.
  apply(vel, pos, dt) {
    const u = this.u;

    vel.addAssign(u.flow.mul(dt));

    // Atractor de PLANO, no de punto. Con la atracción puntual toda la masa convergía a un
    // mismo sitio y se veía como un embudo; lo que se quiere es que empuje en una DIRECCIÓN
    // para que los palitos golpeen la pared del bound a lo ancho. La mezcla (`.w` de
    // attractorDir) va de 0 (punto, como antes) a 1 (plano puro: todos empujados igual,
    // perpendicular al bloque, con la caída dependiendo solo de la distancia al plano).
    Loop({ start: uint(0), end: u.attractorCount, type: 'uint', condition: '<' }, ({ i }) => {
      const a = u.attractorPos.element(i);
      const radius = u.attractorRadius.element(i).x;
      const nd = u.attractorDir.element(i);
      const d = a.xyz.sub(pos);

      // División protegida en vez de normalize(): un slot vacío tiene d = 0 y daría NaN.
      const dist = max(length(d), float(0.001));
      const dirPunto = d.div(dist);

      // Distancia con signo al plano que pasa por el atractor: positiva del lado del que hay
      // que empujar, así el empuje siempre apunta hacia el bloque desde donde esté la partícula.
      const perp = dot(d, nd.xyz);
      const distPlano = max(abs(perp), float(0.001));
      // `sign()` devuelve 0 justo sobre el plano y ahí la dirección se anularía; esto nunca da 0.
      const lado = select(perp.lessThan(0), float(-1), float(1));
      const dirPlano = nd.xyz.mul(lado);

      // La mezcla nunca puede dar el vector nulo: dot(dirPunto, dirPlano) = |perp|/dist ≥ 0,
      // o sea que los dos apuntan al mismo semiespacio y no se cancelan.
      const dir = normalize(mix(dirPunto, dirPlano, nd.w));
      const distUsada = mix(dist, distPlano, nd.w);
      const falloff = float(1).div(float(1).add(distUsada.div(radius).mul(distUsada.div(radius))));
      vel.addAssign(dir.mul(a.w).mul(falloff).mul(dt));
    });

    // `notEqual` y no `greaterThan`: desde que `pull` puede ser negativo (repulsión), un
    // `greaterThan(0)` dejaría la fuga sin ejecutar el bloque entero.
    const hayVortice = u.vortexSwirl.notEqual(0).or(u.vortexPull.notEqual(0)).and(u.vortexResponse.equal(0));
    const vortexFalloff = (dist) => {
      const suave = float(1).div(float(1).add(dist.div(u.vortexRadius).mul(dist.div(u.vortexRadius))));
      const dentro = float(dist.lessThan(u.vortexRadius.mul(u.vortexCutoff)));
      return suave.mul(select(u.vortexCutoff.greaterThan(0), dentro, float(1)));
    };

    // Torbellino de EJE VERTICAL: gira en el plano XZ (en planta). El de siempre — 20, 21, 22.
    If(hayVortice.and(u.vortexAxis.equal(uint(0))), () => {
      const r = vec2(pos.x.sub(u.vortexCenter.x), pos.z.sub(u.vortexCenter.y)).toConst();
      const dist = length(r);
      const falloff = vortexFalloff(dist);
      const safe = max(dist, float(0.01));
      const tangent = vec2(r.y.negate(), r.x).div(safe);
      const push = tangent.mul(u.vortexSwirl).sub(r.div(safe).mul(u.vortexPull)).mul(falloff).mul(dt);
      vel.x.addAssign(push.x);
      vel.z.addAssign(push.y);
      vel.y.addAssign(u.vortexLift.mul(falloff).mul(dt));
      const radial = r.div(safe).toConst();
      const escape = max(dot(vec2(vel.x, vel.z), radial), float(0)).mul(u.vortexOutwardDamping);
      vel.x.subAssign(radial.x.mul(escape));
      vel.z.subAssign(radial.y.mul(escape));
    });

    // Torbellino de EJE HORIZONTAL: mismo cálculo en el plano XY, o sea de frente a la cámara.
    // Acá el giro SE VE, y por eso hay dos cosas que cambian de sentido respecto del de arriba:
    // la profundidad (z) no participa —la rueda es plana, y si además tirara en z se leería como
    // un embudo— y `lift` no se usa, porque el ascenso ya es parte del giro.
    If(hayVortice.and(u.vortexAxis.equal(uint(1))), () => {
      const r = vec2(pos.x.sub(u.vortexCenter.x), pos.y.sub(u.vortexCenterY)).toConst();
      const dist = length(r);
      const falloff = vortexFalloff(dist);
      const safe = max(dist, float(0.01));
      const tangent = vec2(r.y.negate(), r.x).div(safe);
      const push = tangent.mul(u.vortexSwirl).sub(r.div(safe).mul(u.vortexPull)).mul(falloff).mul(dt);
      vel.x.addAssign(push.x);
      vel.y.addAssign(push.y);
      const radial = r.div(safe).toConst();
      const escape = max(dot(vec2(vel.x, vel.y), radial), float(0)).mul(u.vortexOutwardDamping);
      vel.x.subAssign(radial.x.mul(escape));
      vel.y.subAssign(radial.y.mul(escape));
    });

    // Eje X: gira en el plano YZ. Es la segunda posición rítmica de la escena 21; el kick
    // alterna entre este bloque y el de eje Y de arriba.
    If(hayVortice.and(u.vortexAxis.equal(uint(2))), () => {
      const r = vec2(pos.y.sub(u.vortexCenterY), pos.z.sub(u.vortexCenter.y)).toConst();
      const dist = length(r);
      const falloff = vortexFalloff(dist);
      const safe = max(dist, float(0.01));
      const tangent = vec2(r.y.negate(), r.x).div(safe);
      const push = tangent.mul(u.vortexSwirl).sub(r.div(safe).mul(u.vortexPull)).mul(falloff).mul(dt);
      vel.y.addAssign(push.x);
      vel.z.addAssign(push.y);
      const radial = r.div(safe).toConst();
      const escape = max(dot(vec2(vel.y, vel.z), radial), float(0)).mul(u.vortexOutwardDamping);
      vel.y.subAssign(radial.x.mul(escape));
      vel.z.subAssign(radial.y.mul(escape));
    });

    // Campo de direcciones por sector (ver el comentario largo en defineParams).
    If(u.campoAmount.greaterThan(0).or(u.campoAlign.greaterThan(0)), () => {
      // Franja vertical en la que cae la partícula, 0 .. sectores-1.
      const sx = clamp(pos.x.div(u.campoDomainW), 0, 0.9999);
      const sector = min(floor(sx.mul(u.campoSectors)), u.campoSectors.sub(1)).toConst();

      // Cada sector muestrea OTRO trozo del mismo ruido: el 37.13 es un salto grande y no
      // redondo para que las franjas no queden correlacionadas entre sí.
      const off = sector.mul(u.campoVariation).mul(37.13);
      const n = triNoise3Dvec(pos.mul(u.campoScale).add(off), time, u.campoSpeed).sub(0.285).toVar();
      // El ruido puede dar el vector nulo justo en un cero; normalize() ahí daría NaN.
      const dir = n.div(max(length(n), float(0.0001))).toConst();

      // Velocidad propia de cada sector: el primero va más lento y el último más rápido.
      const t = sector.div(max(u.campoSectors.sub(1), float(1)));
      const vmul = float(1).add(t.sub(0.5).mul(u.campoSpeedSpread));

      vel.addAssign(dir.mul(u.campoAmount).mul(vmul).mul(dt));

      // Alineación: gira la velocidad hacia el campo conservando el módulo. El clamp evita
      // que con un frame lento el mix se pase de 1 y la velocidad rebote.
      const k = clamp(u.campoAlign.mul(dt), 0, 1);
      vel.assign(mix(vel, dir.mul(length(vel)), k));
    });

    Loop({ start: uint(0), end: u.repulsorCount, type: 'uint', condition: '<' }, ({ i }) => {
      const seg = u.repulsorSeg.element(i);
      const prm = u.repulsorParams.element(i);
      // Punto más cercano del segmento vertical (x, [yBottom..yTop], z).
      const q = vec3(seg.x, clamp(pos.y, seg.y, seg.w), seg.z);
      const d = pos.sub(q);
      const dist = max(length(d), float(0.001));
      const falloff = clamp(float(1).sub(dist.div(prm.y)), 0, 1);
      vel.addAssign(d.div(dist).mul(prm.x).mul(falloff).mul(dt));
    });

    // La dirección es igual dentro de la zona (no radial), por eso se ve como una porción de
    // la masa que de pronto cambia de rumbo. Fuera de la esfera el clamp deja el peso en cero;
    // adentro la caída cuadrática evita un borde duro en la nube.
    If(u.localPush.greaterThan(0), () => {
      const dist = length(pos.sub(u.localPushCenter));
      const falloff = clamp(float(1).sub(dist.div(u.localPushRadius)), 0, 1);
      vel.addAssign(u.localPushDirection.mul(u.localPush).mul(falloff.mul(falloff)).mul(dt));
    });

    vel.mulAssign(float(1).sub(u.drag.mul(dt)));

    If(u.kick.greaterThan(0), () => {
      const n = triNoise3Dvec(pos.mul(u.noiseScale), time, u.noiseSpeed).sub(0.285).normalize();
      vel.addAssign(n.mul(u.kick).mul(dt));
    });
  }

  // `normal` es la normal del plano del atractor (en el mundo) y `planeBlend` cuánto se usa
  // el modo plano en vez del puntual. Sin normal, se comporta como antes.
  setAttractor(slot, worldPos, strength, radiusM, normal = null, planeBlend = 0) {
    const { min: m, cellSize } = STAGE.sim;
    this.attractors[slot].set((worldPos.x - m[0]) / cellSize, (worldPos.y - m[1]) / cellSize, (worldPos.z - m[2]) / cellSize, strength);
    this.attractorRadii[slot].x = Math.max(radiusM / cellSize, 0.01);
    // La normal es una dirección: no lleva el offset del origen de la grilla, y como la grilla
    // es isotrópica tampoco cambia de escala. Solo hay que normalizarla.
    if (normal) {
      const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
      this.attractorDirs[slot].set(normal.x / len, normal.y / len, normal.z / len, planeBlend);
    } else {
      this.attractorDirs[slot].set(0, 0, 1, 0);
    }
  }

  // Se aplica DESPUÉS de reconstruir la velocidad de la grilla: así el giro modifica
  // el movimiento existente. Con response=0 las otras escenas conservan sus fuerzas.
  transformVelocity(vel, pos, frameDt) {
    const u = this.u;
    const influence = float(0).toVar();
    If(u.vortexResponse.greaterThan(0).and(u.vortexSwirl.notEqual(0).or(u.vortexPull.notEqual(0))), () => {
      // Los signos conservan el sentido de los tres ejes del torbellino original.
      const axis = select(u.vortexAxis.equal(uint(0)), vec3(0, -1, 0),
        select(u.vortexAxis.equal(uint(1)), vec3(0, 0, 1), vec3(1, 0, 0))).toConst();
      const relative = pos.sub(vec3(u.vortexCenter.x, u.vortexCenterY, u.vortexCenter.y));
      const radial = relative.sub(axis.mul(dot(relative, axis))).toConst();
      const dist = max(length(radial), float(0.01));
      const direction = radial.div(dist);
      const tangent = cross(axis, direction);
      const ratio = dist.div(u.vortexRadius);
      const falloff = float(1).div(float(1).add(ratio.mul(ratio)));
      const edge = clamp(u.vortexRadius.mul(u.vortexCutoff).sub(dist).div(u.vortexRadius.mul(0.35)), 0, 1);
      const weight = falloff.mul(select(u.vortexCutoff.greaterThan(0), edge, float(1)));
      influence.assign(float(1).sub(exp(u.vortexResponse.mul(frameDt).mul(weight).negate())));
      const target = tangent.mul(u.vortexSwirl).sub(direction.mul(u.vortexPull))
        .add(axis.mul(dot(vel, axis)));
      vel.assign(mix(vel, target, influence));
    });
    return influence;
  }

  clearAttractor(slot) {
    this.attractors[slot].w = 0;
  }

  setRepulsor(slot, x, yBottom, z, yTop, strength, radiusM) {
    const { min: m, cellSize } = STAGE.sim;
    this.repulsors[slot].set((x - m[0]) / cellSize, (yBottom - m[1]) / cellSize, (z - m[2]) / cellSize, (yTop - m[1]) / cellSize);
    this.repulsorParams[slot].set(strength, Math.max(radiusM / cellSize, 0.01), 0, 0);
  }

  clearRepulsor(slot) {
    this.repulsorParams[slot].x = 0;
  }

  update(dt) {
    const p = this.params;
    const u = this.u;
    const { min: m, cellSize } = STAGE.sim;

    u.flow.value.set(p.get('particles.flowX'), p.get('particles.flowY'), p.get('particles.flowZ'));
    u.drag.value = p.get('particles.drag');
    u.noiseScale.value = p.get('particles.turbulenceScale');
    u.noiseSpeed.value = p.get('particles.turbulenceSpeed');

    // El golpe decae solo; se dispara con la action particles.kick.
    if (this.kick > 0) {
      this.kick *= Math.exp(-dt / Math.max(p.get('particles.kickDecay'), 0.01));
      if (this.kick < 0.001) this.kick = 0;
    }
    u.kick.value = this.kick;

    if (this.localPush > 0) {
      this.localPush *= Math.exp(-dt / Math.max(p.get('particles.localPushDecay'), 0.01));
      if (this.localPush < 0.001) this.localPush = 0;
    }
    u.localPush.value = this.localPush;

    // Puerta del estrobo. El tiempo se lleva acá y no con `performance.now()` para que respete
    // el dt del motor (y con él las pausas y el watchdog): si no, al recuperar el foco la fase
    // pegaría un salto y se vería un parpadeo suelto.
    this.strobeTime += dt;
    const strobe = p.get('vortex.strobe');
    let puerta = 1;
    if (strobe > 0.001) {
      const fase = (this.strobeTime * p.get('vortex.strobeRate')) % 1;
      const encendido = fase < p.get('vortex.strobeDuty') ? 1 : 0;
      puerta = 1 - strobe * (1 - encendido);
    }

    u.vortexSwirl.value = p.get('vortex.swirl') * puerta;
    u.vortexPull.value = p.get('vortex.pull') * puerta;
    u.vortexLift.value = p.get('vortex.lift') * puerta;
    u.vortexResponse.value = p.get('vortex.response');
    u.vortexRadius.value = Math.max(p.get('vortex.radius') / cellSize, 0.01);
    u.vortexCutoff.value = p.get('vortex.cutoff');
    u.vortexOutwardDamping.value = p.get('vortex.outwardDamping');

    // Paseo del centro. El tiempo se acumula con el dt del motor, igual que el del estrobo y
    // por la misma razón: con `performance.now()` una pausa o el watchdog harían saltar el
    // centro de golpe a la otra punta del escenario y la masa saldría disparada detrás.
    this.travelTime += dt;
    const travelX = p.get('vortex.travelX');
    const travelZ = p.get('vortex.travelZ');
    let cx = p.get('vortex.x');
    let cz = p.get('vortex.z');
    if (travelX > 0 || travelZ > 0) {
      const fase = 2 * Math.PI * p.get('vortex.travelRate') * this.travelTime;
      cx += travelX * Math.sin(fase);
      cz += travelZ * Math.sin(fase * 0.37 + 1.3);
      // El centro tiene que quedar DENTRO del escenario: `vortex.x` llega a ±4 y el paseo suma
      // otros ±4, o sea que sin esto se puede ir a 8 m y arrastrar toda la masa contra la pared
      // del dominio, donde se queda apelmazada.
      cx = Math.min(Math.max(cx, STAGE.sim.min[0]), STAGE.sim.max[0]);
      cz = Math.min(Math.max(cz, STAGE.sim.min[2]), STAGE.sim.max[2]);
    }
    u.vortexCenter.value.set((cx - m[0]) / cellSize, (cz - m[2]) / cellSize);
    u.vortexCenterY.value = (p.get('vortex.y') - m[1]) / cellSize;
    const axis = p.get('vortex.axis');
    u.vortexAxis.value = axis === 'z' ? 1 : axis === 'x' ? 2 : 0;

    const modo = p.get('particles.wrapMode');
    u.wrapMode.value = modo === 'vertical' ? 1 : modo === 'horizontal' ? 2 : modo === 'radial' ? 3 : 0;

    u.campoAmount.value = p.get('field.amount');
    u.campoAlign.value = p.get('field.align');
    u.campoScale.value = p.get('field.scale');
    u.campoSpeed.value = p.get('field.speed');
    u.campoSectors.value = p.get('field.sectors');
    u.campoVariation.value = p.get('field.variation');
    u.campoSpeedSpread.value = p.get('field.speedSpread');
    // Ancho del dominio en unidades de grilla: es contra esto que se parte en sectores.
    u.campoDomainW.value = (STAGE.sim.max[0] - STAGE.sim.min[0]) / cellSize;

    // Los atractores son pocos y fijos: se recorren todos, los vacíos tienen fuerza 0.
    u.attractorCount.value = MAX_ATTRACTORS;
    // Los repulsores no: hay 32 slots y casi siempre están casi todos vacíos. El loop llega
    // hasta el último slot OCUPADO (Rays los limpia y los vuelve a poner cada frame, antes de
    // que corra esto), así que sin rayos en pantalla el loop no se ejecuta ni una vez.
    let ultimo = 0;
    for (let i = 0; i < MAX_REPULSORS; i++) if (this.repulsorParams[i].x > 0) ultimo = i + 1;
    u.repulsorCount.value = ultimo;
  }

  triggerKick() {
    this.kick = this.params.get('particles.kickAmount');
  }

  triggerLocalPush() {
    const p = this.params;
    const { min: simMin, cellSize } = STAGE.sim;

    const radiusMin = p.get('particles.localPushRadiusMin');
    const radiusMax = p.get('particles.localPushRadiusMax');
    const lo = Math.min(radiusMin, radiusMax);
    const hi = Math.max(radiusMin, radiusMax);
    const radius = lo + Math.random() * (hi - lo);

    let x;
    let y;
    let z;
    // Dentro de una caja (o del emisor vertical de la 12), el centro se sortea en ese mismo
    // volumen para garantizar que la esfera encuentre palitos. En las escenas libres se usa
    // el volumen visible completo y no todo el dominio, que también se extiende fuera de cuadro.
    const usarCaja = p.get('box.enabled') || p.get('particles.wrapMode') === 'vertical';
    if (usarCaja) {
      const lx = (Math.random() * 2 - 1) * p.get('box.width') * 0.38;
      const ly = (Math.random() * 2 - 1) * p.get('box.height') * 0.38;
      const lz = (Math.random() * 2 - 1) * p.get('box.depth') * 0.38;
      const yaw = THREE.MathUtils.degToRad(p.get('box.yaw'));
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      x = p.get('box.x') + c * lx + s * lz;
      y = p.get('box.y') + ly;
      z = p.get('box.z') - s * lx + c * lz;
    } else if (Math.abs(p.get('vortex.swirl')) > 0.001 || Math.abs(p.get('vortex.pull')) > 0.001) {
      // Si la nube está reunida por un torbellino, sortear sobre toda la pantalla puede caer en
      // un hueco. El centro se mueve dentro del tubo actual; sigue cambiando en cada nota, pero
      // siempre intercepta una porción de la masa. En eje X el tubo corre horizontal, en Y es
      // vertical y en Z apunta hacia la cámara.
      const spread = Math.min(Math.max(p.get('vortex.radius') * 0.45, radius * 0.5), 1.5);
      const axis = p.get('vortex.axis');
      if (axis === 'x') {
        x = (Math.random() * 2 - 1) * STAGE.physical.widthM * 0.42;
        y = p.get('vortex.y') + (Math.random() * 2 - 1) * spread;
        z = p.get('vortex.z') + (Math.random() * 2 - 1) * spread;
      } else {
        x = p.get('vortex.x') + (Math.random() * 2 - 1) * spread;
        y = axis === 'z'
          ? p.get('vortex.y') + (Math.random() * 2 - 1) * spread
          : 0.3 + Math.random() * STAGE.physical.heightM * 0.8;
        z = axis === 'z'
          ? -4.2 + Math.random() * 3.7
          : p.get('vortex.z') + (Math.random() * 2 - 1) * spread;
      }
    } else {
      x = (Math.random() * 2 - 1) * STAGE.physical.widthM * 0.46;
      y = 0.3 + Math.random() * STAGE.physical.heightM * 0.8;
      z = -4.2 + Math.random() * 3.7;
    }

    // Dirección sobre todo en el plano de pantalla para que el cambio se lea desde la butaca,
    // con una componente Z menor que evita que todos los golpes parezcan completamente planos.
    const angle = Math.random() * Math.PI * 2;
    const direction = this.u.localPushDirection.value;
    direction.set(Math.cos(angle), Math.sin(angle) * 0.8, (Math.random() * 2 - 1) * 0.35).normalize();

    this.u.localPushCenter.value.set(
      (x - simMin[0]) / cellSize,
      (y - simMin[1]) / cellSize,
      (z - simMin[2]) / cellSize,
    );
    this.u.localPushRadius.value = Math.max(radius / cellSize, 0.01);
    this.localPush = p.get('particles.localPushAmount');
    this.u.localPush.value = this.localPush;
  }
}
