export interface FluidLook {
  id: 'original' | 'reactive-original' | 'tres-masas' | 'fluids-show' | 'float' | 'cluster' | 'mix' | 'fall' | 'viscous' | 'burst' | 'orbit';
  same: number;
  cross: number;
  pressure: number;
  tension: number;
  gravity: number;
  drag: number;
  size: number;
  light: number;
  exposure: number;
  contrast: number;
  impulse: number;
}

export const FLUID_LOOKS: Readonly<Record<FluidLook['id'], FluidLook>> = Object.freeze({
  original: Object.freeze({
    id: 'original', same: 6.5, cross: 6.1, pressure: 0.2, tension: 0.05,
    gravity: 0, drag: 0, size: 0, light: 0,
    exposure: 0, contrast: 0, impulse: 1,
  }),
  // Selecting this look activates ReactiveFluidDirector. The neutral values
  // keep manual controls unchanged if the output is ever rendered without it.
  'reactive-original': Object.freeze({
    id: 'reactive-original', same: 6.5, cross: 6.1, pressure: 0.2, tension: 0.05,
    gravity: 0, drag: 0, size: 0, light: 0,
    exposure: 0, contrast: 0, impulse: 1,
  }),
  // Selecting this look activates TresMasasDirector: the cue-driven show
  // simulation (geometry layer + white/red/blue materials). Neutral values
  // keep manual controls unchanged if rendered without the director.
  'tres-masas': Object.freeze({
    id: 'tres-masas', same: 6.5, cross: 6.1, pressure: 0.2, tension: 0.05,
    gravity: 0, drag: 0, size: 0, light: 0,
    exposure: 0, contrast: 0, impulse: 1,
  }),
  // Selecciona FluidsShowDirector: el show de la línea emisora manejado por
  // la timeline de /fluids. Neutro acá para que, si alguna vez se renderiza
  // sin director, los controles manuales no cambien de significado.
  'fluids-show': Object.freeze({
    id: 'fluids-show', same: 6.5, cross: 6.1, pressure: 0.2, tension: 0.05,
    gravity: 0, drag: 0, size: 0, light: 0,
    exposure: 0, contrast: 0, impulse: 1,
  }),
  float: Object.freeze({
    id: 'float', same: 3.6, cross: 3.0, pressure: 0.14, tension: 0.05,
    gravity: 0, drag: 0.002, size: -0.1, light: -0.06,
    exposure: -0.015, contrast: 0.08, impulse: 0.65,
  }),
  cluster: Object.freeze({
    id: 'cluster', same: 11.2, cross: 1.3, pressure: 0.34, tension: 1.45,
    gravity: 0, drag: 0.012, size: 0.2, light: 0.06,
    exposure: 0.025, contrast: 0.12, impulse: 0.8,
  }),
  mix: Object.freeze({
    id: 'mix', same: 2.1, cross: 10.9, pressure: 0.55, tension: 0.18,
    gravity: 0, drag: 0.004, size: 0.35, light: 0.1,
    exposure: 0.035, contrast: -0.04, impulse: 1.15,
  }),
  fall: Object.freeze({
    id: 'fall', same: 6.3, cross: 5.4, pressure: 0.32, tension: 0.24,
    gravity: 0.72, drag: 0.006, size: 0.12, light: 0.03,
    exposure: 0.02, contrast: 0.04, impulse: 0.75,
  }),
  viscous: Object.freeze({
    id: 'viscous', same: 8.7, cross: 7.6, pressure: 0.12, tension: 1.8,
    gravity: 0.14, drag: 0.085, size: 0.45, light: -0.04,
    exposure: -0.01, contrast: 0.16, impulse: 0.48,
  }),
  burst: Object.freeze({
    id: 'burst', same: 1.0, cross: 1.0, pressure: 1.45, tension: 0.05,
    gravity: 0, drag: 0, size: 0.75, light: 0.22,
    exposure: 0.075, contrast: -0.08, impulse: 1.5,
  }),
  orbit: Object.freeze({
    id: 'orbit', same: 5.0, cross: 8.8, pressure: 0.66, tension: 0.4,
    gravity: 0, drag: 0.006, size: 0.28, light: 0.14,
    exposure: 0.045, contrast: 0.02, impulse: 1.3,
  }),
});

export const readFluidLook = (id: string): FluidLook => (
  FLUID_LOOKS[id as FluidLook['id']] ?? FLUID_LOOKS.original
);

/** Add a look as an offset, preserving the operator's manual trim. */
export const applyFluidLookTrim = (
  manualValue: number,
  originalDefault: number,
  lookValue: number,
  amount = 1,
): number => manualValue + (lookValue - originalDefault) * Math.max(0, Math.min(1, amount));

export const FLUID_LOOK_OPTIONS: Array<{ id: FluidLook['id']; name: string }> = [
  { id: 'original', name: 'Original manual' },
  { id: 'reactive-original', name: 'Reactive original' },
  { id: 'float', name: 'Flotar' },
  { id: 'cluster', name: 'Agrupar' },
  { id: 'mix', name: 'Mezclar' },
  { id: 'fall', name: 'Caer' },
  { id: 'viscous', name: 'Viscoso' },
  { id: 'burst', name: 'Estallido' },
  { id: 'orbit', name: 'Órbita' },
  { id: 'tres-masas', name: 'Tres Masas (show)' },
  { id: 'fluids-show', name: 'Fluids (show)' },
];
