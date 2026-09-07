import { useEffect, useRef, useState } from 'react';
import { ShowBus } from '../core/bus';
import { EMPTY_AUDIO, createDefaultShow } from '../core/manifest';
import { ParameterMixer } from '../core/parameter-mixer';
import {
  OUTPUT_TARGET_DPR,
  OUTPUT_TARGET_HEIGHT,
  OUTPUT_TARGET_WIDTH,
} from '../core/output-target';
import type { AudioSnapshot, OutputTelemetry, SceneId, ShowState, VisualScene } from '../core/types';
import { AutoShowDirector, type DirectorCue } from '../reactive/AutoShowDirector';
import { DirectorOverlayMixer } from '../reactive/DirectorOverlayMixer';
import { createScene } from './scene-registry';
import './output.css';

const p95 = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
};

/** Keep the authored Blocks engine alive in AUTO rehearsals without a mic. */
const autoIdleBlocksAudio = (
  source: AudioSnapshot,
  cue: DirectorCue,
  now: number,
): AudioSnapshot => {
  if (!cue.enabled || cue.scene !== 'blocks' || source.running) return source;
  const period = 1.6;
  const beat = Math.floor(now / period);
  const phase = now - beat * period;
  const midi = [48, 55, 60, 67, 72, 79][Math.abs(beat) % 6];
  const attack = phase < 0.12;
  return {
    ...source,
    sequence: 1_000_000_000 + beat,
    timestamp: now,
    onset: attack ? 0.72 : 0,
    notes: attack ? [{
      midi,
      frequency: 440 * 2 ** ((midi - 69) / 12),
      strength: 0.72 + (beat % 3) * 0.07,
    }] : [],
  };
};

export function OutputApp() {
  const stageRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const host = stageRef.current;
    const fade = fadeRef.current;
    const errorView = errorRef.current;
    if (!host || !fade || !errorView) return;

    const bus = new ShowBus();
    const mixer = new ParameterMixer();
    const director = new AutoShowDirector();
    const directorOverlay = new DirectorOverlayMixer();
    let show: ShowState = createDefaultShow();
    let audio: AudioSnapshot = EMPTY_AUDIO;
    let cue: DirectorCue = director.update(show, audio, performance.now() / 1000, 1 / 60);
    let lastAudioFrameAt = -Infinity;
    let scene: VisualScene | null = null;
    let sceneId: SceneId | null = null;
    let sceneLook = '';
    let sceneQuality: ShowState['quality'] | null = null;
    let loadingSceneId: SceneId | null = null;
    let loadingQuality: ShowState['quality'] | null = null;
    let failedRequest: { scene: SceneId; quality: ShowState['quality']; revision: number } | null = null;
    let switchToken = 0;
    let raf = 0;
    let destroyed = false;
    let lastNow = performance.now();
    let lastTelemetryAt = 0;
    let framesSinceTelemetry = 0;
    let frameTimes: number[] = [];
    let consecutiveFrameErrors = 0;
    let lastPublishedError = '';
    let lastPublishedErrorAt = -Infinity;
    // The stage can be a letterboxed preview on the control computer, but the
    // render surface must always be the native show master: 3360 x 1008.
    let size = {
      width: OUTPUT_TARGET_WIDTH,
      height: OUTPUT_TARGET_HEIGHT,
      dpr: OUTPUT_TARGET_DPR,
    };

    const fail = (message: string) => {
      errorView.textContent = message;
      errorView.hidden = false;
      const now = performance.now();
      if (message !== lastPublishedError || now - lastPublishedErrorAt >= 2_000) {
        lastPublishedError = message;
        lastPublishedErrorAt = now;
        bus.send({ type: 'output-error', message });
      }
    };

    const applyOutputTarget = () => {
      size = {
        width: OUTPUT_TARGET_WIDTH,
        height: OUTPUT_TARGET_HEIGHT,
        dpr: OUTPUT_TARGET_DPR,
      };
      scene?.resize(size.width, size.height, size.dpr);
    };

    const switchScene = async (nextId: SceneId, look: string) => {
      const requestedQuality = show.quality;
      if (loadingSceneId === nextId && loadingQuality === requestedQuality) return;
      const token = ++switchToken;
      loadingSceneId = nextId;
      loadingQuality = requestedQuality;
      fade.classList.add('is-dark');
      await new Promise<void>((resolve) => setTimeout(resolve, scene ? 180 : 0));
      if (destroyed || token !== switchToken) return;
      try { scene?.dispose(); } catch (error) {
        fail(error instanceof Error ? error.message : 'No se pudo liberar la escena anterior.');
      }
      scene = null;
      sceneId = null;
      sceneLook = '';
      sceneQuality = null;
      host.replaceChildren();
      let next: VisualScene | null = null;
      try {
        next = await createScene(nextId, host, requestedQuality);
        if (destroyed || token !== switchToken) {
          next.dispose();
          return;
        }
        // AUTO targets can change while an async engine is loading. Apply the
        // latest effective look, never a stale persisted/manual look.
        const activeLook = cue.scene === nextId ? cue.look : look;
        next.resize(size.width, size.height, size.dpr);
        next.enter?.(activeLook);
        next.suspend?.(document.hidden);
        // Publish the engine only after every activation step succeeds. A
        // partially entered GPU scene must never reach the RAF loop.
        scene = next;
        sceneId = nextId;
        sceneLook = activeLook;
        sceneQuality = requestedQuality;
        director.markAvailable(nextId);
        failedRequest = null;
        mixer.reset(nextId);
        directorOverlay.reset(nextId);
        consecutiveFrameErrors = 0;
        frameTimes = [];
        framesSinceTelemetry = 0;
        lastTelemetryAt = performance.now();
        errorView.hidden = true;
        setBooting(false);
        requestAnimationFrame(() => {
          if (!destroyed && token === switchToken) fade.classList.remove('is-dark');
        });
      } catch (error) {
        if (destroyed || token !== switchToken) return;
        try { next?.dispose(); } catch { /* Preserve the original activation error. */ }
        scene = null;
        sceneId = null;
        sceneLook = '';
        sceneQuality = null;
        host.replaceChildren();
        if (show.automation.enabled) director.markUnavailable(nextId);
        failedRequest = { scene: nextId, quality: requestedQuality, revision: show.revision };
        fail(error instanceof Error ? error.message : `No se pudo iniciar ${nextId}.`);
      } finally {
        if (token === switchToken) {
          loadingSceneId = null;
          loadingQuality = null;
        }
      }
    };

    const quarantineActiveScene = (message: string) => {
      const failedScene = scene;
      if (!failedScene) {
        fail(message);
        return;
      }
      const failedId = failedScene.id;
      try { failedScene.dispose(); } catch { /* The render error remains primary. */ }
      scene = null;
      sceneId = null;
      sceneLook = '';
      sceneQuality = null;
      host.replaceChildren();
      fade.classList.add('is-dark');
      failedRequest = { scene: failedId, quality: show.quality, revision: show.revision };
      if (show.automation.enabled) director.markUnavailable(failedId);
      consecutiveFrameErrors = 0;
      fail(message);
    };

    const syncScene = (wantedScene: SceneId, wantedLook: string) => {
      if (loadingSceneId && (loadingSceneId !== wantedScene || loadingQuality !== show.quality)) {
        switchToken += 1;
        loadingSceneId = null;
        loadingQuality = null;
        if (sceneId === wantedScene) fade.classList.remove('is-dark');
      }
      const requestSuppressed = failedRequest?.scene === wantedScene
        && failedRequest.quality === show.quality
        && failedRequest.revision === show.revision;
      if ((sceneId !== wantedScene || sceneQuality !== show.quality) && !requestSuppressed) {
        if (loadingSceneId !== wantedScene || loadingQuality !== show.quality) {
          void switchScene(wantedScene, wantedLook);
        }
      } else if (scene && sceneLook !== wantedLook) {
        try {
          scene.enter?.(wantedLook);
          sceneLook = wantedLook;
        } catch (error) {
          quarantineActiveScene(error instanceof Error ? error.message : 'No se pudo activar el look.');
        }
      }
      fade.classList.toggle('is-blackout', show.blackout);
      fade.style.setProperty('--master-dark', `${1 - show.master}`);
    };

    const unsubscribe = bus.subscribe((message) => {
      if (message.type === 'hello') {
        bus.send({ type: 'hello-output' });
      } else if (message.type === 'show-state') {
        show = message.state;
      } else if (message.type === 'audio-frame') {
        audio = message.audio;
        lastAudioFrameAt = performance.now();
      } else if (message.type === 'command' && message.command === 'reload') {
        location.reload();
      } else if (message.type === 'command' && message.command === 'snapshot') {
        let dataUrl = scene?.snapshot?.() ?? null;
        if (!dataUrl) {
          const canvas = host.querySelector('canvas');
          try { dataUrl = canvas?.toDataURL('image/png') ?? null; } catch { dataUrl = null; }
        }
        if (dataUrl) bus.send({ type: 'snapshot', dataUrl });
      }
    });

    const onVisibility = () => scene?.suspend?.(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    applyOutputTarget();
    syncScene(cue.scene, cue.look);
    bus.send({ type: 'hello-output' });

    const tick = (now: number) => {
      if (destroyed) return;
      raf = requestAnimationFrame(tick);
      const frameStart = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      // A controller can disappear without running its cleanup (crash/closed tab).
      // Never leave a reactive scene frozen on its last non-zero audio frame.
      if (audio.running && now - lastAudioFrameAt > 1_500) {
        audio = {
          ...EMPTY_AUDIO,
          sequence: audio.sequence + 1,
          timestamp: now / 1000,
        };
      }
      cue = director.update(show, audio, now / 1000, dt);
      syncScene(cue.scene, cue.look);
      let rendered = false;
      if (scene && !document.hidden) {
        try {
          // During an async cross-engine transition, keep rendering the
          // outgoing scene with its own base parameters until the fade is dark.
          const renderScene = scene.id;
          const baseParams = mixer.mix(renderScene, show, audio, dt);
          const params = directorOverlay.resolve(
            renderScene,
            baseParams,
            cue,
            show.automation.intensity,
            dt,
          );
          const renderLook = renderScene === cue.scene ? cue.look : sceneLook;
          const sceneAudio = renderScene === cue.scene
            ? autoIdleBlocksAudio(audio, cue, now / 1000)
            : audio;
          scene.frame({ ...size, now: now / 1000, dt, look: renderLook, params, audio: sceneAudio, quality: show.quality });
          consecutiveFrameErrors = 0;
          rendered = true;
        } catch (error) {
          consecutiveFrameErrors += 1;
          const message = error instanceof Error ? error.message : 'Error durante el render.';
          if (consecutiveFrameErrors >= 3) quarantineActiveScene(message);
          else fail(message);
        }
      }
      if (rendered) {
        frameTimes.push(performance.now() - frameStart);
        if (frameTimes.length > 240) frameTimes.shift();
        framesSinceTelemetry += 1;
      }
      if (now - lastTelemetryAt >= 500 && scene) {
        const elapsed = Math.max(1, now - lastTelemetryAt);
        let runtime: ReturnType<VisualScene['telemetry']>;
        try {
          runtime = scene.telemetry();
        } catch (error) {
          quarantineActiveScene(error instanceof Error ? error.message : 'Error leyendo telemetría de escena.');
          lastTelemetryAt = now;
          framesSinceTelemetry = 0;
          return;
        }
        const outputCanvas = host.querySelector('canvas');
        const renderedDpr = outputCanvas && size.width > 0
          ? outputCanvas.width / size.width
          : size.dpr;
        const telemetry: OutputTelemetry = {
          timestamp: Date.now(), connected: true, scene: scene.id,
          look: sceneLook,
          automationEnabled: cue.enabled,
          automationMoment: cue.telemetry.moment,
          automationSceneProgress: cue.telemetry.sceneProgress,
          automationLookProgress: cue.telemetry.lookProgress,
          fps: framesSinceTelemetry * 1000 / elapsed,
          frameMs: frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, frameTimes.length),
          frameP95Ms: p95(frameTimes), ...size, dpr: renderedDpr, ...runtime,
        };
        bus.send({ type: 'telemetry', telemetry });
        lastTelemetryAt = now;
        framesSinceTelemetry = 0;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      destroyed = true;
      switchToken += 1;
      cancelAnimationFrame(raf);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      try { scene?.dispose(); } catch { /* Teardown must not strand the output window. */ }
      bus.close();
    };
  }, []);

  return (
    <main className="output-shell">
      <div ref={stageRef} className="output-stage" />
      <div ref={fadeRef} className="output-fade" />
      <div ref={errorRef} className="output-error" hidden />
      {booting && <div className="output-boot">RADIANCE · INICIANDO</div>}
    </main>
  );
}
