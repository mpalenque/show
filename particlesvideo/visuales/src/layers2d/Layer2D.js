import * as THREE from 'three/webgpu';
import { STAGE } from '../config/stage.js';
import { WarningPlate } from './WarningPlate.js';
import { Frame } from './Frame.js';
import { MovingLine } from './MovingLine.js';
import { GridBlocks } from './GridBlocks.js';
import { Sweeps } from './Sweeps.js';

// Escena ortográfica en píxeles: origen arriba-izquierda, x a la derecha, y hacia abajo.
export class Layer2D {
  static ELEMENTS = [WarningPlate, GridBlocks, Sweeps, Frame, MovingLine];

  static defineParams(params) {
    for (const El of Layer2D.ELEMENTS) El.defineParams(params);
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.scene.background = null;   // alpha 0 donde no hay nada → se compone encima del 3D
    this.camera = new THREE.OrthographicCamera(0, STAGE.width, 0, STAGE.height, -10, 10);
    this.camera.position.z = 5;
    this.elements = [];
  }

  async init() {
    let order = 0;
    for (const El of Layer2D.ELEMENTS) {
      const el = new El(this.ctx);
      el.renderOrder = order++;
      await el.init(this.scene);
      this.elements.push(el);
    }
  }

  update(dt, t) {
    for (const el of this.elements) el.update(dt, t);
  }

  dispose() {
    for (const el of this.elements) el.dispose?.();
  }
}

// Helper: posiciona un quad de PlaneGeometry(1,1) sobre el rect [x, x+w] × [y, y+h] en píxeles.
export function placeQuad(mesh, x, y, w, h) {
  mesh.position.set(x + w / 2, y + h / 2, 0);
  mesh.scale.set(w, h, 1);
}
