import { useRef } from 'react';
import type { AudioPeaks } from '../audio-transport';
import type { AnalysisOnset, AnalysisSection } from '../seed';
import { rulerStep, timeToX, xToTime, type TimelineView } from '../timeline-view';
import { LANE_COLORS, localPoint, tickLabel, useLaneCanvas } from './lane-canvas';

/**
 * Regla + waveform + onsets + secciones, y la superficie de scrubbing.
 *
 * Los onsets son lo que hace editable el show contra el sonido: rojo los
 * graves, blanco los medios, azul los agudos, con la altura de cada marca
 * puesta en su fuerza. Sin ellos, alinear un estrobo a un golpe sería adivinar
 * mirando una mancha.
 */

export interface WaveformLaneProps {
  view: TimelineView;
  duration: number;
  peaks: AudioPeaks | null;
  onsets: AnalysisOnset[];
  sections: AnalysisSection[];
  loop: { from: number; to: number } | null;
  /** Rango que se está regrabando, dibujado en rojo mientras dura. */
  punch: { from: number; to: number } | null;
  onScrub: (time: number) => void;
  onLoopDrag: (range: { from: number; to: number } | null) => void;
}

const RULER_HEIGHT = 16;
const ONSET_HEIGHT = 16;

export default function WaveformLane(props: WaveformLaneProps) {
  const { view, duration, peaks, onsets, sections, loop, punch, onScrub, onLoopDrag } = props;
  const dragRef = useRef<{ mode: 'scrub' | 'loop'; from: number } | null>(null);

  const { canvasRef } = useLaneCanvas((ctx, width, height) => {
    const waveTop = RULER_HEIGHT;
    const waveHeight = Math.max(8, height - RULER_HEIGHT - ONSET_HEIGHT);
    const waveMid = waveTop + waveHeight / 2;

    ctx.fillStyle = LANE_COLORS.background;
    ctx.fillRect(0, 0, width, height);

    if (loop) {
      ctx.fillStyle = LANE_COLORS.loop;
      const x0 = timeToX(view, loop.from, width);
      ctx.fillRect(x0, 0, timeToX(view, loop.to, width) - x0, height);
    }
    if (punch) {
      ctx.fillStyle = LANE_COLORS.punch;
      const x0 = timeToX(view, punch.from, width);
      ctx.fillRect(x0, 0, Math.max(1, timeToX(view, punch.to, width) - x0), height);
    }

    // Regla.
    const step = rulerStep(view, width);
    ctx.strokeStyle = LANE_COLORS.grid;
    ctx.fillStyle = LANE_COLORS.text;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) {
      const x = Math.round(timeToX(view, t, width)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.fillText(tickLabel(t, step), x + 3, 3);
    }
    ctx.stroke();

    // Waveform: una columna de píxel por cubeta visible.
    if (peaks) {
      ctx.strokeStyle = LANE_COLORS.wave;
      ctx.beginPath();
      const scale = waveHeight / 2;
      for (let x = 0; x < width; x += 1) {
        const from = xToTime(view, x, width);
        const to = xToTime(view, x + 1, width);
        const bucketFrom = Math.max(0, Math.floor(from * peaks.rate));
        const bucketTo = Math.min(peaks.count - 1, Math.ceil(to * peaks.rate));
        if (bucketTo < bucketFrom) continue;
        let min = 0;
        let max = 0;
        for (let bucket = bucketFrom; bucket <= bucketTo; bucket += 1) {
          const low = peaks.data[bucket * 2];
          const high = peaks.data[bucket * 2 + 1];
          if (low < min) min = low;
          if (high > max) max = high;
        }
        ctx.moveTo(x + 0.5, waveMid - max * scale);
        ctx.lineTo(x + 0.5, waveMid - min * scale);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = LANE_COLORS.text;
      ctx.fillText('ONDA DE REFERENCIA NO DISPONIBLE', 8, waveMid - 4);
    }

    // Secciones: guía visual, no editables.
    ctx.strokeStyle = LANE_COLORS.section;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const section of sections) {
      if (section.t <= 0 || section.t < view.t0 || section.t > view.t1) continue;
      const x = Math.round(timeToX(view, section.t, width)) + 0.5;
      ctx.moveTo(x, RULER_HEIGHT);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Onsets, por banda y con la fuerza en la altura.
    const onsetTop = height - ONSET_HEIGHT;
    for (const onset of onsets) {
      if (onset.t < view.t0 || onset.t > view.t1) continue;
      const x = Math.round(timeToX(view, onset.t, width)) + 0.5;
      const size = 3 + onset.strength * (ONSET_HEIGHT - 4);
      ctx.strokeStyle = onset.band === 'low' ? LANE_COLORS.onsetLow
        : onset.band === 'high' ? LANE_COLORS.onsetHigh
        : LANE_COLORS.onsetMid;
      ctx.globalAlpha = 0.35 + onset.strength * 0.65;
      ctx.beginPath();
      ctx.moveTo(x, height);
      ctx.lineTo(x, height - size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [view.t0, view.t1, peaks?.data, peaks?.rate, peaks?.count,
    onsets.length ? onsets : null, sections.length ? sections : null,
    loop?.from, loop?.to, punch?.from, punch?.to]);

  const timeAt = (event: React.PointerEvent): number => {
    const canvas = canvasRef.current;
    const { x } = localPoint(event, canvas);
    const width = canvas?.getBoundingClientRect().width ?? 1;
    return Math.max(0, Math.min(duration, xToTime(view, x, width)));
  };

  return (
    <canvas
      ref={canvasRef}
      className="fs-lane-canvas fs-lane-wave"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const time = timeAt(event);
        if (event.shiftKey) {
          // Shift arrastra la región de loop en vez de mover el playhead.
          dragRef.current = { mode: 'loop', from: time };
          onLoopDrag({ from: time, to: time });
        } else {
          dragRef.current = { mode: 'scrub', from: time };
          onScrub(time);
        }
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const time = timeAt(event);
        if (drag.mode === 'loop') {
          onLoopDrag({ from: Math.min(drag.from, time), to: Math.max(drag.from, time) });
        } else {
          onScrub(time);
        }
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        // Un loop de ancho cero es un click sin intención: se descarta.
        if (drag?.mode === 'loop' && Math.abs(timeAt(event) - drag.from) < 0.05) onLoopDrag(null);
      }}
      onPointerCancel={() => { dragRef.current = null; }}
    />
  );
}
