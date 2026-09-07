import * as THREE from 'three/webgpu';

// La pantalla es una ventana: el frustum pasa exactamente por sus cuatro esquinas.
export class OffAxisCamera extends THREE.PerspectiveCamera {
  constructor(stage) {
    super(60, 8 / 3, stage.near ?? 0.05, stage.far ?? 60);
    this.stage = stage;                    // { widthM, heightM, bottomM }
    this.eye = new THREE.Vector3(0, 1, 4); // se actualiza desde Params camera.*
  }

  // El renderer llama a esto cuando cambia coordinateSystem; por eso se sobreescribe
  // en vez de setear projectionMatrix "a mano" (si no, lo pisa).
  updateProjectionMatrix() {
    if (!this.stage) return;               // durante super() todavía no existe
    const { widthM, heightM, bottomM } = this.stage;
    const d = this.eye.z;                   // distancia ojo → plano de pantalla (z = 0)
    const s = this.near / d;
    const left   = (-widthM / 2 - this.eye.x) * s;
    const right  = ( widthM / 2 - this.eye.x) * s;
    const bottom = ( bottomM     - this.eye.y) * s;
    const top    = ( bottomM + heightM - this.eye.y) * s;
    this.projectionMatrix.makePerspective(left, right, top, bottom, this.near, this.far, this.coordinateSystem);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }

  setEye(x, y, z) {
    this.eye.set(x, y, z);
    this.position.copy(this.eye);
    this.rotation.set(0, 0, 0);
    this.updateProjectionMatrix();
    this.updateMatrixWorld(true);
  }
}
