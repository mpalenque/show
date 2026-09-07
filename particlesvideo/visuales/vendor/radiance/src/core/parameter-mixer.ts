import { SCENE_MAP } from './manifest';
import type { AudioSnapshot, AudioSource, ParameterState, SceneId, ShowState } from './types';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

const readAudio = (audio: AudioSnapshot, source: AudioSource): number => {
  if (!audio.running) return 0;
  return clamp(audio[source], 0, 1);
};

export class ParameterMixer {
  private smooth = new Map<string, number>();

  reset(scene?: SceneId): void {
    if (!scene) this.smooth.clear();
    else for (const key of this.smooth.keys()) if (key.startsWith(`${scene}:`)) this.smooth.delete(key);
  }

  mix(sceneId: SceneId, state: ShowState, audio: AudioSnapshot, dt: number): Record<string, number> {
    const manifest = SCENE_MAP[sceneId];
    const values: Record<string, number> = {};
    for (const spec of manifest.parameters) {
      const config: ParameterState = state.scenes[sceneId]?.parameters?.[spec.id] ?? {
        manual: spec.default,
        mode: 'manual',
        source: spec.audioSource ?? 'rms',
        amount: spec.audioAmount ?? 0,
        smoothing: spec.smoothing ?? 0.15,
        invert: false,
      };
      const kind = spec.kind ?? 'number';
      if (spec.modulatable === false || kind === 'color' || kind === 'select' || kind === 'toggle' || kind === 'action') {
        const direct = clamp(config.manual, spec.min, spec.max);
        values[spec.id] = kind === 'number' ? direct : Math.round(direct);
        this.smooth.set(`${sceneId}:${spec.id}`, values[spec.id]);
        continue;
      }
      const range = spec.max - spec.min;
      const rawAudio = readAudio(audio, config.source);
      const shaped = config.invert ? 1 - rawAudio : rawAudio;
      const modulation = shaped * config.amount * range;
      let target = config.manual;
      if (config.mode === 'audio') target = spec.default + modulation;
      if (config.mode === 'hybrid') target = config.manual + modulation;
      target = clamp(target, spec.min, spec.max);
      const key = `${sceneId}:${spec.id}`;
      const previous = this.smooth.get(key) ?? target;
      const seconds = Math.max(0, config.smoothing);
      const alpha = seconds <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / seconds);
      const value = previous + (target - previous) * alpha;
      this.smooth.set(key, value);
      values[spec.id] = value;
    }
    return values;
  }
}
