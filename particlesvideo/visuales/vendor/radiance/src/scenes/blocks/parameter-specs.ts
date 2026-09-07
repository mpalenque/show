import type { ParameterSpec } from '../../core/types';

/**
 * Public control ABI for the original ImpulseMode 3 scene.
 *
 * Action parameters are monotonically cycled counters by the control UI. The
 * renderer reacts to a value change, so an action is never repeated merely
 * because its last value remains in the show state.
 */
export const BLOCKS_PARAMETER_SPECS: ParameterSpec[] = [
  {
    id: 'density', label: 'Densidad', group: 'live', kind: 'number',
    min: 0, max: 1, step: 0.01, default: 0.2,
    audioSource: 'rms', audioAmount: 0.24, smoothing: 0.15,
    description: 'Cantidad de cuerpos generados por cada ataque; 0.2 conserva la ráfaga original.',
    live: true,
  },
  {
    id: 'turbulence', label: 'Turbulencia', group: 'live', kind: 'number',
    min: 0, max: 1, step: 0.01, default: 0.1,
    audioSource: 'flux', audioAmount: 0.24, smoothing: 0.12,
    description: 'Desvío lateral al lanzar cuerpos con la gravedad suspendida.',
    live: true,
  },
  {
    id: 'tension', label: 'Tensión', group: 'live', kind: 'number',
    min: 0, max: 1, step: 0.01, default: 0.1,
    audioSource: 'mid', audioAmount: 0.18, smoothing: 0.15,
    description: 'Amortiguación lineal y angular de los cuerpos; 0.1 conserva la física original.',
    live: true,
  },
  {
    id: 'zoom', label: 'Zoom', group: 'camera', kind: 'number',
    min: 0.65, max: 1.85, step: 0.01, default: 1,
    audioSource: 'bass', audioAmount: 0, smoothing: 0.18,
    description: 'Distancia de cámara del renderer original.',
  },
  {
    id: 'testMidi', label: 'Nota de prueba', group: 'emitters', kind: 'select',
    min: 48, max: 84, step: 12, default: 60,
    options: [
      { value: 48, label: 'Grave C3' },
      { value: 60, label: 'Media C4' },
      { value: 84, label: 'Aguda C6' },
    ],
    description: 'Altura usada por Probar nota; replica los accesos del panel original.',
    modulatable: false,
  },
  {
    id: 'testNote', label: 'Probar nota', group: 'live', kind: 'action',
    min: 0, max: 999, step: 1, default: 0,
    description: 'Genera una nota de fuerza 0.85 y su ráfaga física de 2–5 cuerpos.',
    live: true, modulatable: false,
  },
  {
    id: 'toggleGravity', label: 'Q · Gravedad', group: 'physics', kind: 'action',
    min: 0, max: 999, step: 1, default: 0,
    description: 'Alterna gravedad −14/0; al apagarla lanza todos los cuerpos al centro.',
    live: true, modulatable: false,
  },
  {
    id: 'rotate90', label: 'W · Girar 90°', group: 'camera', kind: 'action',
    min: 0, max: 999, step: 1, default: 0,
    description: 'Giro original de 90° en 0.82 s, con dirección elegida por la última nota.',
    live: true, modulatable: false,
  },
  {
    id: 'toggleEmitterScale', label: 'E · Emisores 1×/3×', group: 'emitters', kind: 'action',
    min: 0, max: 999, step: 1, default: 0,
    description: 'Anima emisores y fixtures físicos entre 1× y 3× durante 10 s.',
    live: true, modulatable: false,
  },
  {
    id: 'resetBlocks', label: 'R · Reiniciar', group: 'advanced', kind: 'action',
    min: 0, max: 999, step: 1, default: 0,
    description: 'Elimina cuerpos y reinicia HRC, gravedad, piso, cámara y ciclos.',
    modulatable: false,
  },
];

export const BLOCKS_LOOKS = [
  { id: 'impulse-03', name: 'Impulse 03 · Original' },
] as const;
