import type { EclipseType } from './Eclipse';

export interface SimulationState {
  currentDay: number;
  isPlaying: boolean;
  playSpeed: number;
  viewMode: 'default' | 'observer' | 'orbital' | 'eclipse';
  eclipseType: EclipseType;
  showOrbitLine: boolean;
  showLabels: boolean;
  realisticScale: boolean;
}

export function createDefaultState(): SimulationState {
  return {
    currentDay: 0,
    isPlaying: true,
    playSpeed: 1,
    viewMode: 'default',
    eclipseType: 'solar',
    showOrbitLine: true,
    showLabels: true,
    realisticScale: false,
  };
}

export type StateChangeCallback = (state: SimulationState) => void;

export class SimulationStore {
  private state: SimulationState;
  private listeners: StateChangeCallback[];

  constructor(initialState: SimulationState = createDefaultState()) {
    this.state = initialState;
    this.listeners = [];
  }

  get(): SimulationState {
    return { ...this.state };
  }

  update(partial: Partial<SimulationState>): void {
    this.state = { ...this.state, ...partial };
    const snapshot = this.get();
    this.listeners.forEach((listener) => {
      listener(snapshot);
    });
  }

  subscribe(cb: StateChangeCallback): () => void {
    this.listeners.push(cb);
    cb(this.get());
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== cb);
    };
  }
}
