import * as THREE from 'three/webgpu';
import { uniform, mrt } from 'three/tsl';
import { MAX_REPULSORS } from './particles/Forces.js';
import { RayPointLight, RayPointLightNode } from './RayPointLight.js';

// Un slot de repulsor por rayo, desde que cae hasta que se apaga el impacto. Con los valores
// por defecto cada rayo ocupa su slot ~1.2 s (0.68 s de caída + 0.55 s de onda), así que la
// cantidad de slots es el techo de rayos por segundo que aguanta la escena sin comerse notas.
const POOL = MAX_REPULSORS;

// Rayos blancos que caen y explotan en el piso (desde la escena 16). Cada rayo publica un repulsor
// de segmento mientras cae, y al tocar el piso dispara debris y una onda expansiva.
export class Rays {
  static defineParams(params) {
    params.define({ id: 'rays.enabled', type: 'bool', default: false, label: 'Rayos', group: 'rays' });
    params.define({ id: 'rays.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Opacidad', group: 'rays' });
    params.define({ id: 'rays.fallSpeed', type: 'float', min: 0.5, max: 30, default: 6, label: 'Velocidad (m/s)', group: 'rays' });
    params.define({ id: 'rays.length', type: 'float', min: 0.1, max: 4, default: 0.8, label: 'Largo (m)', group: 'rays' });
    // Tres veces el ancho anterior (0.014 m), con la misma geometría y cantidad de dibujos.
    params.define({ id: 'rays.width', type: 'float', min: 0.002, max: 0.5, default: 0.042, label: 'Ancho (m)', group: 'rays' });
    params.define({ id: 'rays.lightIntensity', type: 'float', min: 0, max: 30, default: 8, label: 'Luz del rayo', group: 'rays' });
    params.define({ id: 'rays.lightRange', type: 'float', min: 0.1, max: 6, default: 2.6, label: 'Alcance de luz (m)', group: 'rays' });
    params.define({ id: 'rays.startY', type: 'float', min: 3, max: 8, default: 4.5, label: 'Altura inicial (m)', group: 'rays' });
    params.define({ id: 'rays.zMin', type: 'float', min: -5, max: 0, default: -2.5, label: 'Z mínimo (m)', group: 'rays' });
    params.define({ id: 'rays.zMax', type: 'float', min: -5, max: 0, default: -0.5, label: 'Z máximo (m)', group: 'rays' });
    // Manuel: el rayo tiene que MOVER los palitos, tanto mientras cae como al chocar. Antes
    // apenas se notaba: 3 y 4 son aceleraciones en unidades de grilla, o sea 0.3 y 0.4 m/s²,
    // nada al lado de la turbulencia. Ahora la caída abre un canal a su paso (25 = 2.5 m/s²
    // sobre 1.6 m de radio) y el impacto es un golpe seco (60 = 6 m/s², más que la gravedad).
    // Los techos suben a 200 para que se pueda exagerar desde MIDI.
    // Segunda subida de las fuerzas, y por lo mismo que la primera: Manuel *"no llega a notar que
    // interactúe, que genere un cambio"*. Los números son aceleraciones en unidades de grilla, o
    // sea que 70 son 7 m/s² y 160 son 16 — el doble y medio de la gravedad terrestre, de golpe.
    //
    // Pero el cambio que hace que SE VEA no es la fuerza sola: es que la fuerza alcance para que
    // los palitos pasen el umbral de blanco. Las escenas de rayos tienen `whiteSpeedMin` en 2.5,
    // así que un golpe de este tamaño no solo los mueve — los ENCIENDE. El impacto se lee como un
    // fogonazo blanco que se abre desde el piso, y eso sí se nota desde la última fila.
    params.define({ id: 'rays.repelRadius', type: 'float', min: 0.1, max: 5, default: 2.2, label: 'Radio repulsión (m)', group: 'rays' });
    params.define({ id: 'rays.repelStrength', type: 'float', min: 0, max: 400, default: 70, label: 'Fuerza repulsión', group: 'rays' });
    params.define({ id: 'rays.impactRadius', type: 'float', min: 0.1, max: 6, default: 3.6, label: 'Radio impacto (m)', group: 'rays' });
    params.define({ id: 'rays.impactStrength', type: 'float', min: 0, max: 400, default: 160, label: 'Fuerza impacto', group: 'rays' });
    // La onda duraba 0.3 s fijos y era el otro motivo de que no se notara: 18 frames es menos de
    // lo que tarda el ojo en encontrar dónde pasó algo. Con 0.55 s se ve el anillo ABRIRSE.
    // Alargarla de más la vuelve un empujón blando: la gracia es que sea un golpe que se expande,
    // no una fuerza sostenida.
    params.define({ id: 'rays.impactTime', type: 'float', min: 0.1, max: 1.5, default: 0.55, label: 'Duración del impacto (s)', group: 'rays' });
    params.define({ id: 'rays.bloom', type: 'float', min: 0, max: 4, default: 1, label: 'Bloom', group: 'rays' });
    params.define({ id: 'rays.color', type: 'color', default: '#FFFFFF', label: 'Color', group: 'rays' });
    params.defineAction({ id: 'ray.spawn', label: 'Disparar rayo', group: 'rays', argHint: 'random | left | center | right | número' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    this.ctx = ctx;
    this.rays = [];        // { x, y, z, slot, shock } — shock >= 0 mientras dura la onda
    this.uColor = uniform(new THREE.Color('#ffffff'));
    this.uOpacity = uniform(0);
    this.uBloom = uniform(1);
    this._color = '';
  }

  async init(scene) {
    this.material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    this.material.colorNode = this.uColor;
    this.material.opacityNode = this.uOpacity;
    // El bloom cambia por uniforme: apagarlo no debe compilar otro shader durante un golpe.
    this.material.mrtNode = mrt({ bloomIntensity: this.uBloom });

    // Un solo trazo y una luz por slot. Nunca añadir/quitar luces ni cambiar su `visible`
    // durante el show: cambiar la lista recompila los materiales en medio de los golpes.
    this.ctx.renderer.library.addLight(RayPointLightNode, RayPointLight);
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.bars = [];
    this.lights = [];
    for (let i = 0; i < POOL; i++) {
      const bar = new THREE.Mesh(this.geometry, this.material);
      bar.visible = false;
      bar.renderOrder = 2;
      scene.add(bar);
      this.bars.push(bar);
      const light = new RayPointLight(0xffffff, 0, this.params.get('rays.lightRange'), 2);
      light.castShadow = false;
      scene.add(light);
      this.lights.push(light);
    }

    this.params.onAction('ray.spawn', (arg) => this.spawn(arg));
  }

  spawn(arg) {
    if (!this.params.get('rays.enabled')) return;
    // Si no queda lugar se sacrifica el rayo MÁS VIEJO, no el disparo nuevo. Perder una nota
    // se nota (falta un golpe donde el oído lo espera); acortarle la cola al rayo que ya venía
    // cayendo, no. Antes se descartaba el disparo nuevo y encima en silencio.
    let slot = this._freeSlot();
    if (slot < 0) {
      const viejo = this.rays.shift();
      if (!viejo) return;
      slot = viejo.slot;
      this.ctx.forces.clearRepulsor(slot);
    }

    let x;
    if (arg === undefined || arg === 'random') x = (Math.random() * 2 - 1) * 3.8;
    else if (arg === 'left') x = -2.5 + (Math.random() * 2 - 1) * 0.4;
    else if (arg === 'center') x = 0 + (Math.random() * 2 - 1) * 0.4;
    else if (arg === 'right') x = 2.5 + (Math.random() * 2 - 1) * 0.4;
    else x = Number(arg);
    if (!Number.isFinite(x)) x = 0;

    const zMin = this.params.get('rays.zMin');
    const zMax = this.params.get('rays.zMax');
    const z = zMin + Math.random() * (zMax - zMin);

    this.rays.push({ x, y: this.params.get('rays.startY'), z, slot, shock: -1 });
  }

  _freeSlot() {
    const used = new Set(this.rays.map((r) => r.slot));
    for (let i = 0; i < POOL; i++) if (!used.has(i)) return i;
    return -1;
  }

  update(dt) {
    const p = this.params;
    const forces = this.ctx.forces;

    // Si se sale de una escena de rayos se descarta cualquier cola que quedara en vuelo. Así un
    // golpe recibido antes de la 16 no puede reaparecer al volver a habilitarlos después.
    if (!p.get('rays.enabled')) {
      for (const bar of this.bars) bar.visible = false;
      for (const light of this.lights) light.intensity = 0;
      for (let i = 0; i < POOL; i++) forces.clearRepulsor(i);
      this.rays.length = 0;
      this.uOpacity.value = 0;
      return;
    }

    const opacity = p.get('rays.opacity') * p.get('layer3d.opacity');
    const length = p.get('rays.length');
    const width = p.get('rays.width');
    const speed = p.get('rays.fallSpeed');
    const floorY = length / 2;
    const lightIntensity = p.get('rays.lightIntensity') * opacity;
    const lightRange = p.get('rays.lightRange');

    this.uOpacity.value = opacity;

    const color = p.get('rays.color');
    if (color !== this._color) {
      this.uColor.value.set(color);
      this._color = color;
    }

    this.uBloom.value = p.get('rays.bloom');

    for (const bar of this.bars) bar.visible = false;
    for (const light of this.lights) {
      light.intensity = 0;
      light.distance = lightRange;
      light.color.copy(this.uColor.value);
    }
    for (let i = 0; i < POOL; i++) forces.clearRepulsor(i);

    const survivors = [];
    for (const r of this.rays) {
      if (r.shock >= 0) {
        // Onda expansiva: el radio crece y la fuerza decae hasta apagarse.
        //
        // La fuerza cae al CUADRADO y no lineal, y esa curva es la que hace que se lea como un
        // golpe: con la caída lineal el empujón se reparte parejo en todo el medio segundo y lo
        // que se ve es que la masa se corre despacio. Con (1−u)² el 60 % del envión se entrega en
        // el primer cuarto de la onda, o sea que hay un golpe seco y después una cola.
        const shockTime = Math.max(p.get('rays.impactTime'), 0.05);
        r.shock += dt;
        if (r.shock >= shockTime) continue;
        const u = r.shock / shockTime;
        const caida = (1 - u) * (1 - u);
        // El impacto conserva una cola corta de luz, con la misma envolvente que la onda.
        this._light(r, floorY, lightIntensity * caida);
        // El anillo no arranca en radio 0: con `u` a secas, el primer frame de la onda tiene la
        // fuerza máxima sobre un radio de 2 cm y no toca a nadie. Arrancando en el 25 % del radio
        // el golpe agarra masa desde el primer frame, que es cuando la fuerza vale más.
        forces.setRepulsor(r.slot, r.x, 0, r.z, 0.2, p.get('rays.impactStrength') * caida, p.get('rays.impactRadius') * (0.25 + 0.75 * u));
        survivors.push(r);
        continue;
      }

      r.y -= speed * dt;
      if (r.y <= floorY) {
        r.y = floorY;
        r.shock = 0;
        this._light(r, floorY, lightIntensity);
        this.ctx.debris?.burst(r.x, r.z);
        survivors.push(r);
        continue;
      }

      forces.setRepulsor(r.slot, r.x, r.y - length / 2, r.z, r.y + length / 2, p.get('rays.repelStrength'), p.get('rays.repelRadius'));
      this._light(r, r.y, lightIntensity);

      if (opacity > 0.001) {
        const bar = this.bars[r.slot];
        bar.visible = true;
        bar.position.set(r.x, r.y, r.z);
        bar.scale.set(width, length, width);
      }
      survivors.push(r);
    }
    this.rays = survivors;
  }

  _light(ray, y, intensity) {
    const light = this.lights[ray.slot];
    light.position.set(ray.x, y, ray.z);
    light.intensity = intensity;
  }

  dispose() {
    for (const light of this.lights) { light.intensity = 0; light.removeFromParent(); light.dispose(); }
    for (const bar of this.bars) bar.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
