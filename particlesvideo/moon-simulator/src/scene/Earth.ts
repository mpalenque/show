import * as THREE from 'three';

const EARTH_TEXTURE_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Blue_Marble_2002.png/1280px-Blue_Marble_2002.png';

export async function createEarth(scene: THREE.Scene): Promise<THREE.Mesh> {
  const geometry = new THREE.SphereGeometry(2, 64, 64);
  const textureLoader = new THREE.TextureLoader();

  let material: THREE.MeshStandardMaterial;

  try {
    const texture = await textureLoader.loadAsync(EARTH_TEXTURE_URL);
    texture.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      metalness: 0,
    });
  } catch {
    material = new THREE.MeshStandardMaterial({
      color: 0x2244aa,
      roughness: 0.7,
      metalness: 0,
    });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.rotation.z = THREE.MathUtils.degToRad(23.4);

  scene.add(mesh);
  return mesh;
}

export function updateEarth(mesh: THREE.Mesh, delta: number): void {
  mesh.rotation.y += 0.1 * delta;
}
