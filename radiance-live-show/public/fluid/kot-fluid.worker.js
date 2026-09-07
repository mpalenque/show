/*
 * Grant Kot's pvfs2d runtime is an Emscripten "classic script", so this
 * worker deliberately has no ESM imports. The main-thread client supplies
 * the Vite-resolved JS/WASM URLs during init.
 */

const DEFAULT_PARAMETERS = Object.freeze({
  sameRestDensity: 6.5,
  differentRestDensity: 6.1,
  stiffness: 0.2,
  nearStiffness: 0.05,
  gravity: 0,
  drag: 0,
  // Freno: cuánta velocidad pierde el fluido en cada subpaso. `dampen_sim`
  // multiplica la velocidad por el factor que recibe, así que 0 = nada de
  // freno y 0.02 ya deja un empujón muerto en un cuarto de segundo. Va
  // aparte de `drag` —que el solver nunca aplicó— para que sólo lo mueva
  // quien lo pida: hoy, el cierre quieto del show de fluidos.
  brake: 0,
  pointerForce: 0.5,
});

const MAX_PARTICLES = 40000;
const FRAME_MATERIAL_OFFSET = MAX_PARTICLES * 2 * Float32Array.BYTES_PER_ELEMENT;
const FRAME_BUFFER_BYTES = FRAME_MATERIAL_OFFSET + MAX_PARTICLES;

// With gravity disabled, start the three dense fluids in calm, overlapping
// horizontal strata instead of scattering them through the whole box. This
// preserves the Liquid Layers composition while leaving gravity at exactly 0.
function initialMaterialBounds(materialId) {
  const bands = [
    [0.64, 0.91], // Ruby: lower, heaviest-looking layer
    [0.46, 0.70], // Amber: middle layer
    [0.27, 0.53], // Tangerine: upper layer
    [0.28, 0.36], // Azure is replaced by its two fixed anchors below
  ];
  const [top, bottom] = bands[materialId] ?? bands[0];
  return [width * 0.025, height * top, width * 0.975, height * bottom];
}

let runtime = null;
let sim = 0;
let width = 1280;
let height = 720;
let frame = 0;
let count = 0;
let parameters = { ...DEFAULT_PARAMETERS };
let materialMasses = [1, 0.6, 0.36, 0.216];
let initialParticlesByMaterial = [6666, 6666, 6666, 2];
let commandQueue = Promise.resolve();
const recycledFrames = [];

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeParticleCounts(counts, fallback = 0) {
  return Array.from({ length: 4 }, (_, materialId) => Math.max(
    0,
    Math.min(40000, Math.floor(finiteNumber(counts?.[materialId], fallback))),
  ));
}

function loadRuntime(scriptUrl, wasmUrl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let probes = 0;
    let probeTimer = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (probeTimer) clearTimeout(probeTimer);
      resolve(value);
    };
    const fail = (reason) => {
      if (settled) return;
      settled = true;
      if (probeTimer) clearTimeout(probeTimer);
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };
    const module = {
      locateFile(path) {
        return path.endsWith('.wasm') ? wasmUrl : path;
      },
      onRuntimeInitialized() {
        finish(module);
      },
      onAbort(reason) {
        fail(new Error(`Grant Kot fluid runtime aborted: ${reason}`));
      },
      printErr(message) {
        console.error(`[KotFluidWorker] ${message}`);
      },
    };
    self.Module = module;
    try {
      importScripts(scriptUrl);
    } catch (error) {
      fail(error);
      return;
    }

    // Some browsers replace the classic Emscripten Module object while the
    // script loads, so its original callback never resolves this promise.
    // Wait for Emscripten's explicit ready marker before starting the solver.
    const probeRuntime = () => {
      if (settled) return;
      const candidate = self.Module;
      if (
        candidate?.calledRun === true
        && candidate.HEAPF32
        && typeof candidate._pvfs_new_sim === 'function'
      ) {
        finish(candidate);
        return;
      }
      probes += 1;
      if (probes >= 120) {
        fail(new Error('Grant Kot fluid runtime did not initialize within 12 seconds.'));
        return;
      }
      probeTimer = setTimeout(probeRuntime, 100);
    };
    probeRuntime();
  });
}

function openingUnit(seed) {
  let value = Math.imul((seed ^ (seed >>> 16)) >>> 0, 0x45d9f3b) >>> 0;
  value = Math.imul((value ^ (value >>> 16)) >>> 0, 0x45d9f3b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

function applyOpeningParticleLayout(counts, openingLayout) {
  const particleTotal = counts.reduce((total, value) => total + value, 0);
  if (!particleTotal) return;
  const pointer = runtime._pvfs_get_particle_positions(sim);
  const positions = new Float32Array(runtime.HEAPF32.buffer, pointer, particleTotal * 2);
  const clusterCentres = [
    [[0.22, 0.72], [0.39, 0.62]],
    [[0.34, 0.37], [0.53, 0.48]],
    [[0.64, 0.67], [0.77, 0.52]],
    [[0.67, 0.29], [0.48, 0.31]],
  ];
  let particleStart = 0;
  for (let materialId = 0; materialId < 4; materialId += 1) {
    for (let offset = 0; offset < counts[materialId]; offset += 1) {
      const index = particleStart + offset;
      const seed = ((materialId + 1) * 0x1f123bb5 + (offset + 1) * 0x6c8e9cf5) >>> 0;
      const clustered = openingUnit(seed) < 0.64;
      let x;
      let y;
      if (clustered) {
        const centre = clusterCentres[materialId][openingUnit(seed + 1) < 0.5 ? 0 : 1];
        const angle = openingUnit(seed + 2) * Math.PI * 2;
        const distance = Math.sqrt(openingUnit(seed + 3));
        x = centre[0] + Math.cos(angle) * distance * (0.055 + materialId * 0.006);
        y = centre[1] + Math.sin(angle) * distance * 0.075;
      } else {
        // The loose third keeps the opening from reading as four artificial
        // blobs while the clustered majority gives the calm 500-particle
        // field some visual structure before any light is introduced.
        x = 0.08 + openingUnit(seed + 4) * 0.84;
        y = 0.12 + openingUnit(seed + 5) * 0.76;
      }
      positions[index * 2] = width * Math.max(0.025, Math.min(0.975, x));
      positions[index * 2 + 1] = height * Math.max(0.04, Math.min(0.96, y));
    }
    particleStart += counts[materialId];
  }
  positionOpeningEmitters(openingLayout.emitters);
}

function positionOpeningEmitters(emitters) {
  if (!Array.isArray(emitters) || !sim || initialParticlesByMaterial[3] <= 0) return;
  const particleTotal = initialParticlesByMaterial.reduce((total, value) => total + value, 0);
  const azureStart = initialParticlesByMaterial[0]
    + initialParticlesByMaterial[1]
    + initialParticlesByMaterial[2];
  const pointer = runtime._pvfs_get_particle_positions(sim);
  const positions = new Float32Array(runtime.HEAPF32.buffer, pointer, particleTotal * 2);
  for (const emitter of emitters) {
    if (!emitter?.active) continue;
    const slot = Math.max(0, Math.min(2, Math.round(finiteNumber(emitter.id, 0))));
    if (slot >= initialParticlesByMaterial[3]) continue;
    const index = (azureStart + slot) * 2;
    positions[index] = width * Math.max(0, Math.min(1, finiteNumber(emitter.x, 0.5)));
    positions[index + 1] = height * Math.max(0, Math.min(1, finiteNumber(emitter.y, 0.5)));
  }
}

function createSimulation(particleCounts, openingLayout = null) {
  const counts = normalizeParticleCounts(particleCounts);
  if (sim) runtime._pvfs_delete_sim(sim);
  sim = runtime._pvfs_new_sim(40000, 4, 40000, 4096);
  runtime._pvfs_set_sim_size(sim, width, height, 0, 0, true);

  // This is the exact native material order used by Liquid Layers.
  for (const mass of [0.216, 0.36, 0.6, 1]) {
    runtime._pvfs_add_material(sim, mass, 2, 0.25, 0.25);
  }
  for (let materialId = 0; materialId < 4; materialId += 1) {
    const materialCount = counts[materialId];
    if (materialCount === 0) continue;
    const [left, top, right, bottom] = initialMaterialBounds(materialId);
    runtime._pvfs_add_particles(
      sim,
      materialCount,
      materialId,
      left,
      top,
      right,
      bottom,
    );
  }

  initialParticlesByMaterial = counts;

  if (openingLayout && finiteNumber(openingLayout.scene, 0) > 0) {
    applyOpeningParticleLayout(counts, openingLayout);
  // Preserve the demo's two ordinary-size Azure emitters and their anchors.
  } else if (counts[3] === 2) {
    const azureStart = counts[0] + counts[1] + counts[2];
    const particleTotal = counts.reduce((total, value) => total + value, 0);
    const pointer = runtime._pvfs_get_particle_positions(sim);
    const positions = new Float32Array(runtime.HEAPF32.buffer, pointer, particleTotal * 2);
    const anchors = [[0.38, 0.52], [0.68, 0.52]];
    anchors.forEach(([x, y], offset) => {
      const index = (azureStart + offset) * 2;
      positions[index] = width * x;
      positions[index + 1] = height * y;
    });
  }

  frame = 0;
  refreshCount();
}

function refreshCount() {
  count = sim ? runtime._pvfs_get_particle_count(sim) : 0;
}

function applyInteraction(interaction, steps, collisionPhase) {
  const x = finiteNumber(interaction.x, 0);
  const y = finiteNumber(interaction.y, 0);
  const radius = finiteNumber(interaction.radius, 100);
  const strength = finiteNumber(interaction.strength, 0.5);
  const mode = interaction.mode ?? 'drag';

  if (collisionPhase) {
    if (mode === 'collide') runtime._pvfs_collide_particles_circle(sim, x, y, radius);
    return;
  }
  if (mode === 'collide') return;
  if (mode === 'drag') {
    runtime._pvfs_drag_particles(
      sim,
      x,
      y,
      radius,
      finiteNumber(interaction.vx, 0) / steps,
      finiteNumber(interaction.vy, 0) / steps,
    );
  } else if (mode === 'attract') {
    runtime._pvfs_attract_particles(sim, x, y, radius, strength);
  } else if (mode === 'repel') {
    runtime._pvfs_attract_particles(sim, x, y, radius, -strength);
  } else if (mode === 'vortex') {
    runtime._pvfs_vortex_sim(sim, x, y, radius, strength);
  } else if (mode === 'vortex-reverse') {
    runtime._pvfs_vortex_sim(sim, x, y, radius, -strength);
  } else if (mode === 'delete') {
    runtime._pvfs_delete_particles(sim, x, y, radius);
  } else if (mode === 'lock') {
    runtime._pvfs_lock_particles(sim, x, y, radius);
  } else if (mode === 'unlock') {
    runtime._pvfs_unlock_particles(sim, x, y, radius);
  } else if (mode === 'herd') {
    // EL MALACATE: junta UN material hacia un punto, cosa que ninguna fuerza
    // del solver puede hacer (attract/vortex/drag pegan a todo lo que entra
    // en el radio, sin mirar material). Escribe las posiciones directo — el
    // solver es de relajacion posicional, asi que mover posiciones es mover
    // particulas sin inyectarles velocidad — y solo toca las que estan FUERA
    // del radio: adentro el fluido sigue siendo fluido. `vx` trae el paso en
    // px por frame (ya escalado por dt), se reparte entre subpasos.
    const count = runtime._pvfs_get_particle_count(sim);
    const step = finiteNumber(interaction.vx, 0) / steps;
    if (count > 0 && step > 0) {
      const positions = new Float32Array(
        runtime.HEAPF32.buffer,
        runtime._pvfs_get_particle_positions(sim),
        count * 2,
      );
      const materials = new Uint8Array(
        runtime.HEAPU8.buffer,
        runtime._pvfs_get_particle_material_ids(sim),
        count,
      );
      const wanted = Math.max(0, Math.min(3, Math.round(finiteNumber(interaction.materialId, 0))));
      // strength = INTERCAMBIOS por frame: la purga del nucleo no empuja a
      // nadie (empujar es una pulseada permanente contra la presion — medido,
      // deja todo hirviendo y el nucleo mezclado igual). PERMUTA: un ajeno de
      // adentro y una del material juntado de afuera se cambian de lugar. La
      // ocupacion del espacio no cambia, asi que la presion ni se entera, y
      // cada intercambio suma una al nucleo por construccion. El azul fijo
      // (material 3, los anclajes de la apertura) no se toca nunca.
      const swapsPerCall = Math.max(0, Math.round(strength / steps));
      // El nucleo que se purga es MAS CHICO que el radio casa del riel: la
      // permuta solo puede purificar un disco que las particulas del material
      // juntado puedan llenar. Con 1764 blancas y un radio casa de 0.36 del
      // lado corto, el disco entero tiene capacidad para ~9400 particulas y
      // el canje se queda sin blancas de afuera con el nucleo al 25% (medido:
      // el racimo conexo se clava en ~50%). Al 55% del radio la capacidad es
      // ~la poblacion, y el nucleo queda blanco de verdad.
      const coreRadius = radius * 0.55;
      const aliens = [];
      const outs = [];
      for (let index = 0; index < count; index += 1) {
        const dx = x - positions[index * 2];
        const dy = y - positions[index * 2 + 1];
        const distance = Math.hypot(dx, dy);
        if (distance <= 1e-6) continue;
        if (materials[index] === wanted) {
          if (distance > radius) {
            const pull = Math.min(step, distance - radius);
            positions[index * 2] += (dx / distance) * pull;
            positions[index * 2 + 1] += (dy / distance) * pull;
          }
          // Con margen: las del borde del nucleo no entran al canje, o
          // quedan canjeandose para siempre con la marea del borde.
          if (distance > coreRadius + 8) outs.push([distance, index]);
        } else if (swapsPerCall > 0 && materials[index] !== 3 && distance < coreRadius - 8) {
          aliens.push([distance, index]);
        }
      }
      if (swapsPerCall > 0 && aliens.length && outs.length) {
        // El ajeno mas profundo sale primero; la de afuera mas cercana entra
        // primero — asi cada permuta es el salto mas corto disponible.
        aliens.sort((a, b) => a[0] - b[0]);
        outs.sort((a, b) => a[0] - b[0]);
        const swaps = Math.min(swapsPerCall, aliens.length, outs.length);
        for (let swap = 0; swap < swaps; swap += 1) {
          const a = aliens[swap][1];
          const b = outs[swap][1];
          const ax = positions[a * 2];
          const ay = positions[a * 2 + 1];
          positions[a * 2] = positions[b * 2];
          positions[a * 2 + 1] = positions[b * 2 + 1];
          positions[b * 2] = ax;
          positions[b * 2 + 1] = ay;
        }
      }
    }
  } else if (mode === 'emit') {
    const emitCount = Math.max(1, Math.round(finiteNumber(interaction.emitCount, 5)));
    const materialId = Math.max(0, Math.min(3, Math.round(finiteNumber(interaction.materialId, 0))));
    // Azure stays a fixed pair: other brushes may still create ordinary fluid.
    if (materialId === 3) return;
    runtime._pvfs_add_particles(
      sim,
      emitCount,
      materialId,
      x - 10,
      y - 10,
      x + 10,
      y + 10,
    );
  }
}

function advance(substeps, interactions) {
  const startedAt = performance.now();
  const steps = Math.max(1, Math.min(5, Math.round(finiteNumber(substeps, 3))));
  runtime._pvfs_set_parameters(
    sim,
    parameters.sameRestDensity,
    parameters.differentRestDensity,
    parameters.stiffness,
    parameters.nearStiffness,
    materialMasses[0],
    materialMasses[1],
    materialMasses[2],
    materialMasses[3],
  );
  runtime._pvfs_set_sim_gravity(sim, 0, parameters.gravity);

  // El freno va ANTES de las interacciones: lo que el operador (o un
  // atractor) empuja en este subpaso sale con toda su fuerza, y lo que queda
  // rodando de los subpasos anteriores se apaga. Empujar sigue funcionando;
  // soltar frena.
  const brake = Math.max(0, Math.min(1, finiteNumber(parameters.brake, 0)));
  for (let substep = 0; substep < steps; substep += 1) {
    if (brake > 0) runtime._pvfs_dampen_sim(sim, 1 - brake);
    for (const interaction of interactions) applyInteraction(interaction, steps, false);
    runtime._pvfs_update_sim_before_collisions(sim, 1);
    for (const interaction of interactions) {
      if (interaction.mode === 'collide') applyInteraction(interaction, steps, true);
    }
    runtime._pvfs_update_sim_after_collisions(sim, 1);
  }
  frame += 1;
  refreshCount();
  return performance.now() - startedAt;
}

function acquireFrameBuffer() {
  return recycledFrames.pop() ?? new ArrayBuffer(FRAME_BUFFER_BYTES);
}

function postSnapshot(kind, lastStepMs = 0, requestId = 0, sentAt = 0) {
  refreshCount();
  const positionLength = count * 2;
  const buffer = acquireFrameBuffer();
  const positions = new Float32Array(buffer, 0, positionLength);
  const materialIds = new Uint8Array(buffer, FRAME_MATERIAL_OFFSET, count);
  const sourcePositionsPointer = runtime._pvfs_get_particle_positions(sim);
  const sourceMaterialsPointer = runtime._pvfs_get_particle_material_ids(sim);
  positions.set(new Float32Array(
    runtime.HEAPF32.buffer,
    sourcePositionsPointer,
    positionLength,
  ));
  materialIds.set(new Uint8Array(
    runtime.HEAPU8.buffer,
    sourceMaterialsPointer,
    count,
  ));

  const emitterIndices = [-1, -1];
  let emitterCount = 0;
  for (let index = 0; index < count && emitterCount < 2; index += 1) {
    if (materialIds[index] !== 3) continue;
    emitterIndices[emitterCount] = index;
    emitterCount += 1;
  }
  self.postMessage({
    type: 'snapshot',
    kind,
    buffer,
    materialOffset: FRAME_MATERIAL_OFFSET,
    count,
    frame,
    lastStepMs,
    requestId,
    sentAt,
    producedAt: performance.now(),
    emitterIndices,
  }, [buffer]);
}

async function handleCommand(message) {
  switch (message.type) {
    case 'init': {
      width = Math.max(1, finiteNumber(message.options?.width, width));
      height = Math.max(1, finiteNumber(message.options?.height, height));
      parameters = { ...DEFAULT_PARAMETERS, ...(message.options?.parameters ?? {}) };
      materialMasses = Array.from(
        { length: 4 },
        (_, index) => Math.max(0.0001, finiteNumber(message.options?.materialMasses?.[index], materialMasses[index])),
      );
      initialParticlesByMaterial = normalizeParticleCounts(
        message.options?.initialParticlesByMaterial,
        finiteNumber(message.options?.initialParticlesPerMaterial, 5000),
      );
      runtime = await loadRuntime(message.runtimeScriptUrl, message.runtimeWasmUrl);
      createSimulation(initialParticlesByMaterial);
      postSnapshot('ready');
      break;
    }
    case 'step': {
      const lastStepMs = advance(message.substeps, message.interactions ?? []);
      postSnapshot('frame', lastStepMs, message.requestId, message.sentAt);
      break;
    }
    case 'set-parameters': {
      for (const key of Object.keys(DEFAULT_PARAMETERS)) {
        const value = Number(message.parameters?.[key]);
        if (Number.isFinite(value)) parameters[key] = value;
      }
      break;
    }
    case 'set-material-mass': {
      const materialId = Math.max(0, Math.min(3, Math.round(finiteNumber(message.materialId, 0))));
      const mass = Number(message.mass);
      if (Number.isFinite(mass) && mass > 0) materialMasses[materialId] = mass;
      break;
    }
    case 'resize': {
      width = Math.max(1, finiteNumber(message.width, width));
      height = Math.max(1, finiteNumber(message.height, height));
      runtime._pvfs_set_sim_size(sim, width, height, 0, 0, false);
      postSnapshot('resize');
      break;
    }
    case 'reset': {
      if (Array.isArray(message.options?.initialParticlesByMaterial)) {
        initialParticlesByMaterial = normalizeParticleCounts(message.options.initialParticlesByMaterial);
      } else if (Number.isFinite(Number(message.options?.initialParticlesPerMaterial))) {
        initialParticlesByMaterial = normalizeParticleCounts(
          null,
          Number(message.options.initialParticlesPerMaterial),
        );
      }
      createSimulation(initialParticlesByMaterial, message.options?.openingLayout ?? null);
      postSnapshot('reset');
      break;
    }
    case 'set-opening-emitters': {
      positionOpeningEmitters(message.emitters);
      postSnapshot('opening-emitters');
      break;
    }
    case 'recycle': {
      if (
        message.buffer instanceof ArrayBuffer
        && message.buffer.byteLength === FRAME_BUFFER_BYTES
      ) recycledFrames.push(message.buffer);
      break;
    }
    case 'dispose': {
      if (sim && runtime) runtime._pvfs_delete_sim(sim);
      sim = 0;
      count = 0;
      break;
    }
    default:
      break;
  }
}

self.onmessage = (event) => {
  commandQueue = commandQueue
    .then(() => handleCommand(event.data))
    .catch((error) => {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : '',
      });
    });
};
