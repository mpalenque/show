import { useRef } from 'react';
import {
  MIN_EVENT_DUR,
  eventSpec,
  makeEvent,
  sortEvents,
  type ShowEvent,
  type ShowEventType,
} from '../show-doc';
import {
  rulerStep,
  secondsPerPixel,
  timeToX,
  xToTime,
  type TimelineView,
} from '../timeline-view';
import { LANE_COLORS, localPoint, useLaneCanvas } from './lane-canvas';

/**
 * Los eventos violentos de luz y sombra, como bloques sobre la timeline.
 *
 * Se reparten en tres filas por empaque codicioso: en el pico del track los
 * flashes y los estrobos caen encima unos de otros, y apilados se puede ver
 * y agarrar cada uno. El borde derecho de cada bloque estira su duración.
 */

export interface EventLaneProps {
  events: ShowEvent[];
  view: TimelineView;
  duration: number;
  snap: (t: number, tolerance: number) => number;
  selectedId: string | null;
  /** Tipo que crea el doble-click en un hueco. */
  createType: ShowEventType;
  onSelect: (id: string | null) => void;
  onChange: (events: ShowEvent[]) => void;
}

const ROWS = 3;
const ROW_GAP = 2;
/** Ancho de la zona de agarre del borde derecho, en píxeles. */
const EDGE = 5;

/** Fila de cada evento: la primera que quedó libre a esa altura del track. */
export const packRows = (events: ShowEvent[]): Map<string, number> => {
  const rows = new Map<string, number>();
  const lastEnd = new Array<number>(ROWS).fill(-Infinity);
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    const end = event.t + Math.max(MIN_EVENT_DUR, event.dur);
    let row = 0;
    while (row < ROWS - 1 && lastEnd[row] > event.t) row += 1;
    lastEnd[row] = Math.max(lastEnd[row], end);
    rows.set(event.id, row);
  }
  return rows;
};

export default function EventLane(props: EventLaneProps) {
  const { events, view, duration, snap, selectedId, createType, onSelect, onChange } = props;
  const dragRef = useRef<{ id: string; mode: 'move' | 'resize'; grabOffset: number } | null>(null);

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

    const rows = packRows(events);
    const rowHeight = Math.max(8, (height - ROW_GAP * (ROWS + 1)) / ROWS);
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    for (const event of events) {
      const dur = Math.max(MIN_EVENT_DUR, event.dur);
      if (event.t > view.t1 || event.t + dur < view.t0) continue;
      const spec = eventSpec(event.type);
      const row = rows.get(event.id) ?? 0;
      const y = ROW_GAP + row * (rowHeight + ROW_GAP);
      const x = timeToX(view, event.t, width);
      const w = Math.max(3, timeToX(view, event.t + dur, width) - x);
      const selected = event.id === selectedId;
      ctx.globalAlpha = 0.35 + event.intensity * 0.55;
      ctx.fillStyle = spec.color;
      ctx.fillRect(x, y, w, rowHeight);
      ctx.globalAlpha = 1;
      if (selected) {
        ctx.strokeStyle = LANE_COLORS.keySelected;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, rowHeight + 1);
        ctx.lineWidth = 1;
      }
      if (w > 34) {
        ctx.fillStyle = '#08080a';
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, rowHeight);
        ctx.clip();
        ctx.fillText(spec.label, x + 4, y + rowHeight / 2);
        ctx.restore();
      }
    }
  }, [events, view.t0, view.t1, selectedId]);

  const measure = (): number => canvasRef.current?.getBoundingClientRect().width ?? 1;

  const hitTest = (x: number, y: number): { event: ShowEvent; mode: 'move' | 'resize' } | null => {
    const width = measure();
    const height = canvasRef.current?.getBoundingClientRect().height ?? 1;
    const rows = packRows(events);
    const rowHeight = Math.max(8, (height - ROW_GAP * (ROWS + 1)) / ROWS);
    // De atrás para adelante: el último dibujado es el que se ve arriba.
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      const dur = Math.max(MIN_EVENT_DUR, event.dur);
      const row = rows.get(event.id) ?? 0;
      const top = ROW_GAP + row * (rowHeight + ROW_GAP);
      if (y < top || y > top + rowHeight) continue;
      const x0 = timeToX(view, event.t, width);
      const x1 = Math.max(x0 + 3, timeToX(view, event.t + dur, width));
      if (x < x0 - 2 || x > x1 + 2) continue;
      return { event, mode: x >= x1 - EDGE ? 'resize' : 'move' };
    }
    return null;
  };

  const patch = (id: string, next: Partial<ShowEvent>): void => {
    onChange(sortEvents(events.map(
      (event) => (event.id === id ? { ...event, ...next } : event),
    )));
  };

  return (
    <canvas
      ref={canvasRef}
      className="fs-lane-canvas"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x, y } = localPoint(event, canvasRef.current);
        const hit = hitTest(x, y);
        if (!hit) {
          onSelect(null);
          return;
        }
        onSelect(hit.event.id);
        dragRef.current = {
          id: hit.event.id,
          mode: hit.mode,
          grabOffset: xToTime(view, x, measure()) - hit.event.t,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const { x } = localPoint(event, canvasRef.current);
        const width = measure();
        const tolerance = secondsPerPixel(view, width) * 8;
        const time = xToTime(view, x, width);
        const target = events.find((item) => item.id === drag.id);
        if (!target) return;
        if (drag.mode === 'resize') {
          patch(drag.id, { dur: Math.max(MIN_EVENT_DUR, snap(time, tolerance) - target.t) });
        } else {
          const start = Math.max(0, Math.min(duration, snap(time - drag.grabOffset, tolerance)));
          patch(drag.id, { t: start });
        }
      }}
      onPointerUp={(event) => {
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => { dragRef.current = null; }}
      onDoubleClick={(event) => {
        const { x, y } = localPoint(event, canvasRef.current);
        // Sólo en un hueco: encima de un bloque el doble-click no crea nada,
        // para que borrar siga siendo una tecla y nunca un accidente.
        if (hitTest(x, y)) return;
        const width = measure();
        const tolerance = secondsPerPixel(view, width) * 8;
        const time = Math.max(0, Math.min(duration, snap(xToTime(view, x, width), tolerance)));
        const created = makeEvent(createType, time);
        onChange(sortEvents([...events, created]));
        onSelect(created.id);
      }}
    />
  );
}
