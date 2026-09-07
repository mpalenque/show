import * as THREE from "three/webgpu";
import { conf } from "./conf";

class SourceMediaPlane {
    object = null;
    material = null;

    constructor() {
        this.material = this.createMaterial();
        this.object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
        this.object.position.set(0, 1.5, 1.55);
        this.object.rotation.y = Math.PI;
        this.object.renderOrder = -1;
        this.object.visible = false;
    }

    createMaterial(map = null) {
        return new THREE.MeshBasicMaterial({
            map,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
        });
    }

    setSource(imageUploadManager) {
        const imageData = imageUploadManager.getImageData();
        const texture = imageUploadManager.getTexture();
        if (!imageData || !texture) return;

        texture.colorSpace = THREE.SRGBColorSpace;
        this.material.dispose();
        this.material = this.createMaterial(texture);
        this.object.material = this.material;
        this.update(imageData);
    }

    clear() {
        this.object.visible = false;
        this.material.map = null;
        this.material.needsUpdate = true;
    }

    update(imageData) {
        if (!imageData || !this.material.map) return;

        this.object.scale.set(8 * conf.imageScale, 3 * conf.imageScale, 1);
        this.material.opacity = conf.sourceImageOpacity;
        this.object.visible = conf.showSourceImage;
    }
}

export default SourceMediaPlane;
