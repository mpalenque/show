import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Params } from '../src/core/Params.js';
import { Rays } from '../src/layers3d/Rays.js';

async function fixture(t) {
  const params = new Params();
  Rays.defineParams(params);
  params.define({ id: 'layer3d.opacity', type: 'float', min: 0, max: 1, default: 1 });
  params.set('rays.enabled', true);
  params.set('rays.opacity', 1);
  // Fixed depth keeps the assertions independent of random spawning.
  params.set('rays.zMin', -1);
  params.set('rays.zMax', -1);
  const repulsors = new Map();
  const bursts = [];
  const lightRegistrations = [];
  const scene = new THREE.Scene();
  const rays = new Rays({
    params,
    forces: {
      clearRepulsor(slot) { repulsors.delete(slot); },
      setRepulsor(slot, ...args) { repulsors.set(slot, args); },
    },
    debris: { burst(x, z) { bursts.push([x, z]); } },
    renderer: { library: { addLight(...args) { lightRegistrations.push(args); } } },
  });
  await rays.init(scene);
  t.after(() => rays.dispose());
  return { params, rays, scene, repulsors, bursts, lightRegistrations };
}

const lit = rays => rays.lights.filter(light => light.intensity > 0);
const visibleBars = rays => rays.bars.filter(bar => bar.visible);

test('a falling ray carries its light, flashes on impact and fades completely with its shock', async t => {
  const { params, rays, repulsors, bursts } = await fixture(t);
  params.trigger('ray.spawn', 1.25);
  rays.update(0);
  const [light] = lit(rays);
  const [bar] = visibleBars(rays);
  assert.ok(light?.isPointLight);
  assert.equal(light.intensity, params.get('rays.lightIntensity'));
  assert.deepEqual(light.position.toArray(), bar.position.toArray());
  assert.equal(repulsors.size, 1, 'the ray still moves nearby sticks while falling');
  const initialY = light.position.y;

  rays.update(0.1);
  assert.ok(light.position.y < initialY, 'the light falls with the ray');
  assert.deepEqual(light.position.toArray(), bar.position.toArray());
  assert.deepEqual(bursts, []);

  rays.update(1);
  assert.equal(visibleBars(rays).length, 0, 'the falling stroke ends at the floor');
  assert.equal(light.position.y, params.get('rays.length') / 2);
  assert.ok(light.intensity > 0, 'impact keeps a visible light tail');
  assert.deepEqual(bursts, [[1.25, -1]], 'debris fires exactly at the impact position');
  const impactIntensity = light.intensity;
  const quarterTail = params.get('rays.impactTime') / 4;

  rays.update(quarterTail);
  assert.ok(light.intensity > 0 && light.intensity < impactIntensity);
  assert.equal(repulsors.size, 1, 'the impact keeps pushing as its light fades');
  const firstTailIntensity = light.intensity;
  rays.update(quarterTail);
  assert.ok(light.intensity > 0 && light.intensity < firstTailIntensity);
  rays.update(params.get('rays.impactTime'));
  assert.equal(lit(rays).length, 0, 'no orphan light remains after the impact');
  assert.equal(repulsors.size, 0);
  assert.equal(rays.rays.length, 0);
  rays.update(1);
  assert.equal(bursts.length, 1, 'the impact cannot fire again after expiring');
});

test('ray and layer fades also dim the light and can leave the scene completely dark', async t => {
  const { params, rays, repulsors } = await fixture(t);
  params.trigger('ray.spawn', 0);
  rays.update(0);
  const [light] = lit(rays);
  const fullIntensity = light.intensity;

  params.set('rays.opacity', 0.5);
  rays.update(0);
  assert.equal(light.intensity, fullIntensity / 2);
  params.set('layer3d.opacity', 0.25);
  rays.update(0);
  assert.equal(light.intensity, fullIntensity / 8);
  assert.equal(rays.uOpacity.value, 0.125);

  params.set('layer3d.opacity', 0);
  rays.update(0);
  assert.equal(lit(rays).length, 0);
  assert.equal(visibleBars(rays).length, 0);
  assert.equal(repulsors.size, 1, 'visual fading preserves the existing physical interaction');
  params.set('layer3d.opacity', 1);
  params.set('rays.opacity', 0);
  rays.update(0);
  assert.equal(lit(rays).length, 0);
  assert.equal(visibleBars(rays).length, 0);

  // A ray that reaches the floor during a fade must not flash through the fade.
  rays.update(1);
  assert.equal(lit(rays).length, 0);
  params.set('rays.opacity', 1);
  params.set('layer3d.opacity', 0.5);
  rays.update(params.get('rays.impactTime') / 4);
  assert.ok(light.intensity > 0 && light.intensity < fullIntensity / 2);
});

test('leaving a ray scene clears falling rays, impact tails and forces before re-entry', async t => {
  const { params, rays, repulsors, bursts } = await fixture(t);
  params.trigger('ray.spawn', -1);
  rays.update(1);
  params.trigger('ray.spawn', 1);
  rays.update(0.01);
  assert.equal(lit(rays).length, 2);
  assert.equal(repulsors.size, 2);
  assert.equal(visibleBars(rays).length, 1);

  params.set('rays.enabled', false);
  rays.update(0);
  assert.equal(lit(rays).length, 0);
  assert.equal(repulsors.size, 0);
  assert.equal(visibleBars(rays).length, 0);
  assert.equal(rays.uOpacity.value, 0);
  params.trigger('ray.spawn', 3);
  params.set('rays.enabled', true);
  rays.update(0.01);
  assert.equal(lit(rays).length, 0, 'old rays and disabled-scene triggers do not reappear');
  assert.equal(repulsors.size, 0);
  assert.equal(visibleBars(rays).length, 0);
  assert.equal(bursts.length, 1);
});

test('dense triggering reuses 32 permanent unshadowed lights and always admits the newest hit', async t => {
  const { params, rays, scene, repulsors, lightRegistrations } = await fixture(t);
  const initialLights = [...rays.lights];
  const initialBars = [...rays.bars];
  const initialChildren = [...scene.children];
  const materialVersion = rays.material.version;
  let sceneMutations = 0;
  scene.addEventListener('childadded', () => sceneMutations++);
  scene.addEventListener('childremoved', () => sceneMutations++);
  assert.equal(initialLights.length, 32);
  assert.equal(lightRegistrations.length, 1);

  for (let hit = 1; hit <= 32; hit++) params.trigger('ray.spawn', hit);
  rays.update(0);
  const oldestLight = rays.lights.find(light => light.position.x === 1);
  assert.equal(lit(rays).length, 32);
  assert.equal(repulsors.size, 32);
  params.trigger('ray.spawn', 33);
  rays.update(0);
  assert.equal(oldestLight.position.x, 33, 'the newest note replaces the oldest ray');
  assert.equal(lit(rays).length, 32);
  assert.equal(repulsors.size, 32);
  assert.deepEqual(rays.lights.map(light => light.position.x).sort((a, b) => a - b),
    Array.from({ length: 32 }, (_, i) => i + 2));

  for (let hit = 34; hit <= 128; hit++) {
    params.trigger('ray.spawn', hit);
    rays.update(0);
  }
  rays.update(1);
  rays.update(params.get('rays.impactTime') + 0.01);
  assert.equal(lit(rays).length, 0);
  assert.equal(repulsors.size, 0);
  assert.equal(sceneMutations, 0, 'bursts do not add or remove lights or meshes');
  assert.equal(rays.material.version, materialVersion, 'bursts do not invalidate the ray shader');
  assert.equal(rays.lights.length, initialLights.length);
  assert.equal(rays.bars.length, initialBars.length);
  for (let i = 0; i < initialLights.length; i++) {
    assert.equal(rays.lights[i], initialLights[i], 'light objects are reused');
    assert.equal(rays.bars[i], initialBars[i], 'stroke meshes are reused');
    assert.equal(rays.lights[i].parent, scene);
    assert.equal(rays.lights[i].visible, true, 'zero intensity retains the permanent light graph');
    assert.equal(rays.lights[i].castShadow, false, 'rays never allocate cubemap shadows');
  }
  assert.deepEqual(scene.children, initialChildren);
});

test('the rendered default stroke is three times wider and width remains editable', async t => {
  const { params, rays } = await fixture(t);
  params.trigger('ray.spawn', 0);
  rays.update(0);
  const [bar] = visibleBars(rays);
  assert.equal(params.get('rays.width'), 0.042);
  assert.equal(bar.scale.x, 0.042);
  assert.equal(bar.scale.z, 0.042);
  assert.equal(bar.scale.y, params.get('rays.length'));
  params.set('rays.width', 0.084);
  rays.update(0);
  assert.equal(bar.scale.x, 0.084);
  assert.equal(bar.scale.z, 0.084);
  assert.equal(bar.scale.y, params.get('rays.length'), 'width edits preserve stroke length');
});

test('live color, reach and intensity edits affect both existing rays and subsequent hits', async t => {
  const { params, rays } = await fixture(t);
  params.trigger('ray.spawn', -1);
  rays.update(0);
  params.set('rays.color', '#4488ff');
  params.set('rays.lightRange', 4);
  params.set('rays.lightIntensity', 12);
  params.trigger('ray.spawn', 1);
  rays.update(0);
  assert.equal(lit(rays).length, 2);
  for (const light of lit(rays)) {
    assert.equal(light.color.getHexString(), '4488ff');
    assert.equal(light.distance, 4);
    assert.equal(light.intensity, 12);
  }
  assert.equal(rays.uColor.value.getHexString(), '4488ff', 'light and stroke have the same color');
  params.set('rays.lightIntensity', 0);
  rays.update(0);
  assert.equal(lit(rays).length, 0);
  assert.equal(visibleBars(rays).length, 2, 'the light control can be disabled independently');
});
