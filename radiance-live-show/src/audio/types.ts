import type { DetectedNote } from '../core/types';

export interface AudioBands {
  low: number;
  mid: number;
  high: number;
}

/** Low-latency frame produced in the AudioWorklet. All public values are 0..1. */
export interface FeatureFrame {
  t: number;
  rawRms: number;
  rms: number;
  bands: AudioBands;
  onset: boolean;
  onsetStrength: number;
  chroma: Float32Array;
  centroid: number;
  flux: number;
  noteAttacks: DetectedNote[];
}

export interface AudioEngineStatus {
  state: 'idle' | 'requesting' | 'starting' | 'running' | 'suspended' | 'ended' | 'error';
  running: boolean;
  sampleRate: number;
  rawRms: number;
  latencyMs: number | null;
  calibrated: boolean;
  calibrating: boolean;
  error: string | null;
}

