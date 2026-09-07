import * as THREE from "three/webgpu";
import {
    Fn,
    texture,
    uv,
    positionWorld,
    vec3,
} from "three/tsl";
import {OBJLoader} from "three/examples/jsm/loaders/OBJLoader";
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import boxObj from './assets/boxSlightlySmooth.obj';

import normalMapFile from './assets/concrete_0016_normal_opengl_1k.png';
import aoMapFile from './assets/concrete_0016_ao_1k.jpg';
import colorMapFile from './assets/concrete_0016_color_1k.jpg';
import roughnessMapFile from './assets/concrete_0016_roughness_1k.jpg';

const textureLoader = new THREE.TextureLoader();
const loadTexture = (file) => {
    return new Promise(resolve => {
        textureLoader.load(file, texture => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            resolve(texture);
        });
    });
}

class BackgroundGeometry {
    object = null;
    constructor() {
    }
    async init() {
        const objectRaw = new OBJLoader().parse(boxObj);
        const geometry = BufferGeometryUtils.mergeVertices(objectRaw.children[0].geometry);
        const positionArray = geometry.attributes.position.array;
        const outerX = 0.550658;
        const outerY = 1.100658;
        const borderScale = 0.4;

        for (let index = 0; index < positionArray.length; index += 3) {
            const x = positionArray[index];
            const y = positionArray[index + 1];

            positionArray[index] = Math.sign(x) * (outerX - (outerX - Math.abs(x)) * borderScale);
            positionArray[index + 1] = y < outerY / 2
                ? y * borderScale
                : outerY - (outerY - y) * borderScale;
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        const uvArray = geometry.attributes.uv.array;
        for (let i=0; i<uvArray.length; i++) {
            uvArray[i] *= 10;
        }


        const normalMap = await loadTexture(normalMapFile);
        const aoMap = await loadTexture(aoMapFile);
        const map = await loadTexture(colorMapFile);
        const roughnessMap = await loadTexture(roughnessMapFile);

        const material = new THREE.MeshStandardNodeMaterial({
            roughness: 0.9,
            metalness:0.0,
            normalScale: new THREE.Vector3(1.0, 1.0),
            normalMap,
            aoMap,
            map,
            roughnessMap,
        });
        /*material.mrtNode = mrt( {
            bloomIntensity: 0
        } );*/
        material.aoNode = Fn(() => {
            return texture(aoMap, uv()).mul(positionWorld.z.div(0.4).mul(0.95).oneMinus());
        })();
        material.colorNode = Fn(() => {
            return vec3(0.01);
        })();


        this.box = new THREE.Mesh(geometry, material);
        this.box.rotation.set(0, Math.PI, 0);
        const depthScale = 3 / 0.451689;
        this.box.position.set(0, 0, 0.201031 * depthScale);
        this.box.scale.set(8 / 1.10132, 3 / 1.10132, depthScale);
        this.box.castShadow = true;
        this.box.receiveShadow = true;

        this.object = new THREE.Object3D();
        this.object.add(this.box);

        const backMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.DoubleSide,
            toneMapped: false,
        });
        this.backPanel = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), backMaterial);
        this.backPanel.position.set(0, 1.5, 2.99);
        this.object.add(this.backPanel);
    }
}
export default BackgroundGeometry;