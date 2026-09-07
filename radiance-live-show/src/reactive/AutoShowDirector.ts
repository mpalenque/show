import type { AudioSnapshot, SceneId, ShowState } from '../core/types';

const SCENE_ORDER: SceneId[] = ['fluid', 'blocks', 'voronoi', 'depth-sort'];

const clamp = (value: number, min = 0, max = 1): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const approach = (from: number, to: number, speed: number, dt: number): number => (
  from + (to - from) * (1 - Math.exp(-speed * clamp(dt, 0.001, 0.1)))
);

export interface DirectorTelemetry {
  enabled: boolean;
  scene: SceneId;
  look: string;
  moment: string;
  sceneProgress: number;
  lookProgress: number;
  climax: number;
}

export interface DirectorCue {
  enabled: boolean;
  scene: SceneId;
  look: string;
  parameterTargets: Record<string, number>;
  telemetry: DirectorTelemetry;
}

interface MusicalEnvelope {
  energy: number;
  slowEnergy: number;
  bass: number;
  mid: number;
  treble: number;
  flux: number;
  onset: number;
  harmonicConfidence: number;
  harmonicSpread: number;
  climax: number;
}

/**
 * Output-only show director. It chooses ephemeral scenes, looks and targets;
 * it never mutates ShowState, so disabling it restores the authored manual
 * show on the very next frame.
 */
export class AutoShowDirector {
  private active = false;
  private currentScene: SceneId = 'fluid';
  private currentLook = 'reactive-original';
  private lastManualScene: SceneId = 'fluid';
  private lastRun = -1;
  private sceneStartedAt = 0;
  private lookStartedAt = 0;
  private cueIndex = 0;
  private lastAudioSequence = -1;
  private onsetEdge = false;
  private fastEnergy = 0;
  private slowEnergy = 0;
  private transient = 0;
  private unavailable = new Set<SceneId>();

  update(show: ShowState, audio: AudioSnapshot, now: number, dt: number): DirectorCue {
    if (!show.automation.enabled) {
      this.resetRuntime(show.scene, now);
      return this.manualCue(show);
    }

    const envelope = this.updateEnvelope(audio, now, dt);
    if (!this.active || this.lastRun !== show.automation.run) {
      this.activate(show.scene, show, envelope, now);
    }

    // Scene buttons remain useful in AUTO: selecting one re-arms the sequence
    // from that engine without changing any of its stored manual controls.
    if (show.scene !== this.lastManualScene) {
      this.lastManualScene = show.scene;
      this.currentScene = show.scene;
      this.sceneStartedAt = now;
      this.lookStartedAt = now;
      this.currentLook = this.chooseLook(this.currentScene, envelope, true);
    }

    if (!show.automation.cycleScenes && this.currentScene !== show.scene) {
      this.currentScene = show.scene;
      this.sceneStartedAt = now;
      this.lookStartedAt = now;
      this.currentLook = this.chooseLook(this.currentScene, envelope, true);
    }

    const sceneDuration = clamp(show.automation.sceneSeconds, 12, 180);
    const sceneElapsed = Math.max(0, now - this.sceneStartedAt);
    const musicalSceneBoundary = this.onsetEdge
      && sceneElapsed >= Math.max(12, sceneDuration * 0.78)
      && envelope.climax >= 0.58;
    if (show.automation.cycleScenes && (sceneElapsed >= sceneDuration || musicalSceneBoundary)) {
      this.advanceScene(show, envelope, now);
    }

    const lookDuration = this.currentScene === 'depth-sort'
      ? Math.max(16, show.automation.lookSeconds)
      : clamp(show.automation.lookSeconds, 3, 60);
    const lookElapsed = Math.max(0, now - this.lookStartedAt);
    const musicalLookBoundary = this.onsetEdge
      && lookElapsed >= lookDuration * 0.72
      && envelope.climax >= 0.42;
    if (this.currentScene !== 'fluid'
      && this.currentScene !== 'blocks'
      && (lookElapsed >= lookDuration || musicalLookBoundary)) {
      this.cueIndex += 1;
      this.currentLook = this.chooseLook(this.currentScene, envelope, false);
      this.lookStartedAt = now;
    }

    const sceneProgress = clamp((now - this.sceneStartedAt) / sceneDuration);
    const lookProgress = this.currentScene === 'fluid'
      ? 0
      : clamp((now - this.lookStartedAt) / lookDuration);
    return {
      enabled: true,
      scene: this.currentScene,
      look: this.currentLook,
      parameterTargets: this.targetsFor(this.currentScene, envelope, now),
      telemetry: {
        enabled: true,
        scene: this.currentScene,
        look: this.currentLook,
        moment: this.currentScene === 'fluid' ? 'director original' : this.currentLook,
        sceneProgress,
        lookProgress,
        climax: envelope.climax,
      },
    };
  }

  markUnavailable(scene: SceneId): void {
    this.unavailable.add(scene);
    if (scene === this.currentScene) this.sceneStartedAt = -Infinity;
  }

  markAvailable(scene: SceneId): void {
    this.unavailable.delete(scene);
  }

  clearUnavailable(): void {
    this.unavailable.clear();
  }

  private manualCue(show: ShowState): DirectorCue {
    const scene = show.scene;
    const look = show.scenes[scene].look;
    return {
      enabled: false,
      scene,
      look,
      parameterTargets: {},
      telemetry: {
        enabled: false,
        scene,
        look,
        moment: 'manual',
        sceneProgress: 0,
        lookProgress: 0,
        climax: 0,
      },
    };
  }

  private resetRuntime(scene: SceneId, now: number): void {
    this.active = false;
    this.currentScene = scene;
    this.lastManualScene = scene;
    this.sceneStartedAt = now;
    this.lookStartedAt = now;
    this.lastAudioSequence = -1;
    this.lastRun = -1;
    this.onsetEdge = false;
    this.fastEnergy = 0;
    this.slowEnergy = 0;
    this.transient = 0;
  }

  private activate(
    scene: SceneId,
    show: ShowState,
    envelope: MusicalEnvelope,
    now: number,
  ): void {
    if (this.lastRun !== show.automation.run) this.unavailable.clear();
    this.active = true;
    this.lastRun = show.automation.run;
    this.currentScene = scene;
    this.lastManualScene = show.scene;
    this.sceneStartedAt = now;
    this.lookStartedAt = now;
    this.cueIndex = 0;
    this.currentLook = this.chooseLook(scene, envelope, true);
  }

  private updateEnvelope(audio: AudioSnapshot, now: number, dt: number): MusicalEnvelope {
    const idleEnergy = 0.28 + Math.sin(now * 0.31) * 0.08 + Math.sin(now * 0.071 + 1.2) * 0.05;
    const idleFlux = 0.32 + Math.sin(now * 0.47 + 2.1) * 0.18;
    const targetEnergy = audio.running ? clamp(audio.rms) : clamp(idleEnergy);
    this.fastEnergy = approach(this.fastEnergy, targetEnergy, 8.5, dt);
    this.slowEnergy = approach(this.slowEnergy, targetEnergy, 1.35, dt);
    this.transient = Math.max(clamp(audio.onset), approach(this.transient, 0, 6.4, dt));
    this.onsetEdge = audio.sequence !== this.lastAudioSequence && audio.onset >= 0.34;
    this.lastAudioSequence = audio.sequence;

    const bass = audio.running ? clamp(audio.bass) : clamp(0.35 + Math.sin(now * 0.19) * 0.16);
    const mid = audio.running ? clamp(audio.mid) : clamp(0.38 + Math.sin(now * 0.23 + 1.4) * 0.14);
    const treble = audio.running ? clamp(audio.treble) : clamp(0.27 + Math.sin(now * 0.37 + 2.8) * 0.13);
    const flux = audio.running ? clamp(audio.flux) : clamp(idleFlux);
    const harmonicConfidence = audio.running
      ? clamp(audio.harmonicConfidence)
      : clamp(0.42 + Math.sin(now * 0.11 + 0.6) * 0.18);
    const harmonicSpread = audio.running
      ? clamp(audio.harmonicSpread)
      : clamp(0.38 + Math.sin(now * 0.13 + 2.2) * 0.16);
    const climax = clamp(
      this.fastEnergy * 0.42
      + this.slowEnergy * 0.2
      + this.transient * 0.2
      + bass * 0.1
      + flux * 0.08,
    );
    return {
      energy: this.fastEnergy,
      slowEnergy: this.slowEnergy,
      bass,
      mid,
      treble,
      flux,
      onset: this.transient,
      harmonicConfidence,
      harmonicSpread,
      climax,
    };
  }

  private advanceScene(show: ShowState, envelope: MusicalEnvelope, now: number): void {
    const currentIndex = Math.max(0, SCENE_ORDER.indexOf(this.currentScene));
    let next = this.currentScene;
    for (let offset = 1; offset <= SCENE_ORDER.length; offset += 1) {
      const candidate = SCENE_ORDER[(currentIndex + offset) % SCENE_ORDER.length];
      if (!this.unavailable.has(candidate)) {
        next = candidate;
        break;
      }
    }
    // If every automatic destination failed, stay on the operator's scene.
    if (this.unavailable.has(next)) next = show.scene;
    this.currentScene = next;
    this.sceneStartedAt = now;
    this.lookStartedAt = now;
    this.cueIndex += 1;
    this.currentLook = this.chooseLook(next, envelope, true);
  }

  private chooseLook(scene: SceneId, envelope: MusicalEnvelope, entering: boolean): string {
    if (scene === 'fluid') return 'reactive-original';
    if (scene === 'blocks') return 'impulse-03';
    if (scene === 'voronoi') {
      if (entering) return envelope.harmonicConfidence + envelope.energy > 0.82 ? 'spectral' : 'forest';
      return this.currentLook === 'forest' ? 'spectral' : 'forest';
    }
    if (entering) {
      if (envelope.climax > 0.72) return 'radiance2';
      if (envelope.energy + envelope.flux > 0.55) return 'radiance';
      return 'sorter';
    }
    const deck = ['sorter', 'radiance', 'radiance2'];
    const current = Math.max(0, deck.indexOf(this.currentLook));
    return deck[(current + 1 + (this.cueIndex % 2)) % deck.length];
  }

  private targetsFor(scene: SceneId, music: MusicalEnvelope, now: number): Record<string, number> {
    const breathe = 0.5 + Math.sin(now * 0.43) * 0.5;
    if (scene === 'fluid') return {};
    if (scene === 'blocks') {
      return {
        density: clamp(0.16 + music.slowEnergy * 0.46 + music.onset * 0.28),
        turbulence: clamp(0.08 + music.flux * 0.68 + music.treble * 0.18),
        tension: clamp(0.06 + music.mid * 0.48 + music.harmonicConfidence * 0.2),
        zoom: clamp(0.91 + music.bass * 0.24 + breathe * 0.06 - music.onset * 0.05, 0.65, 1.85),
      };
    }
    if (scene === 'voronoi') {
      return {
        cells: clamp(44 + music.slowEnergy * 78 + music.flux * 22, 12, 160),
        density: clamp(0.56 + music.bass * 0.68 + music.energy * 0.36, 0, 2),
        turbulence: clamp(0.22 + music.flux * 1.18 + music.treble * 0.3, 0, 2),
        tension: clamp(0.48 + music.mid * 0.78 + music.harmonicConfidence * 0.34, 0, 2),
        pulse: clamp(0.28 + music.onset * 1.42, 0, 2),
        brightness: clamp(0.84 + music.energy * 0.76 + music.treble * 0.22, 0.2, 2.2),
        contrast: clamp(0.92 + music.flux * 0.48 + music.mid * 0.2, 0.5, 2),
        speed: clamp(0.25 + music.treble * 0.92 + music.flux * 0.42, 0, 2),
      };
    }
    return {
      strength: clamp(0.48 + music.energy * 0.72 + music.onset * 0.24, 0, 1.5),
      speed: clamp(0.28 + music.flux * 1.54 + music.treble * 0.32, 0, 2.5),
      depth: clamp(0.58 + music.bass * 1.08 + music.slowEnergy * 0.18, 0, 2),
      spread: clamp(0.5 + music.mid * 0.82 + music.harmonicSpread * 0.48, 0, 2),
      feedback: clamp(0.46 + music.slowEnergy * 0.42 + music.harmonicConfidence * 0.08, 0, 1),
      contrast: clamp(0.9 + music.mid * 0.44 + music.flux * 0.22, 0.5, 2),
      brightness: clamp(0.86 + music.energy * 0.72 + music.onset * 0.18, 0.2, 2),
      cameraZoom: clamp(0.88 + music.bass * 0.24 + breathe * 0.08, 0.4, 2.2),
    };
  }
}

export default AutoShowDirector;
