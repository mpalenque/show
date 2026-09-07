import { EMPTY_AUDIO } from '../core/manifest';
import type { AudioSnapshot, DetectedNote } from '../core/types';
import type { FeatureFrame } from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const approach = (from: number, to: number, speed: number, dt: number): number => (
  from + (to - from) * (1 - Math.exp(-speed * dt))
);

/** Aggregates worklet hops into one compact, render-safe snapshot. */
export class AudioSnapshotAggregator {
  private snapshot: AudioSnapshot = { ...EMPTY_AUDIO, notes: [] };
  private sequence = 0;

  reset(): AudioSnapshot {
    this.sequence += 1;
    this.snapshot = { ...EMPTY_AUDIO, sequence: this.sequence, notes: [] };
    return this.current();
  }

  update(frames: readonly FeatureFrame[], running: boolean, dt: number): AudioSnapshot {
    const safeDt = Math.max(0.001, Math.min(0.2, Number.isFinite(dt) ? dt : 1 / 30));
    this.sequence += 1;
    if (!frames.length) {
      this.snapshot = {
        ...this.snapshot,
        sequence: this.sequence,
        running,
        rms: approach(this.snapshot.rms, 0, 5, safeDt),
        bass: approach(this.snapshot.bass, 0, 5, safeDt),
        mid: approach(this.snapshot.mid, 0, 5.5, safeDt),
        treble: approach(this.snapshot.treble, 0, 6.5, safeDt),
        onset: approach(this.snapshot.onset, 0, 15, safeDt),
        flux: approach(this.snapshot.flux, 0, 9, safeDt),
        harmonicConfidence: approach(this.snapshot.harmonicConfidence, 0, 0.7, safeDt),
        harmonicSpread: approach(this.snapshot.harmonicSpread, 0, 0.5, safeDt),
        notes: [],
      };
      return this.current();
    }

    let rms = 0;
    let bass = 0;
    let mid = 0;
    let treble = 0;
    let onset = 0;
    let flux = 0;
    let centroid = 0;
    const chroma = new Float32Array(12);
    const notes: DetectedNote[] = [];
    for (const frame of frames) {
      rms += frame.rms;
      bass += frame.bands.low;
      mid += frame.bands.mid;
      treble += frame.bands.high;
      onset = Math.max(onset, frame.onsetStrength);
      flux = Math.max(flux, frame.flux);
      centroid += frame.centroid;
      for (let index = 0; index < 12; index += 1) chroma[index] += frame.chroma[index] ?? 0;
      notes.push(...frame.noteAttacks);
    }
    const inverseCount = 1 / frames.length;
    let strongestClass = 0;
    let strongestValue = 0;
    let chromaTotal = 0;
    for (let index = 0; index < chroma.length; index += 1) {
      const value = chroma[index] * inverseCount;
      chromaTotal += value;
      if (value > strongestValue) {
        strongestValue = value;
        strongestClass = index;
      }
    }
    const harmonicConfidence = clamp01(strongestValue / (chromaTotal + 1e-6) * 3);
    let entropy = 0;
    if (chromaTotal > 1e-6) {
      for (const accumulated of chroma) {
        const probability = (accumulated * inverseCount) / chromaTotal;
        if (probability > 1e-6) entropy -= probability * Math.log(probability);
      }
    }
    const harmonicCenter = strongestClass / 11;
    const harmonicSpread = clamp01(entropy / Math.log(12));

    this.snapshot = {
      sequence: this.sequence,
      timestamp: frames[frames.length - 1].t,
      running,
      rms: approach(this.snapshot.rms, clamp01(rms * inverseCount), 12, safeDt),
      bass: approach(this.snapshot.bass, clamp01(bass * inverseCount), 10, safeDt),
      mid: approach(this.snapshot.mid, clamp01(mid * inverseCount), 10, safeDt),
      treble: approach(this.snapshot.treble, clamp01(treble * inverseCount), 12, safeDt),
      onset: Math.max(onset, approach(this.snapshot.onset, 0, 15, safeDt)),
      flux: Math.max(flux, approach(this.snapshot.flux, 0, 9, safeDt)),
      centroid: approach(this.snapshot.centroid, clamp01(centroid * inverseCount), 7, safeDt),
      harmonicCenter,
      // New descriptors deliberately expose the analysis result directly so
      // reactive engines can reason about confidence and chord spread.
      harmonicConfidence,
      harmonicSpread,
      // Existing scene mappings use `harmonic`. Keep its established smooth
      // motion and hold the previous value when chroma confidence vanishes,
      // instead of snapping colour/material routes to C during quiet frames.
      harmonic: harmonicConfidence > 0.08
        ? approach(this.snapshot.harmonic, harmonicCenter, 5, safeDt)
        : this.snapshot.harmonic,
      notes: dedupeNotes(notes),
    };
    return this.current();
  }

  current(): AudioSnapshot {
    return { ...this.snapshot, notes: this.snapshot.notes.map((note) => ({ ...note })) };
  }
}

function dedupeNotes(notes: readonly DetectedNote[]): DetectedNote[] {
  const strongest = new Map<number, DetectedNote>();
  for (const note of notes) {
    if (!Number.isInteger(note.midi) || note.midi < 21 || note.midi > 108) continue;
    const existing = strongest.get(note.midi);
    if (!existing || note.strength > existing.strength) strongest.set(note.midi, note);
  }
  return [...strongest.values()]
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 10)
    .sort((left, right) => left.midi - right.midi);
}
