import { createDefaultShow, SCENES } from './manifest';
import type { AudioSource, ModulationMode, ParameterState, SceneId, ShowAutomationState, ShowState } from './types';

const KEY = 'radiance-live-show-state-v2';
const LEGACY_KEY = 'radiance-live-show-state-v1';
const AUDIO_SOURCES = new Set<AudioSource>(['rms', 'bass', 'mid', 'treble', 'onset', 'flux', 'centroid', 'harmonic']);
const MODULATION_MODES = new Set<ModulationMode>(['manual', 'audio', 'hybrid']);
const FULL_CONTROL_MARKERS: Partial<Record<SceneId, string>> = {
  fluid: 'emissiveMaterial',
  blocks: 'testNote',
};

const finiteOr = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const sanitizeParameter = (
  saved: Partial<ParameterState> | undefined,
  fallback: ParameterState,
  spec: (typeof SCENES)[number]['parameters'][number],
): ParameterState => ({
  manual: (() => {
    const value = clamp(finiteOr(saved?.manual, fallback.manual), spec.min, spec.max);
    return spec.kind && spec.kind !== 'number' ? Math.round(value) : value;
  })(),
  mode: spec.modulatable === false || (spec.kind && spec.kind !== 'number')
    ? 'manual'
    : MODULATION_MODES.has(saved?.mode as ModulationMode) ? saved!.mode as ModulationMode : fallback.mode,
  source: AUDIO_SOURCES.has(saved?.source as AudioSource) ? saved!.source as AudioSource : fallback.source,
  amount: clamp(finiteOr(saved?.amount, fallback.amount), -1, 1),
  smoothing: clamp(finiteOr(saved?.smoothing, fallback.smoothing), 0, 2),
  invert: typeof saved?.invert === 'boolean' ? saved.invert : fallback.invert,
});

export const loadShow = (): ShowState => {
  const fallback = createDefaultShow();
  try {
    type StoredShow = Omit<Partial<ShowState>, 'schemaVersion' | 'automation'> & {
      schemaVersion?: number;
      automation?: Partial<ShowAutomationState>;
    };
    let parsed: StoredShow | null = null;
    for (const serialized of [localStorage.getItem(KEY), localStorage.getItem(LEGACY_KEY)]) {
      if (!serialized) continue;
      try {
        const candidate = JSON.parse(serialized) as StoredShow;
        if ((candidate.schemaVersion === 1 || candidate.schemaVersion === 2) && candidate.scenes) {
          parsed = candidate;
          break;
        }
      } catch {
        // A damaged current snapshot must not hide a still-valid legacy one.
      }
    }
    if (!parsed) return fallback;
    const parsedScenes = parsed.scenes;
    if (!parsedScenes) return fallback;
    for (const scene of SCENES) {
      const saved = parsedScenes[scene.id];
      if (!saved) continue;
      // The first unified prototype persisted reduced Fluid/Blocks parameter
      // sets under the same schema. Do not let those stale values override the
      // restored original engines and their reference defaults.
      const marker = FULL_CONTROL_MARKERS[scene.id];
      if (marker && (!saved.parameters || !Object.prototype.hasOwnProperty.call(saved.parameters, marker))) continue;
      fallback.scenes[scene.id].look = scene.looks.some((look) => look.id === saved.look) ? saved.look : scene.looks[0].id;
      for (const spec of scene.parameters) {
        fallback.scenes[scene.id].parameters[spec.id] = sanitizeParameter(
          saved.parameters?.[spec.id],
          fallback.scenes[scene.id].parameters[spec.id],
          spec,
        );
      }
    }
    fallback.scene = SCENES.some((scene) => scene.id === parsed.scene) ? parsed.scene! : 'fluid';
    fallback.blackout = typeof parsed.blackout === 'boolean' ? parsed.blackout : false;
    fallback.master = clamp(finiteOr(parsed.master, 1), 0, 1);
    fallback.quality = parsed.quality === 'safe' || parsed.quality === 'balanced' || parsed.quality === 'high' ? parsed.quality : 'high';
    fallback.automation.enabled = typeof parsed.automation?.enabled === 'boolean'
      ? parsed.automation.enabled
      : false;
    fallback.automation.cycleScenes = typeof parsed.automation?.cycleScenes === 'boolean'
      ? parsed.automation.cycleScenes
      : true;
    fallback.automation.intensity = clamp(finiteOr(parsed.automation?.intensity, 1), 0, 1);
    fallback.automation.sceneSeconds = clamp(finiteOr(parsed.automation?.sceneSeconds, 36), 12, 180);
    fallback.automation.lookSeconds = clamp(finiteOr(parsed.automation?.lookSeconds, 9), 3, 60);
    fallback.automation.run = Math.max(0, Math.trunc(finiteOr(parsed.automation?.run, 0)));
    fallback.revision = Math.max(1, Math.trunc(finiteOr(parsed.revision, 1)));
    return fallback;
  } catch {
    return fallback;
  }
};

export const saveShow = (state: ShowState): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    // Storage can be unavailable or full; the live controller must keep running.
    return false;
  }
};
