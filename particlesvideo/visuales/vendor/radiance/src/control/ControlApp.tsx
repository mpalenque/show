import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveAudioAnalyzer } from '../audio';
import type { AudioEngineStatus } from '../audio';
import { ShowBus } from '../core/bus';
import { EMPTY_AUDIO, SCENES, SCENE_MAP, resetShowConfiguration } from '../core/manifest';
import { loadShow, saveShow } from '../core/storage';
import { FLUID_OPENING_SCENE_OPTIONS } from '../scenes/fluid/parameter-specs';
import type {
  AudioSnapshot,
  AudioSource,
  ModulationMode,
  OutputTelemetry,
  ParameterGroup,
  ParameterSpec,
  ParameterState,
  QualityLevel,
  SceneId,
  ShowBusMessage,
  ShowState,
} from '../core/types';
import styles from './ControlApp.module.css';

type TabId = 'live' | 'config' | 'audio' | 'system';
type ControlOutbound =
  | { type: 'hello' }
  | { type: 'show-state'; state: ShowState }
  | { type: 'audio-frame'; audio: AudioSnapshot }
  | { type: 'command'; command: 'snapshot' | 'reload' };

const AUDIO_SOURCES: AudioSource[] = ['rms', 'bass', 'mid', 'treble', 'onset', 'flux', 'centroid', 'harmonic'];
const AUDIO_LABELS: Record<AudioSource, string> = {
  rms: 'Energía', bass: 'Graves', mid: 'Medios', treble: 'Agudos', onset: 'Ataque',
  flux: 'Movimiento', centroid: 'Brillo', harmonic: 'Armonía',
};
const MODE_LABELS: Record<ModulationMode, string> = { manual: 'MAN', audio: 'AUTO', hybrid: 'HYB' };
const GROUP_ORDER: ParameterGroup[] = ['live', 'materials', 'emitters', 'physics', 'radiance', 'grade', 'look', 'camera', 'advanced'];
const EMPTY_STATUS: AudioEngineStatus = {
  state: 'idle', running: false, sampleRate: 0, rawRms: 0, latencyMs: null,
  calibrated: false, calibrating: false, error: null,
};

const FLUID_OPENING_CUE_DESCRIPTIONS: Record<number, string> = {
  0: 'Fluid manual, sin cue de apertura.',
  1: 'Arranque oscuro con 500 partículas.',
  2: 'Nace un único Azure desde arriba.',
  3: 'Suma un segundo Azure desde la izquierda.',
  4: 'Suma el tercero desde la derecha y activa choques.',
  5: 'Cambia a Ruby y responde a la energía.',
};

const send = (bus: ShowBus | null, message: ControlOutbound): void => {
  if (!bus) return;
  bus.send(message as Parameters<ShowBus['send']>[0]);
};

const fixed = (value: number | undefined, digits = 1): string => (
  Number.isFinite(value) ? Number(value).toFixed(digits) : '—'
);

const noteName = (midi: number): string => {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};

export default function ControlApp() {
  const [tab, setTab] = useState<TabId>('live');
  const [show, setShow] = useState<ShowState>(() => {
    const saved = loadShow();
    // Every operator session starts from the known-safe opening scene while
    // retaining every saved look, fader and modulation assignment.
    return { ...saved, scene: 'fluid' };
  });
  const [audio, setAudio] = useState<AudioSnapshot>({ ...EMPTY_AUDIO, notes: [] });
  const [audioStatus, setAudioStatus] = useState<AudioEngineStatus>(EMPTY_STATUS);
  const [telemetry, setTelemetry] = useState<OutputTelemetry | null>(null);
  const [outputConnected, setOutputConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busRef = useRef<ShowBus | null>(null);
  const analyzerRef = useRef<LiveAudioAnalyzer | null>(null);
  const showRef = useRef(show);
  const audioRef = useRef(audio);
  const telemetryRef = useRef<OutputTelemetry | null>(null);
  const lastOutputSeen = useRef(-Infinity);

  const scene = SCENE_MAP[show.scene];
  const sceneState = show.scenes[show.scene];

  const mutateShow = useCallback((mutator: (draft: ShowState) => void) => {
    setShow((current) => {
      const next = structuredClone(current);
      mutator(next);
      next.revision = current.revision + 1;
      showRef.current = next;
      return next;
    });
  }, []);

  const updateParameter = useCallback((
    sceneId: SceneId,
    parameterId: string,
    patch: Partial<ParameterState>,
  ) => {
    mutateShow((draft) => Object.assign(draft.scenes[sceneId].parameters[parameterId], patch));
  }, [mutateShow]);

  useEffect(() => {
    const bus = new ShowBus();
    const analyzer = new LiveAudioAnalyzer();
    busRef.current = bus;
    analyzerRef.current = analyzer;
    let lastStatusAt = -Infinity;
    let lastUiAudioAt = -Infinity;
    let previousStatus = analyzer.getStatus();
    const unsubscribeAudio = analyzer.subscribe((status) => {
      const now = performance.now();
      const structuralChange = status.state !== previousStatus.state
        || status.calibrated !== previousStatus.calibrated
        || status.calibrating !== previousStatus.calibrating
        || status.error !== previousStatus.error;
      previousStatus = status;
      if (structuralChange || now - lastStatusAt >= 100) {
        lastStatusAt = now;
        setAudioStatus(status);
      }
    });
    const unsubscribeSnapshots = analyzer.subscribeSnapshots((snapshot) => {
      // Do not use requestAnimationFrame for the show signal. Once the Output
      // window has focus, browsers throttle the Control tab's RAF loop and the
      // visual engine would otherwise receive stale/zero audio.
      const now = performance.now();
      audioRef.current = snapshot;
      send(bus, { type: 'audio-frame', audio: snapshot });
      if (now - lastUiAudioAt >= 90 || snapshot.notes.length > 0) {
        lastUiAudioAt = now;
        setAudio(snapshot);
      }
    });
    const unsubscribeBus = bus.subscribe((message) => {
      if (message.type === 'hello-output') {
        lastOutputSeen.current = performance.now();
        setOutputConnected(true);
        send(bus, { type: 'show-state', state: showRef.current });
        send(bus, { type: 'audio-frame', audio: audioRef.current });
      }
      if (message.type === 'telemetry') {
        lastOutputSeen.current = performance.now();
        setOutputConnected(true);
        telemetryRef.current = message.telemetry;
        setTelemetry(message.telemetry);
      }
      if (message.type === 'snapshot') downloadSnapshot(message.dataUrl);
      if (message.type === 'output-error') setNotice(message.message);
    });

    send(bus, { type: 'hello' });
    send(bus, { type: 'show-state', state: showRef.current });

    const connectionTimer = window.setInterval(() => {
      const connected = performance.now() - lastOutputSeen.current < 3_000;
      setOutputConnected(connected);
      if (!connected) {
        telemetryRef.current = null;
        setTelemetry(null);
      }
    }, 500);

    return () => {
      window.clearInterval(connectionTimer);
      unsubscribeSnapshots();
      unsubscribeAudio();
      unsubscribeBus();
      send(bus, {
        type: 'audio-frame',
        audio: {
          ...EMPTY_AUDIO,
          sequence: audioRef.current.sequence + 1,
          timestamp: performance.now() / 1000,
        },
      });
      analyzer.stop();
      bus.close();
      if (busRef.current === bus) busRef.current = null;
      if (analyzerRef.current === analyzer) analyzerRef.current = null;
    };
  }, []);

  useEffect(() => {
    showRef.current = show;
    saveShow(show);
    send(busRef.current, { type: 'show-state', state: show });
  }, [show]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
        || event.altKey
        || event.ctrlKey
        || event.metaKey
      ) return;
      if (event.repeat) return;
      const sceneIndex = Number(event.key) - 1;
      if (sceneIndex >= 0 && sceneIndex < SCENES.length) {
        event.preventDefault();
        mutateShow((draft) => {
          draft.scene = SCENES[sceneIndex].id;
          if (draft.automation.enabled) draft.automation.run += 1;
        });
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        mutateShow((draft) => {
          const manifest = SCENE_MAP[draft.scene];
          const currentLook = draft.scenes[draft.scene].look;
          const currentIndex = Math.max(0, manifest.looks.findIndex((look) => look.id === currentLook));
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          const nextIndex = (currentIndex + direction + manifest.looks.length) % manifest.looks.length;
          draft.scenes[draft.scene].look = manifest.looks[nextIndex].id;
        });
        return;
      }
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        mutateShow((draft) => { draft.blackout = !draft.blackout; });
        return;
      }
      if (event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const enable = !showRef.current.automation.enabled;
        mutateShow((draft) => {
          draft.automation.enabled = enable;
          if (enable) draft.automation.run += 1;
        });
        if (enable && !analyzerRef.current?.getStatus().running) {
          void analyzerRef.current?.start().catch(() => undefined);
        }
        return;
      }
      const hotkeyScene = showRef.current.automation.enabled
        && telemetryRef.current?.automationEnabled
        ? telemetryRef.current.scene
        : showRef.current.scene;
      if (hotkeyScene === 'blocks') {
        const actionByKey: Partial<Record<string, string>> = {
          q: 'toggleGravity',
          w: 'rotate90',
          e: 'toggleEmitterScale',
          r: 'resetBlocks',
        };
        const actionId = actionByKey[event.key.toLowerCase()];
        if (actionId) {
          event.preventDefault();
          mutateShow((draft) => {
            const spec = SCENE_MAP.blocks.parameters.find((parameter) => parameter.id === actionId);
            const parameter = draft.scenes.blocks.parameters[actionId];
            if (!spec || !parameter) return;
            parameter.manual = parameter.manual >= spec.max
              ? spec.min
              : parameter.manual + Math.max(1, spec.step);
          });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mutateShow]);

  const startAudio = useCallback(async () => {
    setNotice(null);
    try {
      await analyzerRef.current?.start();
    } catch {
      // The analyzer publishes the actionable error through its status.
    }
  }, []);

  const openOutput = useCallback(() => {
    const outputUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    outputUrl.searchParams.set('view', 'output');
    window.open(outputUrl, 'radiance-live-output');
  }, []);

  const selectScene = useCallback((id: SceneId) => {
    mutateShow((draft) => {
      draft.scene = id;
      if (draft.automation.enabled) draft.automation.run += 1;
    });
  }, [mutateShow]);

  const toggleAutomation = useCallback(() => {
    const enable = !showRef.current.automation.enabled;
    mutateShow((draft) => {
      draft.automation.enabled = enable;
      if (enable) draft.automation.run += 1;
    });
    // Starting here keeps getUserMedia inside a real user gesture. The
    // director still has deterministic idle motion without microphone input.
    if (enable && !analyzerRef.current?.getStatus().running) {
      void analyzerRef.current?.start().catch(() => undefined);
    }
  }, [mutateShow]);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.logo}>R</span>
          <div><p>RADIANCE LIVE</p><h1>SHOW CONTROL</h1></div>
        </div>
        <div className={styles.headerStatus}>
          <StatusPill active={audioStatus.running} label="AUDIO" value={audioStatus.running ? 'LIVE' : 'OFF'} />
          <StatusPill active={outputConnected} label="OUTPUT" value={outputConnected ? 'LINK' : 'WAIT'} />
          <button className={styles.openOutput} onClick={openOutput}>ABRIR SALIDA ↗</button>
        </div>
      </header>

      <div className={styles.transport}>
        <button
          className={`${styles.blackout} ${show.blackout ? styles.blackoutActive : ''}`}
          onClick={() => mutateShow((draft) => { draft.blackout = !draft.blackout; })}
        >{show.blackout ? 'RESTORE' : 'BLACKOUT'}</button>
        <button
          className={`${styles.autoMode} ${show.automation.enabled ? styles.autoModeActive : ''}`}
          type="button"
          aria-pressed={show.automation.enabled}
          onClick={toggleAutomation}
        >
          <strong>{show.automation.enabled ? 'AUTO REACTIVO' : 'CONTROL MANUAL'}</strong>
          <small>{show.automation.enabled ? 'ESCENAS + PARÁMETROS' : 'FADERS DIRECTOS'}</small>
        </button>
        <label className={styles.master}>
          <span>MASTER <b>{Math.round(show.master * 100)}%</b></span>
          <input type="range" min="0" max="1" step="0.01" value={show.master}
            onChange={(event) => mutateShow((draft) => { draft.master = Number(event.target.value); })} />
        </label>
        <div className={styles.quality} aria-label="Calidad de salida">
          {(['safe', 'balanced', 'high'] as QualityLevel[]).map((quality) => (
            <button key={quality} className={show.quality === quality ? styles.selected : ''}
              onClick={() => mutateShow((draft) => {
                draft.quality = quality;
                if (draft.automation.enabled) draft.automation.run += 1;
              })}>{quality}</button>
          ))}
        </div>
        <div className={styles.transportReadout}>
          <span>{telemetry ? `${fixed(telemetry.fps, 0)} FPS` : '— FPS'}</span>
          <small>{telemetry ? `${fixed(telemetry.frameP95Ms)} ms p95` : 'salida sin telemetría'}</small>
        </div>
      </div>

      <nav className={styles.tabs} aria-label="Secciones de control">
        {(['live', 'config', 'audio', 'system'] as TabId[]).map((id) => (
          <button key={id} className={tab === id ? styles.activeTab : ''} onClick={() => setTab(id)}>{id}</button>
        ))}
      </nav>

      {notice && <div className={styles.notice}><span>{notice}</span><button onClick={() => setNotice(null)}>×</button></div>}
      {audioStatus.error && <div className={styles.error}>{audioStatus.error}</div>}

      <main className={styles.content}>
        {tab === 'live' && (
          <LiveTab show={show} audio={audio} telemetry={telemetry} selectScene={selectScene}
            toggleAutomation={toggleAutomation}
            mutateShow={mutateShow} updateParameter={updateParameter} />
        )}
        {tab === 'config' && (
          <ConfigTab sceneId={show.scene} show={show} audio={audio} updateParameter={updateParameter} />
        )}
        {tab === 'audio' && (
          <AudioTab audio={audio} status={audioStatus} start={startAudio}
            stop={() => analyzerRef.current?.stop()} calibrate={() => analyzerRef.current?.recalibrate()} />
        )}
        {tab === 'system' && (
          <SystemTab connected={outputConnected} telemetry={telemetry} revision={show.revision}
            openOutput={openOutput} snapshot={() => send(busRef.current, { type: 'command', command: 'snapshot' })}
            reload={() => send(busRef.current, { type: 'command', command: 'reload' })}
            reset={() => {
              const confirmed = window.confirm('¿Restablecer todos los looks y controles del show?');
              if (confirmed) setShow((current) => {
                const next = resetShowConfiguration(current);
                showRef.current = next;
                return next;
              });
            }} />
        )}
      </main>

      <footer className={styles.footer}>
        <span className={outputConnected ? styles.good : styles.warn}>{outputConnected ? '● OUTPUT ONLINE' : '● OUTPUT OFFLINE'}</span>
        <span>{show.automation.enabled && telemetry
          ? `AUTO · ${SCENE_MAP[telemetry.scene].name} / ${SCENE_MAP[telemetry.scene].looks.find((look) => look.id === telemetry.look)?.name ?? telemetry.look}`
          : `${scene.name} / ${scene.looks.find((look) => look.id === sceneState.look)?.name}`}</span>
        <span>REV {show.revision}</span>
      </footer>
    </div>
  );
}

function StatusPill({ active, label, value }: { active: boolean; label: string; value: string }) {
  return <div className={`${styles.statusPill} ${active ? styles.statusGood : ''}`}>
    <i /><span>{label}</span><b>{value}</b>
  </div>;
}

function LiveTab({
  show,
  audio,
  telemetry,
  selectScene,
  toggleAutomation,
  mutateShow,
  updateParameter,
}: {
  show: ShowState;
  audio: AudioSnapshot;
  telemetry: OutputTelemetry | null;
  selectScene: (id: SceneId) => void;
  toggleAutomation: () => void;
  mutateShow: (mutator: (draft: ShowState) => void) => void;
  updateParameter: (scene: SceneId, parameter: string, patch: Partial<ParameterState>) => void;
}) {
  const effectiveScene = show.automation.enabled && telemetry?.automationEnabled
    ? telemetry.scene
    : show.scene;
  const manifest = SCENE_MAP[effectiveScene];
  const state = show.scenes[effectiveScene];
  const effectiveLook = show.automation.enabled && telemetry?.automationEnabled
    ? telemetry.look
    : state.look;
  const openingCue = Math.max(0, Math.min(5, Math.round(
    show.scenes.fluid.parameters.openingScene?.manual ?? 0,
  )));
  return <>
    <section className={`${styles.section} ${styles.automationPanel} ${show.automation.enabled ? styles.automationPanelActive : ''}`}>
      <div className={styles.automationIntro}>
        <div>
          <p>SHOW DIRECTOR</p>
          <h2>{show.automation.enabled ? 'Reactivo automático activo' : 'Control manual completo'}</h2>
          <span>{show.automation.enabled
            ? 'La salida varía escenas, looks y parámetros. Tus controles manuales quedan guardados sin cambios.'
            : 'La salida usa exactamente los looks, colores, física y faders configurados abajo.'}</span>
          {show.automation.enabled && telemetry?.automationEnabled && (
            <div className={styles.automationNow}>
              <b>{SCENE_MAP[telemetry.scene].name.replace(/^\d+\s*·\s*/, '')}</b>
              <span>{telemetry.automationMoment} · escena {Math.round(telemetry.automationSceneProgress * 100)}%</span>
              <i><em style={{ transform: `scaleX(${telemetry.automationSceneProgress})` }} /></i>
            </div>
          )}
        </div>
        <button type="button" aria-pressed={show.automation.enabled} onClick={toggleAutomation}>
          {show.automation.enabled ? 'PASAR A MANUAL' : 'ACTIVAR AUTO'}
        </button>
      </div>
      <div className={styles.automationControls}>
        <label>
          <span>MEZCLA DE PARÁMETROS <b>{Math.round(show.automation.intensity * 100)}%</b></span>
          <input type="range" min="0" max="1" step="0.01" value={show.automation.intensity}
            onChange={(event) => mutateShow((draft) => { draft.automation.intensity = Number(event.target.value); })} />
        </label>
        <label>
          <span>ESCENA <b>{Math.round(show.automation.sceneSeconds)} s</b></span>
          <input type="range" min="12" max="90" step="1" value={show.automation.sceneSeconds}
            onChange={(event) => mutateShow((draft) => { draft.automation.sceneSeconds = Number(event.target.value); })} />
        </label>
        <label>
          <span>LOOK / MOMENTO <b>{Math.round(show.automation.lookSeconds)} s</b></span>
          <input type="range" min="3" max="30" step="1" value={show.automation.lookSeconds}
            onChange={(event) => mutateShow((draft) => { draft.automation.lookSeconds = Number(event.target.value); })} />
        </label>
        <button type="button"
          className={show.automation.cycleScenes ? styles.cycleActive : ''}
          aria-pressed={show.automation.cycleScenes}
          onClick={() => mutateShow((draft) => {
            draft.automation.cycleScenes = !draft.automation.cycleScenes;
            if (draft.automation.enabled) draft.automation.run += 1;
          })}>
          {show.automation.cycleScenes ? 'RECORRER TODAS: ON' : 'SÓLO ESCENA ACTUAL'}
        </button>
      </div>
    </section>

    <section className={styles.section}>
      <SectionHeading eyebrow="SHOW FLOW" title="Escena activa"
        detail={show.automation.enabled ? `AUTO ahora: ${SCENE_MAP[effectiveScene].name}` : '1–4'} />
      <div className={styles.sceneGrid}>
        {SCENES.map((item, index) => (
          <button key={item.id} className={`${styles.sceneButton} ${effectiveScene === item.id ? styles.sceneActive : ''}`}
            onClick={() => selectScene(item.id)}>
            <span>0{index + 1}</span><strong>{item.name.replace(/^\d+\s*·\s*/, '')}</strong><small>{item.engine.toUpperCase()}</small>
          </button>
        ))}
      </div>
    </section>

    {effectiveScene === 'fluid' && (
      <section className={`${styles.section} ${styles.openingCuePanel}`}>
        <div className={styles.openingCueHeader}>
          <div>
            <p>APERTURA FLUID</p>
            <h2>Escena inicial del show</h2>
            <span>Elegí un cue completo; queda guardado junto con los controles manuales.</span>
            <small>Al elegirlo, AUTO Reactivo queda pausado y este cue toma la salida inmediatamente.</small>
          </div>
          {show.automation.enabled && (
            <aside>
              <b>AUTO GLOBAL ACTIVO</b>
              <span>Temporalmente manda Reactive original. Elegir un cue pausa AUTO y toma control inmediato.</span>
            </aside>
          )}
        </div>
        <div className={styles.openingCueGrid} role="group" aria-label="Escenas de apertura Fluid">
          {FLUID_OPENING_SCENE_OPTIONS.map((cue) => (
            <button
              key={cue.value}
              type="button"
              className={openingCue === cue.value ? styles.openingCueActive : ''}
              aria-pressed={openingCue === cue.value}
              onClick={() => mutateShow((draft) => {
                draft.automation.enabled = false;
                draft.scene = 'fluid';
                draft.scenes.fluid.parameters.openingScene.manual = cue.value;
                draft.scenes.fluid.look = 'original';
              })}
            >
              <strong>{cue.label}</strong>
              <span>{FLUID_OPENING_CUE_DESCRIPTIONS[cue.value]}</span>
            </button>
          ))}
        </div>
      </section>
    )}

    <div className={styles.twoColumns}>
      <section className={styles.section}>
        <SectionHeading eyebrow="VARIANT" title="Look" detail={manifest.description} />
        <div className={styles.lookGrid}>
          {manifest.looks.map((look) => <button key={look.id}
            className={effectiveLook === look.id ? styles.lookActive : ''}
            onClick={() => mutateShow((draft) => { draft.scenes[effectiveScene].look = look.id; })}>
            <i /><span>{look.name}</span>
          </button>)}
        </div>
      </section>
      <section className={styles.section}>
        <SectionHeading eyebrow="AUDIO BUS" title="Respuesta en vivo" detail={audio.running ? 'analizando' : 'sin entrada'} />
        <div className={styles.miniMeters}>
          {(['rms', 'bass', 'mid', 'treble', 'onset', 'flux'] as AudioSource[]).map((source) => (
            <AudioMeter key={source} source={source} value={audio[source]} compact />
          ))}
        </div>
      </section>
    </div>

    <section className={styles.section}>
      <SectionHeading eyebrow="PERFORMANCE" title="Faders de escena" detail="manual · audio · híbrido" />
      <div className={styles.liveFaders}>
        {manifest.parameters.filter((spec) => spec.live ?? spec.group === 'live').map((spec) => {
          const parameter = state.parameters[spec.id];
          return <LiveFader key={spec.id} spec={spec} state={parameter} audio={audio}
            change={(patch) => updateParameter(effectiveScene, spec.id, patch)} />;
        })}
      </div>
    </section>
  </>;
}

function LiveFader({ spec, state, audio, change }: {
  spec: ParameterSpec;
  state: ParameterState;
  audio: AudioSnapshot;
  change: (patch: Partial<ParameterState>) => void;
}) {
  if (!isModulatable(spec)) {
    return <article className={styles.liveFader}>
      <div className={styles.faderTop}><span>{spec.label}</span><b>{formatParameter(state.manual, spec)}</b></div>
      <DirectParameterInput spec={spec} state={state} change={change} compact />
      <small>{spec.description ?? 'control directo de escena'}</small>
    </article>;
  }
  const sourceValue = audio.running ? audio[state.source] : 0;
  return <article className={styles.liveFader}>
    <div className={styles.faderTop}><span>{spec.label}</span><b>{formatParameter(state.manual, spec)}</b></div>
    <div className={styles.sourceTrace}><i style={{ width: `${sourceValue * 100}%` }} /></div>
    <input type="range" min={spec.min} max={spec.max} step={spec.step} value={state.manual}
      onChange={(event) => change({ manual: Number(event.target.value) })} />
    <div className={styles.modeSwitch}>
      {(['manual', 'audio', 'hybrid'] as ModulationMode[]).map((mode) => (
        <button key={mode} className={state.mode === mode ? styles.modeActive : ''}
          onClick={() => change({ mode })}>{MODE_LABELS[mode]}</button>
      ))}
    </div>
    <small>{state.mode === 'manual' ? 'control directo' : `${AUDIO_LABELS[state.source]} × ${fixed(state.amount, 2)}`}</small>
  </article>;
}

function ConfigTab({ sceneId, show, audio, updateParameter }: {
  sceneId: SceneId;
  show: ShowState;
  audio: AudioSnapshot;
  updateParameter: (scene: SceneId, parameter: string, patch: Partial<ParameterState>) => void;
}) {
  const manifest = SCENE_MAP[sceneId];
  const state = show.scenes[sceneId];
  const groups = useMemo(() => GROUP_ORDER
    .map((id) => ({ id, specs: manifest.parameters.filter((spec) => spec.group === id) }))
    .filter((group) => group.specs.length), [manifest]);
  return <>
    <section className={styles.section}>
      <SectionHeading eyebrow="MODULATION MATRIX" title={`Configurar ${manifest.name}`} detail="Cada parámetro conserva su control manual y su fuente de audio." />
      <div className={styles.configLegend}><span>BASE</span><span>MODO</span><span>FUENTE</span><span>CANTIDAD</span><span>SMOOTH</span></div>
    </section>
    {groups.map((group) => <section key={group.id} className={styles.section}>
      <SectionHeading eyebrow={group.id.toUpperCase()} title={groupTitle(group.id)} />
      <div className={styles.configStack}>
        {group.specs.map((spec) => <ParameterConfig key={spec.id} spec={spec}
          state={state.parameters[spec.id]} audio={audio}
          change={(patch) => updateParameter(sceneId, spec.id, patch)} />)}
      </div>
    </section>)}
  </>;
}

function ParameterConfig({ spec, state, audio, change }: {
  spec: ParameterSpec;
  state: ParameterState;
  audio: AudioSnapshot;
  change: (patch: Partial<ParameterState>) => void;
}) {
  if (!isModulatable(spec)) {
    return <article className={`${styles.parameterConfig} ${styles.parameterConfigDirect}`}>
      <div className={styles.parameterName}><strong>{spec.label}</strong><small>{spec.description ?? spec.id}</small></div>
      <DirectParameterInput spec={spec} state={state} change={change} />
    </article>;
  }
  return <article className={styles.parameterConfig}>
    <div className={styles.parameterName}><strong>{spec.label}</strong><small>{spec.id}</small></div>
    <label className={styles.configRange}>
      <input type="range" min={spec.min} max={spec.max} step={spec.step} value={state.manual}
        onChange={(event) => change({ manual: Number(event.target.value) })} />
      <output>{formatParameter(state.manual, spec)}</output>
    </label>
    <div className={styles.configModes}>{(['manual', 'audio', 'hybrid'] as ModulationMode[]).map((mode) => (
      <button key={mode} className={state.mode === mode ? styles.modeActive : ''}
        onClick={() => change({ mode })}>{MODE_LABELS[mode]}</button>
    ))}</div>
    <label className={styles.selectWrap}>
      <select value={state.source} onChange={(event) => change({ source: event.target.value as AudioSource })}>
        {AUDIO_SOURCES.map((source) => <option key={source} value={source}>{AUDIO_LABELS[source]}</option>)}
      </select>
      <i style={{ width: `${(audio.running ? audio[state.source] : 0) * 100}%` }} />
    </label>
    <label className={styles.smallRange}><span>{fixed(state.amount, 2)}</span><input type="range" min="-1" max="1" step="0.01"
      value={state.amount} onChange={(event) => change({ amount: Number(event.target.value) })} /></label>
    <label className={styles.smallRange}><span>{fixed(state.smoothing, 2)} s</span><input type="range" min="0" max="2" step="0.01"
      value={state.smoothing} onChange={(event) => change({ smoothing: Number(event.target.value) })} /></label>
    <button className={`${styles.invert} ${state.invert ? styles.invertActive : ''}`}
      onClick={() => change({ invert: !state.invert })}>INV</button>
  </article>;
}

function AudioTab({ audio, status, start, stop, calibrate }: {
  audio: AudioSnapshot;
  status: AudioEngineStatus;
  start: () => void;
  stop: () => void;
  calibrate: () => void;
}) {
  return <>
    <section className={styles.audioHero}>
      <div className={`${styles.micOrb} ${status.running ? styles.micLive : ''}`}>
        <i style={{ transform: `scale(${0.72 + audio.rms * 0.5})` }} />
        <strong>{status.running ? 'LIVE' : 'MIC'}</strong>
      </div>
      <div className={styles.audioIntro}>
        <p>AUDIO ENGINE</p><h2>{status.running ? 'Entrada activa' : 'Esperando entrada'}</h2>
        <span>{status.sampleRate ? `${status.sampleRate.toLocaleString()} Hz` : 'AudioWorklet de baja latencia'} · {status.latencyMs === null ? '—' : `${fixed(status.latencyMs, 0)} ms`}</span>
        <div className={styles.audioActions}>
          {!status.running
            ? <button className={styles.primary} onClick={start}>INICIAR MICRÓFONO</button>
            : <button onClick={stop}>DETENER</button>}
          <button onClick={calibrate} disabled={!status.running || status.calibrating}>
            {status.calibrating ? 'CALIBRANDO 10 S…' : 'RECALIBRAR'}
          </button>
        </div>
      </div>
      <div className={styles.calibrationState}>
        <span>CALIBRACIÓN</span><strong>{status.calibrated ? 'LISTA' : status.calibrating ? 'EN CURSO' : 'PENDIENTE'}</strong>
        <small>RAW RMS {fixed(status.rawRms, 4)}</small>
      </div>
    </section>
    <section className={styles.section}>
      <SectionHeading eyebrow="FEATURES" title="Análisis global" detail="Las bandas están gateadas por RMS calibrado." />
      <div className={styles.audioMeters}>
        {AUDIO_SOURCES.map((source) => <AudioMeter key={source} source={source} value={audio[source]} />)}
      </div>
    </section>
    <section className={styles.section}>
      <SectionHeading eyebrow="EVENTS" title="Notas detectadas" detail={`${audio.notes.length} ataques en el último bloque`} />
      <div className={styles.noteStrip}>{audio.notes.length
        ? audio.notes.map((note) => <span key={note.midi}>{noteName(note.midi)}<i style={{ height: `${note.strength * 100}%` }} /></span>)
        : <small>— ninguna nota nueva —</small>}</div>
    </section>
  </>;
}

function AudioMeter({ source, value, compact = false }: { source: AudioSource; value: number; compact?: boolean }) {
  return <div className={`${styles.audioMeter} ${compact ? styles.audioMeterCompact : ''}`}>
    <div><span>{AUDIO_LABELS[source]}</span><b>{fixed(value, 2)}</b></div>
    <em><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} /></em>
  </div>;
}

function SystemTab({ connected, telemetry, revision, openOutput, snapshot, reload, reset }: {
  connected: boolean;
  telemetry: OutputTelemetry | null;
  revision: number;
  openOutput: () => void;
  snapshot: () => void;
  reload: () => void;
  reset: () => void;
}) {
  const fpsHealth = telemetry ? Math.min(1, telemetry.fps / 60) : 0;
  const frameHealth = telemetry ? Math.min(1, 16.67 / Math.max(1, telemetry.frameP95Ms)) : 0;
  return <>
    <section className={styles.section}>
      <SectionHeading eyebrow="OUTPUT HOST" title={connected ? 'Salida conectada' : 'Salida desconectada'} detail="BroadcastChannel · misma máquina y navegador" />
      <div className={styles.systemActions}>
        <button className={styles.primary} onClick={openOutput}>ABRIR SALIDA ↗</button>
        <button onClick={snapshot} disabled={!connected}>CAPTURAR FRAME</button>
        <button onClick={reload} disabled={!connected}>RECARGAR SALIDA</button>
        <button className={styles.dangerGhost} onClick={reset}>RESET CONFIG</button>
      </div>
    </section>
    <section className={styles.section}>
      <SectionHeading eyebrow="PERFORMANCE" title="Medidor de salida" detail={telemetry?.renderer ?? 'sin renderer'} />
      <div className={styles.perfGrid}>
        <PerfCard label="FPS" value={telemetry ? fixed(telemetry.fps, 0) : '—'} detail="objetivo 60" health={fpsHealth} />
        <PerfCard label="FRAME" value={telemetry ? `${fixed(telemetry.frameMs)} ms` : '—'} detail={telemetry ? `p95 ${fixed(telemetry.frameP95Ms)} ms` : 'sin datos'} health={frameHealth} />
        <PerfCard label="OUTPUT" value={telemetry ? `${telemetry.width}×${telemetry.height}` : '—'} detail={telemetry ? `DPR ${fixed(telemetry.dpr, 2)}` : 'sin canvas'} health={connected ? 1 : 0} />
        <PerfCard label="SCENE" value={telemetry?.scene ?? '—'} detail={telemetry?.look ?? '—'} health={connected ? 1 : 0} />
      </div>
      {telemetry?.warning && <div className={styles.warningBox}>{telemetry.warning}</div>}
    </section>
    <section className={styles.section}>
      <SectionHeading eyebrow="RENDER DETAILS" title="Recursos" detail={`config revision ${revision}`} />
      <dl className={styles.details}>
        <div><dt>Renderer</dt><dd>{telemetry?.renderer ?? '—'}</dd></div>
        <div><dt>Draw calls</dt><dd>{telemetry?.drawCalls ?? '—'}</dd></div>
        <div><dt>Partículas</dt><dd>{telemetry?.particles?.toLocaleString() ?? '—'}</dd></div>
        <div><dt>Solver</dt><dd>{telemetry?.solverMs === undefined ? '—' : `${fixed(telemetry.solverMs, 2)} ms`}</dd></div>
        <div><dt>Memoria</dt><dd>{telemetry?.memoryMb === undefined ? '—' : `${fixed(telemetry.memoryMb, 0)} MB`}</dd></div>
        <div><dt>Timestamp</dt><dd>{telemetry ? new Date(telemetry.timestamp).toLocaleTimeString() : '—'}</dd></div>
      </dl>
    </section>
  </>;
}

function PerfCard({ label, value, detail, health }: { label: string; value: string; detail: string; health: number }) {
  return <article className={styles.perfCard}><span>{label}</span><strong>{value}</strong><small>{detail}</small>
    <em><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, health))})` }} /></em></article>;
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return <div className={styles.sectionHeading}><div><p>{eyebrow}</p><h2>{title}</h2></div>{detail && <span>{detail}</span>}</div>;
}

function formatParameter(value: number, spec: ParameterSpec): string {
  if (spec.kind === 'color') return numberToHex(value).toUpperCase();
  if (spec.kind === 'toggle') return value >= 0.5 ? 'ON' : 'OFF';
  if (spec.kind === 'action') return 'EJECUTAR';
  if (spec.kind === 'select') return spec.options?.find((option) => option.value === Math.round(value))?.label ?? String(Math.round(value));
  const decimals = spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : 2;
  return `${fixed(value, decimals)}${spec.unit ? ` ${spec.unit}` : ''}`;
}

function groupTitle(group: string): string {
  if (group === 'live') return 'Controles de performance';
  if (group === 'materials') return 'Materiales y colores';
  if (group === 'emitters') return 'Emisores y fuentes de luz';
  if (group === 'look') return 'Imagen y acabado';
  if (group === 'physics') return 'Movimiento y física';
  if (group === 'radiance') return 'Transporte Radiance / HRC';
  if (group === 'grade') return 'Grade global HSCB';
  if (group === 'camera') return 'Cámara';
  return 'Parámetros avanzados';
}

function isModulatable(spec: ParameterSpec): boolean {
  return (spec.kind ?? 'number') === 'number' && spec.modulatable !== false;
}

function numberToHex(value: number): string {
  return `#${Math.max(0, Math.min(0xffffff, Math.round(value))).toString(16).padStart(6, '0')}`;
}

function DirectParameterInput({ spec, state, change, compact = false }: {
  spec: ParameterSpec;
  state: ParameterState;
  change: (patch: Partial<ParameterState>) => void;
  compact?: boolean;
}) {
  if (spec.kind === 'color') {
    return <label className={`${styles.directControl} ${compact ? styles.directControlCompact : ''}`}>
      <input type="color" value={numberToHex(state.manual)}
        onChange={(event) => change({ manual: Number.parseInt(event.target.value.slice(1), 16) })} />
      <output>{numberToHex(state.manual).toUpperCase()}</output>
    </label>;
  }
  if (spec.kind === 'select') {
    const selected = spec.options?.find((option) => option.value === Math.round(state.manual));
    if (spec.options?.some((option) => option.colour)) {
      return <div className={`${styles.optionSwatches} ${compact ? styles.optionSwatchesCompact : ''}`}>
        {spec.options.map((option) => {
          const active = option.value === Math.round(state.manual);
          return <button key={option.value} type="button" aria-pressed={active}
            className={active ? styles.optionSwatchActive : ''}
            onClick={() => change({ manual: option.value })}>
            <i style={{ background: option.colour ?? '#ffffff' }} />
            <span>{option.label}</span>
          </button>;
        })}
      </div>;
    }
    return <label className={`${styles.directControl} ${compact ? styles.directControlCompact : ''}`}>
      <select value={Math.round(state.manual)} onChange={(event) => change({ manual: Number(event.target.value) })}>
        {(spec.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {selected?.colour && <i className={styles.optionColour} style={{ background: selected.colour }} />}
    </label>;
  }
  if (spec.kind === 'toggle') {
    const active = state.manual >= 0.5;
    return <button type="button" className={`${styles.directButton} ${active ? styles.directButtonActive : ''}`}
      onClick={() => change({ manual: active ? 0 : 1 })}>{active ? 'ON' : 'OFF'}</button>;
  }
  if (spec.kind === 'action') {
    return <button type="button" className={styles.actionButton}
      onClick={() => change({ manual: state.manual >= spec.max ? spec.min : state.manual + Math.max(1, spec.step) })}>EJECUTAR</button>;
  }
  return <label className={`${styles.directControl} ${compact ? styles.directControlCompact : ''}`}>
    <input type="range" min={spec.min} max={spec.max} step={spec.step} value={state.manual}
      onChange={(event) => change({ manual: Number(event.target.value) })} />
    <output>{formatParameter(state.manual, spec)}</output>
  </label>;
}

function downloadSnapshot(dataUrl: string): void {
  if (!dataUrl.startsWith('data:image/')) return;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `radiance-live-${new Date().toISOString().replaceAll(':', '-')}.png`;
  link.click();
}

export type { ShowBusMessage };
