import * as THREE from 'three/webgpu';
import { uniform, Fn, float, positionWorld } from 'three/tsl';
import { STAGE } from '../config/stage.js';

// Techo del corte cuando NO hay crecimiento en curso: más arriba que cualquier coordenada real
// del escenario (dominio hasta y=7), así el `lessThanEqual` de abajo siempre da verdadero y el
// corte es matemáticamente un no-op.
const GROW_TOP_OPEN = 1e4;

// Aristas de la caja. Comparte los params box.* con el simulador: las dos cosas leen
// el mismo registro, así que girar o mover la caja mueve el límite físico y las aristas juntas.
export class BoxWire {
  static defineParams(params) {
    const b = STAGE.box;
    params.define({ id: 'box.visible', type: 'float', min: 0, max: 1, default: 0, label: 'Aristas', group: 'box' });
    params.define({ id: 'box.enabled', type: 'bool', default: true, label: 'Límite activo', group: 'box' });
    params.define({ id: 'box.preset', type: 'enum', options: ['left', 'center', 'right'], default: 'center', label: 'Posición', group: 'box' });
    // `box.x` es ESTADO VIVO: lo escribe el preset, no la escena. Tiene que ser sceneReset:false
    // o queda un bug feo: `goto` lo devolvía a su default (0) en cada cambio de escena, y
    // `BoxWire` solo lo vuelve a escribir cuando el preset CAMBIA de valor. Entonces saltar entre
    // dos escenas que comparten preset dejaba la caja plantada en el centro, y recorriendo el
    // show en orden ni se notaba porque entre medio siempre pasa una 'center'.
    params.define({ id: 'box.x', type: 'float', min: -6, max: 6, default: 0, label: 'X (m)', group: 'box', sceneReset: false });
    params.define({ id: 'box.y', type: 'float', min: 0, max: 4, default: b.y, label: 'Y (m)', group: 'box' });
    params.define({ id: 'box.z', type: 'float', min: -5, max: 0, default: b.z, label: 'Z (m)', group: 'box' });
    // Techo 8 → 11 (el ancho del dominio). No es para dibujar una caja gigante: cuando el
    // límite está apagado, la huella de la caja es lo que usan el emisor y el reciclado
    // (escena 12), y para que un flujo horizontal cubra la pantalla TIENE que llegar al
    // borde del escenario. La pantalla mide 8 m en el plano z = 0, pero en perspectiva se
    // ensancha con la profundidad: a 1.8 m de fondo el cuadro ya abarca ±5.8 m, así que con
    // medio ancho 4 el chorro dejaba franjas negras a los costados.
    params.define({ id: 'box.width', type: 'float', min: 0.5, max: 11, default: b.width, label: 'Ancho (m)', group: 'box' });
    params.define({ id: 'box.height', type: 'float', min: 0.5, max: 8, default: b.height, label: 'Alto (m)', group: 'box' });
    params.define({ id: 'box.depth', type: 'float', min: 0.5, max: 8, default: b.depth, label: 'Profundidad (m)', group: 'box' });
    params.define({ id: 'box.yaw', type: 'float', min: -180, max: 180, default: b.yawDeg, label: 'Giro Y (°)', group: 'box' });
    params.define({ id: 'box.yawSpeed', type: 'float', min: -90, max: 90, default: 0, label: 'Giro continuo (°/s)', group: 'box' });
    params.define({ id: 'box.wallStiffness', type: 'float', min: 0, max: 2, default: 0.3, label: 'Rigidez pared', group: 'box' });
    // Los tres eran sceneReset:false, y con eso una escena que los tocara se los dejaba puestos
    // a TODAS las que vinieran después (es la misma fuga que documenta NOTAS con `redBlock`).
    // Cualquier escena que endurezca la pared para aguantar una fuerza grande tiene que
    // devolverlos sola a su valor de fábrica al salir, así que van con sceneReset por defecto.
    params.define({ id: 'box.wallMaxPush', type: 'float', min: 0, max: 40, default: 1.0, label: 'Empuje máximo', group: 'box' });
    params.define({ id: 'box.hardClamp', type: 'bool', default: false, label: 'Clamp duro', group: 'box' });
    params.define({ id: 'box.wallBounce', type: 'float', min: 0, max: 1, default: 0.2, label: 'Rebote en la pared', group: 'box' });
    params.define({ id: 'box.flicker', type: 'bool', default: false, label: 'Titileo', group: 'box' });
    params.define({ id: 'box.flickerRate', type: 'float', min: 0.5, max: 30, default: 8, label: 'Titileo (Hz)', group: 'box' });
    params.define({ id: 'box.flickerDuty', type: 'float', min: 0, max: 1, default: 0.5, label: 'Titileo duty', group: 'box' });
    params.define({ id: 'box.color', type: 'color', default: '#FFFFFF', label: 'Color', group: 'box' });
    // CRECER DESDE LA BASE (escena 10, pedido de Manuel: *"el bound tiene que ir apareciendo
    // como creciendo desde la base hacia arriba, y actuar como oclusión: afuera no se ven los
    // palitos hasta que termina de crecer"*). Default 0 = apagado: ninguna escena que no lo pida
    // toca este param, así que en el resto del show el corte de abajo (`GROW_TOP_OPEN`) nunca
    // se activa y no cambia nada de lo que ya funciona.
    params.define({ id: 'box.growDuration', type: 'float', min: 0, max: 8, default: 0, label: 'Crecer desde la base (s)', group: 'box' });
    params.defineAction({ id: 'box.grow', label: 'Crecer desde la base', group: 'box' });
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.params = ctx.params;
    this.uColor = uniform(new THREE.Color('#ffffff'));
    this.uOpacity = uniform(0);
    this.uGrowTop = uniform(GROW_TOP_OPEN);   // altura Y (mundo) hasta donde ya "creció" la caja
    this._color = '';
    this._preset = null;
    // Arranca ya "crecida": sin que algo dispare `box.grow` no hay corte, ni en el primer frame.
    this._growElapsed = Infinity;
    this.params.onAction('box.grow', () => { this._growElapsed = 0; });
  }

  async init(scene) {
    const material = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    material.colorNode = this.uColor;
    // Corte DURO (sin degradado, mismo criterio que ya usa `Floor` para el piso que se extiende:
    // "sin fade, pixel puro"): la arista se ve completa por debajo de `uGrowTop` y desaparece
    // entera por encima. Como las aristas verticales cruzan ese umbral, el efecto que se lee es
    // el borde subiendo a media altura — no hace falta animar la geometría.
    const uGrowTop = this.uGrowTop;
    material.opacityNode = Fn(() => this.uOpacity.mul(float(positionWorld.y.lessThanEqual(uGrowTop))))();
    // El MRT del compositor pide `transformedNormalView` a TODO lo que se dibuja en el pase 3D,
    // y EdgesGeometry no trae atributo `normal`: sin esto three avisa por consola y el buffer de
    // normales queda con basura justo donde van las aristas, que es lo que después lee el GTAO.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const normals = new Float32Array(edges.attributes.position.count * 3);
    for (let i = 2; i < normals.length; i += 3) normals[i] = 1;   // (0, 0, 1) para todos
    edges.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.lines = new THREE.LineSegments(edges, material);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  update(dt, t) {
    const p = this.params;

    // Crecimiento desde la base. Se calcula ANTES del corte de visibilidad de más abajo, porque
    // `StickRenderer` necesita el valor por `ctx` todos los frames, dibuje o no dibuje aristas.
    this._growElapsed += dt;
    const growDuration = p.get('box.growDuration');
    if (growDuration <= 0 || this._growElapsed >= growDuration) {
      this.uGrowTop.value = GROW_TOP_OPEN;
    } else {
      const bottom = p.get('box.y') - p.get('box.height') / 2;
      this.uGrowTop.value = bottom + p.get('box.height') * (this._growElapsed / growDuration);
    }
    this.ctx.boxGrowTopY = this.uGrowTop.value;

    // El preset mueve box.x DE UNA, sin tween. Antes se deslizaba en 1 s y se veía la caja
    // viajar de un lado al otro de la pantalla; Manuel lo quiere como un corte: la caja nueva
    // aparece ya en su lugar. El simulador lee el mismo param, así que el límite salta con
    // ella y las partículas que quedaron afuera las mete adentro el clamp en el mismo frame.
    const preset = p.get('box.preset');
    if (preset !== this._preset) {
      this._preset = preset;
      p.set('box.x', STAGE.box.presets[preset], { immediate: true });
    }

    // Giro continuo. Se mira el DESTINO de `box.yawSpeed`, no su valor actual, y esa distinción
    // arregla un bug que se comía el ángulo pedido por la escena:
    //
    // `box.yawSpeed` se funde como cualquier otro param, así que al entrar en una escena que lo
    // pide en 0 viniendo de una que giraba, el valor tarda toda la transición en llegar a cero.
    // Durante esos segundos este integrador seguía escribiendo `box.yaw` frame por frame, y como
    // en Params un `set` CANCELA el tween en curso, el tween hacia el ángulo que pidió la escena
    // moría en el primer frame y no lo volvía a crear nadie: la caja se quedaba clavada en un
    // ángulo cualquiera. Se veía yendo de la 13 (que gira) a una escena con `box.yaw: 0`, que
    // terminaba en 14° o en 96° según de dónde se viniera.
    //
    // El destino, en cambio, ya vale 0 en el primer frame de la escena nueva. Mirándolo, el
    // integrador se calla enseguida y el tween del ángulo llega a donde tiene que llegar. Para
    // las escenas que SÍ giran no cambia nada: ahí el destino es ≠ 0 y todo sigue como estaba
    // (el giro manda sobre el ángulo, que es lo que se quiere cuando la caja está girando).
    const yawSpeed = p.get('box.yawSpeed');
    if (yawSpeed !== 0 && p.target('box.yawSpeed') !== 0) {
      const yaw = p.get('box.yaw') + yawSpeed * dt;
      p.set('box.yaw', ((yaw + 180) % 360 + 360) % 360 - 180, { immediate: true });
    }

    let opacity = p.get('box.visible') * p.get('layer3d.opacity');
    if (p.get('box.flicker')) {
      const phase = (t * p.get('box.flickerRate')) % 1;
      if (phase >= p.get('box.flickerDuty')) opacity = 0;
    }
    this.uOpacity.value = opacity;
    this.lines.visible = opacity > 0.001;
    if (!this.lines.visible) return;

    const color = p.get('box.color');
    if (color !== this._color) { this.uColor.value.set(color); this._color = color; }

    this.lines.position.set(p.get('box.x'), p.get('box.y'), p.get('box.z'));
    this.lines.scale.set(p.get('box.width'), p.get('box.height'), p.get('box.depth'));
    this.lines.rotation.y = THREE.MathUtils.degToRad(p.get('box.yaw'));
  }

  dispose() {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
