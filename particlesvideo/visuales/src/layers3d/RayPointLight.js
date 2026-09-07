import { PointLight, PointLightNode } from 'three/webgpu';
import { If, uniform } from 'three/tsl';

// Un PointLight por slot, permanente y sin shadow maps. El tipo propio permite omitir
// el sombreado PBR de luces apagadas o fuera de alcance sin cambiar el grafo de luces.
export class RayPointLight extends PointLight {}

export class RayPointLightNode extends PointLightNode {
  static get type() { return 'RayPointLightNode'; }

  constructor(light) {
    super(light);
    this.activeNode = uniform(0);
  }

  update(frame) {
    super.update(frame);
    this.activeNode.value = this.light.intensity > 0 ? 1 : 0;
  }

  setup(builder) {
    If(this.activeNode.greaterThan(0), () => {
      const delta = this.getLightVector(builder).toVar();
      If(delta.dot(delta).lessThan(this.cutoffDistanceNode.mul(this.cutoffDistanceNode)), () => {
        super.setup(builder);
      });
    });
  }
}
