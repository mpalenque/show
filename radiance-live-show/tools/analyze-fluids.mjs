// Offline audio analysis for the Fluids show timeline editor.
//
// Reads a PCM WAV, runs a hopped STFT and emits `fluids.analysis.json`:
//   - envelopes  : rms + band energies at ~43 Hz, for drawing under the waveform
//   - onsets     : timbral onset list {t, strength, band} from per-band spectral flux
//   - sections   : coarse structural boundaries from spectral novelty
//   - tempo      : autocorrelation estimate of the onset envelope
//
// Usage: node tools/analyze-fluids.mjs [input.wav] [output.json]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const inputPath = process.argv[2] ?? 'public/audio/fluids.wav';
const outputPath = process.argv[3] ?? 'public/show/fluids.analysis.json';

// --------------------------------------------------------------------- wav

function parseWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file.');
  }
  let offset = 12;
  let format = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(size, buffer.length - dataOffset);
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || dataOffset < 0) throw new Error('Missing fmt or data chunk.');
  if (format.audioFormat !== 1 && format.audioFormat !== 3) {
    throw new Error(`Unsupported WAV format ${format.audioFormat}.`);
  }

  const bytesPerSample = format.bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * format.channels));
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      const at = dataOffset + (frame * format.channels + channel) * bytesPerSample;
      let sample = 0;
      if (format.audioFormat === 3) sample = view.getFloat32(at, true);
      else if (format.bitsPerSample === 16) sample = view.getInt16(at, true) / 32768;
      else if (format.bitsPerSample === 24) {
        const raw = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16);
        sample = (raw > 0x7fffff ? raw - 0x1000000 : raw) / 8388608;
      } else if (format.bitsPerSample === 32) sample = view.getInt32(at, true) / 2147483648;
      sum += sample;
    }
    mono[frame] = sum / format.channels;
  }
  return { ...format, samples: mono };
}

// --------------------------------------------------------------------- fft

function fft(real, imag) {
  const n = real.length;
  for (let index = 1, reversed = 0; index < n; index += 1) {
    let bit = n >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imag[index], imag[reversed]] = [imag[reversed], imag[index]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = -2 * Math.PI / size;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let unitReal = 1;
      let unitImag = 0;
      for (let index = 0; index < half; index += 1) {
        const even = start + index;
        const odd = even + half;
        const oddReal = real[odd] * unitReal - imag[odd] * unitImag;
        const oddImag = real[odd] * unitImag + imag[odd] * unitReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = unitReal * stepReal - unitImag * stepImag;
        unitImag = unitReal * stepImag + unitImag * stepReal;
        unitReal = nextReal;
      }
    }
  }
}

// ---------------------------------------------------------------- analysis

const FRAME = 2048;
const HOP = 512;

const wav = parseWav(readFileSync(inputPath));
const { samples, sampleRate } = wav;
const duration = samples.length / sampleRate;
const frameCount = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
const frameRate = sampleRate / HOP;

const hann = new Float32Array(FRAME);
for (let i = 0; i < FRAME; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

const binHz = sampleRate / FRAME;
const bins = FRAME / 2;
// Envelope bands (energy) and flux bands (timbral onset classification).
const bandEdges = { bass: [20, 250], mid: [250, 2000], high: [2000, 8000], air: [8000, 20000] };
const fluxEdges = { low: [20, 250], mid: [250, 2500], high: [2500, 16000] };

const real = new Float32Array(FRAME);
const imag = new Float32Array(FRAME);
const magnitudes = new Float32Array(bins);
const previous = new Float32Array(bins);

const rmsTrack = new Float32Array(frameCount);
const bandTracks = { bass: new Float32Array(frameCount), mid: new Float32Array(frameCount), high: new Float32Array(frameCount), air: new Float32Array(frameCount) };
const fluxTracks = { low: new Float32Array(frameCount), mid: new Float32Array(frameCount), high: new Float32Array(frameCount) };
const fluxTotal = new Float32Array(frameCount);
const centroidTrack = new Float32Array(frameCount);
// Coarse spectral profile per frame for section novelty (8 log-spaced bands).
const PROFILE_BANDS = 8;
const profile = new Float32Array(frameCount * PROFILE_BANDS);

for (let frame = 0; frame < frameCount; frame += 1) {
  const start = frame * HOP;
  let sumSquares = 0;
  for (let i = 0; i < FRAME; i += 1) {
    const s = samples[start + i];
    sumSquares += s * s;
    real[i] = s * hann[i];
    imag[i] = 0;
  }
  rmsTrack[frame] = Math.sqrt(sumSquares / FRAME);
  fft(real, imag);

  let total = 0;
  let weighted = 0;
  const bandPower = { bass: 0, mid: 0, high: 0, air: 0 };
  const bandFlux = { low: 0, mid: 0, high: 0 };
  let flux = 0;
  for (let bin = 1; bin < bins; bin += 1) {
    const magnitude = Math.hypot(real[bin], imag[bin]) / FRAME;
    magnitudes[bin] = magnitude;
    const power = magnitude * magnitude;
    const hz = bin * binHz;
    total += power;
    weighted += hz * power;
    for (const [name, [lo, hi]] of Object.entries(bandEdges)) {
      if (hz >= lo && hz < hi) bandPower[name] += power;
    }
    const rise = Math.max(0, magnitude - previous[bin]);
    flux += rise;
    for (const [name, [lo, hi]] of Object.entries(fluxEdges)) {
      if (hz >= lo && hz < hi) bandFlux[name] += rise;
    }
    previous[bin] = magnitude;
    // Log position 0..1 over 40..16000 Hz picks the novelty-profile slot.
    const pos = Math.log2(Math.max(hz, 40) / 40) / Math.log2(16000 / 40);
    const slot = Math.min(PROFILE_BANDS - 1, Math.max(0, Math.floor(pos * PROFILE_BANDS)));
    profile[frame * PROFILE_BANDS + slot] += power;
  }
  for (const name of Object.keys(bandTracks)) bandTracks[name][frame] = Math.sqrt(bandPower[name]);
  for (const name of Object.keys(fluxTracks)) fluxTracks[name][frame] = bandFlux[name];
  fluxTotal[frame] = flux;
  centroidTrack[frame] = total > 1e-12 ? weighted / total : 0;
}

// ------------------------------------------------------------------ onsets

function rollingMedian(track, radius) {
  const out = new Float32Array(track.length);
  const window = [];
  for (let i = 0; i < track.length; i += 1) {
    window.length = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(track.length - 1, i + radius); j += 1) {
      window.push(track[j]);
    }
    window.sort((a, b) => a - b);
    out[i] = window[Math.floor(window.length / 2)];
  }
  return out;
}

const medianRadius = Math.round(frameRate * 0.5); // ±0.5 s
const fluxMedian = rollingMedian(fluxTotal, medianRadius);
const sortedFlux = Array.from(fluxTotal).sort((a, b) => a - b);
const fluxScale = sortedFlux[Math.floor(sortedFlux.length * 0.98)] || 1;

const minGap = Math.round(frameRate * 0.07); // 70 ms between onsets
const onsets = [];
let lastOnset = -minGap;
for (let frame = 2; frame < frameCount - 2; frame += 1) {
  const value = fluxTotal[frame];
  const threshold = fluxMedian[frame] * 1.6 + fluxScale * 0.015;
  if (value <= threshold) continue;
  if (value < fluxTotal[frame - 1] || value < fluxTotal[frame + 1]) continue;
  if (value < fluxTotal[frame - 2] || value < fluxTotal[frame + 2]) continue;
  if (frame - lastOnset < minGap) continue;
  lastOnset = frame;
  const low = fluxTracks.low[frame];
  const mid = fluxTracks.mid[frame];
  const high = fluxTracks.high[frame];
  const sum = low + mid + high + 1e-12;
  const shares = { low: low / sum, mid: mid / sum, high: high / sum };
  const band = shares.low >= shares.mid && shares.low >= shares.high ? 'low'
    : shares.high >= shares.mid ? 'high' : 'mid';
  onsets.push({
    t: Number(((frame * HOP + FRAME / 2) / sampleRate).toFixed(3)),
    strength: Number(Math.min(1, (value - threshold) / (fluxScale * 0.6)).toFixed(3)),
    band,
    shares: { low: Number(shares.low.toFixed(2)), mid: Number(shares.mid.toFixed(2)), high: Number(shares.high.toFixed(2)) },
  });
}

// ------------------------------------------------------------------- tempo

function estimateTempo() {
  const envelope = Float32Array.from(fluxTotal);
  let mean = 0;
  for (const v of envelope) mean += v;
  mean /= envelope.length;
  for (let i = 0; i < envelope.length; i += 1) envelope[i] -= mean;
  const minLag = Math.round(frameRate * 60 / 200); // 200 BPM
  const maxLag = Math.round(frameRate * 60 / 55); // 55 BPM
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = 0; i + lag < envelope.length; i += 1) score += envelope[i] * envelope[i + lag];
    score /= envelope.length - lag;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag) return null;
  const bpm = 60 * frameRate / bestLag;
  return Number(bpm.toFixed(1));
}

// ---------------------------------------------------------------- sections

function detectSections() {
  const step = Math.round(frameRate * 0.5); // evaluate every 0.5 s
  const span = Math.round(frameRate * 4); // compare 4 s before vs after
  const novelty = [];
  const meanProfile = (from, to) => {
    const out = new Float64Array(PROFILE_BANDS + 1);
    const lo = Math.max(0, from);
    const hi = Math.min(frameCount, to);
    for (let f = lo; f < hi; f += 1) {
      for (let b = 0; b < PROFILE_BANDS; b += 1) out[b] += profile[f * PROFILE_BANDS + b];
      out[PROFILE_BANDS] += rmsTrack[f];
    }
    const n = Math.max(1, hi - lo);
    for (let b = 0; b <= PROFILE_BANDS; b += 1) out[b] /= n;
    return out;
  };
  for (let center = span; center < frameCount - span; center += step) {
    const before = meanProfile(center - span, center);
    const after = meanProfile(center, center + span);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let b = 0; b < PROFILE_BANDS; b += 1) {
      dot += before[b] * after[b];
      normA += before[b] * before[b];
      normB += after[b] * after[b];
    }
    const cosine = dot / (Math.sqrt(normA * normB) + 1e-18);
    const rmsBefore = before[PROFILE_BANDS];
    const rmsAfter = after[PROFILE_BANDS];
    const rmsJump = Math.abs(rmsAfter - rmsBefore) / (Math.max(rmsBefore, rmsAfter) + 1e-9);
    novelty.push({ frame: center, score: (1 - cosine) + rmsJump * 0.7 });
  }
  const sections = [{ t: 0 }];
  const sorted = [...novelty].sort((a, b) => b.score - a.score);
  const minSectionGap = frameRate * 8; // sections at least 8 s apart
  const picked = [];
  for (const candidate of sorted) {
    if (candidate.score < 0.18) break;
    if (picked.some((p) => Math.abs(p.frame - candidate.frame) < minSectionGap)) continue;
    picked.push(candidate);
    if (picked.length >= 24) break;
  }
  picked.sort((a, b) => a.frame - b.frame);
  for (const p of picked) {
    sections.push({ t: Number((p.frame * HOP / sampleRate).toFixed(2)), score: Number(p.score.toFixed(3)) });
  }
  return sections;
}

// ------------------------------------------------------------------ output

const DOWNSAMPLE = 2; // store envelopes at ~43 Hz
const points = Math.floor(frameCount / DOWNSAMPLE);
const round3 = (v) => Number(v.toFixed(4));
const downsample = (track, normalize) => {
  const out = new Array(points);
  for (let i = 0; i < points; i += 1) {
    let acc = 0;
    for (let j = 0; j < DOWNSAMPLE; j += 1) acc += track[i * DOWNSAMPLE + j];
    out[i] = round3((acc / DOWNSAMPLE) / normalize);
  }
  return out;
};

const percentile = (track, q) => {
  const sorted = Array.from(track).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * q)] || 1;
};

const rmsNorm = percentile(rmsTrack, 0.99);
const sections = detectSections();
const tempo = estimateTempo();

const analysis = {
  version: 1,
  source: inputPath.replace(/\\/g, '/'),
  sampleRate,
  duration: Number(duration.toFixed(3)),
  envelopeRate: Number((frameRate / DOWNSAMPLE).toFixed(3)),
  tempo,
  envelopes: {
    rms: downsample(rmsTrack, rmsNorm),
    bass: downsample(bandTracks.bass, percentile(bandTracks.bass, 0.99)),
    mid: downsample(bandTracks.mid, percentile(bandTracks.mid, 0.99)),
    high: downsample(bandTracks.high, percentile(bandTracks.high, 0.99)),
    air: downsample(bandTracks.air, percentile(bandTracks.air, 0.99)),
    flux: downsample(fluxTotal, fluxScale),
    centroid: downsample(centroidTrack, 8000),
  },
  onsets,
  sections,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(analysis));

// ------------------------------------------------------------------ report

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const byBand = { low: 0, mid: 0, high: 0 };
for (const onset of onsets) byBand[onset.band] += 1;
console.log(`duration      ${duration.toFixed(2)} s (${fmt(duration)})`);
console.log(`sampleRate    ${sampleRate}`);
console.log(`tempo (est.)  ${tempo ?? '—'} BPM`);
console.log(`onsets        ${onsets.length} (low ${byBand.low} · mid ${byBand.mid} · high ${byBand.high})`);
console.log('sections:');
for (let i = 0; i < sections.length; i += 1) {
  const from = sections[i].t;
  const to = i + 1 < sections.length ? sections[i + 1].t : duration;
  const fromIdx = Math.floor(from * frameRate);
  const toIdx = Math.min(frameCount, Math.floor(to * frameRate));
  let rms = 0;
  let bass = 0;
  let high = 0;
  let count = 0;
  const sectionOnsets = onsets.filter((o) => o.t >= from && o.t < to).length;
  for (let f = fromIdx; f < toIdx; f += 1) {
    rms += rmsTrack[f];
    bass += bandTracks.bass[f];
    high += bandTracks.high[f];
    count += 1;
  }
  rms /= Math.max(1, count);
  const level = rms / rmsNorm;
  const bars = '█'.repeat(Math.max(1, Math.round(level * 20)));
  const density = sectionOnsets / Math.max(1, to - from);
  console.log(`  ${fmt(from).padStart(5)} → ${fmt(to).padStart(5)}  rms ${level.toFixed(2)} ${bars.padEnd(20)} onsets/s ${density.toFixed(1)}`);
}
console.log(`\nwrote ${outputPath}`);
