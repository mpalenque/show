import * as THREE from 'three/webgpu';
import { uniform, uv, vec4, mix, float } from 'three/tsl';
import { STAGE } from '../config/stage.js';
import { placeQuad } from './Layer2D.js';

const POOL = 10;

// Barridos por bloque (desde la escena 5): el frente cruza el bloque de arriba abajo
// (o al revés) dejando una cola en gradiente. El sólido (6c) no tiene gradiente.
export class Sweeps {
  static defineParams(params) {
    params.define({ id: 'sweep.enabled', type: 'bool', default: false, label: 'Barridos', group: 'sweep' });
    params.define({ id: 'sweep.opacity', type: 'float', min: 0, max: 1, default: 1, label: 'Opacidad', group: 'sweep' });
    params.define({ id: 'sweep.duration', type: 'float', min: 0.1, max: 6, default: 1.2, label: 'Duración (s)', group: 'sweep' });
    params.define({ id: 'sweep.length', type: 'float', min: 0.1, max: 1.5, default: 0.7, label: 'Largo (frac. alto)', group: 'sweep' });
    // El sólido (6c) NO cruza la pantalla: entra desde un borde, avanza hasta cubrir esta
    // fracción del alto (0.5 = la mitad, que es lo que pidió Manuel), se queda ahí `solidHold`
    // segundos y recién entonces se apaga en el lugar durante `solidFade`. Los barridos con
    // gradiente (6 y 6b) siguen cruzando de lado a lado, que es otra cosa.
    params.define({ id: 'sweep.solidHeight', type: 'float', min: 0.1, max: 1, default: 0.5, label: 'Alto sólido (frac.)', group: 'sweep' });
    params.define({ id: 'sweep.solidDuration', type: 'float', min: 0.1, max: 6, default: 0.3, label: 'Sólido: entrada (s)', group: 'sweep' });
    params.define({ id: 'sweep.solidHold', type: 'float', min: 0, max: 8, default: 0.8, label: 'Sólido: se queda (s)', group: 'sweep' });
    params.define({ id: 'sweep.solidFade', type: 'float', min: 0.05, max: 4, default: 0.5, label: 'Sólido: se apaga (s)', group: 'sweep' });
    params.define({ id: 'sweep.dirBlue', type: 'enum', options: ['down', 'up', 'random'], default: 'down', label: 'Sentido azul', group: 'sweep' });
    params.define({ id: 'sweep.dirWhite', type: 'enum', options: ['down', 'up', 'random'], default: 'up', label: 'Sentido blanco', group: 'sweep' });
    params.define({ id: 'sweep.dirSolid', type: 'enum', options: ['down', 'up', 'random'], default: 'random', label: 'Sentido sólido', group: 'sweep' });
    params.define({ id: 'sweep.blueColor', type: 'color', default: '#0000C8', label: 'Azul', group: 'sweep' });
    params.define({ id: 'sweep.whiteColor', type: 'color', default: '#C8C8C8', label: 'Blanco', group: 'sweep' });
    params.define({ id: 'sweep.avoidRepeat', type: 'bool', default: true, label: 'No repetir bloque', group: 'sweep', sceneReset: false });
    params.defineAction({ id: 'sweep.blue', label: 'Barrido azul (6)', group: 'sweep', argHint: 'random | 1..5' });
    params.defineAction({ id: 'sweep.white', label: 'Barrido blanco (6b)', group: 'sweep', argHint: 'random | 1..5' });
    params.defineAction({ id: 'sweep.solid', label: 'Bloque sólido (6c)', group: 'sweep', argHint: 'random | 1..5' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    this.active = [];
    this.quads = [];
    this.lastBlock = -1;
    this._blue = new THREE.Color();
    this._white = new THREE.Color();
  }

  async init(scene) {
    for (let i = 0; i < POOL; i++) {
      const u = { color: uniform(new THREE.Color(0, 0, 1)), alpha: uniform(0), gradient: uniform(1), flip: uniform(0) };
      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      // uv().y va 0..1 a lo largo del quad; con gradient=0 el barrido es sólido.
      const t = mix(uv().y, float(1).sub(uv().y), u.flip);
      const grad = mix(float(1), t, u.gradient);
      material.colorNode = vec4(u.color, grad.mul(u.alpha));

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.renderOrder = 8;
      mesh.visible = false;
      scene.add(mesh);
      this.quads.push({ mesh, u });
    }

    this.params.onAction('sweep.blue', (arg) => this.spawn('blue', arg));
    this.params.onAction('sweep.white', (arg) => this.spawn('white', arg));
    this.params.onAction('sweep.solid', (arg) => this.spawn('solid', arg));
  }

  spawn(type, arg) {
    if (!this.params.get('sweep.enabled')) return;

    let block;
    if (arg === undefined || arg === 'random') {
      do { block = Math.floor(Math.random() * STAGE.blocks); }
      while (this.params.get('sweep.avoidRepeat') && STAGE.blocks > 1 && block === this.lastBlock);
    } else block = Math.max(0, Math.min(STAGE.blocks - 1, Number(arg) - 1));
    this.lastBlock = block;

    const dirParam = type === 'blue' ? 'sweep.dirBlue' : type === 'white' ? 'sweep.dirWhite' : 'sweep.dirSolid';
    let dir = this.params.get(dirParam);
    if (dir === 'random') dir = Math.random() < 0.5 ? 'down' : 'up';

    // El sólido tiene tres tramos (entra, se queda, se apaga) y los otros uno solo. Se
    // congela acá el tiempo total: si Manuel mueve los params a mitad de un barrido, el que
    // ya está en el aire termina con el timing con el que nació.
    // El medio bloque entra en 0.3 s: desde 2026-09-06 corre al doble de la velocidad que
    // tenía antes, sin cambiar ni el tiempo que queda apoyado ni su apagado.
    const duration = type === 'solid'
      ? this.params.get('sweep.solidDuration')
      : this.params.get('sweep.duration');
    const hold = this.params.get('sweep.solidHold');
    const fade = this.params.get('sweep.solidFade');
    const total = type === 'solid' ? duration + hold + fade : duration;

    this.active.push({ type, block, dir, t: 0, duration, hold, fade, total });
    if (this.active.length > POOL) this.active.shift();
  }

  update(dt) {
    if (!this.params.get('sweep.enabled')) {
      this.active.length = 0;
      for (const { mesh } of this.quads) mesh.visible = false;
      return;
    }

    const opacity = this.params.get('sweep.opacity');
    this._blue.set(this.params.get('sweep.blueColor'));
    this._white.set(this.params.get('sweep.whiteColor'));
    const lengthFrac = this.params.get('sweep.length');
    const solidFrac = this.params.get('sweep.solidHeight');
    const H = STAGE.height;

    for (const s of this.active) s.t += dt;
    this.active = this.active.filter((s) => s.t < s.total);

    for (let i = 0; i < this.quads.length; i++) {
      const s = this.active[i];
      const { mesh, u } = this.quads[i];
      if (!s || opacity <= 0.001) { mesh.visible = false; continue; }

      const x0 = STAGE.blockBounds[s.block];
      const w = STAGE.blockBounds[s.block + 1] - x0;

      let top;
      let alpha = opacity;
      let len;

      if (s.type === 'solid') {
        // Entra desde su borde hasta apoyarse: en reposo ocupa `len` px CONTADOS DESDE EL
        // BORDE POR EL QUE ENTRÓ. No lo cruza: se posa y después se apaga sin moverse.
        len = solidFrac * H;
        const entrando = Math.min(s.t / Math.max(s.duration, 0.001), 1);
        top = s.dir === 'down' ? -len + entrando * len : H - entrando * len;
        const tFade = s.t - s.duration - s.hold;
        if (tFade > 0) alpha = opacity * Math.max(1 - tFade / Math.max(s.fade, 0.001), 0);
      } else {
        len = lengthFrac * H;
        const p = s.t / s.duration;
        // El frente va de fuera de pantalla a fuera de pantalla; la cola queda detrás.
        const front = s.dir === 'down' ? -len + p * (H + len * 2) : H + len - p * (H + len * 2);
        top = s.dir === 'down' ? front - len : front;
      }

      mesh.visible = true;
      u.color.value.copy(s.type === 'blue' || s.type === 'solid' ? this._blue : this._white);
      u.alpha.value = alpha;
      u.gradient.value = s.type === 'solid' ? 0 : 1;
      // El gradiente tiene que apagarse hacia la cola: depende del sentido y del flip de uv.
      u.flip.value = s.dir === 'down' ? 0 : 1;
      placeQuad(mesh, x0, top, w, len);
    }
  }

  dispose() {
    for (const q of this.quads) { q.mesh.geometry.dispose(); q.mesh.material.dispose(); }
  }
}
