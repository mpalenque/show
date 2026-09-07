import { STAGE } from '../config/stage.js';

// Ids = ORDEN DEL SHOW, corridos y sin huecos, del 1 al 29. Hasta la vuelta 12 el id era el
// número de imagen del storyboard, y eso dejó un agujero cuando se sacó la 16 (era la 18 sin
// rayos): en el editor la lista aparecía salteada y mapear desde Ableton se volvía un lío.
//
// Equivalencia con el storyboard: de la 1 a la 15 coinciden; de la 16 a la 19 es id + 1 (la 16
// de acá es `17.png`). De la 20 en adelante ya no hay correspondencia, porque la 20 es una
// escena nueva que el storyboard no tiene — es la 19 con el atractor encima — y todo lo que
// venía después se corrió un lugar más (la 21 de acá es `21.png`, la 23 es `23.png`).
//
// 1b/2b/6b/6c no son escenas: son acciones dentro de su escena (warning.bgOff, line.flip,
// sweep.white, sweep.solid).
// `mainAction` es lo que dispara la barra espaciadora.
// Celdas cuadradas (Manuel las pidió cuadradas; el storyboard las tenía rectangulares).
const GRID_FINE = { 'grid.cellW': 84, 'grid.cellH': 84 };
// La nota cambia la visibilidad y el dibujo fino en el primer frame. Los corrimientos
// de offsets conservan su animación independiente; no son un fade de aparición.
const GRID_CUT = { 'grid.opacity': 0, 'grid.brightness': 0,
  'grid.cellW': 0, 'grid.cellH': 0, 'grid.lineWidth': 0 };

// Config de los cinco bloques de grilla: [encendido, sentido, ×velocidad, offset Y en px].
//
// Los cuatro valores se escriben SIEMPRE, también en los bloques que arrancan apagados.
// `grid.toggleAll` y `grid.bN.toggle` prenden bloques EN VIVO (toggleAll es el mainAction de
// las escenas 3 a 9): si el desfasaje viviera solo en los que arrancan encendidos, los que
// entran después caerían todos en sentido 1 y velocidad ×1, y las cinco columnas volverían a
// moverse como una sola cortina — que es justo lo que hay que evitar para que la pantalla se
// lea como cinco pantallas y no como una.
function gridBlocks(spec) {
  const out = {};
  spec.forEach(([enabled, dir, speedMul, offsetY], i) => {
    const n = i + 1;
    out[`grid.b${n}.enabled`] = enabled;
    out[`grid.b${n}.dir`] = dir;
    out[`grid.b${n}.speedMul`] = speedMul;
    out[`grid.b${n}.offsetY`] = offsetY;
  });
  return out;
}

// La 5 es la negativa de la 4 (Manuel: "sigue la misma dinámica"): lo que cambia es qué
// bloques arrancan prendidos, no el ritmo. Los dos repartos están acá para que se vea que son
// el mismo material visto al revés, y para no repetir cinco líneas en cada escena.
const BLOQUES_IMPARES = [
  [true,   1, 1.00,   0],
  [false, -1, 1.35,  21],
  [true,   1, 0.65,  42],
  [false, -1, 1.10,  63],
  [true,   1, 1.45,  10],
];
const BLOQUES_PARES = [
  [false, -1, 1.20,  63],
  [true,   1, 1.00,   0],
  [false,  1, 0.80,  31],
  [true,  -1, 1.40,  42],
  [false, -1, 0.90,  10],
];

// Los truenos siguen disponibles en la 3, 4, 5, 6 y 9. Con `line.maxLines` en 1 cada nota
// mataba la línea anterior de golpe y la cola no llegaba a verse nunca; con 3 los golpes
// rápidos se superponen y el que sale por el borde se apaga con su propio fade.
const TRUENO = { 'line.opacity': 1, 'line.mode': 'strike', 'line.maxLines': 3, 'line.fadeOut': 0.6 };

// El color de las partículas cambia de golpe, no con el fundido de la escena: pasar de rojo a
// azul en un segundo y medio se ve como un lavado violeta en el medio. Con 0.15 s es un corte
// y el resto de la escena (piso, caja, opacidades) sigue entrando en su tiempo.
const COLOR_RAPIDO = { 'particles.baseColor': 0.15 };

// LA RUEDA AZUL: las escenas 14 y 15, que son la misma cosa espejada (Manuel: *"que la 15 sea
// igual a la 14 pero para el otro lado"*). `sentido` es −1 (empuja a la izquierda, bloque rojo a
// la izquierda) o +1 (todo al revés).
//
// Qué es la escena: una masa azul encerrada en una caja, girando como una RUEDA de frente a la
// cámara —con su ojo en el medio— mientras una corriente lateral la recuesta contra el bloque
// rojo, que tiembla. Las partículas no se sueltan: el bound está activo y se ven las aristas.
//
// El giro se lee porque el torbellino es de EJE HORIZONTAL (`vortex.axis: 'z'`). Los tres
// torbellinos que ya existían (21, 22, 23) son de eje vertical, o sea que giran en planta: desde
// la butaca no se ve el giro, se ve una masa que se junta y se afina. Ver `particles/Forces.js`.
//
// Lo que se probó y NO funciona para esta escena: un caudal horizontal que cruce la caja y se
// recicle contra la pared (que es lo que fue la 14 en su segunda versión). En capturas es un
// ladrillo azul uniforme — con todos los palitos alineados y a la misma velocidad no hay textura,
// no hay borde y no se lee ninguna dirección. Cuatro juegos de valores, la misma niebla plana.
function ruedaAzul(sentido) {
  const izquierda = sentido < 0;
  return {
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60,
      'floor.scrollSpeed': izquierda ? 1.2 : 1.6,
      // La caja SE VE (Manuel: *"que no desaparezca la caja de los límites"*). Con `box.yaw` 0 se
      // lee en perspectiva de un punto, como una habitación, en vez del rombo de 45° del resto
      // del show — y acá ese ángulo no es una decisión estética: la rueda gira en el plano de la
      // pantalla, así que la caja tiene que estar de frente o el giro se ve torcido. Y no gira:
      // el giro continuo va cuando la caja es un objeto, no cuando es la cancha de una dinámica.
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center',
      'box.yaw': 0, 'box.yawSpeed': 0,
      // LA CAJA SE DIMENSIONA COMO LA MASA QUE SE QUIERE VER, no como el espacio por el que uno
      // imagina que la masa se mueve. El fluido no tiene tensión superficial: se reparte por todo
      // el volumen que le den, así que la silueta que se ve en pantalla es la de la caja. Primer
      // intento con 4.6 × 3.2 × 2.0: llenaba el cuadro entero y era una niebla azul sin forma, y
      // la 15 con 3.8 de ancho ya se leía como otra escena en vez de como la 14 al revés.
      // El alto se pasa del cuadro por arriba y por abajo (de −0.1 a 3.1) para que no se vean las
      // tapas, y el fondo va corto para que la rueda se lea plana y no como un embudo.
      'box.width': 2.6, 'box.height': 3.2, 'box.depth': 1.8, 'box.y': 1.5, 'box.z': -1.84,
      // La pared devuelve poco: lo que sale despedido por la centrífuga tiene que quedarse en el
      // borde alimentando el brazo exterior de la rueda, no rebotar contra lo que viene girando.
      'box.wallBounce': 0.25, 'box.wallStiffness': 0.4,

      // El bloque se corre de 3.3 a 3.0 para que su borde interior quede JUSTO donde arranca la
      // caja: los dos se proyectan al mismo lugar de la pantalla (el bloque está a z = −1.0 y la
      // caja a −1.84, así que en perspectiva no basta con mirar los metros). Con el default
      // quedaba una franja negra entre el bloque y la caja.
      //
      // NO SE MUEVE y NO TIRA: TITILA. El bloque queda clavado y lo que late es la intensidad de
      // su rojo (Manuel: *"los cuadrados rojos que atraen no tienen que moverse, sino que tiene
      // que titilar su intensidad de rojo"*). Y no atrae porque tirar de una masa incompresible
      // contra una pared termina siempre en la masa apelmazada contra el borde (medido en la
      // séptima vuelta de NOTAS). Es el muro contra el que la corriente aprieta.
      //
      // 11 Hz es rápido para que se lea como un nervio eléctrico, pero todavía por debajo de
      // donde el ojo lo empieza a promediar y lo ve como un rojo apenas más apagado.
      'redBlock.opacity': 1, 'redBlock.side': izquierda ? 'left' : 'right',
      'redBlock.x': 3.0, 'redBlock.attract': 0, 'redBlock.vibrate': 0,
      'redBlock.flicker': 0.6, 'redBlock.flickerRate': 11,

      'particles.opacity': 1, 'particles.baseColor': '#0000FF',
      'particles.density': 1.4,
      'particles.turbulence': 0.9,
      'particles.emissive': 0.12,

      // LOS CINCO VALORES DE LA RUEDA VAN JUNTOS. Probados de a juegos completos con capturas:
      //  · `pull` NO puede ser 0. Sin atracción la centrífuga manda todo contra las paredes y
      //    queda un marco cuadrado hueco: se ve la caja, no la rueda (probado con swirl 2 / pull 0).
      //  · `swirl` alto con `pull` alto es lo que da el huracán: masa llena con un ojo chico en el
      //    medio. Con swirl 2.5 / pull 0.5 sale una rosca gruesa con un agujero enorme — también
      //    se ve bien, pero se lee más como un anillo que como algo girando.
      //  · el rozamiento le pone TECHO a la velocidad de giro, y ese techo es lo que decide el
      //    color: la velocidad tangencial de régimen es swirl/drag = 13, y el umbral de blanco
      //    efectivo más bajo es 20 − 0.35·20 = 13 (`particles.whiteJitter` corre el umbral de cada
      //    partícula hasta ±35 % del span). O sea que el cuerpo queda azul y solo se encienden las
      //    puntas más rápidas. Si se sube el giro, hay que subir el rozamiento o se lava a blanco.
      //
      // El SIGNO del giro es lo que hace que el espejo cierre: si las dos escenas giraran para el
      // mismo lado, la 15 no sería la 14 dada vuelta, sería la 14 con el bloque mudado.
      'vortex.axis': 'z', 'vortex.swirl': -sentido * 6.5, 'vortex.pull': 3.5, 'vortex.radius': 2.2,
      'vortex.x': 0, 'vortex.y': 1.5,
      'particles.drag': 0.5,
      'particles.whiteSpeedMin': 20, 'particles.whiteSpeedMax': 40,

      // LA CORRIENTE (pedido de Manuel: *"además del torbellino, que haya como una fuerza hacia la
      // izquierda que lo empuje"*). Con el rozamiento en 0.5, la velocidad de régimen del empuje
      // es flujo/rozamiento = 3, contra los 13 del giro: la rueda sigue girando pero apoyada
      // contra la pared del bloque, y el brazo de ese lado se aplasta y se deshilacha. Con el
      // flujo al máximo (3) la rueda se pierde: la masa se va entera al borde y vuelve a ser el
      // ladrillo plano de la versión anterior.
      'particles.flowX': sentido * 1.5,
    },
  };
}

// LA NUBE SUELTA: las escenas 19 y 20, que son la misma masa con y sin atractor. Manuel las
// quiso separadas (*"que haya una escena extra 20 antes de la que ahora es 20; esa tiene que ser
// la escena que tiene el atractor de los palitos cuando están sueltos, antes están sueltos pero
// sin ese atractor"*), y tiene razón de armado: soltar la masa y meterle un atractor en el mismo
// momento es gastar dos ideas juntas. Primero se ve que están libres; recién después aparece algo
// que se las lleva.
//
// Lo que las organiza es el CAMPO, que no tiene centro: cada punto del espacio tiene su propia
// dirección sacada de un ruido 3D, así que la nube se arma en filamentos y remolinos que nacen y
// mueren solos sin converger a ningún lado. Acá NO va torbellino: el primer intento fue uno muy
// ancho y flojo para que la nube no se quedara quieta, y Manuel lo cazó al toque ("no están tan
// libres, ya están armando el torbellino"). Un torbellino tiene centro, y con centro deja de ser
// libre.
function nubeSuelta(conOrbe) {
  const base = {
    'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 2.0,
    'box.visible': 0, 'box.enabled': false,
    'rays.enabled': true, 'rays.opacity': 1, 'debris.opacity': 1,
    'particles.opacity': 1, 'particles.baseColor': '#FF0000',
    'particles.turbulence': 0.5, 'particles.drag': 0.02,
    // El umbral de blanco sube del default (2 / 7) a 8 / 24, y es lo que le devuelve el ROJO a la
    // escena. Con el de fábrica cualquier partícula de esta nube lo supera y el cuadro entero
    // queda blanco lavado — y encima el orbe, que acelera lo que toca, blanqueaba justo lo que
    // tiene que apagar. Con 8 la nube se mantiene roja y el blanco vuelve a ser el pico, no el
    // estado.
    'particles.whiteSpeedMin': 8, 'particles.whiteSpeedMax': 24,
    // 5 sectores (uno por bloque de la LED): cada franja de pantalla hace algo distinto y a otra
    // velocidad. `align` alto con `amount` bajo es lo que da la lectura de bandada — los palitos
    // se peinan entre ellos en vez de acelerar todos juntos.
    'field.amount': 0.5, 'field.align': 2.6, 'field.scale': 0.011, 'field.speed': 0.3,
    'field.sectors': 5, 'field.variation': 0.85, 'field.speedSpread': 0.6,
  };
  if (!conOrbe) return base;
  return {
    ...base,
    // EL ORBE, y esta es la única escena del show que lo usa como EVENTO (la 10 lo tiene
    // encendido fijo). Aparece, se lleva un pedazo de la nube detrás, lo apaga a negro y se va.
    //
    // Va acá y no en las de torbellino (21, 22, 23) porque esas ya tienen algo tirando: dos
    // atractores peleando por la misma masa no se lee, se ensucia. Acá el campo no tiene centro,
    // así que el orbe es lo único que junta, y el campo vuelve a repartir lo que soltó.
    //
    // BLANCO y no celeste: la luz también tiñe lo que toca, y en celeste la nube roja se ponía
    // cyan alrededor del orbe. En blanco ilumina sin cambiarle el color a nada.
    'orb.opacity': 1, 'orb.color': '#FFFFFF',
    // La bola NO se dibuja. Se ve lo que HACE: un pedazo de la nube que se apaga y se va detrás
    // de algo. La luz es lo único que delata dónde está.
    'orb.core': 0, 'orb.size': 0.18,
    // Fuerza y radio moderados: con 60 y 4.5 m (probado) arrastraba la nube entera de un lado al
    // otro del escenario. Con 30 y 2.6 se lleva un pedazo y deja el resto donde estaba, que es lo
    // que hace que se lea como algo que PASA por la nube.
    'orb.pull': 30, 'orb.radius': 2.6,
    // La luz va moderada por la misma razón que en la 10: le pega justo a los palitos que el halo
    // está apagando, y muy fuerte el reflejo especular los vuelve a encender. Así ilumina el
    // borde del agujero, que es donde se quiere ver.
    'orb.light': 18, 'orb.lightRange': 4.5,
    // El radio del apagado va MÁS GRANDE que el de la atracción (3.2 contra 2.6) y no al revés:
    // el orbe no solo se lleva lo que tiene encima, acelera todo lo que hay alrededor, y es esa
    // zona entera la que tiene que apagarse.
    'orb.darken': 1.0, 'orb.darkenRadius': 3.2, 'orb.darkenJitter': 0.5,
    // Paseo amplio y lento: cruza el escenario en ~11 s, así cada destello lo agarra en otro
    // lado. Sin paseo el atractor tira siempre del mismo punto y la nube termina en una bola.
    'orb.x': 0, 'orb.y': 1.5, 'orb.z': -1.9,
    'orb.travelX': 3.0, 'orb.travelY': 0.7, 'orb.travelZ': 1.2, 'orb.travelRate': 0.09,
    // Recoge y suelta: a los 2.75 s la fuerza se da vuelta y devuelve al espacio lo que juntó.
    // Sin esto cada destello junta un poco más y a los 40 s la nube es una bola.
    'orb.attack': 0.15, 'orb.decay': 2.6, 'orb.push': 0.5,
    // PROVISORIO: se dispara solo cada ~7 s, para poder verlo antes de que Manuel defina de qué
    // mensaje va a colgar. Cuando lo defina: mapear `orb.flash` a ese mensaje y poner esto en 0.
    'orb.auto': 0.14,
  };
}

export const SCENES = [
  {
    id: '1', name: 'Placa de advertencia', transition: 1.0,
    params: {
      'warning.band': 1, 'warning.bg': 1,
      'warning.scroll': 90,          // el texto ADVERTENCIA corre continuo hacia la izquierda
      'warning.bgPulse': 0.85, 'warning.bgPulseRate': 0.45,
    },
    mainAction: 'warning.pulse',
  },
  {
    id: '2', name: 'Marco + línea móvil', transition: 3.0,
    params: {
      'frame.opacity': 1, 'frame.color': '#7A0000',
      'line.opacity': 1, 'line.mode': 'loop', 'line.speed': 70,
      'line.maxLines': 1, 'line.wrap': true,
      'line.orientation': 'vertical', 'line.width': 3, 'line.direction': 1,
    },
    // Arranca sola, completa y en movimiento aunque no llegue ninguna nota. Sólo el
    // marco conserva el fundido de 3 s; la nota invierte la línea que ya está viajando.
    transitions: { 'line.opacity': 0.12, 'line.direction': 0, 'line.width': 0,
      'line.speed': 0, 'line.maxLines': 0 },
    mainAction: 'line.flip',
  },
  {
    id: '3', name: 'Grilla gruesa por bloque', transition: 1.0,
    params: {
      'frame.opacity': 1, 'frame.color': '#7A0000',
      ...TRUENO, 'line.speed': 30,
      'grid.opacity': 1, 'grid.coarse': true, 'grid.lineWidth': 1, 'grid.brightness': 0.35, 'grid.scrollSpeed': 8,
      // En modo grueso la celda mide lo que el bloque (538 px), así que el offset Y decide a
      // qué altura queda la única línea horizontal de cada columna. Repartirlos es lo que
      // rompe la lectura de "una grilla sola" sin tocar nada más.
      ...gridBlocks([
        [true,  1, 1.00,   0],
        [true, -1, 0.70, 120],
        [true,  1, 1.40, 260],
        [true, -1, 0.90, 380],
        [true,  1, 1.20, 500],
      ]),
    },
    mainAction: 'grid.toggleAll',
  },
  {
    id: '4', name: 'Grillas finas', transition: 1.0,
    params: {
      'frame.opacity': 1, 'frame.color': '#E00000',
      ...TRUENO,
      'grid.opacity': 1, 'grid.coarse': false, ...GRID_FINE, 'grid.brightness': 0.6, 'grid.scrollSpeed': 12,
      ...gridBlocks(BLOQUES_IMPARES),
    },
    transitions: GRID_CUT,
    actions: ['grid.reveal.cancel'],
    mainAction: 'grid.toggleAll',
  },
  {
    id: '5', name: 'Grillas finas (negativa de la 4)', transition: 1.0,
    params: {
      'frame.opacity': 1, 'frame.color': '#E00000',
      ...TRUENO,
      'grid.opacity': 1, 'grid.coarse': false, ...GRID_FINE, 'grid.brightness': 0.6, 'grid.scrollSpeed': 12,
      ...gridBlocks(BLOQUES_PARES),
      'sweep.enabled': true, 'sweep.opacity': 1,
    },
    transitions: GRID_CUT,
    actions: ['grid.reveal.cancel'],
    mainAction: 'grid.toggleAll',
  },
  {
    id: '6', name: 'Grillas + barridos', transition: 1.0,
    params: {
      'frame.opacity': 1, 'frame.color': '#7A0000',
      ...TRUENO,
      'grid.opacity': 1, 'grid.coarse': false, ...GRID_FINE, 'grid.brightness': 0.6, 'grid.scrollSpeed': 12,
      ...gridBlocks(BLOQUES_IMPARES),
      'sweep.enabled': true, 'sweep.opacity': 1,
    },
    // La grilla fina también entra completa en la 6, sin la carga gradual anterior.
    transitions: GRID_CUT,
    actions: ['grid.reveal.cancel'],
    mainAction: ['sweep.blue', 'random'],
  },
  {
    // Las hileras del PISO 3D se reinician en cada entrada. El avance se mide en perspectiva
    // para que los dieciséis segundos se vean en pantalla, sin gastar casi todo el despliegue
    // en los metros lejanos que quedan comprimidos junto al horizonte.
    id: '7', name: 'Piso con fuga (+ grilla)', transition: 2.0,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.scrollSpeed': 0.6,
      'floor.revealDist': 0, 'floor.revealDuration': 16,
      'grid.opacity': 1, 'grid.coarse': false, ...GRID_FINE, 'grid.brightness': 0.26, 'grid.scrollSpeed': 5,
      ...gridBlocks(BLOQUES_IMPARES),
      'sweep.enabled': true, 'sweep.opacity': 1,
    },
    // La acción consulta la duración al entrar, así que este param debe llegar de inmediato y
    // no heredarse/tweenear desde los 4 s de fábrica.
    transitions: { ...GRID_CUT, 'floor.revealDist': 0, 'floor.revealDuration': 0,
      'floor.opacity': 0, 'layer3d.opacity': 0 },
    actions: ['grid.reveal.cancel', ['floor.reveal', 'perspective']],
    onRetrigger: ({ params }) => params.trigger('floor.reveal', 'perspective'),
    mainAction: ['floor.reveal', 'perspective'],
  },
  {
    // 8 y 9 no están en el storyboard. En vez de dejarlas como copias mudas de la 7, cada una
    // empuja el mismo material un paso más: la 8 trae los barridos de la 6 sobre el piso, con
    // el reparto de bloques invertido para que el corte se note...
    id: '8', name: 'Piso + barridos', transition: 2.0,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.scrollSpeed': 1.2, 'floor.revealDist': 60,
      'grid.opacity': 1, 'grid.coarse': false, ...GRID_FINE, 'grid.brightness': 0.26, 'grid.scrollSpeed': 8,
      ...gridBlocks(BLOQUES_PARES),
      'sweep.enabled': true, 'sweep.opacity': 1,
    },
    transitions: GRID_CUT,
    actions: ['grid.reveal.cancel'],
    mainAction: ['sweep.blue', 'random'],
  },
  {
    // ...y la 9 acelera el piso, vuelve a la grilla gruesa y suelta el trueno rápido: es el
    // puente hacia el 3D puro de la 10. Si Manuel define otra cosa para 8/9, se cambian estas
    // dos entradas y listo: son datos, no código.
    id: '9', name: 'Piso rápido + grilla gruesa', transition: 2.0,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.scrollSpeed': 2.4, 'floor.revealDist': 60,
      'grid.opacity': 1, 'grid.coarse': true, 'grid.lineWidth': 1, 'grid.brightness': 0.30, 'grid.scrollSpeed': 14,
      ...gridBlocks([
        [true,  1, 1.00,   0],
        [true, -1, 1.30, 200],
        [true,  1, 0.60, 400],
        [true, -1, 1.50, 100],
        [true,  1, 0.90, 300],
      ]),
      ...TRUENO, 'line.speed': 90, 'line.maxLines': 4, 'line.fadeOut': 0.45,
      'sweep.enabled': true, 'sweep.opacity': 1,
    },
    mainAction: ['line.strike', 'random'],
  },
  {
    id: '10', name: 'Caja + palitos blancos', transition: 1.5,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 0,
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center',
      // Giro lento (una vuelta cada 90 s). La caja quieta a 45° se lee como un dibujo; girando,
      // las aristas cambian de largo y el ojo entiende que hay un volumen. El límite físico gira
      // con ella (se calcula en el espacio local de la caja), así que las partículas siguen
      // contenidas. Regla que se sigue en todo el show: la caja gira despacio SIEMPRE que se le
      // vean las aristas, y se queda quieta cuando es solo un límite invisible (14, 15).
      'box.yawSpeed': 4,
      'particles.opacity': 1, 'particles.baseColor': '#FFFFFF',
      'particles.emissive': 0.14,
      // UN DÉCIMO DE LOS PALITOS. Es la primera vez que aparecen en el show, y con los 131 072
      // completos la caja se ve como una masa maciza donde no se distingue un palito de otro.
      // Con 13 000 se ven SUELTOS: se les lee el largo, la orientación y el hueco entre uno y
      // otro, que es lo que hace entender qué son antes de que la escena 11 los muestre en masa.
      'particles.fraction': 0.1,
      // Y la MITAD de largos. Con la densidad de palitos tan baja, los de largo normal se leen
      // como fideos sueltos; a la mitad quedan como esquirlas y la masa recupera el grano.
      'particles.length': 0.5,
      // LA MASA NACE DE A POCO, de abajo hacia arriba (Manuel: *"cuando cargo la escena 10 las
      // partículas tienen que ir apareciendo de a poco y con un gradiente ir naciendo; ahora
      // aparecen todas de una"*). El momento se merece un nacimiento y no un corte.
      //
      // 3 s para llenar la caja: bastante más que la transición de 1.5 s de la escena, así que
      // el fundido de opacidad termina cuando la mitad de abajo ya está formada y la de arriba
      // todavía se está armando. Ese desfasaje es parte del efecto.
      'particles.birthTime': 3.0, 'particles.birthAxis': 'y', 'particles.birthSpread': 0.4,

      // LA CAJA TAMBIÉN CRECE DE ABAJO HACIA ARRIBA, y mientras crece OCULTA lo que queda por
      // encima (Manuel: *"el bound tiene que ir apareciendo como creciendo desde la base hacia
      // arriba, y actuar como oclusión: afuera no se ven los palitos hasta que termina de
      // crecer"*). Mismos 3 s que `birthTime`: la caja termina de abrirse justo cuando la masa
      // termina de formarse, así los dos efectos se leen como uno solo.
      'box.growDuration': 3.0,

      // DENSIDAD BAJA (0.25 contra 0.4 de fábrica) para que la masa LLENE la caja en vez de
      // juntarse en una bola en el medio. Con la fracción al 10 % y la densidad de fábrica queda
      // una pelota que ocupa media caja, y ahí el agujero del orbe cae entero adentro de la masa
      // — tapado por su propia cáscara, no se ve. Llenando la caja, el agujero llega al frente.
      'particles.density': 0.25,
      'particles.turbulence': 1.2,

      // EL ORBE. Junta los palitos hacia él y APAGA A NEGRO a los que se le acercan, con el
      // borde disuelto para que no se apaguen todos juntos.
      //
      // `core` en 0: la bola no se dibuja. Lo que se ve es el efecto, no la causa.
      'orb.opacity': 1, 'orb.core': 0, 'orb.color': '#FFFFFF',
      'orb.pull': 12, 'orb.radius': 2.2,
      'orb.light': 14, 'orb.lightRange': 3.5,
      // Dispersión ALTA (0.85): cada palito tiene su propio radio de apagado, así que a la misma
      // distancia unos ya están negros y otros todavía blancos. Sin eso el agujero queda con el
      // borde de una pelota de billar; con eso se disuelve palito por palito, que es lo que pidió
      // Manuel (*"que varíe así no se pegan todos"*).
      'orb.darken': 1.0, 'orb.darkenRadius': 1.6, 'orb.darkenJitter': 0.85,
      // PASEA, y no es un adorno: con el orbe clavado en el medio el agujero queda en el centro
      // del volumen y la cara de adelante de la masa lo tapa — probado, no se ve nada. Paseando
      // despacio (un ciclo cada ~16 s) el agujero cruza la masa y llega al frente, y ahí sí se lee
      // que los palitos se apagan al acercarse. La amplitud es chica: no se va de la caja.
      'orb.x': 0, 'orb.y': 1.5, 'orb.z': STAGE.box.z,
      'orb.travelX': 0.7, 'orb.travelY': 0.5, 'orb.travelZ': 0.6, 'orb.travelRate': 0.06,
      // SIEMPRE ENCENDIDO, y esta combinación es la que lo consigue sin parpadeo: `attack` en 0
      // hace que cada disparo ponga la envolvente en 1 de una (con ataque, el redisparo la
      // llevaría a 0 primero y se vería el bache), `decay` al máximo la baja despacio, y el
      // automático a 0.5 Hz la resetea antes de que caiga del 0.92. O sea: prendido y quieto.
      'orb.attack': 0, 'orb.decay': 12, 'orb.push': 0, 'orb.auto': 0.5,
    },
    // `birthTime` y `birthSpread` entran SIN transición, y es obligatorio: `SceneManager.goto`
    // funde los params y dispara las acciones inmediatamente después, así que el `resetInBox` de
    // acá abajo corre en el primer frame del fundido. Con el tween puesto, en ese frame el
    // nacimiento todavía valdría 0 —el valor de la escena anterior— y la masa aparecería entera
    // de golpe, que es justo lo que se está arreglando.
    // `fraction` también entra sin transición: si se fundiera, el simulador vería la cuenta
    // subir y bajar frame a frame y estaría todo el fundido haciendo nacer palitos nuevos.
    // `growDuration` entra sin transición por la misma razón que `birthTime`: la acción
    // `box.grow` de acá abajo corre en el primer frame del fundido, y con el tween puesto todavía
    // valdría 0 —el de la escena anterior— y la caja no cortaría nada.
    transitions: { ...COLOR_RAPIDO, 'particles.birthTime': 0, 'particles.birthSpread': 0, 'particles.fraction': 0, 'box.growDuration': 0 },
    // El orbe se enciende al entrar; sin esto habría que esperar al primer disparo automático.
    // `box.grow` arranca el crecimiento de la caja.
    actions: [['particles.resetInBox'], ['orb.flash'], ['box.grow']],
    mainAction: 'particles.resetInBox',
  },
  {
    // LA MASA SE COMPLETA. Viniendo de la 10, que corre con un décimo de los palitos, acá la
    // fracción vuelve a 1: los otros nueve décimos son palitos NUEVOS, y nacen desde el centro
    // de la caja hacia afuera (Manuel: *"cuando paso a la 11 tienen que ir naciendo desde el
    // centro los palitos nuevos rojos, y los blancos convertirse a rojos"*).
    //
    // De eso se encarga solo el simulador: cuando la cuenta efectiva CRECE, las que entran se
    // reubican en una esfera en el centro de la caja con un retardo por radio (`spawnRange` en
    // `MlsMpmSimulator`). Los que ya estaban se quedan donde están y solo cambian de color.
    id: '11', name: 'Piso + palitos rojos', transition: 1.5,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.scrollSpeed': 0.9,
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center', 'box.yawSpeed': 3,
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.turbulence': 0.8,
      'particles.whiteSpeedMin': 2.5, 'particles.emissive': 0.12,
      'particles.fraction': 1,
      // 2.5 s para que la masa nueva termine de brotar, y bien desordenado para que el frente
      // esférico no se lea como una burbuja creciendo.
      'particles.birthTime': 2.5, 'particles.birthSpread': 0.55,
      // El radio de la esfera donde nacen. Chico contra la caja de 2.6 m: brotan de un punto.
      'particles.emitSpread': 0.5,
    },
    // El color NO corta acá, y es la única escena del show donde eso es a propósito: los palitos
    // que vienen de la 10 son blancos y tienen que VERSE volverse rojos mientras los nuevos
    // brotan del centro. Con el corte de 0.15 s de COLOR_RAPIDO el cambio pasa antes de que el
    // ojo lo registre; con 1.2 s se lee como que la masa se tiñe.
    transitions: { 'particles.baseColor': 1.2, 'particles.fraction': 0, 'particles.birthTime': 0, 'particles.birthSpread': 0, 'particles.emitSpread': 0 },
    actions: [['floor.reveal']],
    mainAction: 'particles.resetInBox',
  },
  {
    // Flujo continuo: SIN límite de caja (`box.enabled: false`). Con el límite puesto las
    // partículas chocaban contra el techo invisible y se apelmazaban en un hongo dentro del
    // cuadro. Ahora suben, se salen de pantalla por arriba y recién ahí vuelven a nacer abajo,
    // así que lo que se ve es un chorro que no termina nunca. La caja (invisible) queda solo
    // como encuadre del emisor: box.width / box.depth son el ancho y el fondo del chorro.
    id: '12', name: 'Flujo azul que sube', transition: 1.5,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 1.0,
      'box.visible': 0, 'box.enabled': false, 'box.preset': 'center',
      'box.width': 2.6, 'box.depth': 2.4,
      // FLUJO RECTO: `fillColumn` ya pone toda la masa con exactamente la velocidad vertical.
      // Sin turbulencia ni giro lateral conserva el mismo grosor físico desde abajo hasta que
      // sale de cuadro, en vez de abrirse arriba como una hélice/torbellino.
      'particles.opacity': 1, 'particles.baseColor': '#0000FF', 'particles.turbulence': 0,
      // Tercera bajada (1.2 → 0.6 → 0.35 → 0.18): Manuel lo seguía viendo apurado. La velocidad
      // de régimen es flujo/rozamiento, así que 0.18/0.22 ≈ 0.8 contra los 5.5 del arranque —
      // una séptima parte. El chorro ahora empuja hacia arriba, no dispara.
      'particles.flowY': 0.18, 'particles.wrapMode': 'vertical',
      // Rozamiento: con flujo constante y sin rozamiento la velocidad crece sin techo y todo
      // termina en blanco. Con rozamiento el chorro llega a una velocidad estable (flujo/roce)
      // y se mantiene azul parejo; el blanco queda reservado para el golpe.
      'particles.drag': 0.22,
      // SIEMPRE AZUL (pedido de Manuel). El umbral se pone MUY por encima de la velocidad que
      // el chorro puede alcanzar, así nunca entra en la mezcla a blanco. Ojo con el margen:
      // `particles.whiteJitter` (0.7 por defecto) corre el umbral de cada partícula hasta
      // ±35% del span, o sea que el umbral efectivo más bajo es 18 − 0.35·18 ≈ 11.7. Contra
      // una velocidad de régimen de 1.6 sobra de lejos, incluso con un `particles.kick`.
      // Esto era el error de la vuelta anterior: bajé los umbrales junto con el flujo (2.5/6.5)
      // y con el jitter el umbral efectivo quedó en 1.1, por debajo del régimen — por eso el
      // chorro se blanqueaba de la mitad para arriba.
      'particles.whiteSpeedMin': 18, 'particles.whiteSpeedMax': 36,
      // Nada de torbellino en esta escena. La lentitud sigue siendo exactamente la misma:
      // `flowY`, `drag` y `particles.speed` no cambian.
      'vortex.swirl': 0, 'vortex.pull': 0,
    },
    // Reparte las partículas por toda la columna al entrar: sin esto se ve el transitorio de
    // la masa de la 11 soltándose de la caja antes de armar el chorro. El problema es que ese
    // reparto es TELEPORT, no animación: `fillColumn` reubica las 131 000 partículas en un solo
    // frame, y como `particles.opacity` en la 11 YA está en 1, un tween "de 1 a 1" no mueve nada
    // — la masa entera aparece de golpe en la columna completa. Eso era el salto (Manuel:
    // *"cuando transiciona de 11 a 12 los palitos... es como que salta y de golpe están, hacelo
    // en fade todo eso"*).
    //
    // El AZUL entra en fundido largo (3.5 s) en vez del corte de COLOR_RAPIDO (Manuel: *"en la
    // escena 12 tiene que entrar más en fade los palitos azules"*). Acá el corte de color no
    // hace falta —la 11 es roja y el rojo→azul pasa por violeta, que en 0.15 s ni se ve pero en
    // 3.5 s es justamente lo que se quiere ver—: el chorro se enfría de rojo a azul mientras
    // aparece.
    transitions: { 'particles.baseColor': 3.5 },
    actions: [['particles.fillColumn']],
    // La opacidad se fuerza a 0 y se tiende de nuevo a 1 ACÁ, en vez de por el mecanismo
    // genérico de arriba: `onEnter` corre después de que el tween automático ya se calculó (de
    // 1 a 1, un no-op), así que pisarlo es la única forma de arrancar realmente desde invisible.
    // Mismo tiempo que el color (3.5 s) para que todo el chorro —color y aparición— se lea como
    // un solo fundido.
    onEnter: (ctx) => {
      ctx.params.set('particles.opacity', 0, { immediate: true });
      ctx.params.tween('particles.opacity', 1, 3.5);
    },
    mainAction: 'particles.kick',
  },
  {
    id: '13', name: 'Caja + rojos (turbulencia)', transition: 1.5,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 1.4,
      // Gira al revés que la 11: el corte entre las dos escenas de caja roja se nota aunque el
      // encuadre sea el mismo.
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center', 'box.yawSpeed': -5,
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.turbulence': 0.95,
      'particles.whiteSpeedMin': 2.5,
      'particles.flicker': 0.18, 'particles.flickerRate': 6,
    },
    transitions: COLOR_RAPIDO,
    mainAction: 'particles.resetInBox',
  },
  {
    ...ruedaAzul(-1),
    id: '14', name: 'Rueda azul (empuja a la izquierda)', transition: 2.0,
    // SIN `resetInBox`, y es un pedido explícito de Manuel: *"de la 13 a la 14 tiene que ser más
    // progresivo el cambio; que cambien de color de una, pero que de la posición que tienen antes
    // pasen a esa dinámica"*. La masa arranca donde la dejó la 13, en el medio, y se la ve
    // empezar a girar mientras la caja se endereza. El color sí corta de una (COLOR_RAPIDO).
    transitions: COLOR_RAPIDO,
    mainAction: 'particles.kick',
  },
  {
    ...ruedaAzul(+1),
    id: '15', name: 'Rueda azul (empuja a la derecha)', transition: 2.0,
    transitions: COLOR_RAPIDO,
    mainAction: 'particles.kick',
  },
  {
    // 16, 17 y 18 son el mismo cuadro con la caja en tres posiciones. Cada una gira en otro
    // sentido y a otra velocidad, y el piso corre distinto, para que la terna no se lea como
    // la misma imagen corrida de lugar.
    id: '16', name: 'Caja + rayos', transition: 1.5,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 1.4,
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center', 'box.yawSpeed': 3,
      'rays.enabled': true, 'rays.opacity': 1, 'debris.opacity': 1,
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.turbulence': 0.8,
      'particles.whiteSpeedMin': 2.5,
    },
    transitions: COLOR_RAPIDO,
    mainAction: ['ray.spawn', 'random'],
  },
  {
    id: '17', name: 'Caja a la izquierda + rayos', transition: 1.5,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 1.8,
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'left', 'box.yawSpeed': -4,
      'rays.enabled': true, 'rays.opacity': 1, 'debris.opacity': 1,
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.turbulence': 0.9,
      'particles.whiteSpeedMin': 2.5,
    },
    transitions: COLOR_RAPIDO,
    mainAction: ['ray.spawn', 'random'],
  },
  {
    id: '18', name: 'Caja a la derecha + rayos', transition: 1.5,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 1.8,
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'right', 'box.yawSpeed': 5,
      'rays.enabled': true, 'rays.opacity': 1, 'debris.opacity': 1,
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.turbulence': 0.9,
      'particles.whiteSpeedMin': 2.5,
    },
    transitions: COLOR_RAPIDO,
    mainAction: ['ray.spawn', 'random'],
  },
  {
    // TODAVÍA CONTENIDAS. La caja anterior se abre a una caja frontal mucho más ancha, fija y
    // sin rotación. El campo puede mover la masa adentro, pero ninguna partícula queda libre
    // hasta entrar a la 20.
    id: '19', name: 'Caja frontal ancha', transition: 2.0,
    params: {
      ...nubeSuelta(false),
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center',
      'box.width': 7.2, 'box.height': 3.2, 'box.depth': 2.2,
      'box.y': 1.5, 'box.z': -1.84, 'box.yaw': 0, 'box.yawSpeed': 0,
      'box.wallStiffness': 0.45,
    },
    transitions: COLOR_RAPIDO,
    mainAction: 'particles.kick',
  },
  {
    // RECIÉN ACÁ se abre la caja y la nube queda libre. El orbe aparece encima, así que el corte
    // entre las dos escenas es la liberación real más algo que se lleva un sector de los palitos.
    id: '20', name: 'Partículas libres + atractor', transition: 2.0,
    params: nubeSuelta(true),
    transitions: COLOR_RAPIDO,
    // La barra espaciadora dispara el orbe a mano, para no esperar al automático.
    mainAction: 'orb.flash',
  },
  {
    id: '21', name: 'Torbellino', transition: 2.0,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 2.0,
      'box.visible': 0, 'box.enabled': false,
      'rays.enabled': true, 'rays.opacity': 1, 'debris.opacity': 1,
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.whiteEnabled': false,
      // La masa recibe sólo la luz puntual de los rayos: sin emisión, luces de estudio ni
      // bloom propio que vuelva a rellenar los huecos oscuros entre palitos.
      'particles.raysOnly': true, 'particles.emissive': 0, 'particles.bloom': 0,
      'particles.turbulence': 0.7, 'particles.drag': 0.08,
      // NO usar `vortex.lift` acá. Se probó (0.15, 0.35, 0.55 y 0.7, con y sin `gravityY` para
      // compensar): el ascenso es una fuerza en un solo sentido y nada la devuelve, así que la
      // masa sube y a los 6-14 s el cuadro queda vacío de la mitad para abajo. Con gravedad
      // negativa para equilibrarla, lo que aparece es una nube caótica que llena la pantalla
      // entera. El hongo de `21.png` (el storyboard de esta escena) es un momento de paso del
      // remolino plano, no un estado.
      // Modifica la velocidad existente en pocos frames. El alcance toma una porción visible
      // de la nube suelta; el kick sigue cambiando el eje Y/X sin esperar una aceleración lenta.
      'vortex.swirl': 18, 'vortex.pull': 6, 'vortex.radius': 1.6, 'vortex.cutoff': 2, 'vortex.axis': 'y',
      'vortex.response': 45,
      'field.amount': 0, 'field.align': 0,
    },
    transitions: { ...COLOR_RAPIDO, 'vortex.swirl': 0, 'vortex.pull': 0, 'vortex.radius': 0,
      'vortex.cutoff': 0, 'vortex.response': 0, 'field.amount': 0, 'field.align': 0,
      'particles.emissive': 0, 'particles.bloom': 0 },
    onExit: ({ params }) => params.set('vortex.response', 0, { immediate: true }),
    mainAction: 'particles.kick',
  },
  {
    id: '22', name: 'Torbellino en la caja', transition: 2.0,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1, 'floor.revealDist': 60, 'floor.scrollSpeed': 2.4,
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center', 'box.yawSpeed': 10,
      'rays.enabled': true, 'rays.opacity': 1, 'debris.opacity': 1,
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.altColor': '#0000FF',
      'particles.blackAllChance': 0.22, 'particles.whiteEnabled': false,
      'particles.turbulence': 0.5, 'particles.drag': 0.02, 'particles.whiteSpeedMin': 1.5,
      'particles.emissive': 0.16,
      // Sin `vortex.lift`, por lo mismo que la 20: acá además hay techo de caja y la masa se
      // apelmazaría contra él en vez de girar.
      'vortex.swirl': 2.2, 'vortex.pull': 1.4, 'vortex.radius': 2.5,
    },
    transitions: COLOR_RAPIDO,
    mainAction: 'particles.kick',
  },
  {
    id: '23', name: 'A punto de explotar', transition: 1.0,
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 0,          // sin piso: acá no van los dashes
      // Sin caja: ni aristas ni límite. Lo que sostiene la forma acá es el torbellino, no una
      // pared. El titileo pasa a estar solo en las partículas (`particles.flicker`).
      'box.visible': 0, 'box.enabled': false, 'box.preset': 'center',
      'rays.enabled': true, 'rays.opacity': 1, 'debris.opacity': 1,
      // TITILA ENTRE ROJO Y AZUL al ritmo del kick (pedido de Manuel: *"esa misma nota tiene que
      // ir switcheando eso"*). El golpe que tira los rayos también intercambia estos dos colores,
      // así que la columna cambia de color en cada golpe. El mapeo está en
      // `mappings.default.json` (`ej18`) y va filtrado a esta escena: la misma nota dispara el
      // rayo en todas, pero el switch de color solo acá.
      'particles.opacity': 1, 'particles.baseColor': '#FF0000', 'particles.altColor': '#0000FF',
      'particles.blackChance': 0, 'particles.blackAllChance': 0.25, 'particles.whiteEnabled': false,
      // QUÉ HACE FINA A LA COLUMNA. Tres cosas, y la más importante NO es el torbellino:
      //
      // 1. `particles.density` 0.4 → 2. La presión del fluido va con la densidad a la QUINTA,
      //    o sea que es prácticamente incompresible: por más que se apriete, la masa ocupa
      //    siempre su volumen en reposo. Subir la densidad de reposo es lo único que hace que
      //    los mismos palitos ocupen ~5 veces menos lugar. Sin esto no hay torbellino que la
      //    afine: probado con swirl y pull al máximo y radio 0.7, la masa no se junta, se
      //    desarma.
      // 2. `pull` muy alto (48) con `swirl` BAJO. Al revés de lo que parece, subir el giro
      //    ensancha: la fuerza centrífuga (v²/r, y v crece como swirl/rozamiento) supera a la
      //    atracción y escupe los palitos para afuera. Probado con swirl 20: quedaba una
      //    nube que ocupaba toda la pantalla.
      // 3. `radius` GRANDE (4.2), no chico. El radio no es el grosor de la columna: es la
      //    distancia a la que la fuerza cae a la mitad, o sea el ALCANCE. Con 0.7 m, a 3 m de
      //    distancia la atracción vale el 5% y los palitos de afuera no vuelven nunca.
      //
      // El rozamiento alto (0.45) es lo que le pone techo a la velocidad de giro, y bajar
      // `particles.speed` de 1.6 a 1.2 es lo que mantiene estable el paso de simulación con
      // fuerzas de este tamaño.
      'particles.density': 2,
      'particles.turbulence': 0.25, 'particles.drag': 0.7,
      'particles.whiteSpeedMin': 8, 'particles.whiteSpeedMax': 24,
      'particles.speed': 1.2,
      'particles.flicker': 0.8, 'particles.flickerRate': 14,
      'particles.emissive': 0.5,
      // Más alcance y atracción que antes. La cohesión radial frena solo lo que intenta salir
      // disparado del eje: deja intactos el giro y el latido, pero evita que el rebote de presión
      // desarme la columna cuando ya no hay caja.
      'vortex.swirl': 4, 'vortex.pull': 48, 'vortex.radius': 4.2, 'vortex.outwardDamping': 0.95,
      // Estrobo: la fuerza del torbellino se corta 11 veces por segundo. No es un parpadeo de
      // brillo, es la fuerza misma: en cada corte la columna se suelta y se abre por inercia,
      // y al volver se cierra de golpe. La masa late.
      'vortex.strobe': 0.85, 'vortex.strobeRate': 11, 'vortex.strobeDuty': 0.45,
    },
    transitions: COLOR_RAPIDO,
    mainAction: 'particles.kick',
  },

  // RadianceController prepara el motor antes de confirmar 24/25. Los presets vacíos apagan
  // las capas de Parte 1; Engine entrega los frames al único runtime Fluid activo.
  // 24 espera con la línea blanca; 25 dispara la secuencia y Ableton reproduce el audio.
  // Las escenas 26–29 siguen libres con su MIDI existente.
  { id: '24', name: 'Fluids · previa', transition: 0, params: {}, mainAction: 'fluids.play' },
  { id: '25', name: 'Fluids · secuencia', transition: 0, params: {}, mainAction: 'fluids.play' },
  {
    // El mismo motor de la 25 pero sin documento: no hay timeline ni audio, sólo
    // el fluido y los diez controles de `fluids.live.*` para tocar por MIDI.
    // Los valores de acá son el punto de partida al entrar; a partir de ahí
    // mandan los CC. La transición es 0 porque el motor arranca de cero y un
    // fundido de la emisión sólo demora la primera masa.
    id: '26', name: 'Fluids · live', transition: 0,
    params: {
      // ESTOS TRES VAN JUNTOS: emisión, gravedad y luz. La luz del motor libre
      // se reparte entre todas las partículas y además sube con la velocidad,
      // así que sólo se ve una población CHICA y en MOVIMIENTO. Probado con
      // ocho juegos de valores: con emisión 0,2-0,35 la pantalla se llena de
      // masa azul apagada; con 0,018 y algo de gravedad quedan gotas luminosas
      // que caen, tiran halo y sombra, y a los 20 s se sigue leyendo igual.
      // Subir la emisión sin bajar la población apaga el cuadro.
      'fluids.live.emission': 0.018, 'fluids.live.gravity': 0.32, 'fluids.live.light': 2.4,
      // El emisor arriba del centro: deja caída suficiente para que se vea la
      // gota viajando antes de llegar al charco.
      'fluids.live.x': 0.5, 'fluids.live.y': 0.32,
      'fluids.live.hue': 0.58,
      // Viscosidad y cohesión van juntas: con esta cohesión la gota se sostiene
      // entera mientras cae en vez de deshacerse en polvo.
      'fluids.live.viscosity': 0.3, 'fluids.live.cohesion': 0.5,
      'fluids.live.forceX': 0, 'fluids.live.forceY': 0,
    },
    mainAction: 'fluids.live.burst',
  },
  ...Array.from({ length: 3 }, (_, i) => ({
    id: String(27 + i), name: `Libre ${i + 4}`, transition: 1.0, params: {},
  })),
];
