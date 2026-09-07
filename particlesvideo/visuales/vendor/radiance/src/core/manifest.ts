import type { AudioSnapshot, AudioSource, ParameterSpec, ParameterState, SceneId, SceneManifest, ShowState } from './types';
import { BLOCKS_LOOKS, BLOCKS_PARAMETER_SPECS } from '../scenes/blocks/parameter-specs';
import { FLUID_LOOK_OPTIONS } from '../scenes/fluid/looks';
import { FLUID_PARAMETER_SPECS } from '../scenes/fluid/parameter-specs';

const p = (
  id: string,
  label: string,
  group: ParameterSpec['group'],
  min: number,
  max: number,
  step: number,
  value: number,
  source: AudioSource = 'rms',
  amount = 0,
  smoothing = 0.15,
): ParameterSpec => ({ id, label, group, min, max, step, default: value, audioSource: source, audioAmount: amount, smoothing });

export const SCENES: SceneManifest[] = [
  {
    id: 'fluid', name: '01 · Radiance Fluid', engine: 'webgl',
    description: 'Fluido 2D de partículas y campo Radiance. Escena de apertura.',
    looks: FLUID_LOOK_OPTIONS.map((look) => ({ ...look })),
    parameters: FLUID_PARAMETER_SPECS,
  },
  {
    id: 'depth-sort', name: '02 · Depth Sorter', engine: 'webgpu',
    description: 'Ordenamiento de profundidad en tiempo real con looks Radiance opcionales.',
    looks: [{ id: 'sorter', name: 'Sorter' }, { id: 'radiance', name: 'Radiance' }, { id: 'radiance2', name: 'Radiance 2' }],
    parameters: [
      p('strength', 'Intensidad', 'live', 0, 1.5, 0.01, 0.72, 'rms', 0.3),
      p('speed', 'Velocidad', 'live', 0, 2.5, 0.01, 0.7, 'flux', 0.32),
      p('depth', 'Profundidad', 'live', 0, 2, 0.01, 0.9, 'bass', 0.28),
      p('spread', 'Dispersión', 'live', 0, 2, 0.01, 0.66, 'mid', 0.2),
      p('feedback', 'Persistencia', 'look', 0, 1, 0.01, 0.72, 'rms', 0.14),
      p('contrast', 'Contraste', 'look', 0.5, 2, 0.01, 1.08, 'mid', 0.12),
      p('brightness', 'Brillo', 'look', 0.2, 2, 0.01, 1, 'rms', 0.16),
      p('cameraZoom', 'Zoom', 'camera', 0.4, 2.2, 0.01, 1, 'bass', 0.08),
    ],
  },
  {
    id: 'blocks', name: '03 · Bloques', engine: 'webgl',
    description: 'Cuerpos luminosos con física, impulsos de notas y campo Radiance.',
    looks: BLOCKS_LOOKS.map((look) => ({ ...look })),
    parameters: BLOCKS_PARAMETER_SPECS,
  },
  {
    id: 'voronoi', name: '04 · Voronoi', engine: 'webgl',
    description: 'Campo celular orgánico animado por energía, armonía y ataques.',
    looks: [{ id: 'forest', name: 'Bosque' }, { id: 'spectral', name: 'Espectral' }, { id: 'mono', name: 'Monocromo' }],
    parameters: [
      p('cells', 'Celdas', 'live', 12, 160, 1, 62, 'rms', 0.35),
      p('density', 'Densidad', 'live', 0, 2, 0.01, 0.85, 'bass', 0.22),
      p('turbulence', 'Turbulencia', 'live', 0, 2, 0.01, 0.52, 'flux', 0.34),
      p('tension', 'Tensión', 'live', 0, 2, 0.01, 0.75, 'mid', 0.25),
      p('pulse', 'Pulso', 'live', 0, 2, 0.01, 0.45, 'onset', 0.65, 0.04),
      p('brightness', 'Brillo', 'look', 0.2, 2.2, 0.01, 1, 'rms', 0.18),
      p('contrast', 'Contraste', 'look', 0.5, 2, 0.01, 1.1, 'mid', 0.16),
      p('speed', 'Velocidad', 'physics', 0, 2, 0.01, 0.48, 'treble', 0.22),
    ],
  },
];

export const SCENE_MAP = Object.fromEntries(SCENES.map((scene) => [scene.id, scene])) as Record<SceneId, SceneManifest>;

const parameterState = (spec: ParameterSpec): ParameterState => ({
  manual: spec.default,
  mode: spec.modulatable === false || (spec.kind && spec.kind !== 'number')
    ? 'manual'
    : spec.audioAmount ? 'hybrid' : 'manual',
  source: spec.audioSource ?? 'rms',
  amount: spec.audioAmount ?? 0,
  smoothing: spec.smoothing ?? 0.15,
  invert: false,
});

export const createDefaultShow = (): ShowState => ({
  schemaVersion: 2,
  revision: 1,
  scene: 'fluid',
  blackout: false,
  master: 1,
  quality: 'high',
  automation: {
    enabled: false,
    cycleScenes: true,
    intensity: 1,
    sceneSeconds: 36,
    lookSeconds: 9,
    run: 0,
  },
  scenes: Object.fromEntries(SCENES.map((scene) => [scene.id, {
    look: scene.looks[0].id,
    parameters: Object.fromEntries(scene.parameters.map((spec) => [spec.id, parameterState(spec)])),
  }])) as ShowState['scenes'],
});

/** Reset authored values without replaying stateful one-shot actions. */
export const resetShowConfiguration = (current: ShowState): ShowState => {
  const next = createDefaultShow();
  next.revision = current.revision + 1;
  for (const scene of SCENES) {
    for (const spec of scene.parameters) {
      if (spec.kind !== 'action') continue;
      const previous = current.scenes[scene.id]?.parameters?.[spec.id]?.manual;
      if (typeof previous === 'number' && Number.isFinite(previous)) {
        next.scenes[scene.id].parameters[spec.id].manual = previous;
      }
    }
  }
  return next;
};

export const EMPTY_AUDIO: AudioSnapshot = {
  sequence: 0, timestamp: 0, running: false, rms: 0, bass: 0, mid: 0,
  treble: 0, onset: 0, flux: 0, centroid: 0.5,
  harmonicCenter: 0, harmonicConfidence: 0, harmonicSpread: 0, harmonic: 0,
  notes: [],
};
