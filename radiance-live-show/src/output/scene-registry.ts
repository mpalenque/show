import type { QualityLevel, SceneId, VisualScene } from '../core/types';

export const createScene = async (id: SceneId, host: HTMLElement, quality: QualityLevel): Promise<VisualScene> => {
  if (id === 'fluid') {
    const { createFluidScene } = await import('../scenes/fluid');
    return createFluidScene(host, quality);
  }
  if (id === 'depth-sort') {
    const { createDepthScene } = await import('../scenes/depth');
    return createDepthScene(host, quality);
  }
  if (id === 'blocks') {
    const { createBlocksScene } = await import('../scenes/blocks');
    return createBlocksScene(host, quality);
  }
  const { createVoronoiScene } = await import('../scenes/voronoi');
  return createVoronoiScene(host, quality);
};
