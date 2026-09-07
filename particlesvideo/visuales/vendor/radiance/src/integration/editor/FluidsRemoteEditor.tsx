import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioPeaks } from '../../fluids-show/audio-transport';
import RemoteTransport from './RemoteTransport';
import CurveLane, { nextShape } from '../../fluids-show/lanes/CurveLane';
import EventLane from '../../fluids-show/lanes/EventLane';
import GestureLane from '../../fluids-show/lanes/GestureLane';
import WaveformLane from '../../fluids-show/lanes/WaveformLane';
import {
  docHasEdits,
  downloadDoc,
  readDocFile,
} from '../../fluids-show/persistence';
import { parseAnalysis, seedShowDoc, type FluidsAnalysis } from '../../fluids-show/seed';
import {
  CURVE_SPECS,
  EVENT_SPECS,
  GESTURE_MODES,
  FLUIDS_ANALYSIS_PATH,
  FLUIDS_DURATION,
  MIN_EVENT_DUR,
  createId,
  cssToHex,
  emitMaterialAt,
  emptyDoc,
  eventSpec,
  hexToCss,
  makeEvent,
  punchGestures,
  sortEvents,
  type CurveId,
  type GestureClip,
  type GestureMode,
  type GestureSample,
  type ShowDoc,
  type ShowEvent,
  type ShowEventType,
} from '../../fluids-show/show-doc';
import {
  clampView,
  panView,
  secondsPerPixel,
  snapTime,
  timeToX,
  zoomView,
  type TimelineView,
} from '../../fluids-show/timeline-view';
import { useShowDoc } from '../../fluids-show/use-show-doc';
import '../../fluids-show/fluids-editor.css';
import './remote-editor.css';

/** Editor del show original conectado a la salida unica de Visuales. */
/** Refresco del reloj visible; el reloj real corre a rAF. */
const READOUT_MS = 60;
/**
 * El tempo estimado del análisis es 191.4 BPM, que es la subdivisión doble.
 * La grilla útil es la mitad, y arranca apagada porque es una estimación.
 */
const BEAT_BPM = 95.7;
/** Ancho del canal de rótulos; el playhead vive a la derecha de esta columna. */
const GUTTER = 132;

type Selection =
  | { kind: 'key'; curve: CurveId; index: number }
  | { kind: 'event'; id: string }
  | { kind: 'gesture'; id: string }
  | null;

/** Estado del puntero sobre el stage, en fracciones 0..1 del frame lógico. */
interface PointerState {
  active: boolean;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  hasLast: boolean;
}

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

export const formatTime = (seconds: number): string => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
};

interface PageStats {
  fps: number;
  particles: number;
  pps: number;
  capped: boolean;
  warning: string;
  scale: number;
}

export default function FluidsRemoteEditor() {
  const stageRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const transportRef = useRef<RemoteTransport | null>(null);
  if (transportRef.current === null) {
    transportRef.current = new RemoteTransport(FLUIDS_DURATION);
  }
  const transport = transportRef.current;

  /** Indirección: `seek` se define antes que la grabación y la necesita. */
  const commitRecordingRef = useRef<(() => void) | null>(null);
  const store = useShowDoc();
  const { doc, version, mutate, replace, adopt, undo, redo, canUndo, canRedo } = store;

  const [analysis, setAnalysis] = useState<FluidsAnalysis | null>(null);
  const [peaks, setPeaks] = useState<AudioPeaks | null>(null);
  const [view, setView] = useState<TimelineView>({ t0: 0, t1: FLUIDS_DURATION });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [stats, setStats] = useState<PageStats | null>(null);
  const [booting, setBooting] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [master, setMaster] = useState(1);
  const [blackout, setBlackout] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  // LÁPIZ (tecla B): arrastrar sobre una lane de curva DIBUJA a mano alzada.
  const [pencilOn, setPencilOn] = useState(false);
  const [beatGrid, setBeatGrid] = useState(false);
  const [loop, setLoop] = useState<{ from: number; to: number } | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [createType, setCreateType] = useState<ShowEventType>('flash');
  const [showLineLanes, setShowLineLanes] = useState(true);
  const [perform, setPerform] = useState(false);
  const [saveState, setSaveState] = useState<'limpio' | 'guardando' | 'guardado' | 'conflicto'>('limpio');
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Cargar desde salida no vuelve a publicar el documento recibido. */
  const skipNextSave = useRef(true);
  /** El editor espera el documento recuperado o persistido por la salida. */
  const [loadState, setLoadState] = useState<'cargando' | 'guardado' | 'repo' | 'vacio'>('cargando');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewOn, setPreviewOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sceneNumber, setSceneNumber] = useState<string | number>(0);
  const [conflict, setConflict] = useState(false);
  const [gestureMode, setGestureMode] = useState<GestureMode>('drag');
  const [gestureRadius, setGestureRadius] = useState(0.08);
  const [gestureStrength, setGestureStrength] = useState(1);
  const [recArmed, setRecArmed] = useState(false);
  /** Comienzo del rango de punch, o null si no se está grabando. */
  const [recFrom, setRecFrom] = useState<number | null>(null);
  const pointerRef = useRef<PointerState>({
    active: false, x: 0.5, y: 0.5, lastX: 0.5, lastY: 0.5, hasLast: false,
  });
  const recSessionRef = useRef<{ from: number | null; clips: GestureClip[] }>({
    from: null, clips: [],
  });
  const strokeRef = useRef<{ t0: number; samples: GestureSample[] } | null>(null);
  /** Lo que el loop de rAF ejecuta cada frame, siempre en su versión actual. */
  const frameHookRef = useRef<((clock: number, dt: number) => void) | null>(null);

  const duration = doc.duration;
  const viewRef = useRef(view);
  viewRef.current = view;


  const onsetTimes = useMemo(
    () => (analysis ? analysis.onsets.map((onset) => onset.t) : []),
    [analysis],
  );

  const snap = useCallback((t: number, tolerance: number): number => (
    snapOn
      ? snapTime(t, { onsets: onsetTimes, bpm: beatGrid ? BEAT_BPM : null, tolerance })
      : t
  ), [beatGrid, onsetTimes, snapOn]);

  // ------------------------------------------------------------- transporte

  const showOutput = useCallback(() => {
    // Focus the named output without navigating/restarting its running show.
    const output = window.open('', 'vis-salida');
    if (!output) return;
    if (output.location.href === 'about:blank') output.location.replace(new URL('./', window.location.href).href);
    output.focus();
  }, []);

  const togglePlay = useCallback(() => { transport.toggle(); }, [transport]);

  const seek = useCallback((next: number) => {
    // Saltar mientras se graba cerraría el rango de punch en un lugar que no
    // corresponde, así que la toma se cierra primero, donde estaba.
    commitRecordingRef.current?.();
    transport.seek(next);
    setTime(transport.time);
  }, [transport]);

  const stop = useCallback(() => {
    transport.pause();
    transport.seek(0);
    setPlaying(false);
    setTime(0);
  }, [transport]);

  useEffect(() => {
    transport.onEnded = () => {
      setPlaying(false);
      setTime(transport.duration);
    };
    return () => {
      transport.onEnded = null;
    };
  }, [transport]);

  // El análisis del track: onsets para el imán, secciones y forma de la onda.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(FLUIDS_ANALYSIS_PATH);
        if (!response.ok) return;
        const parsed = parseAnalysis(await response.json());
        if (!cancelled && parsed) setAnalysis(parsed);
      } catch {
        // Sin análisis la página sigue: se pierden el imán y la guía visual.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The output alone loads and saves the authoritative show. ACKs preserve
  // this editor's undo stack; incoming changes never overwrite a dirty draft.
  useEffect(() => transport.subscribe((message) => {
    if (message.t === 'document') {
      skipNextSave.current = true;
      adopt(message.doc);
      setLoadState('repo');
      setSaveState('guardado');
      setConflict(false);
    } else if (message.t === 'state') {
      const state = message.state;
      setConnected(true);
      setSceneNumber(state.scene);
      setAudioError(state.error || state.audioError || state.storageError || null);
      setBooting(state.status === 'loading');
      if (typeof state.master === 'number') setMaster(state.master);
      if (typeof state.blackout === 'boolean') setBlackout(state.blackout);
      if ('loop' in state) {
        setLoop(state.loop ? { from: state.loop.from, to: state.loop.to } : null);
        setLoopOn(Boolean(state.loop && state.loop.on !== false));
      }
      if (state.stats) setStats({ fps: 0, particles: 0, pps: 0, capped: false,
        warning: '', scale: 1, ...state.stats });
    } else if (message.t === 'save') {
      setSaveState(message.status);
    } else if (message.t === 'peaks') {
      setPeaks(message.peaks);
    } else if (message.t === 'preview') {
      setPreview(message.url);
    } else if (message.t === 'connection') {
      setConnected(message.connected);
    } else if (message.t === 'output-changed') {
      setPeaks(null);
      setPreview(null);
      if (!message.unsaved) setLoadState('cargando');
    } else if (message.t === 'conflict') {
      setConflict(true);
      setSaveState('conflicto');
      setFatal(message.error);
    } else if (message.t === 'error') {
      setAudioError(message.error);
    }
  }), [adopt, transport]);

  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    transport.updateDocument(doc);
  }, [doc, version, transport]);

  const toggleLoop = useCallback(() => {
    setLoopOn(!loopOn);
    transport.setLoop(!loopOn ? loop : null);
  }, [loop, loopOn, transport]);

  useEffect(() => {
    if (!previewOn) return;
    const request = () => { if (!document.hidden) transport.requestPreview(); };
    request();
    const timer = window.setInterval(request, 500);
    return () => window.clearInterval(timer);
  }, [previewOn, transport]);

  const changeMaster = (value: number) => { setMaster(value); transport.command('master', value); };
  const toggleBlackout = () => { setBlackout(!blackout); transport.command('blackout', !blackout); };

  /**
   * Vuelve a sembrar desde el análisis. `keepEmission` deja intacta la curva
   * de emisión: es la que más se dibuja a mano —dónde escupe la línea y dónde
   * calla— y perderla por resembrar el resto del guion es tirar el trabajo
   * fino. El caudal se adapta solo a la curva que haya, así que una emisión
   * dibujada a mano sigue soltando todas las partículas del show.
   */
  const seedFromAudio = useCallback((keepEmission = false) => {
    if (!analysis) return;
    const warning = keepEmission
      ? 'Sembrar reemplaza las curvas y los eventos actuales, salvo la emisión. ¿Seguir?'
      : 'Sembrar reemplaza las curvas y los eventos actuales. ¿Seguir?';
    if (docHasEdits(doc) && !window.confirm(warning)) return;
    // La curva conservada entra ANTES de sembrar, no pisando el resultado
    // después: hay eventos que se derivan de dónde escupe la línea —de qué
    // color nace cada chorro— y sembrarlos contra una curva que después se
    // descarta los deja corridos de lo que se ve.
    const seeded = seedShowDoc(
      analysis,
      keepEmission ? { keepEmission: doc.curves.emission } : {},
    );
    // La siembra no toca los gestos grabados: son trabajo de otra naturaleza.
    replace({ ...seeded, gestures: doc.gestures });
    setSelection(null);
  }, [analysis, doc, replace]);

  const importDoc = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const imported = await readDocFile(file, duration);
    replace(imported);
    setSelection(null);
  }, [duration, replace]);

  // ---------------------------------------------------------------- gestos

  /**
   * Convierte el stroke en curso en un clip de la toma. Lo llaman tanto
   * soltar el mouse como cerrar la grabación: pausar con el botón apretado
   * tiene que guardar lo que se venía haciendo, no tirarlo.
   */
  const captureStroke = useCallback(() => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    // Una toma ya cerrada no puede recibir clips: su rango de punch se
    // resolvió y este stroke quedaría fuera de él.
    if (!stroke || stroke.samples.length < 2 || recSessionRef.current.from === null) return;
    recSessionRef.current.clips.push({
      id: createId(gestureMode),
      t0: stroke.t0,
      t1: Math.max(stroke.t0 + 0.05, transport.time),
      mode: gestureMode,
      radius: gestureRadius,
      strength: gestureStrength,
      samples: stroke.samples,
    });
  }, [gestureMode, gestureRadius, gestureStrength, transport]);

  /**
   * Cierra la grabación y sobreescribe el rango entero, aunque el operador no
   * haya tocado el mouse en parte de él: grabar encima con silencio borra,
   * como en cualquier DAW. Es lo que hace que regrabar sea confiable.
   */
  const commitRecording = useCallback(() => {
    const session = recSessionRef.current;
    if (session.from === null) return;
    captureStroke();
    const from = session.from;
    const to = Math.max(from, transport.time);
    const clips = session.clips;
    recSessionRef.current = { from: null, clips: [] };
    setRecFrom(null);
    mutate((current) => punchGestures(current, from, to, clips));
  }, [captureStroke, mutate, transport]);

  /**
   * Lo que corre en cada frame del stage: el gesto vivo hacia la escena y, si
   * está grabando, la muestra del stroke. El puntero manda su velocidad
   * calculada contra el frame anterior — dejar que la escena reutilice la
   * última velocidad haría que un puntero quieto siguiera empujando.
   */
  const onFrame = useCallback((clock: number, dt: number) => {
    const pointer = pointerRef.current;
    {
      if (pointer.active) {
        transport.gesture({
          mode: gestureMode,
          x: pointer.x,
          y: pointer.y,
          vx: pointer.hasLast ? (pointer.x - pointer.lastX) / dt : 0,
          vy: pointer.hasLast ? (pointer.y - pointer.lastY) / dt : 0,
          radius: gestureRadius,
          strength: gestureStrength,
        });
      } else {
        transport.gesture(null);
      }
    }
    pointer.lastX = pointer.x;
    pointer.lastY = pointer.y;
    pointer.hasLast = pointer.active;

    const session = recSessionRef.current;
    if (recArmed && transport.playing) {
      if (session.from === null) {
        session.from = clock;
        setRecFrom(clock);
        // Si el operador ya estaba con la mano puesta cuando arrancó la toma,
        // el stroke empieza acá en vez de esperar a que suelte y vuelva.
        if (pointer.active && !strokeRef.current) {
          strokeRef.current = { t0: clock, samples: [{ t: 0, x: pointer.x, y: pointer.y }] };
        }
      }
      const stroke = strokeRef.current;
      if (stroke && pointer.active) {
        const last = stroke.samples[stroke.samples.length - 1];
        // ~60 Hz: el mouse puede reportar mucho más seguido que el render.
        if (!last || clock - stroke.t0 - last.t > 1 / 70) {
          stroke.samples.push({ t: Math.max(0, clock - stroke.t0), x: pointer.x, y: pointer.y });
        }
      }
    } else if (session.from !== null) {
      // Pausar cierra la toma donde se detuvo el reloj visual; Ableton es independiente.
      commitRecording();
    }
  }, [commitRecording, gestureMode, gestureRadius, gestureStrength, recArmed, transport]);

  frameHookRef.current = onFrame;
  commitRecordingRef.current = commitRecording;

  const endStroke = useCallback(() => {
    const pointer = pointerRef.current;
    pointer.active = false;
    pointer.hasLast = false;
    captureStroke();
  }, [captureStroke]);

  const pointerFromEvent = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    };
  };

  // This RAF moves the UI playhead and samples operator gestures only.
  // The output owns the sole solver, renderer, visual clock and — since
  // 2026-09-06 — the show's audio. This editor never plays a sound itself.
  useEffect(() => {
    let raf = 0;
    let lastNow = performance.now();
    let lastReadout = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = clamp((now - lastNow) / 1000, 0.001, 0.1);
      lastNow = now;
      if (document.hidden) return;
      const clock = transport.time;
      frameHookRef.current?.(clock, dt);
      const playhead = playheadRef.current;
      if (playhead?.parentElement) {
        const width = playhead.parentElement.clientWidth;
        const x = timeToX(viewRef.current, clock, width);
        playhead.style.transform = 'translateX(' + x + 'px)';
        playhead.style.opacity = x < -2 || x > width + 2 ? '0' : '1';
      }
      if (now - lastReadout >= READOUT_MS) {
        lastReadout = now;
        setTime(clock);
        setPlaying(transport.playing);
      }
    };
    raf = requestAnimationFrame(tick);
    const release = () => {
      if (document.hidden) {
        pointerRef.current.active = false;
        transport.gesture(null);
        commitRecordingRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', release);
    const beforeClose = (event: BeforeUnloadEvent) => {
      if (transport.hasUnsavedDocument) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeClose);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', release);
      window.removeEventListener('beforeunload', beforeClose);
      transport.dispose();
    };
  }, [transport]);

  // ------------------------------------------------------ zoom, pan, teclas

  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return;
    // Listener nativo y no pasivo: React registra `onWheel` como pasivo, y
    // sin preventDefault la rueda scrollea la página en vez de hacer zoom.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, rect.width - GUTTER);
      const x = clamp(event.clientX - rect.left - GUTTER, 0, width);
      setView((current) => {
        if (event.shiftKey) {
          return panView(current, duration, event.deltaY * secondsPerPixel(current, width));
        }
        const anchor = current.t0 + (x / width) * (current.t1 - current.t0);
        return zoomView(current, duration, anchor, Math.exp(event.deltaY * 0.0015));
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [duration]);

  useEffect(() => {
    setView((current) => clampView(current, duration));
  }, [duration]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'event') {
      mutate((current) => ({
        ...current,
        events: current.events.filter((event) => event.id !== selection.id),
      }));
    } else if (selection.kind === 'gesture') {
      mutate((current) => ({
        ...current,
        gestures: current.gestures.filter((clip) => clip.id !== selection.id),
      }));
    } else {
      mutate((current) => ({
        ...current,
        curves: {
          ...current.curves,
          [selection.curve]: {
            keys: current.curves[selection.curve].keys.filter(
              (_, index) => index !== selection.index,
            ),
          },
        },
      }));
    }
    setSelection(null);
  }, [mutate, selection]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      if (meta && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'Home') {
        event.preventDefault();
        seek(0);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seek(transport.time - (event.shiftKey ? 5 : 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seek(transport.time + (event.shiftKey ? 5 : 1));
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'Tab') {
        // Cicla el shape de la key seleccionada: lineal -> suave -> sostenida.
        if (!selection || selection.kind !== 'key') return;
        event.preventDefault();
        mutate((current) => {
          const keys = current.curves[selection.curve].keys.map((key, index) => (
            index === selection.index ? { ...key, shape: nextShape(key.shape) } : key
          ));
          return { ...current, curves: { ...current.curves, [selection.curve]: { keys } } };
        });
      } else if (event.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else setPerform(false);
      } else if (event.key === 'r' || event.key === 'R') {
        setRecArmed((value) => {
          if (value) commitRecordingRef.current?.();
          return !value;
        });
      } else if (event.key === 'l' || event.key === 'L') {
        toggleLoop();
      } else if (event.key === 's' || event.key === 'S') {
        setSnapOn((value) => !value);
      } else if (event.key === 'b' || event.key === 'B') {
        setPencilOn((value) => !value);
      } else if (event.key === 'f' || event.key === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void stageRef.current?.requestFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelection, mutate, redo, seek, selection, togglePlay, toggleLoop, transport, undo]);

  // ---------------------------------------------------------------- edición

  const setCurve = useCallback((id: CurveId, keys: ShowDoc['curves'][CurveId]) => {
    mutate((current) => ({ ...current, curves: { ...current.curves, [id]: keys } }));
  }, [mutate]);

  const setEvents = useCallback((events: ShowEvent[]) => {
    mutate((current) => ({ ...current, events: sortEvents(events) }));
  }, [mutate]);

  const patchEvent = useCallback((id: string, patch: Partial<ShowEvent>) => {
    mutate((current) => ({
      ...current,
      events: sortEvents(current.events.map(
        (event) => (event.id === id ? { ...event, ...patch } : event),
      )),
    }));
  }, [mutate]);

  const patchEventParam = useCallback((id: string, param: string, value: number) => {
    mutate((current) => ({
      ...current,
      events: current.events.map((event) => (
        event.id === id ? { ...event, params: { ...event.params, [param]: value } } : event
      )),
    }));
  }, [mutate]);

  const selectedEvent = selection?.kind === 'event'
    ? doc.events.find((event) => event.id === selection.id) ?? null
    : null;

  const visibleCurves = useMemo(
    () => CURVE_SPECS.filter((spec) => showLineLanes || !spec.collapsed),
    [showLineLanes],
  );

  /**
   * El rango de punch se deriva del reloj que ya se refresca para el reloj
   * visible: no necesita estado propio ni un render extra por frame.
   */
  const punchRange = recFrom === null ? null : { from: recFrom, to: Math.max(recFrom, time) };

  const selectedGesture = selection?.kind === 'gesture'
    ? doc.gestures.find((clip) => clip.id === selection.id) ?? null
    : null;

  const patchGesture = (id: string, patch: Partial<GestureClip>): void => {
    mutate((current) => ({
      ...current,
      gestures: current.gestures.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)),
    }));
  };

  /** Material que está emitiendo en el playhead: el editor y el director lo
   *  resuelven con la misma función, así que muestran siempre lo mismo. */
  const activeMaterial = emitMaterialAt(doc, time);

  const setMaterialColor = (index: number, hex: number): void => {
    mutate((current) => ({
      ...current,
      materialColors: current.materialColors.map(
        (color, position) => (position === index ? hex : color),
      ),
    }));
  };

  /** Deja un `set-material` en el playhead: de acá en adelante emite ése. */
  const emitMaterial = (index: number): void => {
    mutate((current) => ({
      ...current,
      events: sortEvents([
        ...current.events.filter(
          (event) => !(event.type === 'set-material' && Math.abs(event.t - time) < 0.02),
        ),
        { ...makeEvent('set-material', time), params: { material: index } },
      ]),
    }));
  };

  const laneSnapTolerance = (): number => {
    const width = Math.max(1, (timelineRef.current?.clientWidth ?? 800) - GUTTER);
    return secondsPerPixel(view, width) * 8;
  };

  return (
    <main className={`fs-shell ${perform ? 'fs-perform' : ''}`}>
      <nav className="fs-remote-nav">
        <a className="fs-btn" href="./editor.html">ESCENAS / MIDI</a>
        <a className="fs-btn" href="./" target="vis-salida" onClick={(event) => {
          event.preventDefault(); showOutput();
        }}>ABRIR SALIDA</a>
        <button className="fs-btn" onClick={() => transport.command('scene', '24')}>24 · PREVIA / RESET</button>
        <button className="fs-btn" onClick={() => transport.command('scene', '25')}>25 · PLAY SHOW GRABADO</button>
        <span>{connected ? 'SALIDA · ESCENA ' + sceneNumber : 'ESPERANDO SALIDA'}</span>
        <span>AUDIO EN ABLETON · PLAY VISUAL DESDE EL CUE 25</span>
        <label><input type="checkbox" checked={previewOn}
          onChange={(event) => setPreviewOn(event.target.checked)} /> VISTA PREVIA (2 FPS)</label>
        {conflict && <button className="fs-btn fs-btn-danger" onClick={() => {
          if (!window.confirm('¿Cargar el documento de salida? Exportá primero tu edición para conservarla.')) return;
          transport.reloadDocument(); setFatal(null);
        }}>CARGAR VERSIÓN DE SALIDA</button>}
      </nav>
      <div ref={stageRef} className="fs-stage">
        {previewOn && preview ? <img className="fs-remote-preview" src={preview} alt="Vista previa de la salida" />
          : <div className="fs-remote-placeholder">{connected
            ? 'La imagen corre en la ventana de salida. Podés grabar gestos sobre esta superficie.'
            : 'Abrí la ventana de salida para cargar el show y conectar los controles.'}</div>}
        {/* HUD del stage: tiempo, cuadros y el aviso de que se está grabando.
            Es lo mínimo para operar el show sin mirar la timeline. */}
        <div className="fs-hud">
          <span>{formatTime(time)}</span>
          <span>{stats ? `${Math.round(stats.fps)} FPS` : '— FPS'}</span>
          <span>{stats ? `${stats.particles.toLocaleString()} PART` : '— PART'}</span>
          {stats?.capped ? <b className="fs-hud-warn">CAP</b> : null}
          {recFrom !== null ? <b className="fs-hud-rec">● REC</b> : null}
        </div>
        {/* La captura vive acá y no en el canvas: el puntero del canvas sólo
            sabe hacer drag, y este show necesita atraer, repeler y vórtice. */}
        <div
          className="fs-capture"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = pointerFromEvent(event);
            const pointer = pointerRef.current;
            pointer.active = true;
            pointer.x = point.x;
            pointer.y = point.y;
            pointer.lastX = point.x;
            pointer.lastY = point.y;
            pointer.hasLast = false;
            if (recArmed && transport.playing) {
              strokeRef.current = {
                t0: transport.time,
                samples: [{ t: 0, x: point.x, y: point.y }],
              };
            }
          }}
          onPointerMove={(event) => {
            const pointer = pointerRef.current;
            if (!pointer.active) return;
            const point = pointerFromEvent(event);
            pointer.x = point.x;
            pointer.y = point.y;
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            endStroke();
          }}
          onPointerCancel={endStroke}
          onPointerLeave={() => {
            // Sin captura activa el puntero puede salirse del stage; soltarlo
            // acá evita que el fluido siga sintiendo una mano que ya no está.
            if (pointerRef.current.active) endStroke();
          }}
        />
      </div>

      {booting && <div className="fs-boot">FLUIDS · INICIANDO</div>}
      {fatal && <div className="fs-error">{fatal}</div>}

      {perform && (
        <section className="fs-panel fs-panel-min">
          <button className="fs-btn" onClick={togglePlay}>{playing ? 'PAUSA' : 'PLAY'}</button>
          <span className="fs-clock">{formatTime(time)} / {formatTime(duration)}</span>
          <label className="fs-slider">
            <span>MASTER</span>
            <input type="range" min="0" max="1" step="0.01" value={master}
              onChange={(event) => changeMaster(Number(event.target.value))} />
            <b>{Math.round(master * 100)}%</b>
          </label>
          <button className={`fs-btn fs-btn-danger ${blackout ? 'fs-btn-on' : ''}`}
            aria-pressed={blackout} onClick={toggleBlackout}>
            {blackout ? 'RESTAURAR' : 'BLACKOUT'}
          </button>
          <span className="fs-hint">ESC vuelve al editor · F pantalla completa</span>
        </section>
      )}

      <section className="fs-panel fs-editor-only" inert={loadState === 'cargando'}>
        <div className="fs-transport">
          <button className="fs-btn" onClick={togglePlay}>{playing ? 'PAUSA' : 'PLAY'}</button>
          <button className="fs-btn" onClick={stop}>STOP</button>
          <span className="fs-clock">{formatTime(time)} / {formatTime(duration)}</span>
          <button className={`fs-btn ${loopOn ? 'fs-btn-on' : ''}`} aria-pressed={loopOn}
            onClick={toggleLoop}>
            LOOP {loop ? `${formatTime(loop.from)}–${formatTime(loop.to)}` : 'SIN REGIÓN'}
          </button>
          <button className={`fs-btn ${snapOn ? 'fs-btn-on' : ''}`} aria-pressed={snapOn}
            onClick={() => setSnapOn((value) => !value)}>IMÁN</button>
          <button className={`fs-btn ${pencilOn ? 'fs-btn-on' : ''}`} aria-pressed={pencilOn}
            title="B · arrastrar dibuja la curva a mano alzada"
            onClick={() => setPencilOn((value) => !value)}>LÁPIZ</button>
          <button className={`fs-btn ${beatGrid ? 'fs-btn-on' : ''}`} aria-pressed={beatGrid}
            onClick={() => setBeatGrid((value) => !value)}>GRILLA 96</button>
          <button className="fs-btn" disabled={!canUndo} onClick={undo}>DESHACER</button>
          <button className="fs-btn" disabled={!canRedo} onClick={redo}>REHACER</button>
          <button className="fs-btn" disabled={!analysis} onClick={() => seedFromAudio()}>
            SEMBRAR DESDE AUDIO
          </button>
          <button className="fs-btn" disabled={!analysis} onClick={() => seedFromAudio(true)}
            title="Resiembra todo el guion pero deja la curva de EMISIÓN como está">
            SEMBRAR SIN TOCAR EMISIÓN
          </button>
          <button className="fs-btn" onClick={() => downloadDoc(doc)}>EXPORTAR</button>
          <button className="fs-btn" onClick={() => fileInputRef.current?.click()}>IMPORTAR</button>
          <input
            ref={fileInputRef}
            className="fs-file"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void importDoc(event.target.files?.[0]).catch((error) => setAudioError(String(error)));
              // Permite volver a importar el mismo archivo dos veces seguidas.
              event.target.value = '';
            }}
          />
          <button className="fs-btn fs-btn-danger" onClick={() => {
            if (!window.confirm('Vaciar el show guardado y empezar de cero?')) return;
            replace(emptyDoc(duration));
            setSelection(null);
          }}>VACIAR</button>
          <button className={`fs-btn ${showLineLanes ? 'fs-btn-on' : ''}`} aria-pressed={showLineLanes}
            onClick={() => setShowLineLanes((value) => !value)}>LÍNEA</button>
          <label className="fs-slider">
            <span>MASTER</span>
            <input type="range" min="0" max="1" step="0.01" value={master}
              onChange={(event) => changeMaster(Number(event.target.value))} />
            <b>{Math.round(master * 100)}%</b>
          </label>
          <button className="fs-btn" onClick={() => transport.command('reset')}>
            RESET FLUIDO
          </button>
          <button className={`fs-btn ${perform ? 'fs-btn-on' : ''}`} aria-pressed={perform}
            onClick={() => setPerform((value) => !value)}>SHOW</button>
          <button className={`fs-btn fs-btn-danger ${blackout ? 'fs-btn-on' : ''}`}
            aria-pressed={blackout} onClick={toggleBlackout}>
            {blackout ? 'RESTAURAR' : 'BLACKOUT'}
          </button>
        </div>
        <div className="fs-transport">
          <button
            className={`fs-btn fs-btn-rec ${recArmed ? 'fs-btn-on' : ''}`}
            aria-pressed={recArmed}
            onClick={() => setRecArmed((value) => {
              if (value) commitRecordingRef.current?.();
              return !value;
            })}
          >
            {recArmed ? (recFrom === null ? 'REC ARMADO' : 'GRABANDO') : 'REC'}
          </button>
          <div className="fs-modes" role="group" aria-label="Modo de gesto">
            {GESTURE_MODES.map((mode) => (
              <button
                key={mode.id}
                className={`fs-btn ${gestureMode === mode.id ? 'fs-btn-on' : ''}`}
                aria-pressed={gestureMode === mode.id}
                onClick={() => setGestureMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <label className="fs-slider">
            <span>RADIO</span>
            <input type="range" min="0.02" max="0.25" step="0.005" value={gestureRadius}
              onChange={(event) => setGestureRadius(Number(event.target.value))} />
            <b>{gestureRadius.toFixed(3)}</b>
          </label>
          <label className="fs-slider">
            <span>FUERZA</span>
            <input type="range" min="0.1" max="2" step="0.05" value={gestureStrength}
              onChange={(event) => setGestureStrength(Number(event.target.value))} />
            <b>{gestureStrength.toFixed(2)}</b>
          </label>
          <span className="fs-hint">
            {recArmed
              ? 'con el track sonando, arrastrá sobre la imagen; parar sobreescribe el rango'
              : 'arrastrá sobre la imagen para agarrar el fluido · R arma la grabación'}
          </span>
        </div>
        <div className="fs-transport">
          <span className="fs-label">PALETA</span>
          {doc.materialColors.map((color, index) => (
            <div
              key={index}
              className={`fs-swatch ${index === activeMaterial ? 'fs-swatch-on' : ''}`}
            >
              <input
                type="color"
                value={hexToCss(color)}
                aria-label={`Color del material ${index}`}
                onChange={(event) => setMaterialColor(index, cssToHex(event.target.value))}
              />
              <button className="fs-btn" onClick={() => emitMaterial(index)}>
                EMITIR {index}
              </button>
            </div>
          ))}
          <span className="fs-hint">
            {`emitiendo material ${activeMaterial} · EMITIR deja un cambio en el playhead · `
              + 'el color vive en el material: repintarlo repinta lo ya emitido'}
          </span>
        </div>
        <div className="fs-stats">
          <span>{stats ? `${Math.round(stats.fps)} FPS` : '— FPS'}</span>
          <span>{stats ? `${stats.particles.toLocaleString()} PART` : '— PART'}</span>
          <span>{stats ? `${stats.pps} P/S` : '— P/S'}</span>
          {stats?.capped ? <span className="fs-warn">CAP</span> : null}
          {audioError ? <span className="fs-warn">{audioError}</span> : null}
          {stats?.warning ? <span className="fs-warn">{stats.warning}</span> : null}
          <span>{doc.events.length} EV · {doc.gestures.length} GESTOS · {saveState.toUpperCase()}</span>
          {loadState === 'cargando' && (
            <span className="fs-warn">
              ESPERANDO DOCUMENTO DE SALIDA
            </span>
          )}
          <span className="fs-hint">
            {`RUEDA ZOOM · SHIFT+RUEDA PAN · SHIFT+ARRASTRE EN LA ONDA = LOOP · ESPACIO ←/→ L S F`}
          </span>
        </div>
      </section>

      <div className="fs-timeline fs-editor-only" ref={timelineRef} inert={loadState === 'cargando'}>
        <div className="fs-lanes">
        <div className="fs-lane fs-lane-wave-row">
          <div className="fs-lane-label"><b>ONDA</b><span>onsets · secciones</span></div>
          <div className="fs-lane-body">
            <WaveformLane
              view={view}
              duration={duration}
              peaks={peaks}
              onsets={analysis?.onsets ?? []}
              sections={analysis?.sections ?? []}
              loop={loop}
              punch={punchRange}
              onScrub={seek}
              onLoopDrag={(range) => {
                setLoop(range);
                setLoopOn(Boolean(range));
                transport.setLoop(range);
              }}
            />
          </div>
        </div>

        {visibleCurves.map((spec) => (
          <div className="fs-lane" key={spec.id}>
            <div className="fs-lane-label">
              <b>{spec.label}</b>
              <span>{spec.hint}</span>
            </div>
            <div className="fs-lane-body">
              <CurveLane
                spec={spec}
                curve={doc.curves[spec.id]}
                view={view}
                duration={duration}
                snap={snap}
                pencil={pencilOn}
                selectedIndex={
                  selection?.kind === 'key' && selection.curve === spec.id ? selection.index : null
                }
                onSelect={(index) => setSelection(
                  index === null ? null : { kind: 'key', curve: spec.id, index },
                )}
                onChange={(curve) => setCurve(spec.id, curve)}
              />
            </div>
          </div>
        ))}

        <div className="fs-lane fs-lane-events">
          <div className="fs-lane-label">
            <b>EVENTOS</b>
            <select
              className="fs-select"
              value={createType}
              onChange={(event) => setCreateType(event.target.value as ShowEventType)}
              aria-label="Tipo de evento a crear"
            >
              {EVENT_SPECS.map((spec) => (
                <option key={spec.type} value={spec.type}>{spec.label}</option>
              ))}
            </select>
          </div>
          <div className="fs-lane-body">
            <EventLane
              events={doc.events}
              view={view}
              duration={duration}
              snap={snap}
              selectedId={selection?.kind === 'event' ? selection.id : null}
              createType={createType}
              onSelect={(id) => setSelection(id === null ? null : { kind: 'event', id })}
              onChange={setEvents}
            />
          </div>
        </div>

        <div className="fs-lane fs-lane-gestures">
          <div className="fs-lane-label">
            <b>GESTOS</b>
            <span>{doc.gestures.length} clips</span>
          </div>
          <div className="fs-lane-body">
            <GestureLane
              gestures={doc.gestures}
              view={view}
              duration={duration}
              selectedId={selection?.kind === 'gesture' ? selection.id : null}
              punch={punchRange}
              onSelect={(id) => setSelection(id === null ? null : { kind: 'gesture', id })}
              onChange={(gestures) => mutate((current) => ({ ...current, gestures }))}
            />
          </div>
        </div>

        <div className="fs-playhead-track">
          <div className="fs-playhead" ref={playheadRef} />
        </div>
        </div>
      </div>

      {selectedGesture && !perform && (
        <section className="fs-inspector">
          <div className="fs-inspector-head">
            <strong>GESTO · {selectedGesture.mode.toUpperCase()}</strong>
            <span>
              {formatTime(selectedGesture.t0)}–{formatTime(selectedGesture.t1)}
              {' · '}{selectedGesture.samples.length} muestras
            </span>
            <button className="fs-btn fs-btn-danger" onClick={deleteSelection}>BORRAR</button>
          </div>
          <div className="fs-inspector-params">
            <label>
              <span>RADIO<b>{selectedGesture.radius.toFixed(3)}</b></span>
              <input type="range" min="0.02" max="0.25" step="0.005" value={selectedGesture.radius}
                onChange={(event) => patchGesture(selectedGesture.id, {
                  radius: Number(event.target.value),
                })} />
            </label>
            <label>
              <span>FUERZA<b>{selectedGesture.strength.toFixed(2)}</b></span>
              <input type="range" min="0.1" max="2" step="0.05" value={selectedGesture.strength}
                onChange={(event) => patchGesture(selectedGesture.id, {
                  strength: Number(event.target.value),
                })} />
            </label>
          </div>
        </section>
      )}

      {selectedEvent && !perform && (
        <section className="fs-inspector">
          <div className="fs-inspector-head">
            <strong>{eventSpec(selectedEvent.type).label}</strong>
            <span>{formatTime(selectedEvent.t)}</span>
            <button className="fs-btn fs-btn-danger" onClick={deleteSelection}>BORRAR</button>
          </div>
          <div className="fs-inspector-params">
            <label>
              <span>INTENSIDAD<b>{selectedEvent.intensity.toFixed(2)}</b></span>
              <input type="range" min="0" max="1" step="0.01" value={selectedEvent.intensity}
                onChange={(event) => patchEvent(selectedEvent.id, {
                  intensity: Number(event.target.value),
                })} />
            </label>
            <label>
              <span>DURACIÓN<b>{selectedEvent.dur.toFixed(2)}s</b></span>
              <input type="range" min={MIN_EVENT_DUR} max="8" step="0.01" value={selectedEvent.dur}
                onChange={(event) => patchEvent(selectedEvent.id, {
                  dur: Number(event.target.value),
                })} />
            </label>
            {eventSpec(selectedEvent.type).params.map((param) => (
              <label key={param.id}>
                <span>
                  {param.label}
                  <b>{(selectedEvent.params[param.id] ?? param.def).toFixed(3)}</b>
                </span>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={selectedEvent.params[param.id] ?? param.def}
                  onChange={(event) => patchEventParam(
                    selectedEvent.id, param.id, Number(event.target.value),
                  )}
                />
              </label>
            ))}
          </div>
          <span className="fs-hint">
            {`imán ${snapOn ? `±${(laneSnapTolerance() * 1000).toFixed(0)} ms` : 'apagado'} · B lápiz${pencilOn ? ' ON' : ''} · SUPR borra`}
          </span>
        </section>
      )}
    </main>
  );
}
