import type { ParameterSpec } from '../../core/types';
import { DEFAULT_MATERIALS, DEFAULT_PARAMETERS, MAX_FLUID_PARTICLES } from './fluid-config.js';
import { TRES_MASAS_CUES } from './TresMasasDirector';

export const FLUID_MATERIAL_OPTIONS = DEFAULT_MATERIALS.map((material, value) => ({
  value,
  label: material.name,
  colour: material.color,
}));

export const FLUID_OPENING_SCENE_OPTIONS = [
  { value: 0, label: 'ORIGINAL' },
  { value: 1, label: '01 NEGRO / 500' },
  { value: 2, label: '02 AZUL SUPERIOR' },
  { value: 3, label: '03 SEGUNDO AZUL' },
  { value: 4, label: '04 TERCER AZUL / CHOQUES' },
  { value: 5, label: '05 ROJAS / ENERGÍA' },
] as const;

export const FLUID_INTERACTION_MODES = [
  'drag',
  'emit',
  'attract',
  'repel',
  'vortex',
  'vortex-reverse',
  'delete',
  'lock',
  'unlock',
  'collide',
] as const;

export type FluidInteractionMode = typeof FLUID_INTERACTION_MODES[number];

export const ORIGINAL_FLUID_DEFAULTS = Object.freeze({
  activeMaterial: 0,
  particleSize: 2,
  substeps: 3,
  particleLimit: 20_000,
  radiance: 1.6,
  radianceSpread: 1,
  radianceAbsorption: 1.5,
  radianceExposure: 0.2,
  gradeHue: -3,
  gradeSaturation: 0.96,
  gradeContrast: 1.48,
  gradeBrightness: 0.01,
  gradeBlackPoint: 0.06,
  lightOnly: 0,
  allEmitters: 0,
  velocityEmission: 0,
  paused: 0,
});

const n = (
  id: string,
  label: string,
  group: ParameterSpec['group'],
  min: number,
  max: number,
  step: number,
  defaultValue: number,
  options: Partial<ParameterSpec> = {},
): ParameterSpec => ({ id, label, group, min, max, step, default: defaultValue, ...options });

const toggle = (
  id: string,
  label: string,
  group: ParameterSpec['group'],
  defaultValue = 0,
  options: Partial<ParameterSpec> = {},
): ParameterSpec => n(id, label, group, 0, 1, 1, defaultValue, {
  kind: 'toggle', modulatable: false, ...options,
});

const action = (id: string, label: string, group: ParameterSpec['group']): ParameterSpec => (
  n(id, label, group, 0, 999, 1, 0, { kind: 'action', modulatable: false })
);

/**
 * Complete Fluid control surface. Numeric colours are encoded as 0xRRGGBB so
 * they can travel through the shared numeric parameter bus without widening
 * SceneFrame. The first four controls are show-level macros; every remaining
 * default/range mirrors the original manual or reactive Fluid implementation.
 */
export const FLUID_PARAMETER_SPECS: ParameterSpec[] = [
  n('openingScene', 'Escena de apertura', 'look', 0, 5, 1, 0, {
    kind: 'select',
    options: [...FLUID_OPENING_SCENE_OPTIONS],
    modulatable: false,
    live: false,
    description: 'Cue discreto de apertura. Se opera desde su botonera dedicada en Live.',
  }),
  n('tresMasasCue', 'Subescena Tres Masas', 'look', 0, TRES_MASAS_CUES.length - 1, 1, 0, {
    kind: 'select',
    options: TRES_MASAS_CUES.map((cue, value) => ({ value, label: `${cue.id} · ${cue.name}` })),
    modulatable: false,
    live: true,
    description: 'Cue del show Tres Masas (look "Tres Masas (show)"). También ←/→ o Espacio en la ventana Output.',
  }),
  action('tresMasasNext', 'Tres Masas: siguiente cue', 'look'),
  action('tresMasasPrev', 'Tres Masas: cue anterior', 'look'),
  n('tresMasasGeoGain', 'Ganancia geometría', 'look', 0, 3, 0.01, 1, {
    live: true,
    description: 'Multiplica la emisión HRC de la capa de geometría (faro, grilla, filamentos).',
  }),
  toggle('tresMasasHud', 'HUD Tres Masas', 'look', 1, {
    description: 'Rótulo de subescena activa en Output durante el show Tres Masas.',
  }),
  n('energy', 'Energía macro', 'live', 0, 1, 0.01, 0.34, {
    live: true, audioSource: 'rms', audioAmount: 0.28,
    description: 'Trim de energía del show; neutro en 0.34.',
  }),
  n('flow', 'Flujo macro', 'live', 0, 1, 0.01, 0.48, {
    live: true, audioSource: 'bass', audioAmount: 0.22,
    description: 'Trim de cohesión y movimiento; neutro en 0.48.',
  }),
  n('turbulence', 'Turbulencia macro', 'live', 0, 1, 0.01, 0.32, {
    live: true, audioSource: 'flux', audioAmount: 0.3,
    description: 'Trim de mezcla y movimiento; neutro en 0.32.',
  }),
  n('burst', 'Impulso', 'live', 0, 1, 0.01, 0, {
    live: true, audioSource: 'onset', audioAmount: 0.8, smoothing: 0.04,
  }),
  n('lookAmount', 'Cantidad de look', 'look', 0, 1, 0.01, 1, {
    live: true, description: 'Mezcla el look sobre los valores manuales sin borrar sus trims.',
  }),
  n('reactiveAmount', 'Mezcla reactiva manual', 'live', 0, 1, 0.01, 0, {
    live: true, audioSource: 'rms', audioAmount: 0,
    description: 'Mezcla reactiva para looks manuales. Reactive original activa su director completo al seleccionarse.',
  }),
  toggle('autoMotion', 'Movimiento autónomo', 'live', 0, {
    description: 'Extensión manual; Reactive original usa exclusivamente el movimiento de su director.',
  }),
  toggle('musicalInteractions', 'Impulsos musicales', 'live', 1, {
    description: 'Control manual; Reactive original conserva sus impulsos musicales exactos.',
  }),

  n('particleLimit', 'Cantidad de partículas', 'materials', 500, MAX_FLUID_PARTICLES, 500, ORIGINAL_FLUID_DEFAULTS.particleLimit, {
    modulatable: false,
    description: 'Cambiarlo reconstruye el fluido; Azure conserva exactamente dos partículas.',
  }),
  n('particleSize', 'Tamaño de partícula', 'materials', 2, 18, 0.05, ORIGINAL_FLUID_DEFAULTS.particleSize, {
    audioSource: 'bass', audioAmount: 0,
  }),
  ...DEFAULT_MATERIALS.flatMap((material, index): ParameterSpec[] => [
    n(`materialMass${index}`, `Masa ${material.name}`, 'materials', 0.05, 2, 0.001, material.mass, {
      description: 'Masa exacta enviada al solver Grant Kot.',
    }),
    n(`materialColor${index}`, `Color ${material.name}`, 'materials', 0, 0xffffff, 1, Number.parseInt(material.color.slice(1), 16), {
      kind: 'color', modulatable: false,
    }),
  ]),

  n('sameRestDensity', 'Atracción mismo material', 'physics', 0, 12, 0.1, DEFAULT_PARAMETERS.sameRestDensity, {
    audioSource: 'bass', audioAmount: 0,
  }),
  n('differentRestDensity', 'Atracción cruzada', 'physics', 0, 12, 0.1, DEFAULT_PARAMETERS.differentRestDensity, {
    audioSource: 'mid', audioAmount: 0,
  }),
  n('stiffness', 'Presión', 'physics', 0.05, 2, 0.05, DEFAULT_PARAMETERS.stiffness, {
    audioSource: 'bass', audioAmount: 0,
  }),
  n('nearStiffness', 'Tensión cercana', 'physics', 0.05, 3, 0.05, DEFAULT_PARAMETERS.nearStiffness, {
    audioSource: 'mid', audioAmount: 0,
  }),
  n('gravity', 'Gravedad', 'physics', 0, 1.5, 0.01, DEFAULT_PARAMETERS.gravity, {
    audioSource: 'bass', audioAmount: 0,
  }),
  n('drag', 'Arrastre', 'physics', 0, 0.3, 0.01, DEFAULT_PARAMETERS.drag, {
    audioSource: 'treble', audioAmount: 0,
  }),
  // El arrastre nunca llegó al solver; el freno sí. Rango corto a propósito:
  // 0.02 por subpaso ya deja un empujón muerto en un cuarto de segundo.
  n('brake', 'Freno', 'physics', 0, 0.05, 0.001, DEFAULT_PARAMETERS.brake),
  n('pointerForce', 'Fuerza de interacción', 'physics', 0, 3, 0.01, DEFAULT_PARAMETERS.pointerForce),
  n('substeps', 'Subpasos', 'physics', 1, 4, 1, ORIGINAL_FLUID_DEFAULTS.substeps, {
    modulatable: false,
  }),
  toggle('paused', 'Pausar solver', 'physics', ORIGINAL_FLUID_DEFAULTS.paused),
  action('resetSimulation', 'Reiniciar fluido', 'physics'),

  n('emissiveMaterial', 'Material emisor', 'emitters', 0, 3, 1, ORIGINAL_FLUID_DEFAULTS.activeMaterial, {
    kind: 'select', options: FLUID_MATERIAL_OPTIONS, modulatable: false, live: true,
  }),
  toggle('allEmitters', 'Iluminar todo este color', 'emitters', ORIGINAL_FLUID_DEFAULTS.allEmitters, {
    live: true,
    description: 'Hace emisoras todas las partículas del material seleccionado; sigue disponible en Config.',
  }),
  toggle('velocityEmission', 'Emisión por velocidad', 'emitters', ORIGINAL_FLUID_DEFAULTS.velocityEmission),
  toggle('emitterFollowAudio', 'Material sigue armonía', 'emitters', 0),
  toggle('emitterAutoCycle', 'Ciclo automático de material', 'emitters', 0),
  n('emitterCycleSeconds', 'Duración del ciclo', 'emitters', 1.5, 60, 0.1, 8, {
    unit: 's', modulatable: false,
  }),
  n('emitterCrossfadeSeconds', 'Crossfade de emisor', 'emitters', 0.1, 5, 0.05, 1.25, {
    unit: 's', modulatable: false,
  }),
  n('reactiveSecondaryMaterial', 'Emisor secundario', 'emitters', -1, 3, 1, -1, {
    kind: 'select', modulatable: false,
    options: [{ value: -1, label: 'Apagado' }, ...FLUID_MATERIAL_OPTIONS],
  }),
  n('reactiveSecondaryStrength', 'Fuerza emisor secundario', 'emitters', 0, 0.85, 0.01, 0),
  n('reactiveSecondaryFraction', 'Fracción emisor secundario', 'emitters', 0.01, 1, 0.01, 1),

  n('radiance', 'Emisión Radiance', 'radiance', 0, 1.6, 0.01, ORIGINAL_FLUID_DEFAULTS.radiance, {
    audioSource: 'rms', audioAmount: 0,
  }),
  n('radianceSpread', 'Resolución / spread', 'radiance', 0, 1, 0.01, ORIGINAL_FLUID_DEFAULTS.radianceSpread, {
    audioSource: 'flux', audioAmount: 0,
  }),
  n('radianceAbsorption', 'Absorción', 'radiance', 0, 1.5, 0.01, ORIGINAL_FLUID_DEFAULTS.radianceAbsorption, {
    audioSource: 'bass', audioAmount: 0,
  }),
  n('radianceExposure', 'Exposición Radiance', 'radiance', 0, 2, 0.01, ORIGINAL_FLUID_DEFAULTS.radianceExposure, {
    audioSource: 'rms', audioAmount: 0,
  }),
  toggle('lightOnly', 'Sólo luz', 'radiance', ORIGINAL_FLUID_DEFAULTS.lightOnly),

  n('gradeHue', 'Matiz', 'grade', -180, 180, 1, ORIGINAL_FLUID_DEFAULTS.gradeHue, {
    unit: '°', audioSource: 'harmonic', audioAmount: 0,
  }),
  n('gradeSaturation', 'Saturación', 'grade', 0, 2.5, 0.01, ORIGINAL_FLUID_DEFAULTS.gradeSaturation, {
    audioSource: 'treble', audioAmount: 0,
  }),
  n('gradeContrast', 'Contraste', 'grade', 0.25, 3, 0.01, ORIGINAL_FLUID_DEFAULTS.gradeContrast, {
    audioSource: 'mid', audioAmount: 0,
  }),
  n('gradeBrightness', 'Brillo', 'grade', -0.5, 0.5, 0.01, ORIGINAL_FLUID_DEFAULTS.gradeBrightness, {
    audioSource: 'rms', audioAmount: 0,
  }),
  n('gradeBlackPoint', 'Punto negro', 'grade', 0, 0.65, 0.01, ORIGINAL_FLUID_DEFAULTS.gradeBlackPoint),

  n('interactionMode', 'Modo de interacción', 'advanced', 0, FLUID_INTERACTION_MODES.length - 1, 1, 0, {
    kind: 'select', modulatable: false,
    options: FLUID_INTERACTION_MODES.map((mode, value) => ({ value, label: mode })),
  }),
  n('interactionMaterial', 'Material de interacción', 'advanced', 0, 3, 1, 0, {
    kind: 'select', options: FLUID_MATERIAL_OPTIONS, modulatable: false,
  }),
  n('interactionX', 'Interacción X', 'advanced', 0, 1, 0.001, 0.5),
  n('interactionY', 'Interacción Y', 'advanced', 0, 1, 0.001, 0.32),
  n('interactionVelocityX', 'Velocidad X', 'advanced', -100, 100, 0.1, 0),
  n('interactionVelocityY', 'Velocidad Y', 'advanced', -100, 100, 0.1, 0),
  n('interactionRadius', 'Radio de interacción', 'advanced', 1, 500, 1, 100, { unit: 'px' }),
  n('interactionStrength', 'Intensidad de interacción', 'advanced', 0, 3, 0.01, DEFAULT_PARAMETERS.pointerForce),
  n('interactionEmitCount', 'Partículas por emisión', 'advanced', 0, 100, 1, 5, { modulatable: false }),
  toggle('interactionContinuous', 'Interacción continua', 'advanced', 0),
  action('interactionTrigger', 'Disparar interacción', 'advanced'),
];

export const FLUID_PARAMETER_IDS = Object.freeze(FLUID_PARAMETER_SPECS.map((spec) => spec.id));
