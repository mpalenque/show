import { SHOW_PROTOCOL_VERSION, type ShowBusMessage } from './types';
import { SCENES } from './manifest';

const CHANNEL_NAME = `radiance-live-show-v${SHOW_PROTOCOL_VERSION}`;
type OutgoingMessage = ShowBusMessage extends infer Message
  ? Message extends ShowBusMessage ? Omit<Message, 'v' | 'sender' | 'at'> : never
  : never;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const SCENE_IDS = new Set(SCENES.map((scene) => scene.id));
const AUDIO_SOURCES = new Set(['rms', 'bass', 'mid', 'treble', 'onset', 'flux', 'centroid', 'harmonic']);
const MODULATION_MODES = new Set(['manual', 'audio', 'hybrid']);

const isParameterState = (value: unknown): boolean => isRecord(value)
  && isFiniteNumber(value.manual)
  && MODULATION_MODES.has(value.mode as string)
  && AUDIO_SOURCES.has(value.source as string)
  && isFiniteNumber(value.amount)
  && isFiniteNumber(value.smoothing)
  && typeof value.invert === 'boolean';

const hasCompleteSceneState = (scenes: Record<string, unknown>): boolean => SCENES.every((manifest) => {
  const scene = scenes[manifest.id];
  if (!isRecord(scene) || typeof scene.look !== 'string' || !isRecord(scene.parameters)) return false;
  return manifest.looks.some((look) => look.id === scene.look)
    && manifest.parameters.every((spec) => isParameterState((scene.parameters as Record<string, unknown>)[spec.id]));
});

const isDetectedNote = (value: unknown): boolean => isRecord(value)
  && isFiniteNumber(value.midi)
  && isFiniteNumber(value.frequency)
  && isFiniteNumber(value.strength);

/** Reject malformed messages before they reach either React application. */
export const isShowBusMessage = (value: unknown): value is ShowBusMessage => {
  if (!isRecord(value)
    || value.v !== SHOW_PROTOCOL_VERSION
    || typeof value.sender !== 'string'
    || !value.sender
    || !isFiniteNumber(value.at)) return false;

  switch (value.type) {
    case 'hello':
    case 'hello-output':
      return true;
    case 'command':
      return value.command === 'snapshot' || value.command === 'reload';
    case 'snapshot':
      return typeof value.dataUrl === 'string';
    case 'output-error':
      return typeof value.message === 'string';
    case 'show-state': {
      const state = value.state;
      return isRecord(state)
        && state.schemaVersion === 2
        && SCENE_IDS.has(state.scene as never)
        && isRecord(state.scenes)
        && hasCompleteSceneState(state.scenes)
        && typeof state.blackout === 'boolean'
        && isFiniteNumber(state.master)
        && (state.quality === 'safe' || state.quality === 'balanced' || state.quality === 'high')
        && isRecord(state.automation)
        && typeof state.automation.enabled === 'boolean'
        && typeof state.automation.cycleScenes === 'boolean'
        && isFiniteNumber(state.automation.intensity)
        && isFiniteNumber(state.automation.sceneSeconds)
        && isFiniteNumber(state.automation.lookSeconds)
        && isFiniteNumber(state.automation.run)
        && isFiniteNumber(state.revision);
    }
    case 'audio-frame': {
      const audio = value.audio;
      return isRecord(audio)
        && typeof audio.running === 'boolean'
        && isFiniteNumber(audio.sequence)
        && isFiniteNumber(audio.timestamp)
        && isFiniteNumber(audio.rms)
        && isFiniteNumber(audio.bass)
        && isFiniteNumber(audio.mid)
        && isFiniteNumber(audio.treble)
        && isFiniteNumber(audio.onset)
        && isFiniteNumber(audio.flux)
        && isFiniteNumber(audio.centroid)
        && isFiniteNumber(audio.harmonicCenter)
        && isFiniteNumber(audio.harmonicConfidence)
        && isFiniteNumber(audio.harmonicSpread)
        && isFiniteNumber(audio.harmonic)
        && Array.isArray(audio.notes)
        && audio.notes.every(isDetectedNote);
    }
    case 'telemetry': {
      const telemetry = value.telemetry;
      return isRecord(telemetry)
        && isFiniteNumber(telemetry.timestamp)
        && typeof telemetry.connected === 'boolean'
        && SCENE_IDS.has(telemetry.scene as never)
        && typeof telemetry.look === 'string'
        && isFiniteNumber(telemetry.fps)
        && isFiniteNumber(telemetry.frameMs)
        && isFiniteNumber(telemetry.frameP95Ms)
        && isFiniteNumber(telemetry.width)
        && isFiniteNumber(telemetry.height)
        && isFiniteNumber(telemetry.dpr)
        && typeof telemetry.automationEnabled === 'boolean'
        && typeof telemetry.automationMoment === 'string'
        && isFiniteNumber(telemetry.automationSceneProgress)
        && isFiniteNumber(telemetry.automationLookProgress)
        && typeof telemetry.renderer === 'string';
    }
    default:
      return false;
  }
};

export class ShowBus {
  readonly id = crypto.randomUUID();
  private readonly channel = new BroadcastChannel(CHANNEL_NAME);
  private listeners = new Set<(message: ShowBusMessage) => void>();

  constructor() {
    this.channel.onmessage = ({ data }) => {
      if (!isShowBusMessage(data) || data.sender === this.id) return;
      this.listeners.forEach((listener) => listener(data));
    };
  }

  subscribe(listener: (message: ShowBusMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message: OutgoingMessage): void {
    this.channel.postMessage({ ...message, v: SHOW_PROTOCOL_VERSION, sender: this.id, at: performance.now() });
  }

  close(): void {
    this.listeners.clear();
    this.channel.close();
  }
}
