import * as THREE from "three/webgpu";
import {Fn, vec3,instanceIndex} from "three/tsl";
import {conf} from "../conf";

class PointRenderer {
    mlsMpmSim = null;
    object = null;

    constructor(mlsMpmSim) {
        this.mlsMpmSim = mlsMpmSim;

        this.geometry = new THREE.InstancedBufferGeometry();
        const positionBuffer = new THREE.BufferAttribute(new Float32Array(3), 3, false);
        const material = new THREE.PointsNodeMaterial();
        this.geometry.setAttribute('position', positionBuffer);
        this.object = new THREE.Points(this.geometry, material);
        material.positionNode = Fn(() => {
            return this.mlsMpmSim.particleBuffer.element(instanceIndex).get('position');
        })();

        this.object.frustumCulled = false;

        this.object.position.set(-4,0,0);
        this.object.scale.set(8 / 64, 3 / 64, 3 / 64);
        this.object.castShadow = true;
        this.object.receiveShadow = true;
    }

    update() {
        const { particles } = conf;
        this.geometry.instanceCount = particles;
    }
}
export default PointRenderer;