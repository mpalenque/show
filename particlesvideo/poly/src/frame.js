import * as THREE from 'three/webgpu';
import { conf } from './conf';
import { WALL_Z } from './polyMesh';
import { PANEL_WIDTH, PANEL_HEIGHT } from './mediaSource';

import normalMapFile from './assets/concrete_0016_normal_opengl_1k.png';
import aoMapFile from './assets/concrete_0016_ao_1k.jpg';
import roughnessMapFile from './assets/concrete_0016_roughness_1k.jpg';

const textureLoader = new THREE.TextureLoader();
const loadTexture = (file, repeat) => new Promise((resolve) => {
    textureLoader.load(file, (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeat, repeat);
        resolve(texture);
    });
});

/**
 * The 8x3 "screen": a dark concrete wall the polygons grow out of, plus a
 * border that frames the format exactly like a physical panel.
 */
class Frame {
    constructor() {
        this.object = new THREE.Object3D();
        this.bars = [];
    }

    async init(envTexture = null) {
        const normalMap = await loadTexture(normalMapFile, 6);
        const aoMap = await loadTexture(aoMapFile, 6);
        const roughnessMap = await loadTexture(roughnessMapFile, 6);

        // the frame gets its own (weak) environment so the sky lights the relief
        // without washing out the room around it
        this.material = new THREE.MeshStandardNodeMaterial({
            envMap: envTexture,
            envMapIntensity: conf.envIntensity * 0.55,
            color: new THREE.Color().setScalar(conf.frameBrightness),
            roughness: 0.92,
            metalness: 0.0,
            normalMap,
            aoMap,
            roughnessMap,
            normalScale: new THREE.Vector2(0.8, 0.8),
        });

        const wallMaterial = new THREE.MeshStandardNodeMaterial({
            envMap: envTexture,
            envMapIntensity: conf.envIntensity * 0.18,
            color: new THREE.Color().setScalar(conf.frameBrightness * 0.15),
            roughness: 0.95,
            metalness: 0.0,
            normalMap,
            roughnessMap,
            normalScale: new THREE.Vector2(0.5, 0.5),
        });
        this.wallMaterial = wallMaterial;

        this.wall = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH * 3, PANEL_HEIGHT * 4), wallMaterial);
        this.wall.position.set(0, PANEL_HEIGHT * 0.5, WALL_Z + 0.012);
        this.wall.rotation.y = Math.PI;
        this.wall.receiveShadow = true;
        this.object.add(this.wall);

        const box = new THREE.BoxGeometry(1, 1, 1);
        for (let i = 0; i < 4; i++) {
            const bar = new THREE.Mesh(box, this.material);
            bar.castShadow = true;
            bar.receiveShadow = true;
            this.bars.push(bar);
            this.object.add(bar);
        }
        this.layout();
    }

    depth() {
        const relief = conf.baseOffset + conf.extrude + conf.wobble + 0.04;
        return conf.frameFollowRelief ? Math.max(conf.frameDepth, relief) : conf.frameDepth;
    }

    layout() {
        const w = Math.max(0.001, conf.frameWidth);
        const d = Math.max(0.01, this.depth());
        const hw = PANEL_WIDTH * 0.5;
        const y0 = 0;
        const y1 = PANEL_HEIGHT;
        const zc = WALL_Z - d * 0.5;
        const [left, right, top, bottom] = this.bars;

        left.position.set(-hw - w * 0.5, (y0 + y1) * 0.5, zc);
        left.scale.set(w, PANEL_HEIGHT + w * 2, d);
        right.position.set(hw + w * 0.5, (y0 + y1) * 0.5, zc);
        right.scale.set(w, PANEL_HEIGHT + w * 2, d);
        top.position.set(0, y1 + w * 0.5, zc);
        top.scale.set(PANEL_WIDTH + w * 2, w, d);
        bottom.position.set(0, y0 - w * 0.5, zc);
        bottom.scale.set(PANEL_WIDTH + w * 2, w, d);
    }

    update() {
        if (!this.material) return;
        for (const bar of this.bars) bar.visible = conf.frameVisible;
        const d = this.depth();
        if (this._w !== conf.frameWidth || this._d !== d) {
            this._w = conf.frameWidth;
            this._d = d;
            this.layout();
        }
        this.material.color.setScalar(conf.frameBrightness);
        this.material.envMapIntensity = conf.envIntensity * 0.55;
        this.wallMaterial.color.setScalar(conf.frameBrightness * 0.15);
        this.wallMaterial.envMapIntensity = conf.envIntensity * 0.18;
        for (const bar of this.bars) bar.castShadow = conf.shadows;
        this.wall.receiveShadow = conf.shadows;
    }
}

export default Frame;
