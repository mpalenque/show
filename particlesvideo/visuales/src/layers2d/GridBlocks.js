import * as THREE from 'three/webgpu';
import { uniform, uv, float, vec4, Fn, floor, mod } from 'three/tsl';
import { STAGE } from '../config/stage.js';
import { placeQuad } from './Layer2D.js';

// Una grilla por bloque (5 columnas). Las coordenadas de píxel salen de uv() × tamaño del quad,
// no de screenCoordinate: el quad mapea 1:1 a píxeles, así que es exacto y no depende
// de la orientación de la pantalla.
export class GridBlocks {
  static defineParams(params) {
    params.define({ id: 'grid.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Grillas', group: 'grid' });
    params.define({ id: 'grid.lineWidth', type: 'int', min: 1, max: 8, default: 1, label: 'Grosor línea (px)', group: 'grid' });
    params.define({ id: 'grid.brightness', type: 'float', min: 0, max: 1, default: 0.6, label: 'Brillo', group: 'grid' });
    params.define({ id: 'grid.cellW', type: 'int', min: 8, max: 1008, default: 96, label: 'Celda ancho (px)', group: 'grid' });
    params.define({ id: 'grid.cellH', type: 'int', min: 8, max: 1008, default: 96, label: 'Celda alto (px)', group: 'grid' });
    params.define({ id: 'grid.coarse', type: 'bool', default: false, label: 'Celdas gruesas', group: 'grid' });
    params.define({ id: 'grid.scrollSpeed', type: 'float', min: 0, max: 400, default: 12, label: 'Scroll (px/s)', group: 'grid' });
    params.define({ id: 'grid.pixelSnap', type: 'bool', default: true, label: 'Ajuste a píxel', group: 'grid', sceneReset: false });
    params.define({ id: 'grid.fadeTime', type: 'float', min: 0, max: 2, default: 0.15, label: 'Fade grilla gruesa (s)', group: 'grid', sceneReset: false });

    // Cuánto dura el corrimiento cuando llega el disparo, y cuánto se corre de una vez.
    // Manuel: "no tienen que ser así saltando, sino suave, como que hacen ese offset".
    // Con 0 s vuelve al salto de antes.
    params.define({ id: 'grid.offsetTime', type: 'float', min: 0, max: 3, default: 0.35, label: 'Corrimiento: duración (s)', group: 'grid' });
    params.define({ id: 'grid.offsetStep', type: 'float', min: 1, max: 1008, default: 42, label: 'Corrimiento: paso (px)', group: 'grid' });
    params.define({ id: 'grid.offsetEase', type: 'enum', options: ['smooth', 'out', 'linear'], default: 'smooth', label: 'Corrimiento: curva', group: 'grid', sceneReset: false });
    params.define({ id: 'grid.offsetAxis', type: 'enum', options: ['vertical', 'horizontal', 'ambos', 'random'], default: 'vertical', label: 'Corrimiento: eje', group: 'grid' });

    for (let n = 1; n <= STAGE.blocks; n++) {
      params.define({ id: `grid.b${n}.enabled`, type: 'bool', default: false, label: `Bloque ${n}`, group: 'grid' });
      params.define({ id: `grid.b${n}.dir`, type: 'int', min: -1, max: 1, default: 1, label: `Bloque ${n} sentido`, group: 'grid' });
      params.define({ id: `grid.b${n}.speedMul`, type: 'float', min: 0, max: 3, default: 1, label: `Bloque ${n} vel.`, group: 'grid' });
      params.define({ id: `grid.b${n}.offsetY`, type: 'float', min: 0, max: 1008, default: 0, label: `Bloque ${n} offset Y`, group: 'grid' });
      // El offset X es aparte del scroll continuo: el scroll siempre corre, y esto es el
      // corrimiento que se dispara. Se suman en el shader.
      params.define({ id: `grid.b${n}.offsetX`, type: 'float', min: -1008, max: 1008, default: 0, label: `Bloque ${n} offset X`, group: 'grid' });
      params.defineAction({ id: `grid.b${n}.toggle`, label: `Bloque ${n} on/off`, group: 'grid' });
      params.defineAction({ id: `grid.b${n}.flip`, label: `Bloque ${n} invertir`, group: 'grid' });
      params.defineAction({ id: `grid.b${n}.nudge`, label: `Bloque ${n} corrimiento`, group: 'grid', argHint: 'v | h | ambos | random | px' });
    }
    params.defineAction({ id: 'grid.toggleAll', label: 'Todas on/off', group: 'grid' });
    params.defineAction({ id: 'grid.visibilityRandom', label: 'Cambiar bloques visibles al azar', group: 'grid' });
    params.defineAction({ id: 'grid.nudge', label: 'Corrimiento suave (todas)', group: 'grid', argHint: 'v | h | ambos | random | px' });
    params.defineAction({ id: 'grid.nudgeRandom', label: 'Corrimiento aleatorio por bloques', group: 'grid' });
    params.defineAction({ id: 'grid.randomize', label: 'Offsets al azar (suave)', group: 'grid' });
    params.defineAction({ id: 'grid.offsetReset', label: 'Volver los offsets a cero', group: 'grid' });
    // Descubrimiento opcional de arriba hacia abajo, sólo cuando se dispara explícitamente.
    params.defineAction({ id: 'grid.reveal', label: 'Cargar grilla', group: 'grid', argHint: 'duración en s (opcional)' });
    params.defineAction({ id: 'grid.reveal.cancel', label: 'Completar carga de grilla', group: 'grid' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    this.blocks = [];
    this.reveal = null;
  }

  async init(scene) {
    for (let n = 1; n <= STAGE.blocks; n++) {
      const x0 = STAGE.blockBounds[n - 1];
      const x1 = STAGE.blockBounds[n];
      const w = x1 - x0;

      const u = {
        cellW: uniform(96), cellH: uniform(96), lineWidth: uniform(1),
        offsetX: uniform(0), offsetY: uniform(0), alpha: uniform(0), reveal: uniform(1),
        size: uniform(new THREE.Vector2(w, STAGE.height)),
      };

      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      material.colorNode = Fn(() => {
        const px = uv().x.mul(u.size.x);
        const py = uv().y.mul(u.size.y);
        const onX = floor(mod(px.sub(u.offsetX), u.cellW)).lessThan(u.lineWidth);
        const onY = floor(mod(py.sub(u.offsetY), u.cellH)).lessThan(u.lineWidth);
        const on = float(onX.or(onY));
        const loaded = float(py.lessThan(u.reveal.mul(u.size.y)));
        return vec4(1, 1, 1, on.mul(loaded).mul(u.alpha));
      })();

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.renderOrder = 5;
      placeQuad(mesh, x0, 0, w, STAGE.height);
      scene.add(mesh);

      this.blocks.push({ n, mesh, u, w, scrollX: 0, fade: 0 });

      this.params.onAction(`grid.b${n}.toggle`, () => this.params.set(`grid.b${n}.enabled`, !this.params.target(`grid.b${n}.enabled`)));
      this.params.onAction(`grid.b${n}.flip`, () => this.params.set(`grid.b${n}.dir`, -this.params.target(`grid.b${n}.dir`)));
      this.params.onAction(`grid.b${n}.nudge`, (arg) => this._nudge([this.blocks[n - 1]], arg));
    }

    this.params.onAction('grid.toggleAll', () => {
      const anyOn = this.blocks.some((b) => this.params.target(`grid.b${b.n}.enabled`));
      for (const b of this.blocks) this.params.set(`grid.b${b.n}.enabled`, !anyOn);
    });
    this.params.onAction('grid.visibilityRandom', () => this._randomizeVisibility());
    this.params.onAction('grid.nudge', (arg) => this._nudge(this.blocks, arg));
    this.params.onAction('grid.nudgeRandom', () => this._nudgeRandom());
    this.params.onAction('grid.randomize', () => {
      const secs = this.params.get('grid.offsetTime');
      const ease = this.params.get('grid.offsetEase');
      for (const b of this.blocks) {
        this.params.tween(`grid.b${b.n}.offsetY`, Math.random() * STAGE.height, secs, ease);
        this.params.tween(`grid.b${b.n}.offsetX`, (Math.random() * 2 - 1) * STAGE.height, secs, ease);
      }
    });
    this.params.onAction('grid.offsetReset', () => {
      const secs = this.params.get('grid.offsetTime');
      const ease = this.params.get('grid.offsetEase');
      for (const b of this.blocks) {
        this.params.tween(`grid.b${b.n}.offsetY`, 0, secs, ease);
        this.params.tween(`grid.b${b.n}.offsetX`, 0, secs, ease);
      }
    });
    this.params.onAction('grid.reveal', (seconds) => this._startReveal(seconds));
    this.params.onAction('grid.reveal.cancel', () => this._cancelReveal());
  }

  // El kick arma una combinación nueva: siempre queda por lo menos un bloque prendido y uno
  // apagado, y nunca repite exactamente el dibujo anterior. Las grillas finas cambian de golpe
  // con la nota; la grilla gruesa conserva su fade configurado.
  _randomizeVisibility() {
    const order = this.blocks.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const count = 1 + Math.floor(Math.random() * Math.max(order.length - 1, 1));
    const next = this.blocks.map(() => false);
    for (let i = 0; i < count; i++) next[order[i]] = true;

    const same = next.every((enabled, i) => enabled === this.params.target(`grid.b${i + 1}.enabled`));
    if (same && order.length > 1) {
      const on = next.findIndex(Boolean);
      const off = next.findIndex((enabled) => !enabled);
      next[on] = false;
      next[off] = true;
    }

    for (let i = 0; i < next.length; i++) this.params.set(`grid.b${i + 1}.enabled`, next[i]);
  }

  // Cada golpe elige solo una parte de los bloques que están visibles y, para cada elegido,
  // decide por separado entre X e Y. Nunca mueve todos juntos: así la pantalla no se comporta
  // como una única cortina y notas distintas del mismo canal producen dibujos distintos.
  _nudgeRandom() {
    const enabled = this.blocks.filter((b) => this.params.target(`grid.b${b.n}.enabled`));
    const candidates = enabled.length ? enabled.slice() : this.blocks.slice();
    const maxCount = candidates.length > 1 ? candidates.length - 1 : 1;
    const count = 1 + Math.floor(Math.random() * maxCount);

    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      this._nudge([candidates[i]], Math.random() < 0.5 ? 'horizontal' : 'vertical');
    }
  }

  _startReveal(seconds) {
    const duration = Number(seconds);
    this.reveal = { elapsed: 0, duration: Number.isFinite(duration) ? Math.max(duration, 0.001) : 1.8 };
    for (const b of this.blocks) b.u.reveal.value = 0;
  }

  _cancelReveal() {
    this.reveal = null;
    for (const b of this.blocks) b.u.reveal.value = 1;
  }

  // Un corrimiento disparado: no salta, se desliza. Cada bloque se corre para su propio lado
  // (según su `dir`) para que el disparo no lea como una sola cortina que se mueve entera.
  // `arg`: 'v' | 'h' | 'ambos' | 'random' (eje) o un número de píxeles (usa el eje del param).
  _nudge(blocks, arg) {
    const secs = this.params.get('grid.offsetTime');
    const ease = this.params.get('grid.offsetEase');
    const stepArg = Number(arg);
    const step = Number.isFinite(stepArg) ? stepArg : this.params.get('grid.offsetStep');

    let axis = typeof arg === 'string' ? arg.toLowerCase() : this.params.get('grid.offsetAxis');
    if (axis === 'v') axis = 'vertical';
    if (axis === 'h') axis = 'horizontal';
    if (!['vertical', 'horizontal', 'ambos', 'random'].includes(axis)) axis = this.params.get('grid.offsetAxis');

    const coarse = this.params.get('grid.coarse');

    for (const b of blocks) {
      const eje = axis === 'random' ? (Math.random() < 0.5 ? 'vertical' : 'horizontal') : axis;
      const sentido = this.params.target(`grid.b${b.n}.dir`) || 1;
      // Celda que está usando ESTE bloque: en modo grueso es el ancho del bloque.
      const cellH = coarse ? b.w : this.params.get('grid.cellH');
      const cellW = coarse ? b.w : this.params.get('grid.cellW');

      if (eje === 'vertical' || eje === 'ambos') this._slide(`grid.b${b.n}.offsetY`, cellH, sentido * step, secs, ease);
      if (eje === 'horizontal' || eje === 'ambos') this._slide(`grid.b${b.n}.offsetX`, cellW, sentido * step, secs, ease);
    }
  }

  // Corre un offset `delta` px con animación. Antes de arrancar reduce el valor actual módulo
  // la celda: el shader ya hace `mod`, así que reducirlo NO se ve, pero es lo que evita que
  // después de unos cuantos disparos el param se clave en el tope de su rango y el corrimiento
  // deje de responder. Reducir en el momento del disparo y no al final del tween también hace
  // que la animación sea siempre corta y hacia adelante, sin volver para atrás al envolver.
  _slide(id, cell, delta, secs, ease) {
    // OJO: `get` (el valor que se está viendo ahora), no `target` (a dónde iba el tween
    // anterior). Con `target`, un segundo disparo antes de que termine el primero saltaba de
    // golpe al destino viejo y recién ahí seguía animando — justo el salto que hay que evitar.
    // Con `get`, el disparo nuevo arranca de donde está y la grilla nunca se teletransporta.
    const actual = this.params.get(id);
    const base = cell > 0 ? actual - Math.floor(actual / cell) * cell : actual;
    // Para un paso negativo desde cero, la misma posición visual se expresa como `cell` antes
    // de restar. Si no, el rango del offset Y lo clampea a cero y esa nota no mueve nada.
    const start = cell > 0 && base + delta < 0 ? base + cell : base;
    if (start !== actual) this.params.set(id, start, { immediate: true });
    this.params.tween(id, start + delta, secs, ease);
  }

  update(dt) {
    const coarse = this.params.get('grid.coarse');
    // Las grillas finas entran y salen por corte, incluso si una transición de escena sigue
    // interpolando la opacidad. Los offsets conservan sus propios tweens de corrimiento.
    const opacity = coarse ? this.params.get('grid.opacity') : this.params.target('grid.opacity');
    const lineWidth = this.params.get('grid.lineWidth');
    const brightness = this.params.get('grid.brightness');
    const cellW = this.params.get('grid.cellW');
    const cellH = this.params.get('grid.cellH');
    const speed = this.params.get('grid.scrollSpeed');
    const snap = this.params.get('grid.pixelSnap');
    const fadeTime = Math.max(this.params.get('grid.fadeTime'), 0.001);

    if (this.reveal) {
      this.reveal.elapsed += dt;
      const amount = Math.min(this.reveal.elapsed / this.reveal.duration, 1);
      for (const b of this.blocks) b.u.reveal.value = amount;
      if (amount >= 1) this.reveal = null;
    }

    for (const b of this.blocks) {
      const enabled = this.params.get(`grid.b${b.n}.enabled`);
      const target = enabled ? 1 : 0;
      if (coarse) b.fade += (target - b.fade) * (1 - Math.exp(-dt / fadeTime));
      else b.fade = target;

      const alpha = b.fade * brightness * opacity;
      b.u.alpha.value = alpha;
      b.mesh.visible = alpha > 0.002;
      if (!b.mesh.visible) continue;

      b.scrollX += this.params.get(`grid.b${b.n}.dir`) * speed * this.params.get(`grid.b${b.n}.speedMul`) * dt;

      // En modo grueso la celda es un cuadrado del ancho del bloque → escena 3.
      b.u.cellW.value = coarse ? b.w : cellW;
      b.u.cellH.value = coarse ? b.w : cellH;
      b.u.lineWidth.value = lineWidth;
      // Scroll continuo + corrimiento disparado, en el mismo uniform.
      const offX = b.scrollX + this.params.get(`grid.b${b.n}.offsetX`);
      b.u.offsetX.value = snap ? Math.round(offX) : offX;
      const offY = this.params.get(`grid.b${b.n}.offsetY`);
      b.u.offsetY.value = snap ? Math.round(offY) : offY;
    }
  }

  dispose() {
    for (const b of this.blocks) { b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
  }
}
