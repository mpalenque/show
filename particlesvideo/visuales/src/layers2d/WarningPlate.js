import * as THREE from 'three/webgpu';
import { texture, uniform, vec4, uv, vec2 } from 'three/tsl';
import { STAGE } from '../config/stage.js';

// Medidas sacadas midiendo STORYBOARD/1.png y 1b.png (1976 × 464 px).
// El storyboard no tiene el aspecto de la LED (4.26:1 contra 8:3), así que no hay
// una sola escala válida: el ritmo horizontal se escala por ancho (×1.360, da 6 columnas
// de 448 px como el plan) y los tamaños verticales por alto (×2.172), para que la banda
// y el texto conserven su peso visual. Los chevrones se escalan uniforme por ancho para
// no deformar el ángulo de las franjas. Todo junto acá para poder ajustarlo a ojo.
const LAYOUT = {
  amber: '#F2A100',              // medido: rgb(242,161,0)
  black: '#000000',
  period: 448,                   // 2688 / 6 columnas
  chevron: { ampP2P: 209, stripe: 76, stripePeriod: 152 },
  band: { height: 104, lineWidth: 4, fontSize: 57, text: 'ADVERTENCIA' },
  box: { width: 306, height: 40, offsetY: 126, tickWidth: 4, text: 'LUCES PARPADEANTES', pad: 10 },
};

export class WarningPlate {
  static defineParams(params) {
    params.define({ id: 'warning.band', type: 'float', min: 0, max: 1, default: 0, label: 'Banda', group: 'warning' });
    params.define({ id: 'warning.bg', type: 'float', min: 0, max: 1, default: 0, smooth: 0.3, label: 'Fondo (chevrones)', group: 'warning' });
    params.define({ id: 'warning.scroll', type: 'float', min: -200, max: 200, default: 0, label: 'Scroll texto (px/s)', group: 'warning' });
    params.define({ id: 'warning.pulseAttack', type: 'float', min: 0.1, max: 10, default: 1.0, label: 'Pulso ataque (s)', group: 'warning' });
    params.define({ id: 'warning.pulseRelease', type: 'float', min: 0.1, max: 10, default: 2.0, label: 'Pulso caída (s)', group: 'warning' });
    params.define({ id: 'warning.bgPulse', type: 'float', min: 0, max: 1, default: 0, label: 'Latido del fondo', group: 'warning' });
    params.define({ id: 'warning.bgPulseRate', type: 'float', min: 0.05, max: 6, default: 0.5, label: 'Latido (Hz)', group: 'warning' });
    params.defineAction({ id: 'warning.pulse', label: 'Pulso de fondo', group: 'warning' });
    params.defineAction({ id: 'warning.bgOff', label: 'Apagar fondo (1b)', group: 'warning' });
    params.defineAction({ id: 'warning.bgOn', label: 'Prender fondo', group: 'warning' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    this.uBg = uniform(0);
    this.uBand = uniform(0);
    this.uScroll = uniform(0);
    this.scrollPx = 0;
  }

  async init(scene) {
    await loadHelvetica();
    this.bgMesh = this._quad(drawBackground(), this.uBg, 0);
    this.bandMesh = this._quad(drawBandBase(), this.uBand, 1);
    this.textMesh = this._quad(drawBandText(), this.uBand, 2, this.uScroll);
    scene.add(this.bgMesh, this.bandMesh, this.textMesh);

    this.params.onAction('warning.pulse', () => {
      const attack = this.params.get('warning.pulseAttack');
      const release = this.params.get('warning.pulseRelease');
      this.params.tween('warning.bg', 1, attack);
      setTimeout(() => this.params.tween('warning.bg', 0.04, release), attack * 1000);
    });
    this.params.onAction('warning.bgOff', () => this.params.tween('warning.bg', 0.04, 2));   // es 1b
    this.params.onAction('warning.bgOn', () => this.params.tween('warning.bg', 1, 1));
  }

  _quad(canvas, uOpacity, order, uScrollNode) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;                    // la ortográfica ya invierte Y: sin esto la textura sale al revés
    tex.wrapS = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;

    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const coord = uScrollNode ? vec2(uv().x.add(uScrollNode), uv().y) : uv();
    const texel = texture(tex, coord);
    material.colorNode = vec4(texel.rgb, texel.a.mul(uOpacity));

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.set(STAGE.width / 2, STAGE.height / 2, 0);
    mesh.scale.set(STAGE.width, STAGE.height, 1);
    mesh.renderOrder = order;
    return mesh;
  }

  update(dt) {
    // El latido sube y baja SOLO los chevrones del fondo. La banda y el texto van por otro
    // quad, así que quedan siempre encendidos aunque el fondo respire.
    const pulse = this.params.get('warning.bgPulse');
    this.pulsePhase = (this.pulsePhase ?? 0) + dt * this.params.get('warning.bgPulseRate') * Math.PI * 2;
    const latido = 1 - pulse * 0.5 * (1 - Math.cos(this.pulsePhase));
    this.uBg.value = this.params.get('warning.bg') * latido;
    this.uBand.value = this.params.get('warning.band');
    this.scrollPx += this.params.get('warning.scroll') * dt;
    this.uScroll.value = (this.scrollPx / STAGE.width) % 1;

    const visible = this.uBg.value > 0.001 || this.uBand.value > 0.001;
    this.bgMesh.visible = this.uBg.value > 0.001;
    this.bandMesh.visible = this.textMesh.visible = this.uBand.value > 0.001;
    return visible;
  }

  dispose() {
    for (const m of [this.bgMesh, this.bandMesh, this.textMesh]) {
      m.geometry.dispose(); m.material.dispose();
    }
  }
}

async function loadHelvetica() {
  try { await document.fonts.load(`700 ${LAYOUT.band.fontSize}px Helvetica`); }
  catch { /* si no está, cae a Arial por la lista de la fuente */ }
}

const FONT = (size) => `700 ${size}px Helvetica, "Helvetica Neue", Arial, sans-serif`;

function newCanvas() {
  const c = document.createElement('canvas');
  c.width = STAGE.width; c.height = STAGE.height;
  return c;
}

// Onda triangular: el eje de la franja de chevrones.
function chevronOffset(x) {
  const P = LAYOUT.period;
  const t = ((x % P) + P) % P / P;            // 0..1 dentro del período
  const tri = t < 0.5 ? t * 4 - 1 : 3 - t * 4; // -1..1..-1
  return tri * (LAYOUT.chevron.ampP2P / 2);
}

function drawBackground() {
  const c = newCanvas();
  const g = c.getContext('2d');
  const { width: W, height: H } = c;
  const { ampP2P, stripe, stripePeriod } = LAYOUT.chevron;
  const half = LAYOUT.period / 2;   // distancia entre vértices del zigzag (dónde cambia de pendiente)

  g.fillStyle = LAYOUT.black;
  g.fillRect(0, 0, W, H);

  // Antes esto se pintaba columna por columna con fillRect de 1 px: sin antialiasing en el
  // borde diagonal, quedaba en escalones. Ahora cada franja es un TRAZO vectorial (polilínea
  // por los vértices exactos del zigzag) — Canvas2D antialíasa los bordes de cualquier trazo
  // o relleno por defecto, así que la diagonal sale lisa.
  //
  // El grosor pedido (`stripe`) es VERTICAL, pero `lineWidth` mide perpendicular al trazo;
  // en una pendiente, perpendicular = vertical × cos(ángulo). Se compensa para que el ancho
  // visual de la franja sea el mismo que antes.
  const cosAngle = half / Math.sqrt(half * half + ampP2P * ampP2P);
  g.strokeStyle = LAYOUT.amber;
  g.lineWidth = stripe * cosAngle;
  g.lineJoin = 'miter';
  g.lineCap = 'butt';

  const margin = ampP2P / 2 + stripe;
  const kMin = Math.floor(-margin / stripePeriod);
  const kMax = Math.ceil((H + margin) / stripePeriod);
  for (let k = kMin; k <= kMax; k++) {
    const row = k * stripePeriod;
    g.beginPath();
    for (let x = -half; x <= W + half; x += half) g.lineTo(x, row + chevronOffset(x));
    g.stroke();
  }

  // Cajas "LUCES PARPADEANTES" (negras con texto ámbar) en las dos filas.
  for (const cy of boxRowsY()) {
    for (const cx of columnCentersX()) drawBox(g, cx, cy);
  }
  return c;
}

function drawBox(g, cx, cy) {
  const { width: w, height: h, text, pad } = LAYOUT.box;
  g.fillStyle = LAYOUT.black;
  g.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);

  // El texto se ajusta al ancho de la caja (el storyboard lo tiene casi al borde).
  const size = fitFontSize(g, text, w - pad * 2, Math.round(h * 0.5));
  g.fillStyle = LAYOUT.amber;
  g.font = FONT(size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cx, cy + 1);
}

function fitFontSize(g, text, maxWidth, startSize) {
  let size = startSize;
  g.font = FONT(size);
  const w = g.measureText(text).width;
  if (w > maxWidth) size = Math.floor(size * (maxWidth / w));
  return size;
}

// Banda: negro opaco + líneas ámbar arriba/abajo + los ticks laterales de las cajas.
// Los ticks van acá porque en 1b siguen prendidos aunque el fondo se apague.
function drawBandBase() {
  const c = newCanvas();
  const g = c.getContext('2d');
  const { height: bh, lineWidth: lw } = LAYOUT.band;
  const top = STAGE.height / 2 - bh / 2;

  g.fillStyle = LAYOUT.black;
  g.fillRect(0, top, STAGE.width, bh);
  g.fillStyle = LAYOUT.amber;
  g.fillRect(0, top, STAGE.width, lw);
  g.fillRect(0, top + bh - lw, STAGE.width, lw);

  const { width: w, height: h, tickWidth: tw } = LAYOUT.box;
  for (const cy of boxRowsY()) {
    for (const cx of columnCentersX()) {
      g.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), tw, h);
      g.fillRect(Math.round(cx + w / 2 - tw), Math.round(cy - h / 2), tw, h);
    }
  }
  return c;
}

function drawBandText() {
  const c = newCanvas();
  const g = c.getContext('2d');
  const { fontSize, text } = LAYOUT.band;
  g.fillStyle = LAYOUT.amber;
  g.font = FONT(fontSize);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const cx of columnCentersX()) g.fillText(text, cx, STAGE.height / 2);
  return c;
}

function columnCentersX() {
  const out = [];
  for (let i = 0; i < STAGE.width / LAYOUT.period; i++) out.push((i + 0.5) * LAYOUT.period);
  return out;
}

function boxRowsY() {
  return [STAGE.height / 2 - LAYOUT.box.offsetY, STAGE.height / 2 + LAYOUT.box.offsetY];
}
