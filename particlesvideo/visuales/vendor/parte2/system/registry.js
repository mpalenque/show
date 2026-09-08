import { ParameterStore } from './parameters.js';
import { COMPOSITION_PARAMETERS } from './compositor.js';
import { FULL_PRESETS } from './full-presets.js';

const COMP_ALIASES = {
  'fullVideo.opacity': 'mix.fullVideo', 'fullMilky.opacity': 'mix.fullMilky',
  'ink.opacity': 'ink.opacity', 'ink.enabled': 'ink.enabled',
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [
    [`stripes.videoOpacity.${i}`, `mix.stripes.${i}.video`],
    [`stripes.milkyOpacity.${i}`, `mix.stripes.${i}.milky`],
  ]).flat()),
};

// Pure registry: available before Settings, Bridge and asynchronous GPU startup.
export function createSystemParameters() {
  const params = new ParameterStore();
    for (const spec of COMPOSITION_PARAMETERS) {
      if (COMP_ALIASES[spec.path]) continue;
      params.define({ id: `composition.${spec.path}`, label: spec.label,
        type: { number: 'float', boolean: 'bool', select: 'enum' }[spec.type] || spec.type,
        default: spec.default, min: spec.min ?? 0, max: spec.max ?? 1, step: spec.step ?? .01,
        options: spec.options, group: spec.group });
    }
    for (const preset of FULL_PRESETS) {
      const ranges = { opacity: [0, 1], normalRadius: [.1, 64], normalDepth: [-4, 4], displaceAmount: [-2, 2],
        unsharpAmount: [0, 5], unsharpShape: [-3, 3], saturation: [0, 3], ditherThreshold: [.1, 10],
        secondaryAmount: [-2, 2], postBlendOpacity: [0, 1], flowBlur: [0, 1], flowIterations: [0, 16],
        seedScale: [.01, 3], seedRotation: [-.5, .5], seedPulsePeriod: [.02, 10] };
      for (const [key, [min, max]] of Object.entries(ranges)) {
        if (typeof preset[key] !== 'number') continue;
        params.define({ id: `milky.${preset.id}.${key}`, label: key, type: key === 'flowIterations' ? 'int' : 'float',
          default: preset[key], min, max, step: .01, group: preset.name });
      }
      for (const [key, values] of [['direction', preset.direction], ['secondaryDirection', preset.secondaryDirection]]) {
        for (let i = 0; i < 2; i++) params.define({ id: `milky.${preset.id}.${key}${i ? 'Y' : 'X'}`, label: `${key} ${i ? 'Y' : 'X'}`,
          type: 'float', default: values[i], min: -2, max: 2, step: .001, group: preset.name });
      }
    }
  return params;
}
