import * as THREE from 'three';

export interface SunSystem {
  light: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  visual: THREE.Mesh;
  updatePhaseAngle: (angleDeg: number) => void;
}

export function createSun(scene: THREE.Scene): SunSystem {
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(100, 0, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;

  const shadowCamera = light.shadow.camera as THREE.OrthographicCamera;
  shadowCamera.left = -20;
  shadowCamera.right = 20;
  shadowCamera.top = 20;
  shadowCamera.bottom = -20;
  shadowCamera.near = 1;
  shadowCamera.far = 160;
  shadowCamera.updateProjectionMatrix();

  const ambient = new THREE.AmbientLight(0x222233, 0.15);

  const visual = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xffdd44 }),
  );
  visual.position.set(100, 0, 0);

  scene.add(light);
  scene.add(light.target);
  scene.add(ambient);
  scene.add(visual);

  const updatePhaseAngle = (angleDeg: number): void => {
    const angle = THREE.MathUtils.degToRad(angleDeg);
    light.position.set(Math.cos(angle) * 100, 0, Math.sin(angle) * 100);
  };

  return { light, ambient, visual, updatePhaseAngle };
}
