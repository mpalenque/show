import { createDspState, extractFeatures, rmsOf } from './dsp.ts';

class RadianceFeatureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 4096;
    this.hopSize = 512;
    this.ring = new Float32Array(this.frameSize);
    this.orderedFrame = new Float32Array(this.frameSize);
    this.dsp = createDspState(this.frameSize);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.sinceAnalysis = 0;
    this.calibratingUntil = 0;
    this.calibrationFloor = Infinity;
    this.calibrationPeak = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type !== 'calibrate') return;
      this.calibratingUntil = currentTime + Math.max(1, Number(data.seconds) || 10);
      this.calibrationFloor = Infinity;
      this.calibrationPeak = 0;
      this.port.postMessage({ type: 'calibration', state: 'started' });
    };
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      this.ring[this.writeIndex] = channel[index];
      this.writeIndex = (this.writeIndex + 1) % this.frameSize;
      this.sampleCount += 1;
      this.sinceAnalysis += 1;
      if (this.sampleCount >= this.frameSize && this.sinceAnalysis >= this.hopSize) {
        this.sinceAnalysis = 0;
        this.analyse();
      }
    }
    return true;
  }

  analyse() {
    for (let index = 0; index < this.frameSize; index += 1) {
      this.orderedFrame[index] = this.ring[(this.writeIndex + index) % this.frameSize];
    }
    this.calibrate(rmsOf(this.orderedFrame));
    this.port.postMessage({
      type: 'features',
      frame: extractFeatures(this.orderedFrame, sampleRate, this.dsp, currentTime),
    });
  }

  calibrate(rawRms) {
    if (this.calibratingUntil > 0) {
      this.calibrationFloor = Math.min(this.calibrationFloor, rawRms);
      this.calibrationPeak = Math.max(this.calibrationPeak, rawRms);
      if (currentTime >= this.calibratingUntil) {
        this.dsp.noiseFloor = Number.isFinite(this.calibrationFloor)
          ? Math.max(0.0001, this.calibrationFloor * 1.5)
          : this.dsp.noiseFloor;
        this.dsp.signalPeak = Math.max(this.calibrationPeak, this.dsp.noiseFloor * 4, 0.01);
        this.calibratingUntil = 0;
        this.port.postMessage({
          type: 'calibration',
          state: 'complete',
          noiseFloor: this.dsp.noiseFloor,
          signalPeak: this.dsp.signalPeak,
        });
      }
      return;
    }

    // Slow adaptation follows a new room without pumping during performance.
    this.dsp.noiseFloor = Math.min(
      this.dsp.noiseFloor * 1.0005,
      Math.max(0.0005, rawRms * 0.6),
    );
    this.dsp.signalPeak = Math.max(rawRms, this.dsp.signalPeak * 0.9995);
  }
}

registerProcessor('radiance-feature-processor', RadianceFeatureProcessor);

