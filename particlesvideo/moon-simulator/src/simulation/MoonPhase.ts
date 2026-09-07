export const SYNODIC_PERIOD = 29.53059;

export interface PhaseInfo {
  day: number;
  phaseAngle: number;
  illumination: number;
  phaseKey: string;
  phaseIndex: number;
}

export const PHASE_KEYS = [
  'newMoon',
  'waxingCrescent',
  'firstQuarter',
  'waxingGibbous',
  'fullMoon',
  'waningGibbous',
  'lastQuarter',
  'waningCrescent',
] as const;

const normalizeAngle = (angle: number): number => {
  const mod = angle % 360;
  return mod < 0 ? mod + 360 : mod;
};

export function dayToPhaseAngle(day: number): number {
  return (day / SYNODIC_PERIOD) * 360;
}

export function phaseAngleToIllumination(angle: number): number {
  return ((1 - Math.cos((angle * Math.PI) / 180)) / 2) * 100;
}

export function getPhaseInfo(day: number): PhaseInfo {
  const normalizedDay = ((day % SYNODIC_PERIOD) + SYNODIC_PERIOD) % SYNODIC_PERIOD;
  const phaseAngle = normalizeAngle(dayToPhaseAngle(normalizedDay));
  const illumination = phaseAngleToIllumination(phaseAngle);
  const phaseIndex = Math.round(phaseAngle / 45) % 8;
  const phaseKey = PHASE_KEYS[phaseIndex] ?? PHASE_KEYS[0];

  return {
    day: normalizedDay,
    phaseAngle,
    illumination,
    phaseKey,
    phaseIndex,
  };
}
