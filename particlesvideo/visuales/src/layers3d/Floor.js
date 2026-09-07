import * as THREE from 'three/webgpu';
import {
  uniform, float, vec3, Fn, attribute, instanceIndex, varying, floor, mod, max,
} from 'three/tsl';

// Cantidad de cubitos preasignados. Alcanza para cubrir todo el escenario con los
// rangos de los params; los que sobran se colapsan a escala 0 y no se ven.
const LANES = 41;
const ROWS = 110;

// Piso de carriles punteados con fuga (escena 7+).
// Cada dash es una CAJA de verdad, no un patrón pintado con un shader: así cada píxel sale
// blanco puro o negro puro, sin el gris de promediar. Manuel lo pidió explícitamente
// ("cubitos pero finitos") porque el filtrado analítico, aunque es más correcto en movimiento,
// dejaba un ruido gris en la distancia que no le gustaba.
// La grilla entera se arma en el vertex shader desde `instanceIndex`: no hay trabajo de CPU
// por frame ni matrices que subir.
export class Floor {
  // Los tres tamaños del dash (largo, ancho y alto) bajaron un 30% el 2026-09-04 a pedido de
  // Manuel. El período y la separación de carriles NO cambian: el dash se achica y queda más
  // aire entre uno y otro, que es lo que se pidió; si se achicara todo junto, la fuga se vería
  // igual pero más chica.
  static defineParams(params) {
    params.define({ id: 'floor.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Piso', group: 'floor' });
    params.define({ id: 'floor.brightness', type: 'float', min: 0, max: 1, default: 1, label: 'Brillo', group: 'floor' });
    params.define({ id: 'floor.laneSpacing', type: 'float', min: 0.1, max: 3, default: 0.7, label: 'Separación carriles (m)', group: 'floor' });
    params.define({ id: 'floor.dashLength', type: 'float', min: 0.05, max: 3, default: 0.385, label: 'Largo dash (m)', group: 'floor' });
    params.define({ id: 'floor.dashPeriod', type: 'float', min: 0.1, max: 6, default: 1.1, label: 'Período dash (m)', group: 'floor' });
    params.define({ id: 'floor.dashWidth', type: 'float', min: 0.01, max: 0.5, default: 0.105, label: 'Ancho dash (m)', group: 'floor' });
    params.define({ id: 'floor.dashHeight', type: 'float', min: 0.002, max: 0.3, default: 0.021, label: 'Alto dash (m)', group: 'floor' });
    params.define({ id: 'floor.scrollSpeed', type: 'float', min: -5, max: 5, default: 0.6, label: 'Avance (m/s)', group: 'floor' });
    params.define({ id: 'floor.revealDuration', type: 'float', min: 0.1, max: 20, default: 4, label: 'Duración aparición (s)', group: 'floor' });
    params.define({ id: 'floor.fadeFar', type: 'float', min: 5, max: 120, default: 60, label: 'Alcance (m)', group: 'floor' });
    params.define({ id: 'floor.revealDist', type: 'float', min: 0, max: 120, default: 0, label: 'Alcance actual (m)', group: 'floor', sceneReset: false });
    params.defineAction({ id: 'floor.reveal', label: 'Extender piso', group: 'floor' });
    params.defineAction({ id: 'floor.hide', label: 'Retraer piso', group: 'floor' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    this.u = {
      laneSpacing: uniform(0.7), dashLength: uniform(0.55), dashPeriod: uniform(1.1),
      dashWidth: uniform(0.15), dashHeight: uniform(0.03),
      scroll: uniform(0), revealDist: uniform(0), fadeFar: uniform(60), opacity: uniform(0),
    };
    this.scroll = 0;
    this._holdRevealFrame = false;
  }

  async init(scene) {
    const u = this.u;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const vVisible = varying(float(0), 'vFloorVisible');

    material.positionNode = Fn(() => {
      const idx = float(instanceIndex);
      const lane = mod(idx, float(LANES));
      const row = floor(idx.div(float(LANES)));

      const x = lane.sub((LANES - 1) / 2).mul(u.laneSpacing);
      // El patrón entero se corre y vuelve a entrar cada período: el loop no se nota
      // porque todas las filas son iguales.
      const depth = row.mul(u.dashPeriod).sub(mod(u.scroll, u.dashPeriod));

      // Se apaga entero al pasarse del alcance o de lo ya revelado (sin fade: pixel puro).
      const dentro = u.revealDist.greaterThan(0).and(depth.lessThanEqual(max(u.revealDist, float(0)))).and(depth.lessThanEqual(u.fadeFar)).and(depth.greaterThanEqual(-1));
      vVisible.assign(float(dentro));

      const size = vec3(u.dashWidth, u.dashHeight, u.dashLength);
      return attribute('position').xyz.mul(size).mul(float(dentro))
        .add(vec3(x, u.dashHeight.mul(0.5), depth.negate()));
    })();

    material.colorNode = vec3(1, 1, 1);
    material.opacityNode = u.opacity.mul(vVisible);

    const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
    geometry.instanceCount = LANES * ROWS;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.params.onAction('floor.reveal', (mode = 'perspective') => {
      // Ocultar un frame evita que una entrada muestre la geometría completa que dejó
      // la escena anterior mientras se publica el alcance cero en la GPU.
      this._holdRevealFrame = true;
      this.mesh.visible = false;
      // Reiniciar también el uniform evita dibujar el piso anterior si la escena cambia
      // mientras el frame está esperando a la GPU. El scroll arranca siempre en la misma fila.
      this.params.set('floor.revealDist', 0, { immediate: true });
      this.u.revealDist.value = 0;
      this.scroll = 0;
      this.u.scroll.value = 0;
      const far = this.params.target('floor.fadeFar');
      const eyeZ = Math.max(this.params.target('camera.eyeZ'), 0.01);
      // En perspectiva los primeros metros ocupan casi toda la pantalla. Animar 0→60 m
      // dejaba el piso visualmente completo durante el fundido de entrada. Esta inversa
      // de la proyección hace que el frente avance en pantalla durante TODO el despliegue.
      const easing = mode === 'perspective'
        ? (progress) => eyeZ * progress / (eyeZ + far * (1 - progress))
        : 'smooth';
      this.params.tween('floor.revealDist', far, this.params.target('floor.revealDuration'), easing);
    });
    this.params.onAction('floor.hide', () => this.params.tween('floor.revealDist', 0, 1.5));
  }

  update(dt) {
    const opacity = this.params.get('floor.opacity') * this.params.get('floor.brightness') * this.params.get('layer3d.opacity');
    this.u.opacity.value = opacity;
    this.u.laneSpacing.value = this.params.get('floor.laneSpacing');
    this.u.dashLength.value = this.params.get('floor.dashLength');
    this.u.dashPeriod.value = this.params.get('floor.dashPeriod');
    this.u.dashWidth.value = this.params.get('floor.dashWidth');
    this.u.dashHeight.value = this.params.get('floor.dashHeight');
    this.u.revealDist.value = this.params.get('floor.revealDist');
    this.u.fadeFar.value = this.params.get('floor.fadeFar');

    if (this._holdRevealFrame) {
      this._holdRevealFrame = false;
      // Un tick de pruebas puede representar varios segundos y no equivale a un frame de
      // presentación. En la salida real se omite exactamente el primer frame corto.
      if (dt <= 0.1) {
        this.mesh.visible = false;
        return;
      }
    }

    this.mesh.visible = opacity > 0.001;
    if (!this.mesh.visible) return;

    this.scroll += this.params.get('floor.scrollSpeed') * dt;
    this.u.scroll.value = this.scroll;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
