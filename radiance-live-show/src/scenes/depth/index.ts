import type { QualityLevel, VisualScene } from '../../core/types';
import { DepthSortScene } from './DepthSortScene';

export const createDepthScene = async (
  host: HTMLElement,
  quality: QualityLevel,
): Promise<VisualScene> => {
  const scene = new DepthSortScene();
  try {
    await scene.init(host, quality);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
};

export { DepthSortScene } from './DepthSortScene';
