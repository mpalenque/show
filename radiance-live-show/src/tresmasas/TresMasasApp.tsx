import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_AUDIO } from '../core/manifest';
import type { QualityLevel, VisualScene } from '../core/types';
import { TRES_MASAS_CUES } from '../scenes/fluid/TresMasasDirector';
import { FLUID_PARAMETER_SPECS } from '../scenes/fluid/parameter-specs';
import { createScene } from '../output/scene-registry';
import './tresmasas.css';

/**
 * Dedicated performance page for the "Tres Masas (show)" look: the Fluid
 * engine boots straight into the cue-driven TresMasasDirector, and the page
 * carries the controls that act on this show. Every tuning value is stored
 * per sub-scene, so each cue can be dialled in independently and keeps what
 * was set for it.
 */

const STORAGE_KEY = 'radiance-tres-masas-page-v2';
const TM_WIDTH = 2688;
const TM_HEIGHT = 1008;
const TM_QUALITY: QualityLevel = 'high';
const LAST_CUE = TRES_MASAS_CUES.length - 1;

/**
 * Supersampling (SSAA) ladder, applied on top of a 1:1 device-pixel match.
 *
 * The logical show frame is always 2688x1008 — that is what the solver and the
 * world mapping use. These multiply the drawing buffer above the number of
 * device pixels the stage actually occupies, and the browser resolves it back
 * down. Anchoring to measured device pixels is the point: a buffer fixed at
 * 2688 is magnified by any viewport that ends up wider than that in device
 * pixels (a HiDPI screen, browser zoom, fullscreen versus windowed), and
 * magnification is what made the same frame look clean in a small window and
 * stepped in fullscreen. The ladder degrades supersampling under load but
 * never drops below 1:1, so the picture cannot get magnified to buy frames.
 */
const SUPERSAMPLE_LADDER = [2, 1.75, 1.5, 1.25, 1] as const;
/** Matches the renderer's own ceiling for the high preset. */
const MAX_RENDER_SCALE = 3;
const TARGET_FPS = 50;
const WARMUP_WINDOWS = 3;
const MEASURE_WINDOW_MS = 1500;

/**
 * Per-cue tuning surface. Adding a control here is one entry: it appears in
 * the panel, is stored per cue and reaches the scene as a parameter. Scale
 * controls multiply what the director authored for the active cue, so its
 * per-cue choreography survives being trimmed.
 */
const TUNING_SPECS = [
  {
    id: 'tresMasasParticleScale', label: 'TAMAÑO PARTÍCULA',
    min: 0.25, max: 8, step: 0.05, def: 1, unit: '×',
  },
  {
    id: 'tresMasasVelocitySensitivity', label: 'SENSIB. VELOCIDAD',
    min: 0.05, max: 12, step: 0.05, def: 3, unit: '×',
  },
  {
    id: 'tresMasasVelocityRange', label: 'RANGO VELOCIDAD',
    min: 0, max: 8, step: 0.05, def: 2.2, unit: '',
  },
  {
    id: 'tresMasasVelocityFloorScale', label: 'PISO VELOCIDAD',
    min: 0, max: 4, step: 0.05, def: 1, unit: '×',
  },
  {
    id: 'tresMasasRadianceScale', label: 'EMISIÓN',
    min: 0, max: 3, step: 0.01, def: 1, unit: '×',
  },
  {
    id: 'tresMasasExposureScale', label: 'EXPOSICIÓN',
    min: 0, max: 3, step: 0.01, def: 1, unit: '×',
  },
  {
    id: 'tresMasasGeoGain', label: 'GEOMETRÍA',
    min: 0, max: 3, step: 0.01, def: 1, unit: '×',
  },
  {
    id: 'tresMasasSharpness', label: 'NITIDEZ BORDES',
    min: 0, max: 1, step: 0.01, def: 0.2, unit: '',
  },
] as const;

type TuningId = typeof TUNING_SPECS[number]['id'];
type CueTuning = Partial<Record<TuningId, number>>;

const TUNING_BY_ID = new Map(TUNING_SPECS.map((spec) => [spec.id, spec]));

const FLUID_DEFAULTS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(FLUID_PARAMETER_SPECS.map((spec) => [spec.id, spec.default])),
);

interface PageControls {
  cue: number;
  hud: boolean;
  master: number;
  blackout: boolean;
}

interface PageStats {
  fps: number;
  particles: number;
  cueId: string;
  cueName: string;
  warning: string;
  scale: number;
}

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
);

const defaultControls = (): PageControls => ({
  cue: 0, hud: true, master: 1, blackout: false,
});

interface StoredPage {
  controls?: Partial<PageControls>;
  tuning?: Record<string, CueTuning>;
}

const load = (): { controls: PageControls; tuning: Record<number, CueTuning> } => {
  const controls = defaultControls();
  const tuning: Record<number, CueTuning> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { controls, tuning };
    const parsed = JSON.parse(raw) as StoredPage;
    controls.cue = Math.round(clamp(Number(parsed.controls?.cue), 0, LAST_CUE));
    controls.master = clamp(Number(parsed.controls?.master), 0, 1);
    controls.hud = typeof parsed.controls?.hud === 'boolean' ? parsed.controls.hud : true;
    // Blackout is never restored: the show must always come back visible.
    for (const [key, values] of Object.entries(parsed.tuning ?? {})) {
      const cue = Number(key);
      if (!Number.isInteger(cue) || cue < 0 || cue > LAST_CUE) continue;
      const clean: CueTuning = {};
      for (const [id, value] of Object.entries(values ?? {})) {
        const spec = TUNING_BY_ID.get(id as TuningId);
        if (!spec || !Number.isFinite(Number(value))) continue;
        clean[spec.id] = clamp(Number(value), spec.min, spec.max);
      }
      tuning[cue] = clean;
    }
  } catch {
    // A damaged snapshot must never stop the show from starting.
  }
  return { controls, tuning };
};

export default function TresMasasApp() {
  const stageRef = useRef<HTMLDivElement>(null);
  // Function form: the snapshot is read once on mount, not on every render.
  const [stored] = useState(load);
  const [controls, setControls] = useState<PageControls>(stored.controls);
  const [tuning, setTuning] = useState<Record<number, CueTuning>>(stored.tuning);
  const [stats, setStats] = useState<PageStats | null>(null);
  const [booting, setBooting] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const controlsRef = useRef(controls);
  const tuningRef = useRef(tuning);

  const update = useCallback((patch: Partial<PageControls>) => {
    setControls((current) => {
      const next = { ...current, ...patch };
      controlsRef.current = next;
      return next;
    });
  }, []);

  const setTuningValue = useCallback((cue: number, id: TuningId, value: number) => {
    setTuning((current) => {
      const next = { ...current, [cue]: { ...current[cue], [id]: value } };
      tuningRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    controlsRef.current = controls;
    tuningRef.current = tuning;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        controls: { ...controls, blackout: false },
        tuning,
      }));
    } catch {
      // Storage can be unavailable; the live page must keep running.
    }
  }, [controls, tuning]);

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    let destroyed = false;
    let raf = 0;
    let scene: VisualScene | null = null;
    let lastNow = performance.now();
    let frames = 0;
    let lastStatsAt = performance.now();
    let consecutiveErrors = 0;
    // The arrow and space keys advance the director inside the scene without
    // going through our cue parameter; mirror the real cue back to the panel.
    let lastSeenCue = controlsRef.current.cue;
    let scaleIndex = 0;
    let slowWindows = 0;
    let windowsAtScale = 0;
    // Device pixels the stage covers horizontally, so the buffer can match it.
    let stageDeviceWidth = TM_WIDTH;

    /**
     * Never below 1:1 with the pixels on screen, never above the renderer's
     * ceiling, supersampled by the current ladder rung in between.
     */
    const renderScaleFor = (): number => {
      const oneToOne = clamp(stageDeviceWidth / TM_WIDTH, 0.5, MAX_RENDER_SCALE);
      return clamp(oneToOne * SUPERSAMPLE_LADDER[scaleIndex], oneToOne, MAX_RENDER_SCALE);
    };

    let appliedDpr = 0;

    /**
     * Publish the device-pixel ceiling and keep the buffer matched to it.
     *
     * CSS cannot read devicePixelRatio, so the cap has to come from here: a
     * literal 2688px cap would present the master across 5376 device pixels
     * on a 200%-scaled display. It is recomputed whenever the ratio changes —
     * browser zoom and moving between monitors both change it, and computing
     * it once at mount left a stale ceiling that silently never applied.
     */
    const measureStage = (): void => {
      const dpr = window.devicePixelRatio || 1;
      if (dpr !== appliedDpr) {
        appliedDpr = dpr;
        host.style.setProperty('--tm-max-width', `${TM_WIDTH / dpr}px`);
      }
      const rect = host.getBoundingClientRect();
      const next = Math.max(1, Math.round(rect.width * dpr));
      if (next === stageDeviceWidth) return;
      stageDeviceWidth = next;
      scene?.resize(TM_WIDTH, TM_HEIGHT, renderScaleFor());
    };

    /**
     * A resolution media query is the dependable signal for a pixel-ratio
     * change: resize and the ResizeObserver both fire while devicePixelRatio
     * still reads its old value. Arm a query that matches the current ratio;
     * when the ratio moves the query stops matching, so the event arrives
     * with the new value already in place, and it fires even while the page
     * is hidden and the render loop is throttled.
     */
    let ratioQuery: MediaQueryList | null = null;
    const onRatioChange = (): void => {
      measureStage();
      armRatioQuery();
    };
    const armRatioQuery = (): void => {
      ratioQuery?.removeEventListener('change', onRatioChange);
      ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      ratioQuery.addEventListener('change', onRatioChange);
    };

    measureStage();
    armRatioQuery();
    const observer = new ResizeObserver(measureStage);
    observer.observe(host);
    window.addEventListener('resize', measureStage);

    const boot = async () => {
      try {
        const created = await createScene('fluid', host, TM_QUALITY);
        if (destroyed) {
          created.dispose();
          return;
        }
        const rect = host.getBoundingClientRect();
        stageDeviceWidth = Math.max(1, Math.round(rect.width * (window.devicePixelRatio || 1)));
        created.resize(TM_WIDTH, TM_HEIGHT, renderScaleFor());
        created.enter?.('tres-masas');
        created.suspend?.(document.hidden);
        scene = created;
        setBooting(false);
      } catch (error) {
        setFatal(error instanceof Error ? error.message : 'No se pudo iniciar la escena Fluid.');
        setBooting(false);
      }
    };
    void boot();

    const tick = (now: number) => {
      if (destroyed) return;
      raf = requestAnimationFrame(tick);
      if (!scene || document.hidden) {
        lastNow = now;
        return;
      }
      const dt = clamp((now - lastNow) / 1000, 0.001, 0.05);
      lastNow = now;
      const current = controlsRef.current;
      const active = tuningRef.current[current.cue] ?? {};
      const params: Record<string, number> = {
        ...FLUID_DEFAULTS,
        tresMasasCue: current.cue,
        tresMasasHud: current.hud ? 1 : 0,
      };
      for (const spec of TUNING_SPECS) {
        params[spec.id] = active[spec.id] ?? spec.def;
      }
      try {
        scene.frame({
          width: TM_WIDTH,
          height: TM_HEIGHT,
          dpr: renderScaleFor(),
          now: now / 1000,
          dt,
          look: 'tres-masas',
          params,
          audio: EMPTY_AUDIO,
          quality: TM_QUALITY,
        });
        consecutiveErrors = 0;
        frames += 1;
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) {
          setFatal(error instanceof Error ? error.message : 'Error durante el render.');
          try { scene.dispose(); } catch { /* The render error remains primary. */ }
          scene = null;
          return;
        }
      }

      // A pixel-ratio change cannot be trusted to arrive as an event: resize
      // and the observer both fire while devicePixelRatio still reports the
      // old value, which measured the new width against the stale ratio and
      // left the frame presented at the wrong size. One comparison per frame
      // costs nothing and makes the sizing self-correcting.
      if ((window.devicePixelRatio || 1) !== appliedDpr) measureStage();

      const canvas = host.querySelector('canvas');
      const realCue = Number(canvas?.dataset.tresMasasCueIndex ?? Number.NaN);
      if (Number.isFinite(realCue) && realCue !== lastSeenCue) {
        lastSeenCue = realCue;
        if (controlsRef.current.cue !== realCue) update({ cue: realCue });
      }

      if (now - lastStatsAt >= MEASURE_WINDOW_MS) {
        const fps = frames * 1000 / Math.max(1, now - lastStatsAt);
        lastStatsAt = now;
        frames = 0;
        windowsAtScale += 1;
        setStats({
          fps,
          particles: Number(canvas?.dataset.tresMasasParticles ?? 0),
          cueId: canvas?.dataset.tresMasasCue ?? TRES_MASAS_CUES[controlsRef.current.cue].id,
          cueName: canvas?.dataset.tresMasasCueName ?? TRES_MASAS_CUES[controlsRef.current.cue].name,
          warning: canvas?.dataset.tresMasasWarning ?? '',
          scale: renderScaleFor(),
        });
        // Two sustained slow windows past warm-up: drop one rung of SSAA.
        if (windowsAtScale > WARMUP_WINDOWS && fps < TARGET_FPS) {
          slowWindows += 1;
          if (slowWindows >= 2 && scaleIndex < SUPERSAMPLE_LADDER.length - 1) {
            scaleIndex += 1;
            slowWindows = 0;
            windowsAtScale = 0;
            scene.resize(TM_WIDTH, TM_HEIGHT, renderScaleFor());
          }
        } else {
          slowWindows = 0;
        }
      }
    };
    raf = requestAnimationFrame(tick);

    const onVisibility = () => scene?.suspend?.(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      ratioQuery?.removeEventListener('change', onRatioChange);
      window.removeEventListener('resize', measureStage);
      document.removeEventListener('visibilitychange', onVisibility);
      try { scene?.dispose(); } catch { /* Teardown must not strand the page. */ }
      scene = null;
    };
    // The loop reads live values through refs; it must mount only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update]);

  // Space also advances the cue via the scene's own listener; drop focus after
  // every click so a focused button never double-fires on the spacebar.
  const press = (action: () => void) => (event: { currentTarget: HTMLButtonElement }) => {
    action();
    event.currentTarget.blur();
  };

  const activeTuning = tuning[controls.cue] ?? {};
  const valueOf = (id: TuningId): number => activeTuning[id] ?? TUNING_BY_ID.get(id)!.def;
  const cueLabel = stats
    ? `${stats.cueId} · ${stats.cueName}`
    : `${TRES_MASAS_CUES[controls.cue].id} · ${TRES_MASAS_CUES[controls.cue].name}`;
  const renderScale = stats?.scale ?? SUPERSAMPLE_LADDER[0];

  return (
    <main className="tm-shell">
      <div ref={stageRef} className="tm-stage" />
      <div className="tm-fade" style={{ opacity: controls.blackout ? 1 : 1 - controls.master }} />
      {booting && <div className="tm-boot">TRES MASAS · INICIANDO</div>}
      {fatal && <div className="tm-error">{fatal}</div>}

      <section className={`tm-panel ${panelOpen ? '' : 'tm-panel-closed'}`} aria-hidden={!panelOpen}>
        <div className="tm-head">
          <h1>TRES MASAS · SHOW</h1>
          <span className="tm-now">{cueLabel} — {controls.cue + 1}/{TRES_MASAS_CUES.length}</span>
          <div className="tm-stats">
            <span>{stats ? `${Math.round(stats.fps)} FPS` : '— FPS'}</span>
            <span>{stats ? `${stats.particles.toLocaleString()} PART` : '— PART'}</span>
            {stats?.warning ? <span className="tm-warn">{stats.warning}</span> : null}
          </div>
          <div className="tm-head-actions">
            <button className="tm-btn" onClick={press(() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen();
            })}>PANTALLA COMPLETA</button>
            <button className="tm-btn" onClick={press(() => setPanelOpen(false))}>OCULTAR</button>
          </div>
        </div>

        <div className="tm-cues" role="group" aria-label="Cues del show Tres Masas">
          {TRES_MASAS_CUES.map((cue, index) => (
            <button
              key={cue.id}
              className={index === controls.cue ? 'tm-cue-active' : ''}
              aria-pressed={index === controls.cue}
              onClick={press(() => update({ cue: index }))}
            >
              <b>{cue.id}</b>
              <span>{cue.name}</span>
              {tuning[index] && Object.keys(tuning[index]).length > 0 && <i className="tm-cue-dot" />}
            </button>
          ))}
        </div>

        <div className="tm-tuning-head">
          <strong>AJUSTES DE {TRES_MASAS_CUES[controls.cue].id}</strong>
          <span>se guardan por subescena al mover el fader</span>
          <button className="tm-btn" onClick={press(() => {
            const source = { ...(tuningRef.current[controls.cue] ?? {}) };
            const next: Record<number, CueTuning> = {};
            for (let cue = 0; cue <= LAST_CUE; cue += 1) next[cue] = { ...source };
            tuningRef.current = next;
            setTuning(next);
          })}>COPIAR A TODOS</button>
          <button className="tm-btn" onClick={press(() => {
            setTuning((current) => {
              const next = { ...current };
              delete next[controls.cue];
              tuningRef.current = next;
              return next;
            });
          })}>RESET CUE</button>
        </div>

        <div className="tm-tuning">
          {TUNING_SPECS.map((spec) => {
            const value = valueOf(spec.id);
            const custom = activeTuning[spec.id] !== undefined;
            return (
              <label key={spec.id} className={custom ? 'tm-tuned' : ''}>
                <span>{spec.label}<b>{value.toFixed(2)}{spec.unit}</b></span>
                <input type="range" min={spec.min} max={spec.max} step={spec.step} value={value}
                  onChange={(event) => setTuningValue(controls.cue, spec.id, Number(event.target.value))} />
              </label>
            );
          })}
        </div>

        <div className="tm-row">
          <button className="tm-btn" disabled={controls.cue <= 0}
            onClick={press(() => update({ cue: Math.max(0, controls.cue - 1) }))}>← ANTERIOR</button>
          <button className="tm-btn" disabled={controls.cue >= LAST_CUE}
            onClick={press(() => update({ cue: Math.min(LAST_CUE, controls.cue + 1) }))}>SIGUIENTE →</button>
          <label className="tm-slider">
            <span>MASTER</span>
            <input type="range" min="0" max="1" step="0.01" value={controls.master}
              onChange={(event) => update({ master: Number(event.target.value) })} />
            <b>{Math.round(controls.master * 100)}%</b>
          </label>
          <button className={`tm-btn ${controls.hud ? 'tm-btn-on' : ''}`} aria-pressed={controls.hud}
            onClick={press(() => update({ hud: !controls.hud }))}>HUD {controls.hud ? 'ON' : 'OFF'}</button>
          <button className={`tm-btn tm-btn-danger ${controls.blackout ? 'tm-btn-on' : ''}`}
            aria-pressed={controls.blackout}
            onClick={press(() => update({ blackout: !controls.blackout }))}>
            {controls.blackout ? 'RESTAURAR' : 'BLACKOUT'}
          </button>
          <span className="tm-hint">
            {`2688×1008 · SSAA ${renderScale.toFixed(2)}× (${Math.round(TM_WIDTH * renderScale)}×${Math.round(TM_HEIGHT * renderScale)}) · ←/→ o ESPACIO`}
          </span>
        </div>
      </section>

      {!panelOpen && (
        <button className="tm-reveal" onClick={press(() => setPanelOpen(true))}>CONTROLES</button>
      )}
    </main>
  );
}
