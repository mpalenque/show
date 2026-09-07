import { useRef } from 'react';
import { simplifyCurve } from '../seed';
import {
  sampleCurve,
  type Curve,
  type CurveKey,
  type CurveSpec,
  type KeyShape,
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
 * Una curva de automatización, dibujada y editada a mano.
 *
 * El trazo se samplea por píxel con la misma `sampleCurve` que usa el
 * director: lo que se ve es exactamente lo que va a sonar, incluidos los
 * planos de `hold` y el arranque suave de `smooth`. La forma de cada key
 * dice su shape — rombo lineal, círculo suave, cuadrado sostenido — para que
 * se lea sin tener que seleccionarla.
 */

export interface CurveLaneProps {
  spec: CurveSpec;
  curve: Curve;
  view: TimelineView;
  duration: number;
  /** Imán de la edición; recibe la tolerancia ya convertida a segundos. */
  snap: (t: number, tolerance: number) => number;
  /**
   * Modo LÁPIZ (tecla B): arrastrar DIBUJA la curva a mano alzada en vez de
   * agarrar o crear keys de a una. El trazo reemplaza lo que había en su
   * rango y al soltar se simplifica a pocas llaves.
   */
  pencil?: boolean;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onChange: (curve: Curve) => void;
}

/** Radio de agarre de una key, en píxeles. */
const GRAB = 7;
const PAD = 8;

const sortKeys = (keys: CurveKey[]): CurveKey[] => [...keys].sort((a, b) => a.t - b.t);

export const nextShape = (shape: KeyShape): KeyShape => (
  shape === 'linear' ? 'smooth' : shape === 'smooth' ? 'hold' : 'linear'
);

export default function CurveLane(props: CurveLaneProps) {
  const {
    spec, curve, view, duration, snap, pencil, selectedIndex, onSelect, onChange,
  } = props;
  const dragRef = useRef<number | null>(null);
  const hoverRef = useRef<{ x: number; y: number; index: number } | null>(null);
  /**
   * El trazo del lápiz mientras el puntero está abajo: un punto por columna
   * de píxel (la clave del mapa es la columna cuantizada), con el último
   * valor que pasó por ahí. Se aplica en vivo en cada movimiento y se
   * simplifica al soltar.
   */
  const strokeRef = useRef<{
    points: Map<number, CurveKey>;
    minT: number;
    maxT: number;
    last: { t: number; v: number } | null;
  } | null>(null);

  const valueToY = (value: number, height: number): number => {
    const span = spec.max - spec.min || 1;
    const usable = Math.max(1, height - PAD * 2);
    return PAD + (1 - (value - spec.min) / span) * usable;
  };
  const yToValue = (y: number, height: number): number => {
    const span = spec.max - spec.min || 1;
    const usable = Math.max(1, height - PAD * 2);
    const raw = spec.min + (1 - (y - PAD) / usable) * span;
    return Math.max(spec.min, Math.min(spec.max, raw));
  };

  const { canvasRef, redraw } = useLaneCanvas((ctx, width, height) => {
    ctx.fillStyle = LANE_COLORS.backgroundAlt;
    ctx.fillRect(0, 0, width, height);

    // Grilla de tiempo, la misma que la regla, para leer en vertical.
    const step = rulerStep(view, width);
    ctx.strokeStyle = LANE_COLORS.grid;
    ctx.beginPath();
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) {
      const x = Math.round(timeToX(view, t, width)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    // El cero, cuando el rango lo cruza: es la referencia de gravedad y giro.
    if (spec.min < 0 && spec.max > 0) {
      const zero = Math.round(valueToY(0, height)) + 0.5;
      ctx.strokeStyle = LANE_COLORS.gridStrong;
      ctx.beginPath();
      ctx.moveTo(0, zero);
      ctx.lineTo(width, zero);
      ctx.stroke();
    }

    // Trazo, sampleado por píxel con la función del director.
    ctx.beginPath();
    for (let x = 0; x <= width; x += 1) {
      const value = sampleCurve(curve, xToTime(view, x, width), spec.def, spec.wrap === true);
      const y = valueToY(value, height);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = LANE_COLORS.curve;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = LANE_COLORS.curveFill;
    ctx.fill();
    ctx.lineWidth = 1;

    // Keys.
    for (let index = 0; index < curve.keys.length; index += 1) {
      const key = curve.keys[index];
      if (key.t < view.t0 - 1 || key.t > view.t1 + 1) continue;
      const x = timeToX(view, key.t, width);
      const y = valueToY(key.v, height);
      const selected = index === selectedIndex;
      ctx.fillStyle = selected ? LANE_COLORS.keySelected : LANE_COLORS.key;
      ctx.beginPath();
      if (key.shape === 'smooth') {
        ctx.arc(x, y, selected ? 4.5 : 3.5, 0, Math.PI * 2);
      } else if (key.shape === 'hold') {
        const size = selected ? 4 : 3;
        ctx.rect(x - size, y - size, size * 2, size * 2);
      } else {
        const size = selected ? 4.8 : 4;
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x - size, y);
        ctx.closePath();
      }
      ctx.fill();
    }

    // Rango etiquetado: sin esto no se sabe qué significa la altura.
    ctx.fillStyle = LANE_COLORS.text;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(spec.max.toFixed(2), 4, 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(spec.min.toFixed(2), 4, height - 2);

    // Tooltip de la key bajo el cursor o en arrastre.
    const hover = hoverRef.current;
    const index = dragRef.current ?? hover?.index ?? -1;
    if (index >= 0 && index < curve.keys.length) {
      const key = curve.keys[index];
      const label = `${key.t.toFixed(2)}s · ${key.v.toFixed(3)} · ${key.shape}`;
      const x = timeToX(view, key.t, width);
      const y = valueToY(key.v, height);
      ctx.font = '9px ui-monospace, Consolas, monospace';
      const textWidth = ctx.measureText(label).width;
      const boxX = Math.min(width - textWidth - 8, Math.max(2, x + 8));
      const boxY = Math.max(2, y - 16);
      ctx.fillStyle = 'rgb(6 7 9 / 90%)';
      ctx.fillRect(boxX, boxY, textWidth + 6, 13);
      ctx.fillStyle = LANE_COLORS.keySelected;
      ctx.textBaseline = 'top';
      ctx.fillText(label, boxX + 3, boxY + 2);
    }
  }, [curve.keys, view.t0, view.t1, spec.min, spec.max, spec.def, spec.wrap, selectedIndex]);

  const measure = (): { width: number; height: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 1, height: rect?.height ?? 1 };
  };

  /** Key bajo el punto, o -1. */
  const hitTest = (x: number, y: number): number => {
    const { width, height } = measure();
    for (let index = 0; index < curve.keys.length; index += 1) {
      const key = curve.keys[index];
      const dx = timeToX(view, key.t, width) - x;
      const dy = valueToY(key.v, height) - y;
      if (dx * dx + dy * dy <= GRAB * GRAB) return index;
    }
    return -1;
  };

  const moveKey = (index: number, x: number, y: number): number => {
    const { width, height } = measure();
    const tolerance = secondsPerPixel(view, width) * 8;
    const time = Math.max(0, Math.min(duration, snap(xToTime(view, x, width), tolerance)));
    const moved: CurveKey = { ...curve.keys[index], t: time, v: yToValue(y, height) };
    const keys = curve.keys.map((key, position) => (position === index ? moved : key));
    const sorted = sortKeys(keys);
    onChange({ keys: sorted });
    return sorted.indexOf(moved);
  };

  /** Suma el punto bajo el puntero al trazo, interpolando huecos. */
  const strokeAdd = (x: number, y: number): void => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    const { width, height } = measure();
    // Un punto por columna de píxel: suficiente para que el trazo sea la
    // curva exacta que se ve, sin acumular miles de llaves.
    const quantum = Math.max(1e-4, secondsPerPixel(view, width));
    const t = Math.max(0, Math.min(duration, xToTime(view, x, width)));
    const v = yToValue(y, height);
    const place = (pt: number, pv: number): void => {
      const column = Math.round(pt / quantum);
      stroke.points.set(column, { t: column * quantum, v: pv, shape: 'linear' });
      stroke.minT = Math.min(stroke.minT, column * quantum);
      stroke.maxT = Math.max(stroke.maxT, column * quantum);
    };
    // Un arrastre rápido salta columnas: se interpola entre el punto
    // anterior y éste para que no queden dientes.
    const last = stroke.last;
    if (last && Math.abs(t - last.t) > quantum * 1.5) {
      const steps = Math.min(400, Math.ceil(Math.abs(t - last.t) / quantum));
      for (let step = 1; step < steps; step += 1) {
        const mix = step / steps;
        place(last.t + (t - last.t) * mix, last.v + (v - last.v) * mix);
      }
    }
    place(t, v);
    stroke.last = { t, v };
  };

  /** Vuelca el trazo a la curva: lo dibujado reemplaza lo que había ahí. */
  const strokeApply = (commit: boolean): void => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.points.size === 0) return;
    const { width } = measure();
    const quantum = Math.max(1e-4, secondsPerPixel(view, width));
    let drawn = [...stroke.points.values()].sort((a, b) => a.t - b.t);
    if (commit) {
      // Al soltar, el trazo crudo (una llave por píxel) se reduce a las
      // llaves que hacen falta para conservar la forma — así después se
      // puede agarrar cualquiera y seguir a mano.
      const budget = Math.max(12, Math.round((stroke.maxT - stroke.minT) * 10));
      drawn = simplifyCurve(drawn, budget);
    }
    const kept = curve.keys.filter(
      (key) => key.t < stroke.minT - quantum * 0.6 || key.t > stroke.maxT + quantum * 0.6,
    );
    onChange({ keys: sortKeys([...kept, ...drawn]) });
  };

  return (
    <canvas
      ref={canvasRef}
      className="fs-lane-canvas"
      style={pencil ? { cursor: 'crosshair' } : undefined}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x, y } = localPoint(event, canvasRef.current);
        if (pencil) {
          // LÁPIZ: el arrastre entero es un trazo, no una key.
          strokeRef.current = {
            points: new Map(), minT: Number.POSITIVE_INFINITY, maxT: Number.NEGATIVE_INFINITY, last: null,
          };
          onSelect(null);
          strokeAdd(x, y);
          strokeApply(false);
          return;
        }
        const hit = hitTest(x, y);
        if (hit >= 0) {
          dragRef.current = hit;
          onSelect(hit);
          redraw();
          return;
        }
        // Click en vacío: nace una key ahí y queda agarrada, para poder
        // dibujar la curva de un solo gesto.
        const { width, height } = measure();
        const tolerance = secondsPerPixel(view, width) * 8;
        const time = Math.max(0, Math.min(duration, snap(xToTime(view, x, width), tolerance)));
        const created: CurveKey = { t: time, v: yToValue(y, height), shape: 'smooth' };
        const keys = sortKeys([
          ...curve.keys.filter((key) => Math.abs(key.t - time) > 1e-4),
          created,
        ]);
        onChange({ keys });
        const index = keys.indexOf(created);
        dragRef.current = index;
        onSelect(index);
      }}
      onPointerMove={(event) => {
        const { x, y } = localPoint(event, canvasRef.current);
        if (strokeRef.current) {
          strokeAdd(x, y);
          strokeApply(false);
          return;
        }
        const dragging = dragRef.current;
        if (dragging !== null && dragging < curve.keys.length) {
          const index = moveKey(dragging, x, y);
          dragRef.current = index;
          onSelect(index);
          return;
        }
        const hit = hitTest(x, y);
        const previous = hoverRef.current?.index ?? -1;
        hoverRef.current = hit >= 0 ? { x, y, index: hit } : null;
        if (hit !== previous) redraw();
      }}
      onPointerUp={(event) => {
        if (strokeRef.current) {
          strokeApply(true);
          strokeRef.current = null;
        }
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        redraw();
      }}
      onPointerCancel={() => {
        if (strokeRef.current) {
          strokeApply(true);
          strokeRef.current = null;
        }
        dragRef.current = null;
        redraw();
      }}
      onPointerLeave={() => {
        if (hoverRef.current) {
          hoverRef.current = null;
          redraw();
        }
      }}
      onDoubleClick={(event) => {
        const { x, y } = localPoint(event, canvasRef.current);
        const hit = hitTest(x, y);
        if (hit < 0) return;
        onChange({ keys: curve.keys.filter((_, index) => index !== hit) });
        onSelect(null);
      }}
    />
  );
}
