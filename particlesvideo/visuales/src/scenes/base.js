import { STAGE } from '../config/stage.js';

// BASE = todo apagado. Cualquier param con sceneReset:true que una escena no liste
// vuelve a este valor (o a su default si no está acá).
//
// Estar acá hace DOS cosas, y la segunda es la que se olvida: además de fijar el valor de
// reposo, mete al param en `SceneManager.ownedParams`, o sea en la lista de lo que es ESTADO
// DEL SHOW y por lo tanto Settings no puede guardar como ajuste del usuario. Un param que no
// lista ninguna escena ni el BASE queda huérfano: moverlo desde el editor le pisa el valor de
// fábrica a todas las escenas, para siempre y sobreviviendo a la recarga (es la fuga que
// documenta NOTAS en "La escena manda").
//
// Por eso los bloques de abajo listan cosas con su propio default: no cambian nada de lo que se
// ve — cambian de quién es el param.
export const BASE = {
  'layer3d.opacity': 0,
  'warning.band': 0,
  'warning.bg': 0,
  'warning.scroll': 0,
  'frame.opacity': 0,
  'line.opacity': 0,
  'grid.opacity': 0,
  'sweep.enabled': false,

  // El bloque rojo lo vuelven a encender la 14 y la 15. Sigue listado acá igual: es el valor de
  // reposo con el que arranca cualquier otra escena, y sin él quedaría a merced de la última que
  // lo tocó.
  'redBlock.opacity': 0,
  'redBlock.side': 'left',
  'redBlock.attract': 0,

  // El ORBE lo enciende solo la escena 19. Los tres que importan van acá porque son los que
  // pueden dejar algo prendido al salir: la opacidad (que arrastra la luz, el tinte y la
  // fuerza), el disparo automático y la atracción. Si el orbe se apagara sin apagar `orb.auto`,
  // seguiría disparándose en silencio en todas las escenas siguientes.
  'orb.opacity': 0,
  'orb.auto': 0,
  'orb.pull': 90,
  'orb.push': 0.8,
  'orb.bloom': 1,
  'orb.core': 1,
  'orb.darkenJitter': 0.5,

  // La fracción de palitos vuelve a 1 en cualquier escena que no la liste: si quedara en 0.1
  // (la de la 10) el resto del show correría con un décimo de la masa. Y `particles.length`
  // igual, que la 10 pone a la mitad.
  'particles.fraction': 1,
  'particles.raysOnly': false,
  // El color alterno: lo usa solo la 23 (el titileo rojo/azul del kick), pero va acá para que
  // ninguna escena herede el intercambio que dejó la anterior.
  'particles.altColor': '#0000FF',
  'particles.blackHalf': false,
  'particles.blackAll': false,
  'particles.blackSeed': 0,
  'particles.length': 1.0,

  // Los cinco de acá abajo quedaron sin dueño cuando la 14 y la 15 cambiaron de dinámica en la
  // décima vuelta: los listaban ellas y hoy no los lista nadie. Sin esto, moverlos desde el
  // editor les pisa el valor de fábrica a TODAS las escenas y sobrevive a la recarga (la fuga
  // que documenta NOTAS en «La escena manda»). Y son justo los peligrosos: un flujo lateral o un
  // paseo del torbellino pegados se arrastran por el show entero sin que se entienda de dónde
  // salen.
  'particles.flowX': 0,
  'particles.emitSpread': 0.4,
  'vortex.z': STAGE.box.z,
  'vortex.travelX': 0,
  'vortex.travelZ': 0,

  // El nacimiento progresivo lo usa solo la escena 10. Va acá para que las demás lo devuelvan a
  // 0 al entrar: si quedara pegado, cualquier `resetInBox` posterior (la 11, la 13, la barra
  // espaciadora) haría desaparecer la masa y reaparecerla de a poco sin que nadie lo pidiera.
  'particles.birthTime': 0,
  'particles.birthAxis': 'y',
  'particles.birthSpread': 0.35,

  // Los rayos empiezan en la 16. Antes de esa escena el kick puede llegar igual, pero
  // `Rays.spawn` lo descarta y no crea ni rayo invisible ni fuerza sobre las partículas.
  // Las escenas 16 a 23 los habilitan de forma explícita.
  'rays.enabled': false,
  'rays.opacity': 0,
  'rays.width': 0.042,
  'rays.lightIntensity': 8,
  'rays.lightRange': 2.6,
  'rays.bloom': 1,
  'rays.color': '#FFFFFF',
  'debris.opacity': 0,

  // La duración del impacto del rayo: nueva y sin dueño (ninguna escena la lista, las tres de
  // rayos usan la de fábrica). Va acá para que moverla desde el editor no le pise el valor a
  // todo el show para siempre.
  'rays.impactTime': 0.55,

  // Eje del torbellino: lo cambia solo la 14 (la rueda). Está acá para que quede claro que el
  // resto del show gira en planta, y para que ninguna escena herede el eje horizontal.
  'vortex.axis': 'y',
  'vortex.response': 0,
  'vortex.y': 1.5,

  // Pared de la caja. Ninguna escena los lista hoy, pero son justo los que NOTAS marca como
  // "no pueden quedar pegados de una escena a la siguiente": una escena que endurezca la pared
  // para aguantar una fuerza grande tiene que devolverlos sola a su valor de fábrica al salir.
  'box.wallStiffness': 0.3,
  'box.wallBounce': 0.2,
  'box.wallMaxPush': 1.0,
  'box.hardClamp': false,

  // Motor libre de Fluids (escena 26). En reposo no emite y no empuja: acá está
  // para que sea la escena la que fija su punto de partida y para que los CC que
  // Manuel mueva en vivo no queden pegados al volver a entrar.
  'fluids.live.emission': 0,
  'fluids.live.x': 0.5,
  'fluids.live.y': 0.5,
  'fluids.live.hue': 0,
  'fluids.live.gravity': 0,
  'fluids.live.viscosity': 0.5,
  'fluids.live.cohesion': 0.5,
  'fluids.live.light': 2.4,
  'fluids.live.forceX': 0,
  'fluids.live.forceY': 0,
};
