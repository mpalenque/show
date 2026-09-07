import {
  DEFAULT_MATERIALS,
  DEFAULT_PARAMETERS,
} from './fluid-config.js';

const publicAssetUrl = (name) => {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return new URL(`${base}fluid/${name}`, window.location.origin);
};
const WORKER_URL = publicAssetUrl('kot-fluid.worker.js');
const RUNTIME_SCRIPT_URL = publicAssetUrl('pvfs2d_v2_7.js');
const RUNTIME_WASM_URL = publicAssetUrl('pvfs2d_v2_7.wasm');
const MAX_PARTICLES = 40000;
const INTERPOLATION_CAPACITY_BLOCK = 2048;

const normalizeParticleCounts = (counts, fallback) => Array.from(
  { length: 4 },
  (_, materialId) => Math.max(
    0,
    Math.min(
      MAX_PARTICLES,
      Math.floor(Number(Array.isArray(counts) ? counts[materialId] : fallback) || 0),
    ),
  ),
);

/**
 * Async, render-friendly facade for the exact Grant Kot WASM solver.
 *
 * Physics lives entirely in a dedicated worker. `step()` is intentionally
 * non-blocking and keeps at most one physics frame in flight. `positions` is
 * a stable main-thread array interpolated between the two newest snapshots,
 * so Three.js can upload it without waiting for WASM or reallocating geometry.
 */
export class KotFluidWorkerClient {
  constructor(options = {}) {
    this.width = Math.max(1, Number(options.width) || 1280);
    this.height = Math.max(1, Number(options.height) || 720);
    this.maxParticles = MAX_PARTICLES;
    this.materialCount = 4;
    this.materials = DEFAULT_MATERIALS.map((material) => ({ ...material }));
    this.parameters = { ...DEFAULT_PARAMETERS, ...(options.parameters ?? {}) };
    this.initialParticlesPerMaterial = Math.max(
      0,
      Math.min(10000, Math.floor(options.initialParticlesPerMaterial ?? 5000)),
    );
    this.initialParticlesByMaterial = normalizeParticleCounts(
      options.initialParticlesByMaterial,
      this.initialParticlesPerMaterial,
    );

    this.count = 0;
    this.positions = new Float32Array(0);
    this.previousPositions = new Float32Array(0);
    this.materialIds = new Uint8Array(0);
    this.emitterIndices = new Int32Array([-1, -1]);
    this.frame = 0;
    this.lastStepMs = 0;
    this.roundTripMs = 0;
    this.interpolationAlpha = 1;
    this.error = null;

    this._capacity = 0;
    this._currentPositions = new Float32Array(0);
    this._hasSnapshot = false;
    this._lastSnapshotAt = 0;
    this._snapshotIntervalMs = 1000 / 60;
    this._stepInFlight = false;
    this._stepQueued = false;
    this._queuedSubsteps = 3;
    this._requestId = 0;
    this._pendingInteractions = [];
    this._disposed = false;

    let resolveReady;
    let rejectReady;
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this._resolveReady = resolveReady;
    this._rejectReady = rejectReady;

    this.worker = new Worker(WORKER_URL, { name: 'grant-kot-fluid-solver' });
    this.worker.onmessage = (event) => this._handleWorkerMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Grant Kot fluid worker failed.');
      this._fail(error);
    };
    this.worker.postMessage({
      type: 'init',
      runtimeScriptUrl: RUNTIME_SCRIPT_URL.href,
      runtimeWasmUrl: RUNTIME_WASM_URL.href,
      options: {
        width: this.width,
        height: this.height,
        parameters: this.parameters,
        materialMasses: this.materials.map((material) => material.mass),
        initialParticlesPerMaterial: this.initialParticlesPerMaterial,
        initialParticlesByMaterial: this.initialParticlesByMaterial,
      },
    });
  }

  get materialId() {
    return this.materialIds;
  }

  /**
   * Request one exact Kot frame. While physics is running, repeated RAF calls
   * collapse into one latest request rather than building a stale work queue.
   */
  step(substeps = 3) {
    if (this._disposed || this.error) return this;
    const steps = Math.max(1, Math.min(5, Math.round(Number(substeps) || 3)));
    if (this._stepInFlight) {
      this._stepQueued = true;
      this._queuedSubsteps = steps;
      return this;
    }
    this._dispatchStep(steps);
    return this;
  }

  _dispatchStep(steps) {
    const interactions = this._pendingInteractions.splice(0);
    const requestId = ++this._requestId;
    const sentAt = performance.now();
    this._stepInFlight = true;
    this.worker.postMessage({
      type: 'step',
      substeps: steps,
      interactions,
      requestId,
      sentAt,
    });
  }

  /** Cancel the single coalesced future tick, used by the pause control. */
  cancelQueuedStep() {
    this._stepQueued = false;
    this._pendingInteractions.length = 0;
    return this;
  }

  /**
   * Advance the render view between completed physics snapshots. Call once
   * per RAF immediately before rendering, including while physics is busy.
   */
  updateInterpolation(timestamp = performance.now()) {
    if (!this._hasSnapshot || this.count === 0) return this;
    const elapsed = Math.max(0, timestamp - this._lastSnapshotAt);
    const alpha = Math.max(0, Math.min(1, elapsed / this._snapshotIntervalMs));
    // Smoothstep removes the small velocity discontinuity at snapshot edges.
    const blend = alpha * alpha * (3 - 2 * alpha);
    const positionLength = this.count * 2;
    for (let index = 0; index < positionLength; index += 1) {
      const previous = this.previousPositions[index];
      this.positions[index] = previous
        + (this._currentPositions[index] - previous) * blend;
    }
    this.interpolationAlpha = alpha;
    return this;
  }

  applyPointer(interaction = {}) {
    if (this._disposed) return this;
    // Bound input latency/memory if the physics worker temporarily falls
    // behind. Recent pointer samples are more useful than stale ones.
    if (this._pendingInteractions.length >= 32) this._pendingInteractions.shift();
    this._pendingInteractions.push({ ...interaction });
    return this;
  }

  setParameters(next = {}) {
    const changed = {};
    for (const key of Object.keys(DEFAULT_PARAMETERS)) {
      const value = Number(next[key]);
      if (!Number.isFinite(value)) continue;
      this.parameters[key] = value;
      changed[key] = value;
    }
    if (Object.keys(changed).length) {
      this.worker.postMessage({ type: 'set-parameters', parameters: changed });
    }
    return this;
  }

  setMaterialMass(materialId, mass) {
    const index = Math.max(0, Math.min(3, Math.round(materialId)));
    const nextMass = Number(mass);
    if (Number.isFinite(nextMass) && nextMass > 0) {
      this.materials[index] = { ...this.materials[index], mass: nextMass };
      this.worker.postMessage({ type: 'set-material-mass', materialId: index, mass: nextMass });
    }
    return this;
  }

  resize(width, height) {
    this.width = Math.max(1, Number(width) || this.width);
    this.height = Math.max(1, Number(height) || this.height);
    this.worker.postMessage({ type: 'resize', width: this.width, height: this.height });
    return this;
  }

  reset(options = {}) {
    if (Array.isArray(options.initialParticlesByMaterial)) {
      this.initialParticlesByMaterial = normalizeParticleCounts(
        options.initialParticlesByMaterial,
        this.initialParticlesPerMaterial,
      );
    } else if (Number.isFinite(Number(options.initialParticlesPerMaterial))) {
      this.initialParticlesPerMaterial = Math.max(
        0,
        Math.min(10000, Math.floor(Number(options.initialParticlesPerMaterial))),
      );
      this.initialParticlesByMaterial = normalizeParticleCounts(
        null,
        this.initialParticlesPerMaterial,
      );
    }
    this._pendingInteractions.length = 0;
    this._stepQueued = false;
    const workerOptions = { initialParticlesByMaterial: this.initialParticlesByMaterial };
    if (options.openingLayout && typeof options.openingLayout === 'object') {
      workerOptions.openingLayout = options.openingLayout;
    }
    this.worker.postMessage({
      type: 'reset',
      options: workerOptions,
    });
    return this;
  }

  setOpeningEmitters(emitters = []) {
    if (this._disposed) return this;
    this.worker.postMessage({
      type: 'set-opening-emitters',
      emitters: Array.isArray(emitters) ? emitters : [],
    });
    return this;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._stepQueued = false;
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    this.count = 0;
    this.positions = new Float32Array(0);
    this.previousPositions = new Float32Array(0);
    this._currentPositions = new Float32Array(0);
    this.materialIds = new Uint8Array(0);
    this.emitterIndices[0] = -1;
    this.emitterIndices[1] = -1;
  }

  _ensureCapacity(requiredCount) {
    if (requiredCount <= this._capacity) return;
    const nextCapacity = Math.min(
      MAX_PARTICLES,
      Math.ceil(requiredCount / INTERPOLATION_CAPACITY_BLOCK) * INTERPOLATION_CAPACITY_BLOCK,
    );
    const nextPositions = new Float32Array(nextCapacity * 2);
    const nextPrevious = new Float32Array(nextCapacity * 2);
    const nextCurrent = new Float32Array(nextCapacity * 2);
    const nextMaterials = new Uint8Array(nextCapacity);
    nextPositions.set(this.positions);
    nextPrevious.set(this.previousPositions);
    nextCurrent.set(this._currentPositions);
    nextMaterials.set(this.materialIds);
    this.positions = nextPositions;
    this.previousPositions = nextPrevious;
    this._currentPositions = nextCurrent;
    this.materialIds = nextMaterials;
    this._capacity = nextCapacity;
  }

  _acceptSnapshot(message) {
    const receivedAt = performance.now();
    const incomingCount = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(message.count ?? 0)));
    const positionLength = incomingCount * 2;
    const materialOffset = Number(message.materialOffset)
      || positionLength * Float32Array.BYTES_PER_ELEMENT;
    const incomingPositions = new Float32Array(message.buffer, 0, positionLength);
    const incomingMaterials = new Uint8Array(message.buffer, materialOffset, incomingCount);
    this._ensureCapacity(incomingCount);

    if (this._hasSnapshot) {
      const retainedLength = Math.min(this.count, incomingCount) * 2;
      this.previousPositions.set(this._currentPositions.subarray(0, retainedLength), 0);
      // Newly emitted particles must not interpolate from (0, 0).
      if (positionLength > retainedLength) {
        this.previousPositions.set(incomingPositions.subarray(retainedLength), retainedLength);
      }
      const observedInterval = receivedAt - this._lastSnapshotAt;
      this._snapshotIntervalMs += (
        Math.max(8, Math.min(100, observedInterval)) - this._snapshotIntervalMs
      ) * 0.25;
    } else {
      this.previousPositions.set(incomingPositions, 0);
      this.positions.set(incomingPositions, 0);
      this._hasSnapshot = true;
    }

    this._currentPositions.set(incomingPositions, 0);
    this.materialIds.set(incomingMaterials, 0);
    this.count = incomingCount;
    this.frame = Math.max(0, Math.floor(message.frame ?? this.frame));
    this.lastStepMs = Math.max(0, Number(message.lastStepMs) || 0);
    this.roundTripMs = message.sentAt
      ? Math.max(0, receivedAt - Number(message.sentAt))
      : this.roundTripMs;
    this.emitterIndices[0] = Number(message.emitterIndices?.[0] ?? -1);
    this.emitterIndices[1] = Number(message.emitterIndices?.[1] ?? -1);
    this._lastSnapshotAt = receivedAt;
    this.interpolationAlpha = this._hasSnapshot ? 0 : 1;

    // The frame has already been copied into stable render arrays. Return its
    // backing store immediately so the worker can fill it again next step.
    this.worker.postMessage({ type: 'recycle', buffer: message.buffer }, [message.buffer]);
  }

  _handleWorkerMessage(message) {
    if (message.type === 'error') {
      this._fail(new Error(message.message || 'Grant Kot fluid worker failed.'));
      return;
    }
    if (message.type !== 'snapshot') return;
    this._acceptSnapshot(message);
    if (message.kind === 'frame') {
      this._stepInFlight = false;
      if (this._stepQueued && !this._disposed && !this.error) {
        const nextSubsteps = this._queuedSubsteps;
        this._stepQueued = false;
        this._dispatchStep(nextSubsteps);
      }
    }
    if (message.kind === 'ready') {
      this._resolveReady(this);
      this._resolveReady = () => {};
      this._rejectReady = () => {};
    }
  }

  _fail(error) {
    this.error = error instanceof Error ? error.message : String(error);
    this._stepInFlight = false;
    this._stepQueued = false;
    this._rejectReady?.(error);
    this._resolveReady = () => {};
    this._rejectReady = () => {};
    console.error(error);
  }
}

export { DEFAULT_MATERIALS, DEFAULT_PARAMETERS };
export default KotFluidWorkerClient;
