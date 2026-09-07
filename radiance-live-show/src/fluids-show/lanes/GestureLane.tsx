import { useRef } from 'react';
import { GESTURE_MODES, type GestureClip } from '../show-doc';
import {
  rulerStep,
  secondsPerPixel,
  timeToX,
  xToTime,
  type TimelineView,
} from '../timeline-view';
import { LANE_COLORS, localPoint, useLaneCanvas } from './lane-canvas';

/**
 * Los clips de gesto grabados, y el rango que se está regrabando.
 *
 * Cada clip lleva dibujada la trayectoria del puntero — su x a lo largo del
 * tiempo — porque el modo y la duración no alcanzan para reconocer cuál es
 * cuál cuando hay media docena encima del mismo tramo.
 */

export interface GestureLaneProps {
  gestures: GestureClip[];
  view: TimelineView;
  duration: number;
  selectedId: string | null;
  /** Rango que se está regrabando: todo lo que caiga adentro se sobreescribe. */
  punch: { from: number; to: number } | null;
  onSelect: (id: string | null) => void;
  onChange: (gestures: GestureClip[]) => void;
}

const MODE_COLOR: Record<string, string> = {
  drag: '#9ce0b4',
  attract: '#6bb8ff',
  repel: '#ff9f6b',
  vortex: '#c58bff',
};

const MODE_LABEL = new Map(GESTURE_MODES.map((mode) => [mode.id, mode.label]));

export default function GestureLane(props: GestureLaneProps) {
  const { gestures, view, duration, selectedId, punch, onSelect, onChange } = props;
  const dragRef = useRef<{ id: string; grabOffset: number } | null>(null);

  const { canvasRef } = useLaneCanvas((ctx, width, height) => {
    ctx.fillStyle = LANE_COLORS.background;
    ctx.fillRect(0, 0, width, height);

    const step = rulerStep(view, width);
    ctx.strokeStyle = LANE_COLORS.grid;
    ctx.beginPath();
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) {
      const x = Math.round(timeToX(view, t, width)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    if (punch) {
      ctx.fillStyle = LANE_COLORS.punch;
      const x0 = timeToX(view, punch.from, width);
      ctx.fillRect(x0, 0, Math.max(2, timeToX(view, punch.to, width) - x0), height);
    }

    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    for (const clip of gestures) {
      if (clip.t0 > view.t1 || clip.t1 < view.t0) continue;
      const x = timeToX(view, clip.t0, width);
      const w = Math.max(3, timeToX(view, clip.t1, width) - x);
      const color = MODE_COLOR[clip.mode] ?? LANE_COLORS.curve;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.fillRect(x, 2, w, height - 4);
      ctx.globalAlpha = 1;

      // Trayectoria: la x del puntero contra el tiempo, recortada al bloque.
      if (clip.samples.length > 1 && w > 6) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 2, w, height - 4);
        ctx.clip();
        ctx.beginPath();
        for (let index = 0; index < clip.samples.length; index += 1) {
          const sample = clip.samples[index];
          const px = timeToX(view, clip.t0 + sample.t, width);
          const py = 4 + sample.x * (height - 8);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.restore();
      }

      if (clip.id === selectedId) {
        ctx.strokeStyle = LANE_COLORS.keySelected;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 0.5, 1.5, w + 1, height - 3);
        ctx.lineWidth = 1;
      }
      if (w > 44) {
        ctx.fillStyle = color;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 2, w, height - 4);
        ctx.clip();
        ctx.fillText(MODE_LABEL.get(clip.mode) ?? clip.mode, x + 4, 9);
        ctx.restore();
      }
    }
  });

  const measure = (): number => canvasRef.current?.getBoundingClientRect().width ?? 1;

  const hitTest = (x: number): GestureClip | null => {
    const width = measure();
    for (let index = gestures.length - 1; index >= 0; index -= 1) {
      const clip = gestures[index];
      const x0 = timeToX(view, clip.t0, width);
      const x1 = Math.max(x0 + 3, timeToX(view, clip.t1, width));
      if (x >= x0 - 2 && x <= x1 + 2) return clip;
    }
    return null;
  };

  return (
    <canvas
      ref={canvasRef}
      className="fs-lane-canvas"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x } = localPoint(event, canvasRef.current);
        const hit = hitTest(x);
        if (!hit) {
          onSelect(null);
          return;
        }
        onSelect(hit.id);
        dragRef.current = { id: hit.id, grabOffset: xToTime(view, x, measure()) - hit.t0 };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const { x } = localPoint(event, canvasRef.current);
        const width = measure();
        const target = gestures.find((clip) => clip.id === drag.id);
        if (!target) return;
        const span = target.t1 - target.t0;
        // El clip se mueve entero: sus muestras son relativas a t0 y no hay
        // que tocarlas para correrlo por la timeline.
        const t0 = Math.max(0, Math.min(duration - span, xToTime(view, x, width) - drag.grabOffset));
        if (Math.abs(t0 - target.t0) < secondsPerPixel(view, width) * 0.25) return;
        onChange(gestures
          .map((clip) => (clip.id === drag.id ? { ...clip, t0, t1: t0 + span } : clip))
          .sort((a, b) => a.t0 - b.t0));
      }}
      onPointerUp={(event) => {
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => { dragRef.current = null; }}
    />
  );
}
