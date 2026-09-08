import { MilkyEngine } from './engine.js';
import { PRESETS, PRESET_BY_ID } from './presets.js';

const $ = id => document.getElementById(id);
const canvas = $('milky-canvas');
const stage = canvas.closest('.stage');
const params = new URLSearchParams(location.search);
const ui = {
  preset: params.get('preset') || '1a', gallery: params.has('gallery'),
  paused: params.has('test'), rate: 60, lastTime: 0, accumulator: 0,
  dirty: true, pending: 0, measured: 0, lastMeasure: 0, fps: 0, lostSteps: 0,
  stepping: false,
};
if (!PRESET_BY_ID[ui.preset]) ui.preset = '1a';
let engine;
let failed = false;
let lastBeat = -1;
let raf;
const errors = [];
const FINAL_DEFAULTS = { fx1: 0, fx2: 0, fx4: 0, button: true, loop: true, flash: true, inkProgress: null, view: 'output' };
let finalPreviewRequested = false;
let finalPreviewRunning = false;
const labels = PRESETS.map(p => {
  const label = document.createElement('span');
  label.textContent = p.name;
  Object.assign(label.style, { position: 'absolute', zIndex: '2', color: '#e6eadb', font: '10px ui-monospace, monospace', letterSpacing: '0.08em', padding: '5px 7px', background: '#10110fcc', pointerEvents: 'none', display: 'none' });
  stage.append(label); return label;
});

function showError(error) {
  const text = error?.message || String(error);
  errors.push(text); failed = true;
  $('loading-panel').hidden = true;
  $('error-panel').hidden = false;
  $('error-message').textContent = text;
  $('status-text').textContent = 'Efecto detenido';
  console.error(error);
}

function activeIds() { return ui.gallery ? PRESETS.map(p => p.id) : [ui.preset]; }
function trigger(kind, preview = true) {
  if (!engine || failed) return;
  if (kind === 'seed' && activeIds().includes('final')) {
    engine.settings.final.button = true;
    engine.settings.final.inkProgress = null;
  }
  engine.trigger(kind, activeIds()); ui.dirty = true; reflectUI();
  if (preview && ui.preset === 'final') refreshFinalPreview();
}
function reflectInkStatus() {
  const visible = ui.preset === 'final' || ui.gallery;
  $('ink-status').hidden = !visible;
  if (!visible || !engine) return;
  const state = engine.states.get('final');
  const frame = Number(state?.inkFrame);
  const loading = Boolean(engine.ink?.loading ?? engine.ink?.pending?.size);
  $('ink-status').classList.toggle('is-loading', loading);
  $('ink-status').textContent = `${loading ? 'Cargando tinta' : 'Tinta'}${Number.isFinite(frame) ? ` · frame ${frame}` : '…'}`;
  if (ui.preset === 'final') $('status-text').textContent = loading ? 'Cargando tinta…' : ui.paused ? 'En pausa' : 'WebGPU activo';
  if (engine.settings.final.inkProgress == null) {
    $('ink-progress-value').textContent = 'Auto';
  }
}
function reflectUI() {
  const p = PRESET_BY_ID[ui.preset];
  const isFinal = ui.preset === 'final';
  $('preset-select').value = ui.preset;
  $('gallery-toggle').checked = ui.gallery;
  $('preset-name').textContent = ui.gallery ? `Los ${PRESETS.length} presets` : p.name;
  $('preset-description').textContent = p.description;
  $('pause-button').textContent = ui.paused ? 'Continuar' : 'Pausar';
  $('status-text').textContent = ui.paused ? 'En pausa' : 'WebGPU activo';
  document.body.classList.toggle('gallery-active', ui.gallery);
  document.body.classList.toggle('final-selected', isFinal);
  $('final-controls').hidden = !isFinal;
  $('material-controls').hidden = isFinal;
  $('impulse-controls').hidden = false;
  for (const option of $('resolution-select').options) {
    const [width, height] = option.value.split('x').map(Number);
    option.textContent = isFinal ? `${Math.round(width * 4.8)} × ${Math.round(width * 1.5)}` : `${width} × ${height}`;
  }
  $('kick-button').disabled = !(ui.gallery || ui.preset === '3a' || isFinal);
  $('snare-button').disabled = !(ui.gallery || ui.preset === '3a');
  $('kick-button').title = isFinal ? 'Alternar forma y anillo · K' : 'Cambiar dirección de Milky 3A · K';
  $('snare-button').title = 'Cambiar dirección de Milky 3A · S';
  $('feedback-value').textContent = Number($('feedback-input').value).toFixed(2);
  $('warp-value').textContent = Number($('warp-input').value).toFixed(2);
  $('detail-value').textContent = Number($('detail-input').value).toFixed(2);
  const settings = engine?.settings.final || FINAL_DEFAULTS;
  for (const property of ['fx1', 'fx2', 'fx4']) {
    $(`final-${property}`).value = settings[property];
    $(`final-${property}-value`).textContent = Number(settings[property]).toFixed(2);
  }
  for (const property of ['button', 'loop', 'flash']) $(`final-${property}`).checked = settings[property];
  $('final-view').value = settings.view;
  $('ink-play-button').disabled = settings.inkProgress == null;
  if (settings.inkProgress != null) {
    $('ink-progress').value = settings.inkProgress;
    $('ink-progress-value').textContent = `${Math.round(settings.inkProgress * 100)} %`;
  }
  reflectInkStatus();
}

function selectPreset(id) {
  if (!PRESET_BY_ID[id]) return;
  ui.preset = id;
  if (engine) engine.settings.opacity = null;
  $('feedback-input').value = PRESET_BY_ID[id].opacity;
  ui.dirty = true; reflectUI();
}

function updateLabels() {
  labels.forEach((label, index) => {
    if (!ui.gallery || !engine.viewports[index]) { label.style.display = 'none'; return; }
    const [x, y] = engine.viewports[index];
    const factor = canvas.getBoundingClientRect().width / canvas.width;
    label.style.display = 'block'; label.style.left = `${x * factor + 7}px`; label.style.top = `${y * factor + 7}px`;
  });
}

function draw(steps = 0) {
  engine.render({ preset: ui.preset, gallery: ui.gallery, steps, dt: 1 / ui.rate });
  updateLabels();
  $('frame-value').textContent = engine.state(ui.preset).frame.toLocaleString('es-AR');
  reflectInkStatus();
  ui.dirty = false;
}

async function refreshFinalPreview() {
  if (!engine || !ui.paused || failed || !activeIds().includes('final')) return;
  finalPreviewRequested = true;
  if (finalPreviewRunning || ui.stepping) return;
  finalPreviewRunning = true; ui.stepping = true;
  try {
    while (finalPreviewRequested) {
      finalPreviewRequested = false;
      await engine.prepare?.(activeIds(), 1 / ui.rate);
      draw(1);
      await engine.device.queue.onSubmittedWorkDone();
    }
  } catch (error) { showError(error); }
  finally { finalPreviewRunning = false; ui.stepping = false; ui.lastTime = 0; reflectUI(); }
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (!engine || failed || ui.stepping) return;
  reflectInkStatus();
  const elapsed = ui.lastTime ? Math.min((now - ui.lastTime) / 1000, 0.25) : 1 / ui.rate;
  ui.lastTime = now;
  if (!ui.paused && !document.hidden) ui.accumulator += elapsed;
  if (ui.pending >= 2) return;
  let steps = ui.paused ? 0 : Math.min(8, Math.floor((ui.accumulator + 1e-7) * ui.rate));
  if (steps) ui.accumulator -= steps / ui.rate;
  if (ui.accumulator > 0.25) { ui.lostSteps += Math.floor(ui.accumulator * ui.rate); ui.accumulator = 0; }
  if (!steps && !ui.dirty) return;
  if ($('auto-beat').checked && !ui.paused) {
    const bpm = Math.max(30, Math.min(300, Number($('bpm-input').value) || 120));
    const beat = Math.floor(engine.state(ui.preset).time * bpm / 60);
    if (beat !== lastBeat) { trigger('kick'); if (beat % 2) trigger('snare'); lastBeat = beat; }
  }
  try {
    const frameBefore = engine.state(ui.preset).frame;
    draw(steps); ui.measured += Math.max(0, engine.state(ui.preset).frame - frameBefore);
    if (!ui.lastMeasure) ui.lastMeasure = now;
    if (now - ui.lastMeasure >= 600) {
      ui.fps = ui.measured * 1000 / (now - ui.lastMeasure);
      $('fps-value').textContent = ui.paused ? '—' : ui.fps.toFixed(0);
      ui.measured = 0; ui.lastMeasure = now;
    }
    ui.pending++;
    engine.device.queue.onSubmittedWorkDone().then(() => ui.pending--).catch(showError);
  } catch (error) { showError(error); }
}

function togglePause() { ui.paused = !ui.paused; ui.accumulator = 0; ui.dirty = true; reflectUI(); }
function reset() { engine?.reset(); ui.accumulator = 0; lastBeat = -1; ui.dirty = true; }
function toggleGallery() { ui.gallery = !ui.gallery; ui.dirty = true; reflectUI(); }
async function fullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }

$('preset-select').addEventListener('change', event => selectPreset(event.target.value));
$('gallery-toggle').addEventListener('change', event => { ui.gallery = event.target.checked; ui.dirty = true; reflectUI(); });
$('pause-button').addEventListener('click', togglePause);
$('reset-button').addEventListener('click', reset);
$('seed-button').addEventListener('click', () => trigger('seed'));
$('kick-button').addEventListener('click', () => trigger('kick'));
$('snare-button').addEventListener('click', () => trigger('snare'));
$('fullscreen-button').addEventListener('click', () => fullscreen().catch(showError));
$('retry-button').addEventListener('click', () => location.reload());
$('auto-seed').addEventListener('change', event => { if (engine) engine.settings.autoSeed = event.target.checked; });
$('auto-beat').addEventListener('change', () => lastBeat = -1);
for (const property of ['fx1', 'fx2', 'fx4']) {
  $(`final-${property}`).addEventListener('input', event => {
    if (!engine) return;
    engine.settings.final[property] = Number(event.target.value);
    ui.dirty = true; reflectUI(); refreshFinalPreview();
  });
}
for (const property of ['button', 'loop', 'flash']) {
  $(`final-${property}`).addEventListener('change', event => {
    if (!engine) return;
    engine.settings.final[property] = event.target.checked;
    ui.dirty = true; reflectUI(); refreshFinalPreview();
  });
}
$('final-explode').addEventListener('click', () => {
  if (!engine || failed) return;
  engine.settings.final.button = true; engine.settings.final.inkProgress = null;
  engine.trigger('seed', ['final']); ui.dirty = true; reflectUI(); refreshFinalPreview();
});
$('ink-progress').addEventListener('input', event => {
  if (!engine) return;
  engine.settings.final.inkProgress = Number(event.target.value);
  ui.dirty = true; reflectUI(); refreshFinalPreview();
});
$('ink-play-button').addEventListener('click', () => {
  if (!engine) return;
  engine.settings.final.inkProgress = null;
  ui.dirty = true; reflectUI(); refreshFinalPreview();
});
$('final-view').addEventListener('change', event => {
  if (!engine) return;
  engine.settings.final.view = event.target.value;
  ui.dirty = true; reflectUI(); refreshFinalPreview();
});
$('rate-select').addEventListener('change', event => { ui.rate = Number(event.target.value); ui.accumulator = 0; });
$('resolution-select').addEventListener('change', event => { const [w, h] = event.target.value.split('x').map(Number); engine?.setResolution(w, h); reset(); });
for (const [id, property] of [['feedback-input', 'opacity'], ['warp-input', 'warp'], ['detail-input', 'detail']]) {
  $(id).addEventListener('input', event => { if (engine) engine.settings[property] = Number(event.target.value); reflectUI(); });
}
$('export-button').addEventListener('click', async () => {
  if (!engine || failed) return;
  try {
    const preset = ui.preset;
    const state = engine.state(preset);
    const { width, height } = state.output;
    const pixels = await engine.readback(preset);
    const imageCanvas = document.createElement('canvas'); imageCanvas.width = width; imageCanvas.height = height;
    imageCanvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = await new Promise(resolve => imageCanvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('No se pudo guardar la imagen.');
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `milky-${preset}-${state.frame}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (error) { showError(error); }
});

function brush(event) {
  if (!engine || !$('brush-input').checked || !event.buttons) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  const v = engine.viewports.find(([vx, vy, vw, vh]) => x >= vx && y >= vy && x <= vx + vw && y <= vy + vh);
  if (v) { engine.settings.brush = [(x - v[0]) / v[2], (y - v[1]) / v[3], 0.035, 1]; ui.dirty = true; }
}
canvas.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); brush(event); });
canvas.addEventListener('pointermove', brush);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { if (engine) engine.settings.brush = null; });
$('brush-input').addEventListener('change', event => { canvas.style.cursor = event.target.checked ? 'crosshair' : ''; if (engine) engine.settings.brush = null; });
document.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  const actions = { ' ': togglePause, r: reset, b: () => trigger('seed'), k: () => trigger('kick'), s: () => trigger('snare'), f: () => fullscreen().catch(showError), g: toggleGallery };
  if (actions[key]) { event.preventDefault(); actions[key](); }
  if (/^[1-5]$/.test(key) && PRESETS[Number(key) - 1]) selectPreset(PRESETS[Number(key) - 1].id);
});
new ResizeObserver(() => ui.dirty = true).observe(stage);
document.addEventListener('visibilitychange', () => { ui.lastTime = 0; ui.accumulator = 0; ui.dirty = true; });

try {
  engine = await MilkyEngine.create(canvas, showError);
  engine.settings.final = { ...FINAL_DEFAULTS, ...engine.settings.final };
  if (params.has('resolution')) { const [w, h] = params.get('resolution').split('x').map(Number); if ([400, 800, 1200].includes(w) && h === w * 1.6) { engine.setResolution(w, h); $('resolution-select').value = `${w}x${h}`; } }
  $('gpu-value').textContent = engine.gpuName;
  $('loading-panel').hidden = true;
  selectPreset(ui.preset);
  if (!ui.paused) engine.render({ preset: ui.preset, gallery: ui.gallery, steps: 1, dt: 1 / ui.rate });
  // Small deterministic API for validation, screenshots and later integration.
  window.milky = {
    engine, ui, errors, PRESETS,
    select: selectPreset, reset, trigger: kind => trigger(kind, false), pause: (value = true) => { ui.paused = value; ui.accumulator = 0; reflectUI(); },
    step: async (count = 1, gallery = ui.gallery) => {
      ui.paused = true; ui.gallery = gallery; ui.accumulator = 0;
      ui.stepping = true;
      try {
        const includesFinal = activeIds().includes('final');
        const batchSize = includesFinal ? 1 : 4;
        for (let i = 0; i < count; i += batchSize) {
          if (includesFinal) await engine.prepare?.(activeIds(), 1 / ui.rate);
          engine.render({ preset: ui.preset, gallery, steps: Math.min(batchSize, count - i), dt: 1 / ui.rate });
          await engine.device.queue.onSubmittedWorkDone();
        }
        $('frame-value').textContent = engine.state(ui.preset).frame.toLocaleString('es-AR');
      } finally { ui.stepping = false; ui.lastTime = 0; ui.dirty = true; reflectUI(); updateLabels(); }
    },
    diagnostics: () => ({ gpu: engine.gpuName, size: [engine.state(ui.preset).output.width, engine.state(ui.preset).output.height], preset: ui.preset, frames: engine.frame, states: [...engine.states].map(([id, s]) => ({ id, frames: s.frame, inkFrame: s.inkFrame })), errors: [...errors, ...engine.errors], fps: ui.fps, lostSteps: ui.lostSteps, stats: engine.stats }),
  };
  raf = requestAnimationFrame(loop);
} catch (error) { showError(error); }

window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); engine?.destroy(); });
