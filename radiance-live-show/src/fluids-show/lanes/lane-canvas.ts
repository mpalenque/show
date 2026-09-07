import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Base de dibujo de las lanes de la timeline.
 *
 * Todas dibujan en canvas 2D y ninguna crea DOM por keyframe: con 6 574
 * muestras de envolvente, 874 onsets y las curvas encima, un nodo por punto
 * haría inusable la página. Un canvas por lane se redibuja entero en cada
 * cambio y eso cuesta menos que reconciliar el árbol.
 *
 * El canvas se dimensiona en píxeles de dispositivo y se dibuja en píxeles
 * CSS: la transformación la pone el hook, así que las lanes trabajan siempre
 * en coordenadas CSS y no se enteran del DPR.
 */

export type LaneDraw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

export interface LaneCanvas {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Ancho y alto en píxeles CSS de la última medición. */
  sizeRef: React.RefObject<{ width: number; height: number }>;
  redraw: () => void;
}

export const useLaneCanvas = (draw: LaneDraw): LaneCanvas => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const sizeRef = useRef({ width: 1, height: 1 });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = sizeRef.current;
    const dpr = canvas.width / Math.max(1, width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRef.current(ctx, width, height);
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      sizeRef.current = { width, height };
      const bufferWidth = Math.max(1, Math.round(width * dpr));
      const bufferHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
      }
      redraw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [redraw]);

  // Sin lista de dependencias a propósito: la lane se re-renderiza sólo
  // cuando cambia algo suyo, y entonces hay que volver a dibujarla.
  useEffect(redraw);

  return { canvasRef, sizeRef, redraw };
};

/** Posición del puntero en píxeles CSS relativos al canvas. */
export const localPoint = (
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement | null,
): { x: number; y: number } => {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

export const LANE_COLORS = Object.freeze({
  background: '#0b0b0e',
  backgroundAlt: '#0e0e12',
  grid: '#1b1b22',
  gridStrong: '#2a2a34',
  text: '#7c7a86',
  curve: '#9ce0b4',
  curveFill: 'rgb(156 224 180 / 10%)',
  key: '#eafbef',
  keySelected: '#ffd166',
  wave: '#4a5a52',
  waveStrong: '#7fae93',
  onsetLow: '#ff6b6b',
  onsetMid: '#e8e6ee',
  onsetHigh: '#6bb8ff',
  section: '#7a6cff',
  loop: 'rgb(156 224 180 / 10%)',
  punch: 'rgb(255 77 109 / 22%)',
});

/** Marca de tiempo corta para la regla: 1:23 o 1:23.5 según el zoom. */
export const tickLabel = (seconds: number, step: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const decimals = step < 0.5 ? 2 : step < 5 ? 1 : 0;
  return `${minutes}:${rest.toFixed(decimals).padStart(decimals > 0 ? decimals + 3 : 2, '0')}`;
};
