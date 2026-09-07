import * as THREE from 'three/webgpu';
import { uniform, mrt, vec3 } from 'three/tsl';

const MAX = 4000;

// A qué altura del piso empiezan a apagarse las esquirlas cuando ya vienen bajando.
// Sin esto llegaban a y = −1.45 m: se hundían por debajo del piso y se veían por los huecos
// entre los dashes. Ahora se desvanecen en el aire y mueren al tocar y = 0.
const ALTURA_FADE_M = 0.3;

// Esquirlas blancas en el piso (escenas 16 a 18, las de rayos). Simuladas en CPU: son pocas y
// baratas,
// y así rebotan y se deslizan con control fino. Todo preasignado: nada se crea por frame.
export class Debris {
  static defineParams(params) {
    params.define({ id: 'debris.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Esquirlas', group: 'debris' });
    params.define({ id: 'debris.count', type: 'int', min: 0, max: 300, default: 60, label: 'Por impacto', group: 'debris' });
    params.define({ id: 'debris.size', type: 'float', min: 0.01, max: 0.3, default: 0.06, label: 'Tamaño (m)', group: 'debris' });
    params.define({ id: 'debris.speed', type: 'float', min: 0, max: 40, default: 11, label: 'Velocidad (m/s)', group: 'debris' });
    params.define({ id: 'debris.lifetime', type: 'float', min: 0.05, max: 10, default: 0.35, label: 'Duración (s)', group: 'debris' });
    params.define({ id: 'debris.fadeFraction', type: 'float', min: 0.05, max: 1, default: 1, label: 'Fracción de fade', group: 'debris' });
    // Apertura del cono de salida: 0 = todas rectas para arriba, 1 = media esfera completa.
    // "Violento hacia arriba a todos lados" es un cono ancho pero con la vertical dominando.
    params.define({ id: 'debris.spread', type: 'float', min: 0, max: 1, default: 0.7, label: 'Apertura (0=vertical)', group: 'debris' });
    // Frenado exponencial (1/s). Es lo que hace que la esquirla salga disparada y se plante,
    // en vez de viajar a velocidad constante hasta que se le acaba la vida.
    params.define({ id: 'debris.drag', type: 'float', min: 0, max: 30, default: 6, label: 'Frenado (1/s)', group: 'debris' });
    // Con false (default) las esquirlas vuelan y se apagan en el aire, sin llegar al piso.
    // El rebote y la fricción quedan disponibles por si se quiere el comportamiento viejo.
    params.define({ id: 'debris.floorCollision', type: 'bool', default: false, label: 'Choca con el piso', group: 'debris' });
    // Gravedad 0 por pedido de Manuel: con gravedad la esquirla dibuja una parábola, sube un
    // poco y CAE, y esa asíntota que baja es justo lo que no quiere. Sin gravedad salen
    // disparadas, el frenado las planta y el fade las apaga ahí mismo. El param queda por si
    // alguna vez se quiere el tiro parabólico de antes.
    params.define({ id: 'debris.gravity', type: 'float', min: 0, max: 20, default: 0, label: 'Gravedad', group: 'debris' });
    params.define({ id: 'debris.bounce', type: 'float', min: 0, max: 1, default: 0.4, label: 'Rebote', group: 'debris' });
    params.define({ id: 'debris.friction', type: 'float', min: 0, max: 1, default: 0.9, label: 'Fricción', group: 'debris' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    ctx.debris = this;                      // los rayos llaman a burst() al impactar
    this.uOpacity = uniform(0);
    this.uBloom = uniform(1);
    this._bloomOn = null;
    this.cursor = 0;

    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.yaw = new Float32Array(MAX);
    this.life = new Float32Array(MAX);      // 0 = muerta
    this.grounded = new Uint8Array(MAX);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._zero = new THREE.Vector3(0, 0, 0);
  }

  async init(scene) {
    this.material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.material.colorNode = vec3(1, 1, 1);
    this.material.opacityNode = this.uOpacity;

    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX;
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this._m.identity().scale(this._zero));
    scene.add(this.mesh);
  }

  // Explosión: media esfera hacia ARRIBA, no un chorro vertical ni un tiro parabólico.
  // La dirección se saca de un ángulo polar medido desde la vertical, no de "un poco de x/z y
  // mucho de y": así la apertura es de verdad uniforme sobre el casquete y hay esquirlas que
  // salen casi horizontales cuando `spread` es alto, que es lo que se lee como reventón.
  burst(x, z) {
    const count = this.params.get('debris.count');
    const speed = this.params.get('debris.speed');
    const lifetime = this.params.get('debris.lifetime');
    const spread = this.params.get('debris.spread');
    const polarMax = spread * (Math.PI / 2);

    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;

      const azimut = Math.random() * Math.PI * 2;
      // cos uniforme en [cos(polarMax), 1] reparte parejo sobre el casquete: sin esto se
      // amontonan todas cerca del eje vertical y el cono se ve hueco en los costados.
      const cosPolar = 1 - Math.random() * (1 - Math.cos(polarMax));
      const sinPolar = Math.sqrt(Math.max(1 - cosPolar * cosPolar, 0));
      // Velocidades muy dispares dentro del mismo estallido: el frente rápido se va enseguida
      // y la cola lenta queda un instante más, que es lo que le da cuerpo a la explosión.
      const v = speed * (0.45 + Math.random() * 0.55);

      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = 0.05;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(azimut) * sinPolar * v;
      this.vel[i * 3 + 1] = cosPolar * v;
      this.vel[i * 3 + 2] = Math.sin(azimut) * sinPolar * v;
      this.yaw[i] = Math.random() * Math.PI * 2;
      this.life[i] = lifetime * (0.7 + Math.random() * 0.3);
      this.grounded[i] = 0;
    }
  }

  update(dt) {
    const p = this.params;
    const opacity = p.get('debris.opacity') * p.get('layer3d.opacity');
    this.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.001;

    const gravity = p.get('debris.gravity');
    const drag = p.get('debris.drag');
    const bounce = p.get('debris.bounce');
    const friction = p.get('debris.friction');
    const size = p.get('debris.size');
    const lifetime = Math.max(p.get('debris.lifetime'), 0.001);
    const floorCollision = p.get('debris.floorCollision');
    const fadeFraction = Math.max(p.get('debris.fadeFraction'), 0.01);

    let anyAlive = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;

      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this._m.identity().scale(this._zero));
        continue;
      }

      const ix = i * 3;
      this.vel[ix + 1] -= gravity * dt;
      // Frenado exponencial (estable con cualquier dt, a diferencia de `v *= 1 - k·dt`, que
      // con un frame lento se pasa de largo y da velocidad negativa).
      if (drag > 0) {
        const k = Math.exp(-drag * dt);
        this.vel[ix] *= k; this.vel[ix + 1] *= k; this.vel[ix + 2] *= k;
      }
      // Solo se controla el piso mientras BAJAN: nacen a ras del suelo y suben, así que
      // mirar la altura sin más las mataría en el mismo frame en que se crean.
      const bajando = this.vel[ix + 1] < 0;
      this.pos[ix] += this.vel[ix] * dt;
      this.pos[ix + 1] += this.vel[ix + 1] * dt;
      this.pos[ix + 2] += this.vel[ix + 2] * dt;

      if (!floorCollision && bajando && this.pos[ix + 1] <= 0) {
        this.life[i] = 0;
        this.mesh.setMatrixAt(i, this._m.identity().scale(this._zero));
        continue;
      }

      if (floorCollision && this.pos[ix + 1] <= 0.01) {
        this.pos[ix + 1] = 0.01;
        this.vel[ix + 1] *= -bounce;
        this.vel[ix] *= friction;
        this.vel[ix + 2] *= friction;
        if (Math.abs(this.vel[ix + 1]) < 0.2) { this.vel[ix + 1] = 0; this.grounded[i] = 1; }
      }

      // Apoyadas quedan planas sobre el piso; en el aire giran sobre su eje vertical.
      this._e.set(this.grounded[i] ? -Math.PI / 2 : 0, this.yaw[i], 0);
      this._q.setFromEuler(this._e);
      this._p.set(this.pos[ix], this.pos[ix + 1], this.pos[ix + 2]);
      const fadeVida = Math.min(this.life[i] / (lifetime * fadeFraction), 1);
      const fadeAltura = (!floorCollision && bajando) ? Math.min(this.pos[ix + 1] / ALTURA_FADE_M, 1) : 1;
      const fade = Math.max(Math.min(fadeVida, fadeAltura), 0);
      this._s.setScalar(size * fade);
      this.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
    }

    if (anyAlive) this.mesh.instanceMatrix.needsUpdate = true;

    const bloomOn = p.get('rays.bloom') > 0.001;
    if (bloomOn !== this._bloomOn) {
      this._bloomOn = bloomOn;
      this.material.mrtNode = bloomOn ? mrt({ bloomIntensity: this.uBloom }) : null;
      this.material.needsUpdate = true;
    }
    this.uBloom.value = p.get('rays.bloom');
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
