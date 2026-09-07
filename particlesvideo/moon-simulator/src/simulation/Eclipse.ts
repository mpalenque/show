import { SYNODIC_PERIOD, dayToPhaseAngle } from './MoonPhase';

export type EclipseType = 'solar' | 'lunar';
export type NonEclipseViewMode = 'default' | 'observer' | 'orbital';

export const ECLIPSE_ORBIT_INCLINATION_DEG = 5.1;
export const SOLAR_ECLIPSE_DAY = 0;
export const LUNAR_ECLIPSE_DAY = SYNODIC_PERIOD / 2;
export const ECLIPSE_WINDOW_THRESHOLD_PERCENT = 70;

type EclipseTransitionState = {
  currentDay: number;
  isPlaying: boolean;
  playSpeed: number;
  realisticScale: boolean;
  showOrbitLine: boolean;
  viewMode: NonEclipseViewMode | 'eclipse';
  eclipseType: EclipseType;
};

type EclipseRestoreSnapshot = {
  currentDay: number;
  isPlaying: boolean;
  playSpeed: number;
  realisticScale: boolean;
  showOrbitLine: boolean;
  viewMode: NonEclipseViewMode;
};

let restoreSnapshot: EclipseRestoreSnapshot | null = null;

const wrapDay = (day: number): number => ((day % SYNODIC_PERIOD) + SYNODIC_PERIOD) % SYNODIC_PERIOD;

export const getEclipseTargetDay = (type: EclipseType): number => (
  type === 'solar' ? SOLAR_ECLIPSE_DAY : LUNAR_ECLIPSE_DAY
);

export const enterEclipseMode = (
  state: EclipseTransitionState,
  type: EclipseType = state.eclipseType,
): Partial<EclipseTransitionState> => {
  if (state.viewMode !== 'eclipse') {
    restoreSnapshot = {
      currentDay: state.currentDay,
      isPlaying: state.isPlaying,
      playSpeed: state.playSpeed,
      realisticScale: state.realisticScale,
      showOrbitLine: state.showOrbitLine,
      viewMode: state.viewMode,
    };
  }

  return {
    viewMode: 'eclipse',
    eclipseType: type,
    currentDay: getEclipseTargetDay(type),
    playSpeed: 0.25,
    isPlaying: false,
    realisticScale: false,
    showOrbitLine: true,
  };
};

export const exitEclipseMode = (nextViewMode: NonEclipseViewMode): Partial<EclipseTransitionState> => {
  if (!restoreSnapshot) {
    return { viewMode: nextViewMode };
  }

  const restoredState: Partial<EclipseTransitionState> = {
    ...restoreSnapshot,
    viewMode: nextViewMode,
  };

  restoreSnapshot = null;
  return restoredState;
};

export const getWrappedDayDelta = (day: number, targetDay: number): number => {
  const normalizedDay = wrapDay(day);
  const delta = normalizedDay - targetDay;

  if (delta > SYNODIC_PERIOD / 2) {
    return delta - SYNODIC_PERIOD;
  }

  if (delta < -SYNODIC_PERIOD / 2) {
    return delta + SYNODIC_PERIOD;
  }

  return delta;
};

export interface EclipseInfo {
  type: EclipseType;
  targetDay: number;
  phaseAngle: number;
  offsetDays: number;
  alignmentWindowPercent: number;
  lineupKey: string;
  descriptionKey: string;
}

export const isWithinEclipseWindow = (alignmentWindowPercent: number): boolean => (
  alignmentWindowPercent >= ECLIPSE_WINDOW_THRESHOLD_PERCENT
);

export const getEclipseInfo = (day: number, type: EclipseType): EclipseInfo => {
  const targetDay = getEclipseTargetDay(type);
  const offsetDays = getWrappedDayDelta(day, targetDay);
  const alignmentWindowPercent = Math.max(0, 100 - Math.min(Math.abs(offsetDays) / 2.5, 1) * 100);

  return {
    type,
    targetDay,
    phaseAngle: dayToPhaseAngle(wrapDay(day)),
    offsetDays,
    alignmentWindowPercent,
    lineupKey: type === 'solar' ? 'eclipse.solar.lineup' : 'eclipse.lunar.lineup',
    descriptionKey: type === 'solar' ? 'eclipse.solar.description' : 'eclipse.lunar.description',
  };
};
