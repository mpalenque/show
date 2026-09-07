import * as THREE from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import { STAGE } from '../config/stage.js';
import { placeQuad } from './Layer2D.js';

// Marco rojo del borde de pantalla (escena 2+). Cuatro quads, no shader:
// así el grosor es exacto en píxeles sin depender de la orientación de screenCoordinate.
export class Frame {
  static defineParams(params) {
    params.define({ id: 'frame.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Marco', group: 'frame' });
    params.define({ id: 'frame.thickness', type: 'int', min: 1, max: 60, default: 10, label: 'Grosor (px)', group: 'frame' });
    params.define({ id: 'frame.color', type: 'color', default: '#7A0000', label: 'Color', group: 'frame' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    this.uColor = uniform(new THREE.Color('#7A0000'));
    this.uOpacity = uniform(0);
    this._color = '';
    this._thickness = -1;
  }

  async init(scene) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    material.colorNode = vec4(this.uColor, this.uOpacity);
    this.material = material;

    this.bars = [];
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.renderOrder = 10;
      this.bars.push(mesh);
      scene.add(mesh);
    }
    this.group = this.bars;
  }

  update() {
    this.uOpacity.value = this.params.get('frame.opacity');
    const visible = this.uOpacity.value > 0.001;
    for (const b of this.bars) b.visible = visible;
    if (!visible) return;

    const color = this.params.get('frame.color');
    if (color !== this._color) { this.uColor.value.set(color); this._color = color; }

    const t = this.params.get('frame.thickness');
    if (t !== this._thickness) {
      this._thickness = t;
      const { width: W, height: H } = STAGE;
      placeQuad(this.bars[0], 0, 0, W, t);              // arriba
      placeQuad(this.bars[1], 0, H - t, W, t);          // abajo
      placeQuad(this.bars[2], 0, t, t, H - t * 2);      // izquierda
      placeQuad(this.bars[3], W - t, t, t, H - t * 2);  // derecha
    }
  }

  dispose() {
    for (const b of this.bars) b.geometry.dispose();
    this.material.dispose();
  }
}
