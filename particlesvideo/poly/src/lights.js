import * as THREE from 'three/webgpu';
import { conf } from './conf';
import { WALL_Z } from './polyMesh';
import { PANEL_WIDTH, PANEL_HEIGHT } from './mediaSource';

const CENTER = new THREE.Vector3(0, PANEL_HEIGHT * 0.5, WALL_Z);

/**
 * Studio rig made of directional lights: no distance falloff means no hot spots
 * on the facets that stand perpendicular to the panel, and the key light gets a
 * tight orthographic shadow camera around the 8x3 frame.
 */
export class Lights {
    constructor() {
        this.object = new THREE.Object3D();

        this.key = new THREE.DirectionalLight(0xfff4e6, conf.keyIntensity);
        this.key.position.set(conf.keyX, conf.keyY, conf.keyZ);
        this.key.target.position.copy(CENTER);
        this.key.castShadow = true;
        this.key.shadow.mapSize.set(2048, 2048);
        this.key.shadow.bias = -0.0008;
        this.key.shadow.normalBias = 0.01;
        const cam = this.key.shadow.camera;
        cam.left = -PANEL_WIDTH * 0.75;
        cam.right = PANEL_WIDTH * 0.75;
        cam.top = PANEL_HEIGHT * 1.2;
        cam.bottom = -PANEL_HEIGHT * 1.2;
        cam.near = 0.1;
        cam.far = 40;
        cam.updateProjectionMatrix();
        this.object.add(this.key);
        this.object.add(this.key.target);

        this.fill = new THREE.DirectionalLight(0xd9e8ff, conf.fillIntensity);
        this.fill.position.set(6.5, 2.5, -5.5);
        this.fill.target.position.copy(CENTER);
        this.object.add(this.fill);
        this.object.add(this.fill.target);

        // grazing light almost parallel to the panel: this is what carves out
        // every facet edge without blowing out the near geometry
        this.rim = new THREE.DirectionalLight(0xffffff, conf.rimIntensity);
        this.rim.position.set(-1.2, -4.0, WALL_Z - 1.2);
        this.rim.target.position.copy(CENTER);
        this.object.add(this.rim);
        this.object.add(this.rim.target);

        this.ambient = new THREE.AmbientLight(0xffffff, conf.ambient);
        this.object.add(this.ambient);
    }

    update() {
        this.key.intensity = conf.keyIntensity;
        this.key.position.set(conf.keyX, conf.keyY, conf.keyZ);
        this.key.castShadow = conf.shadows;
        this.fill.intensity = conf.fillIntensity;
        this.rim.intensity = conf.rimIntensity;
        this.ambient.intensity = conf.ambient;
    }
}
