import type { QualityLevel, VisualScene } from '../../core/types';
import { FluidScene } from './FluidScene';

export { FluidScene } from './FluidScene';
export {
  ReactiveFluidDirector,
  REACTIVE_FLUID_MOMENTS,
  type ReactiveFluidInteraction,
  type ReactiveFluidMusic,
  type ReactiveFluidOutput,
} from './ReactiveFluidDirector';
export { applyFluidLookTrim, FLUID_LOOKS, FLUID_LOOK_OPTIONS, readFluidLook, type FluidLook } from './looks';
export {
  FLUID_INTERACTION_MODES,
  FLUID_MATERIAL_OPTIONS,
  FLUID_PARAMETER_IDS,
  FLUID_PARAMETER_SPECS,
  ORIGINAL_FLUID_DEFAULTS,
  type FluidInteractionMode,
} from './parameter-specs';

export async function createFluidScene(
  host: HTMLElement,
  quality: QualityLevel,
): Promise<VisualScene> {
  const scene = new FluidScene();
  try {
    await scene.init(host, quality);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
}

export default createFluidScene;
