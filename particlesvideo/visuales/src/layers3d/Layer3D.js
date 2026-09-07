import * as THREE from 'three/webgpu';
import { STAGE } from '../config/stage.js';
import { OffAxisCamera } from '../render/OffAxisCamera.js';
import { Floor } from './Floor.js';
import { Lights } from './Lights.js';
import { BoxWire } from './BoxWire.js';
import { RedBlock } from './RedBlock.js';
import { Orb } from './Orb.js';
import { Rays } from './Rays.js';
import { Debris } from './Debris.js';
import { MlsMpmSimulator } from './particles/MlsMpmSimulator.js';
import { StickRenderer } from './particles/StickRenderer.js';

export class Layer3D {
  static ELEMENTS = [Lights, Floor, BoxWire, RedBlock, Orb, Debris, Rays];

  static defineParams(params) {
    params.define({ id: 'layer3d.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Capa 3D', group: 'layer3d' });
    params.define({ id: 'camera.eyeX', type: 'float', min: -4, max: 4, default: STAGE.camera.eyeX, label: 'Ojo X (m)', group: 'camera', sceneReset: false });
    params.define({ id: 'camera.eyeY', type: 'float', min: 0, max: 3, default: STAGE.camera.eyeY, label: 'Ojo Y (m)', group: 'camera', sceneReset: false });
    params.define({ id: 'camera.eyeZ', type: 'float', min: 1, max: 10, default: STAGE.camera.eyeZ, label: 'Ojo Z (m)', group: 'camera', sceneReset: false });
    for (const El of Layer3D.ELEMENTS) El.defineParams(params);
    MlsMpmSimulator.defineParams(params);
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.params = ctx.params;
    this.scene = new THREE.Scene();
    this.camera = new OffAxisCamera({
      widthM: STAGE.physical.widthM, heightM: STAGE.physical.heightM, bottomM: STAGE.physical.bottomM,
      near: STAGE.camera.near, far: STAGE.camera.far,
    });
    this.camera.setEye(STAGE.camera.eyeX, STAGE.camera.eyeY, STAGE.camera.eyeZ);
    this.elements = [];
    this._eye = { x: NaN, y: NaN, z: NaN };
  }

  async init() {
    // El simulador va primero: los elementos publican atractores y repulsores en ctx.forces.
    this.sim = new MlsMpmSimulator(this.ctx);
    this.ctx.forces = this.sim.forces;
    await this.sim.init();

    for (const El of Layer3D.ELEMENTS) {
      const el = new El(this.ctx);
      await el.init(this.scene);
      this.elements.push(el);
    }

    this.sticks = new StickRenderer(this.ctx, this.sim);
    await this.sticks.init(this.scene);
  }

  update(dt, t) {
    const x = this.params.get('camera.eyeX');
    const y = this.params.get('camera.eyeY');
    const z = this.params.get('camera.eyeZ');
    if (x !== this._eye.x || y !== this._eye.y || z !== this._eye.z) {
      this.camera.setEye(x, y, z);
      this._eye.x = x; this._eye.y = y; this._eye.z = z;
    }
    for (const el of this.elements) el.update(dt, t);
    this.sticks.update(dt, t);
  }

  dispose() {
    for (const el of this.elements) el.dispose?.();
  }
}
