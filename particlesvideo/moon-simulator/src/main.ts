/**
 * Observer-only bootstrap: nothing on screen but the Moon changing phase,
 * seen from Earth. No starfield, no Earth, no Sun disc, no UI beyond a small
 * fader strip (hide it with H).
 *
 * Based on the Moon Phases Simulator by Gustavo Adrián Salvini <guspatagonico@gmail.com>
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createDefocusPass } from './postprocessing/DefocusPass';
import { attachEarthshine } from './scene/Earthshine';
import { MOON_DEFAULT_NORMAL_SCALE, createMoon } from './scene/Moon';
import { createMoonGlow } from './scene/MoonGlow';
import { createSun } from './scene/Sun';
import { SYNODIC_PERIOD } from './simulation/MoonPhase';
import { createOrbitalSystem } from './simulation/OrbitalSystem';
import { SimulationStore, createDefaultState } from './simulation/SimulationState';
import { createFaderPanel } from './ui/FaderPanel';

/** Every knob is readable from the URL and written back to it as the faders move. */
const query = new URLSearchParams(window.location.search);

const readNumber = (key: string, fallback: number): number => {
  const raw = query.get(key);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Simulated days per real second. 1 => a full lunation every ~29.5s. */
let daysPerSecond = readNumber('speed', 1);
/** Lunar day the animation starts from (0 = new moon). */
const START_DAY = readNumber('day', 0);
/** Share of the viewport height the lunar disc covers. */
const FRAME_FILL = THREE.MathUtils.clamp(readNumber('fill', 0.45), 0.05, 0.95);
const SUN_INTENSITY = readNumber('sun', 4.5);
/** Earthshine: sunlight bounced off Earth onto the lunar night side. */
let earthshineIntensity = readNumber('earthshine', 0.035);
/** Bloom: screen-space bleed from pixels brighter than the threshold. */
let bloomStrength = readNumber('bloom', 0.4);
let bloomThreshold = readNumber('threshold', 0.2);
const BLOOM_RADIUS = readNumber('radius', 0.5);
let bloomEnabled = readNumber('bloomOn', 1) !== 0;
/** Glow: geometric halo hugging the lunar silhouette. */
let glowStrength = readNumber('glow', 0.25);
let glowEnabled = readNumber('glowOn', 1) !== 0;
/** Defocus radius as a percentage of frame height. 0 = sharp. */
let defocusPercent = readNumber('blur', 0);
/** Normal-map strength: 1 is the true LOLA relief, higher exaggerates it. */
let reliefScale = readNumber('relief', MOON_DEFAULT_NORMAL_SCALE);
/** Flat uniform fill, kept at 0 now that earthshine is a real directional term. */
const AMBIENT_INTENSITY = readNumber('ambient', 0);
/** ?ui=0 boots with the fader strip hidden. */
const SHOW_FADERS = readNumber('ui', 1) !== 0;
/** How far from Earth's centre the virtual observer sits. */
const OBSERVER_DISTANCE = 4;
const MOON_RADIUS = 0.55;

export const simulationStore = new SimulationStore({
  ...createDefaultState(),
  viewMode: 'observer',
  currentDay: START_DAY,
  playSpeed: daysPerSecond,
  showOrbitLine: false,
});

const canvas = document.getElementById('scene-canvas');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas with id "scene-canvas" was not found');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(20, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Linear output: with a single lit object on black, filmic tone mapping only
// crushes the crescent phases into near-invisibility.
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  bloomStrength,
  BLOOM_RADIUS,
  bloomThreshold,
);
const defocus = createDefocusPass(defocusPercent / 100, window.innerWidth, window.innerHeight);
composer.addPass(defocus.pass);

bloomPass.enabled = bloomEnabled;
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const clock = new THREE.Clock();

/** Keeps the address bar in sync with the faders, so a reload restores the look. */
const syncUrl = (): void => {
  const next = new URLSearchParams(window.location.search);
  next.set('speed', String(Math.round(daysPerSecond * 100) / 100));
  next.set('earthshine', String(Math.round(earthshineIntensity * 1000) / 1000));
  next.set('bloom', String(Math.round(bloomStrength * 100) / 100));
  next.set('threshold', String(Math.round(bloomThreshold * 100) / 100));
  next.set('bloomOn', bloomEnabled ? '1' : '0');
  next.set('glow', String(Math.round(glowStrength * 100) / 100));
  next.set('glowOn', glowEnabled ? '1' : '0');
  next.set('relief', String(Math.round(reliefScale * 100) / 100));
  next.set('blur', String(Math.round(defocusPercent * 100) / 100));
  window.history.replaceState(null, '', `${window.location.pathname}?${next.toString()}`);
};

const setCameraFov = (nextFov: number): void => {
  if (Math.abs(camera.fov - nextFov) > 0.001) {
    camera.fov = nextFov;
    camera.updateProjectionMatrix();
  }
};

/** FOV that makes the disc cover FRAME_FILL of the frame at the given distance. */
const getObserverFov = (distanceToMoon: number): number => {
  const angularDiameter = 2 * Math.atan(MOON_RADIUS / Math.max(distanceToMoon, 0.001));
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(angularDiameter / FRAME_FILL), 1, 60);
};

const init = async (): Promise<void> => {
  const moon = await createMoon(scene);

  // The Sun is only a light source here: its visual sphere would drift into
  // frame around new moon, so it stays hidden.
  const sun = createSun(scene);
  sun.visual.visible = false;
  sun.light.castShadow = false;
  sun.light.intensity = SUN_INTENSITY;
  sun.light.position.set(100, 0, 0);
  sun.ambient.intensity = AMBIENT_INTENSITY;

  const moonMaterial = moon.material as THREE.MeshStandardMaterial;
  moonMaterial.normalScale.set(reliefScale, reliefScale);

  const earthshine = attachEarthshine(moon, { intensity: earthshineIntensity });
  const glow = createMoonGlow(scene, { moonRadius: MOON_RADIUS, strength: glowStrength });
  glow.setVisible(glowEnabled);

  const orbitalSystem = createOrbitalSystem(moon);
  scene.add(orbitalSystem.pivot);

  const faders = createFaderPanel({
    toggles: [
      {
        id: 'bloomOn',
        label: 'Bloom',
        value: bloomEnabled,
        onChange: (value) => {
          bloomEnabled = value;
          bloomPass.enabled = value;
          syncUrl();
        },
      },
      {
        id: 'glowOn',
        label: 'Glow',
        value: glowEnabled,
        onChange: (value) => {
          glowEnabled = value;
          glow.setVisible(value);
          syncUrl();
        },
      },
    ],
    faders: [
      {
        id: 'earthshine',
        label: 'Earthshine',
        min: 0,
        max: 0.15,
        step: 0.001,
        value: earthshineIntensity,
        format: (value) => value.toFixed(3),
        onChange: (value) => {
          earthshineIntensity = value;
          earthshine.setIntensity(value);
          syncUrl();
        },
      },
      {
        id: 'bloom',
        label: 'Bloom',
        min: 0,
        max: 2,
        step: 0.01,
        value: bloomStrength,
        onChange: (value) => {
          bloomStrength = value;
          bloomPass.strength = value;
          syncUrl();
        },
      },
      {
        id: 'threshold',
        label: 'Umbral',
        min: 0,
        max: 1,
        step: 0.01,
        value: bloomThreshold,
        onChange: (value) => {
          bloomThreshold = value;
          bloomPass.threshold = value;
          syncUrl();
        },
      },
      {
        id: 'glow',
        label: 'Glow',
        min: 0,
        max: 2,
        step: 0.01,
        value: glowStrength,
        onChange: (value) => {
          glowStrength = value;
          glow.setStrength(value);
          syncUrl();
        },
      },
      {
        id: 'blur',
        label: 'Desenfoque',
        min: 0,
        max: 5,
        step: 0.05,
        value: defocusPercent,
        onChange: (value) => {
          defocusPercent = value;
          defocus.setAmount(value / 100);
          syncUrl();
        },
      },
      {
        id: 'relief',
        label: 'Relieve',
        min: 0,
        max: 5,
        step: 0.05,
        value: reliefScale,
        onChange: (value) => {
          reliefScale = value;
          moonMaterial.normalScale.set(value, value);
          syncUrl();
        },
      },
      {
        id: 'speed',
        label: 'Velocidad',
        min: 0,
        max: 4,
        step: 0.05,
        value: daysPerSecond,
        onChange: (value) => {
          daysPerSecond = value;
          simulationStore.update({ playSpeed: value });
          syncUrl();
        },
      },
    ],
  }, SHOW_FADERS);

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyH') {
      faders.toggle();
    }
  });

  const moonWorldPos = new THREE.Vector3();
  const observerDirection = new THREE.Vector3();
  // Earth sits at the origin; the Sun is where its directional light is parked.
  const earthWorldPos = new THREE.Vector3(0, 0, 0);
  const sunWorldPos = sun.light.position.clone();

  const animate = (): void => {
    const delta = clock.getDelta();
    const state = simulationStore.get();

    if (state.isPlaying) {
      const nextDay = (state.currentDay + delta * state.playSpeed) % SYNODIC_PERIOD;
      simulationStore.update({ currentDay: nextDay });
    }

    orbitalSystem.setDay(simulationStore.get().currentDay);
    moon.getWorldPosition(moonWorldPos);
    observerDirection.copy(moonWorldPos).normalize();

    // Tidal locking: keep the near side (texture centre, local +X) facing Earth,
    // so only the terminator sweeps across a fixed lunar face.
    moon.rotation.y = Math.atan2(observerDirection.z, -observerDirection.x);

    camera.position.copy(observerDirection).multiplyScalar(OBSERVER_DISTANCE);
    setCameraFov(getObserverFov(camera.position.distanceTo(moonWorldPos)));
    camera.lookAt(moonWorldPos);

    const earthLitFraction = earthshine.update(moonWorldPos, earthWorldPos, sunWorldPos, camera);
    // The Moon's lit fraction is the complement of Earth's, seen from the Moon.
    glow.update(moonWorldPos, sunWorldPos, camera, 1 - earthLitFraction);

    composer.render();
    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);
};

const onResize = (): void => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.resolution.set(window.innerWidth, window.innerHeight);
  defocus.setSize(window.innerWidth, window.innerHeight);
};

/** Invisible conveniences for recording: space pauses, arrows step half a day. */
const onKeyDown = (event: KeyboardEvent): void => {
  const state = simulationStore.get();

  if (event.code === 'Space') {
    event.preventDefault();
    simulationStore.update({ isPlaying: !state.isPlaying });
    return;
  }

  if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault();
    const step = event.code === 'ArrowRight' ? 0.5 : -0.5;
    const nextDay = (state.currentDay + step + SYNODIC_PERIOD) % SYNODIC_PERIOD;
    simulationStore.update({ currentDay: nextDay, isPlaying: false });
  }
};

window.addEventListener('resize', onResize);
window.addEventListener('keydown', onKeyDown);

void init();
