import * as THREE from 'three/webgpu';
import { uniform, mrt } from 'three/tsl';
import { STAGE } from '../config/stage.js';

// ORBE: un punto de luz que ATRAE y que además ILUMINA a los palitos que pasan cerca.
//
// Por qué existe (pedido de Manuel): cuando las partículas están sueltas, sin caja, la nube se
// organiza sola con el campo (escena 19) pero no le pasa NADA — no hay un acontecimiento. El
// orbe es ese acontecimiento: aparece, se lleva la masa detrás, la enciende con su color y se
// apaga. Después vuelve a aparecer en otro lado.
//
// Hace TRES cosas a la vez, y las tres juntas son el efecto (una sola no alcanza):
//  1. ATRAE — publica el atractor 1 del simulador, en modo punto. La masa lo persigue.
//  2. ALUMBRA — una PointLight de verdad, así los palitos cercanos reciben luz direccional y
//     se les ve el volumen contra el fondo negro. Es sombreado físico, no un truco.
//  3. APAGA — un halo que lleva a NEGRO el color y la emisión de la partícula según lo cerca
//     que esté (`orb.darken`, lo lee StickRenderer). O sea que abre un agujero negro en la
//     nube, con el borde todavía iluminado por su luz. La luz sola no alcanza para que se note
//     nada: el palito mide 3 px de ancho y tiene brillo propio, así que el aporte de una
//     lámpara se le pierde adentro; lo que se lee desde lejos es que la masa se apague.
//
// El núcleo (`orb.core`) puede estar en 0 y entonces la bola no se dibuja: se ve lo que HACE
// —la masa que se apaga y se va detrás de algo— sin ver qué lo hace. Así queda en la 19.
//
// El orbe NO está siempre encendido. Tiene una envolvente (ataque + caída) que dispara la
// acción `orb.flash`. Un atractor puntual permanente termina siempre en lo mismo: una bola
// apelmazada en un punto y nada más se mueve. Como evento —aparece, arrastra, se va— la masa
// se junta y se vuelve a soltar, y eso sí es un show.
//
// `orb.auto` lo dispara SOLO cada 1/auto segundos. Está para poder verlo funcionando antes de
// que Manuel defina de qué mensaje va a colgar; el día que lo defina se mapea `orb.flash` a ese
// mensaje y se pone `orb.auto` en 0. No hay que tocar código para eso.
export class Orb {
  static defineParams(params) {
    params.define({ id: 'orb.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Orbe', group: 'orb' });
    params.define({ id: 'orb.color', type: 'color', default: '#66E0FF', label: 'Color', group: 'orb' });
    // Fuerza del atractor en unidades de grilla (misma escala que `redBlock.attract`): 100 son
    // 10 m/s², o sea la gravedad terrestre tirando de la masa hacia un punto.
    params.define({ id: 'orb.pull', type: 'float', min: 0, max: 300, default: 90, label: 'Atracción', group: 'orb' });
    // ALCANCE, no grosor: la distancia a la que la fuerza cae a la mitad. Va grande a propósito
    // — con 1 m el orbe solo mueve lo que ya tiene encima y no se ve que arrastre nada. Es la
    // misma trampa que `vortex.radius`.
    params.define({ id: 'orb.radius', type: 'float', min: 0.3, max: 8, default: 3.2, label: 'Radio atracción (m)', group: 'orb' });
    params.define({ id: 'orb.light', type: 'float', min: 0, max: 60, default: 22, label: 'Luz', group: 'orb' });
    params.define({ id: 'orb.lightRange', type: 'float', min: 0.5, max: 14, default: 6.0, label: 'Alcance de la luz (m)', group: 'orb' });
    params.define({ id: 'orb.darken', type: 'float', min: 0, max: 1, default: 1, label: 'Apagado de los palitos', group: 'orb' });
    params.define({ id: 'orb.darkenRadius', type: 'float', min: 0.3, max: 8, default: 2.0, label: 'Radio del apagado (m)', group: 'orb' });
    // Cuánto varía ese radio DE UNA PARTÍCULA A OTRA (0 = todas igual, 1 = ±50 %). Sin esto los
    // palitos a la misma distancia se apagan todos en el mismo frame y el agujero queda con el
    // borde de una pelota de billar; con jitter el borde se disuelve de a un palito.
    params.define({ id: 'orb.darkenJitter', type: 'float', min: 0, max: 1, default: 0.5, label: 'Dispersión del apagado', group: 'orb' });
    // 0 = la bola NO se dibuja (se ve solo lo que hace). El núcleo es lo único del orbe que se
    // ve directo, así que apagarlo cambia por completo la lectura: de "una luz que pasa" a "algo
    // invisible que se lleva a los palitos".
    params.define({ id: 'orb.core', type: 'float', min: 0, max: 1, default: 1, label: 'Núcleo visible', group: 'orb' });
    params.define({ id: 'orb.size', type: 'float', min: 0.02, max: 1, default: 0.16, label: 'Tamaño del núcleo (m)', group: 'orb' });
    params.define({ id: 'orb.bloom', type: 'float', min: 0, max: 1, default: 1, label: 'Bloom', group: 'orb' });

    // Centro del paseo y amplitudes. El orbe se mueve SIEMPRE, esté encendido o apagado: así
    // cada destello lo agarra en otro lugar del escenario y no se repite dos veces la misma
    // pasada.
    params.define({ id: 'orb.x', type: 'float', min: -5, max: 5, default: 0, label: 'Centro X (m)', group: 'orb' });
    params.define({ id: 'orb.y', type: 'float', min: 0, max: 5, default: 1.5, label: 'Centro Y (m)', group: 'orb' });
    params.define({ id: 'orb.z', type: 'float', min: -5, max: 0, default: -1.8, label: 'Centro Z (m)', group: 'orb' });
    params.define({ id: 'orb.travelX', type: 'float', min: 0, max: 5, default: 2.8, label: 'Paseo X (m)', group: 'orb' });
    params.define({ id: 'orb.travelY', type: 'float', min: 0, max: 3, default: 0.7, label: 'Paseo Y (m)', group: 'orb' });
    params.define({ id: 'orb.travelZ', type: 'float', min: 0, max: 3, default: 1.1, label: 'Paseo Z (m)', group: 'orb' });
    params.define({ id: 'orb.travelRate', type: 'float', min: 0.01, max: 1, default: 0.09, label: 'Paseo (Hz)', group: 'orb' });

    // Envolvente del destello. El ataque no es un capricho: con 0 el orbe aparece de un frame
    // al otro y en la LED se lee como un error de video. Con 0.15 s se ve ENCENDERSE.
    params.define({ id: 'orb.attack', type: 'float', min: 0, max: 1.5, default: 0.15, label: 'Ataque (s)', group: 'orb' });
    params.define({ id: 'orb.decay', type: 'float', min: 0.1, max: 12, default: 3.0, label: 'Caída (s)', group: 'orb' });
    // EL EMPUJÓN DE SALIDA, y no es un adorno: sin esto la escena se muere sola. Cada destello
    // junta un poco más de masa, y como el campo de la 19 no tiene fuerza para deshacer un
    // grumo, después de cuatro o cinco pasadas del orbe la nube queda hecha una bola en el medio
    // y deja de estar "libre" (medido: a los 38 s ocupaba un tercio de lo que ocupaba al entrar).
    //
    // Con esto el orbe RECOGE Y SUELTA: la fuerza se da vuelta justo cuando se está apagando, así
    // que lo que juntó sale despedido y el campo lo vuelve a peinar. Y de paso el evento tiene
    // final: se ve la masa abrirse cuando la luz se va, en vez de quedar ahí amontonada.
    params.define({ id: 'orb.push', type: 'float', min: 0, max: 1.5, default: 0.8, label: 'Empujón al soltar', group: 'orb' });
    // 0 = solo se dispara por mensaje. > 0 = se dispara solo a esa frecuencia.
    params.define({ id: 'orb.auto', type: 'float', min: 0, max: 2, default: 0, label: 'Automático (Hz)', group: 'orb' });

    params.defineAction({ id: 'orb.flash', label: 'Aparecer', group: 'orb' });
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.params = ctx.params;
    this.uColor = uniform(new THREE.Color('#66E0FF'));
    this.uOpacity = uniform(0);
    this.uBloom = uniform(1);
    this._color = '';
    this._bloomOn = null;
    this.travelTime = 0;
    // Edad del destello en curso. Negativa = no hay ninguno (así el primer frame no dispara uno).
    this.age = -1;
    this.autoTime = 0;
    this.pos = new THREE.Vector3(0, 1.5, -1.8);
    // Lo que StickRenderer necesita para el tinte. Se publica en el ctx en vez de cablear los
    // dos elementos entre sí: el orden del frame ya garantiza que los elementos corren antes
    // que el renderer de palitos (ver Layer3D.update).
    ctx.orbState = { pos: this.pos, dark: 0, radius: 1, jitter: 0.5 };
    this.state = ctx.orbState;
  }

  async init(scene) {
    // Núcleo: una bolita plena con bloom. No es la luz, es lo que SE VE de la luz — sin algo
    // dibujado, el orbe es un fantasma que mueve palitos y no se entiende de dónde sale.
    this.material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    this.material.colorNode = this.uColor;
    this.material.opacityNode = this.uOpacity;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    // La luz vive SIEMPRE en la escena, aunque el orbe esté apagado. Agregarla y sacarla en vivo
    // obliga a three a recompilar los materiales de toda la capa 3D (cambia el LightsNode), y eso
    // es un tirón de varios frames justo en el momento del destello. Apagada cuesta una luz
    // puntual más en un shader que ya es MeshStandard: nada medible.
    this.light = new THREE.PointLight(0x66e0ff, 0, 6, 2);
    scene.add(this.light);

    this.params.onAction('orb.flash', () => this.flash());
  }

  flash() { this.age = 0; }

  // Envolvente de la FUERZA. Es la del brillo menos una campana angosta puesta donde el
  // destello se apaga: ahí el resultado se va a NEGATIVO y el atractor pasa a repeler.
  // Devuelve de −1 a 1. El ancho de la campana (0.35 s) es fijo a propósito: es corto contra
  // cualquier caída razonable, así que el empujón se lee como un golpe y no como una segunda
  // fase larga.
  _forceEnvelope(env) {
    const push = this.params.get('orb.push');
    if (push <= 0.0001 || this.age < 0) return env;
    const fin = this.params.get('orb.attack') + this.params.get('orb.decay');
    const t = (this.age - fin) / 0.35;
    return env - push * Math.exp(-t * t);
  }

  // Ataque lineal + caída exponencial. Devuelve 0..1.
  _envelope() {
    if (this.age < 0) return 0;
    const attack = this.params.get('orb.attack');
    if (this.age < attack) return this.age / Math.max(attack, 1e-4);
    const t = this.age - attack;
    const e = Math.exp(-t / Math.max(this.params.get('orb.decay'), 0.01));
    return e < 0.002 ? 0 : e;
  }

  update(dt) {
    const p = this.params;
    const forces = this.ctx.forces;

    // El paseo corre siempre y con el dt del motor (no con `performance.now()`), igual que el del
    // torbellino: si no, al volver el foco de la ventana la fase pega un salto y el orbe se
    // teletransporta arrastrando la masa detrás.
    this.travelTime += dt;
    const fase = 2 * Math.PI * p.get('orb.travelRate') * this.travelTime;
    // Frecuencias en relación 1 : 0.61 : 0.37, irracionales a efectos prácticos: la trayectoria
    // es una Lissajous que no se repite a ojo y no se lee como un péndulo.
    this.pos.set(
      p.get('orb.x') + p.get('orb.travelX') * Math.sin(fase),
      p.get('orb.y') + p.get('orb.travelY') * Math.sin(fase * 0.61 + 2.1),
      p.get('orb.z') + p.get('orb.travelZ') * Math.sin(fase * 0.37 + 1.3),
    );
    // El orbe tiene que quedar DENTRO del escenario: centro y paseo suman hasta 10 m, y un
    // atractor fuera del dominio arrastra toda la masa contra la pared, donde se apelmaza.
    const { min: m, max: M } = STAGE.sim;
    this.pos.set(
      Math.min(Math.max(this.pos.x, m[0] + 0.3), M[0] - 0.3),
      Math.min(Math.max(this.pos.y, m[1] + 0.3), M[1] - 0.3),
      Math.min(Math.max(this.pos.z, m[2] + 0.3), M[2] - 0.3),
    );

    // Disparo automático. Está para verlo andar antes de que exista el mensaje que lo va a
    // disparar en el show; con `orb.auto` en 0 el orbe solo aparece por `orb.flash`.
    const auto = p.get('orb.auto');
    if (auto > 0.0001) {
      this.autoTime += dt;
      const periodo = 1 / auto;
      if (this.autoTime >= periodo) { this.autoTime -= periodo; this.flash(); }
    } else {
      this.autoTime = 0;
    }

    if (this.age >= 0) this.age += dt;
    const env = this._envelope();
    // El destello no se da por terminado solo porque la luz llegó a cero: el empujón vive un
    // poco después (la campana está centrada en attack + decay y dura ~0.7 s en total). Si se
    // apagara antes, el empujón directamente no ocurriría.
    const finPush = p.get('orb.attack') + p.get('orb.decay') + 0.7;
    if (env === 0 && this.age > finPush) this.age = -1;

    // `orb.opacity` es el mando de la ESCENA (se funde en las transiciones) y la envolvente es
    // el del EVENTO. Se multiplican: una escena sin orbe lo deja mudo aunque llegue un
    // `orb.flash`, y una escena con orbe no muestra nada hasta que llega el disparo.
    const master = p.get('orb.opacity') * p.get('layer3d.opacity');
    const nivel = master * env;

    const color = p.get('orb.color');
    if (color !== this._color) {
      this.uColor.value.set(color);
      this.light.color.set(color);
      this._color = color;
    }

    const nucleo = nivel * p.get('orb.core');
    this.uOpacity.value = Math.min(nucleo * 1.6, 1);   // el núcleo satura antes que la luz
    this.mesh.visible = nucleo > 0.002;
    if (this.mesh.visible) {
      this.mesh.position.copy(this.pos);
      // El núcleo late con la envolvente: nace chico y se agranda. Con tamaño fijo el destello
      // sería solo un cambio de brillo y no se leería como algo que llega.
      this.mesh.scale.setScalar(p.get('orb.size') * (0.5 + 0.5 * env) * 2);
    }

    const bloomOn = p.get('orb.bloom') > 0.001;
    if (bloomOn !== this._bloomOn) {
      this._bloomOn = bloomOn;
      this.material.mrtNode = bloomOn ? mrt({ bloomIntensity: this.uBloom }) : null;
      this.material.needsUpdate = true;
    }
    this.uBloom.value = p.get('orb.bloom');

    this.light.position.copy(this.pos);
    // Al entrar en 21 el orbe anterior todavía puede estar fundiéndose. Su fuerza conserva
    // esa transición, pero la luz se apaga desde el primer frame para dejar sólo los rayos.
    this.light.intensity = p.get('particles.raysOnly') ? 0 : p.get('orb.light') * nivel;
    this.light.distance = p.get('orb.lightRange');

    // Lo que lee StickRenderer para apagar. Ya viene con la envolvente adentro, así que el
    // agujero se abre y se cierra junto con el orbe.
    this.state.dark = p.get('orb.darken') * nivel;
    this.state.radius = p.get('orb.darkenRadius');
    this.state.jitter = p.get('orb.darkenJitter');

    // Sin la opacidad de por medio no serviría: una escena que apaga el orbe tiene que apagarle
    // también la fuerza, o queda un imán invisible tirando de la masa. La fuerza usa su propia
    // envolvente (la del brillo con el empujón de salida encima), que puede ser NEGATIVA: ahí el
    // atractor repele, igual que un `vortex.pull` negativo.
    const pull = p.get('orb.pull') * master * this._forceEnvelope(env);
    if (Math.abs(pull) > 0.001) forces.setAttractor(1, this.pos, pull, p.get('orb.radius'));
    else forces.clearAttractor(1);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
