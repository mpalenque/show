import * as THREE from 'three';

/**
 * Textures from NASA's CGI Moon Kit (SVS 4720), processed to web assets:
 * colour is the LROC WAC mosaic; the normal map is derived from LOLA elevation
 * (see scripts/make_textures.py). Relief is a normal map rather than
 * displacement because at this scale the Moon's ±10 km of terrain is 0.6% of its
 * radius — invisible on the silhouette, but very visible as shading near the
 * terminator, which is exactly what a normal map delivers.
 */
const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;

export const MOON_COLOR_MAP_URL = `${TEXTURE_BASE}moon_color_4k.jpg`;
export const MOON_NORMAL_MAP_URL = `${TEXTURE_BASE}moon_normal_4k.png`;
/** Used only if the local NASA assets are missing. */
export const MOON_FALLBACK_MAP_URL = 'https://threejs.org/examples/textures/planets/moon_1024.jpg';

/** Kept for the original UI modules that still reference the old name. */
export const MOON_TEXTURE_URL = MOON_COLOR_MAP_URL;

export const MOON_DEFAULT_NORMAL_SCALE = 1.6;

export async function createMoon(scene: THREE.Scene): Promise<THREE.Mesh> {
  const geometry = new THREE.SphereGeometry(0.55, 128, 128);
  const textureLoader = new THREE.TextureLoader();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
  });

  const loadColor = async (): Promise<THREE.Texture | null> => {
    for (const url of [MOON_COLOR_MAP_URL, MOON_FALLBACK_MAP_URL]) {
      try {
        const texture = await textureLoader.loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        return texture;
      } catch {
        continue;
      }
    }
    return null;
  };

  const loadNormal = async (): Promise<THREE.Texture | null> => {
    try {
      const texture = await textureLoader.loadAsync(MOON_NORMAL_MAP_URL);
      texture.anisotropy = 8;
      return texture;
    } catch {
      return null;
    }
  };

  const [colorMap, normalMap] = await Promise.all([loadColor(), loadNormal()]);

  if (colorMap) {
    material.map = colorMap;
  } else {
    material.color.setHex(0x888888);
  }

  if (normalMap) {
    material.normalMap = normalMap;
    material.normalScale.set(MOON_DEFAULT_NORMAL_SCALE, MOON_DEFAULT_NORMAL_SCALE);
  }

  material.needsUpdate = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}
