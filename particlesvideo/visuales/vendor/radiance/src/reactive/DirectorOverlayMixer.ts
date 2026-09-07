import { SCENE_MAP } from '../core/manifest';
import type { SceneId } from '../core/types';
import type { DirectorCue } from './AutoShowDirector';

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

/** Blends/smooths director targets without ever writing them into ShowState. */
export class DirectorOverlayMixer {
  private smooth = new Map<string, number>();
  private wasEnabled = false;

  resolve(
    scene: SceneId,
    base: Record<string, number>,
    cue: DirectorCue,
    intensity: number,
    dt: number,
  ): Record<string, number> {
    if (!cue.enabled) {
      if (this.wasEnabled) this.reset();
      this.wasEnabled = false;
      return base;
    }
    this.wasEnabled = true;
    const amount = clamp(intensity, 0, 1);
    if (amount <= 0 || cue.scene !== scene) return { ...base };

    const result = { ...base };
    const specs = SCENE_MAP[scene].parameters;
    for (const [id, targetValue] of Object.entries(cue.parameterTargets)) {
      const spec = specs.find((candidate) => candidate.id === id);
      if (!spec || (spec.kind && spec.kind !== 'number')) continue;
      const baseValue = result[id];
      if (!Number.isFinite(baseValue) || !Number.isFinite(targetValue)) continue;
      const target = clamp(targetValue, spec.min, spec.max);
      const blended = clamp(baseValue + (target - baseValue) * amount, spec.min, spec.max);
      const key = `${scene}:${id}`;
      const previous = this.smooth.get(key) ?? baseValue;
      const speed = id === 'brightness' || id === 'pulse' ? 8 : 3.5;
      const alpha = 1 - Math.exp(-speed * clamp(dt, 0.001, 0.1));
      const value = previous + (blended - previous) * alpha;
      this.smooth.set(key, value);
      result[id] = value;
    }
    return result;
  }

  reset(scene?: SceneId): void {
    if (!scene) this.smooth.clear();
    else for (const key of this.smooth.keys()) if (key.startsWith(`${scene}:`)) this.smooth.delete(key);
  }
}

export default DirectorOverlayMixer;
