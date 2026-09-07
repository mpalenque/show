import { createRenderer, showFatalError } from './render/Renderer.js';
import { Params } from './core/Params.js';
import { SceneManager } from './core/SceneManager.js';
import { Engine } from './core/Engine.js';
import { Keyboard } from './core/Keyboard.js';
import { Settings } from './core/Settings.js';
import { SceneBar } from './core/SceneBar.js';
import { Layer2D } from './layers2d/Layer2D.js';
import { Layer3D } from './layers3d/Layer3D.js';
import { Compositor } from './render/Compositor.js';
import { MidiInput } from './io/MidiInput.js';
import { OscClient } from './io/OscClient.js';
import { Mapper } from './io/Mapper.js';
import { Bridge } from './io/Bridge.js';
import { STAGE } from './config/stage.js';
import { SCENES } from './scenes/index.js';
import { BASE } from './scenes/base.js';
import { RadianceController } from './radiance/RadianceController.js';

async function boot() {
  window.name = 'vis-salida';
  const { renderer, view } = await createRenderer();
  console.info('[vis] WebGPU listo · backend', renderer.backend.constructor.name);

  // El registro tiene que estar completo antes de crear nada (el editor pide el listado al arrancar).
  const params = new Params();
  Compositor.defineParams(params);
  SceneManager.defineParams(params, SCENES);
  Layer2D.defineParams(params);
  Layer3D.defineParams(params);
  RadianceController.defineParams(params);

  const ctx = { params, stage: STAGE, renderer, scenes: null, mapper: null, bridge: null, settings: null };

  // Se restaura antes de crear nada: los elementos leen los defaults ya corregidos.
  const settings = new Settings(params, SceneManager.ownedParams(SCENES, BASE));
  settings.load();
  ctx.settings = settings;

  const scenes = new SceneManager(ctx, SCENES, BASE);
  ctx.scenes = scenes;
  scenes.init();

  const layer2d = new Layer2D(ctx);
  await layer2d.init();
  const layer3d = new Layer3D(ctx);
  await layer3d.init();

  const compositor = new Compositor(ctx, layer2d, layer3d);
  compositor.init();
  await compositor.warmup();

  const engine = new Engine(ctx, { layer2d, layer3d, compositor });
  engine.sim = layer3d.sim;
  engine.initFpsOverlay();
  ctx.engine = engine;
  const radiance = new RadianceController(ctx, view);
  ctx.radiance = radiance;
  // Preparar shaders, Worker, WASM y WAV antes de habilitar los cues del show.
  // Un fallo de Radiance se informa y permite seguir operando las escenas 1–23.
  await radiance.prepare().catch(() => {});

  // IO: todo lo que entra pasa por el Mapper, que solo escribe en Params.
  const mapper = new Mapper(ctx);
  ctx.mapper = mapper;
  await mapper.init();
  scenes.onSceneChange((id) => mapper.onSceneChange(id));

  const midi = new MidiInput({
    onMessage: (msg) => { mapper.dispatch(msg); bridge.midiActivity(msg); },
    onInputsChange: (list) => bridge.midiInputs(list),
  });
  const osc = new OscClient({
    onMessage: (msg) => { mapper.dispatch(msg); bridge.midiActivity(msg); },
    onStatus: (status) => bridge.oscStatus(status),
  });

  const bridge = new Bridge(ctx, { midi, osc, mapper });
  ctx.bridge = bridge;
  bridge.init();

  await midi.init();
  osc.connect();

  const sceneBar = new SceneBar(ctx);
  sceneBar.init();

  new Keyboard(ctx, {
    onToggleFps: () => engine.toggleFps(),
    onToggleSceneBar: () => sceneBar.toggle(),
    onToggleNativeView: () => console.info(`[vis] vista ${view.toggleNative()}`),
  }).init();

  applyQualityPresets(params);

  scenes.goto(SCENES[0].id, { transition: 0 });
  engine.start();

  window.vis = ctx;             // acceso desde la consola en desarrollo
  Object.assign(window.vis, { engine, layer2d, layer3d, midi, osc, settings });
  console.info('[vis] arrancado ·', params.list().length, 'params/actions ·', mapper.mappings.length, 'mapeos');
}

// Presets de calidad: un solo control para bajar carga si hace falta. Se persiste porque
// depende de la máquina, no del show.
// Menos partículas que antes en todos los escalones: los palitos ahora son ~2.7× más largos
// y ~1.7× más gruesos, así que con las cantidades viejas la caja se tapaba sola y volvía a
// verse como un bloque plano. Menos y más grandes = se ve el palito, la oclusión y el rumbo.
const QUALITY = {
  ultra: { count: 262144, bloom: true },
  high: { count: 131072, bloom: true },
  medium: { count: 65536, bloom: true },
  low: { count: 32768, bloom: false },
};

function applyQualityPresets(params) {
  const apply = (name) => {
    const preset = QUALITY[name];
    if (!preset) return;
    params.set('particles.count', preset.count);
    params.set('master.bloomEnabled', preset.bloom);
    localStorage.setItem('vis.quality', name);
  };
  params.onChange('master.quality', apply);
  const saved = localStorage.getItem('vis.quality');
  if (saved && QUALITY[saved]) params.set('master.quality', saved);
  apply(params.get('master.quality'));
}

boot().catch(showFatalError);
