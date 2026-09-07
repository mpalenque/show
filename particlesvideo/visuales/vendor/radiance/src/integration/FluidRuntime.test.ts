import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({ solver: null as any, renderer: null as any, geometry: null as any }));
vi.mock('../scenes/fluid/KotFluidWorkerClient.js', () => {
  class Solver {
    ready = Promise.resolve(); count = 0; frame = 0; error = null;
    positions = new Float32Array(0); materialIds = new Uint8Array(0);
    _pendingInteractions: any[] = []; _stepInFlight = false; _stepQueued = false;
    reset = vi.fn((options: any) => { this.count = options.initialParticlesByMaterial.reduce((a: number, b: number) => a + b, 0); return this; });
    drain = vi.fn(() => Promise.resolve());
    setMaterialMass = vi.fn(); setParameters = vi.fn(); updateInterpolation = vi.fn(); resize = vi.fn(); dispose = vi.fn();
    applyPointer = vi.fn((interaction: any) => { this._pendingInteractions.push(interaction); });
    step = vi.fn(() => { this.frame += 1; this._pendingInteractions.length = 0; });
    cancelQueuedStep = vi.fn(() => { this._pendingInteractions.length = 0; this._stepQueued = false; });
    constructor() { shared.solver = this; }
  }
  return { default: Solver, DEFAULT_PARAMETERS: { pointerForce: 0.5, gravity: 0, brake: 0 } };
});
vi.mock('../scenes/fluid/FluidRadianceRenderer', () => ({
  default: class {
    stats = { resolution: 1024, targetMemoryBytes: 0, drawCalls: 4 };
    render = vi.fn(); setOverlay = vi.fn(); resetRadiance = vi.fn(); setQuality = vi.fn();
    resize = vi.fn(); finishWarmup = vi.fn(); dispose = vi.fn();
    constructor() { shared.renderer = this; }
  },
}));
vi.mock('../scenes/fluid/TresMasasGeometry', () => ({
  default: class {
    setInstances = vi.fn(); setGain = vi.fn(); dispose = vi.fn();
    constructor() { shared.geometry = this; }
  },
}));

import FluidRuntime from './FluidRuntime';
import { emptyDoc, makeEvent, parseShowDoc } from '../fluids-show/show-doc';
import FluidsShowDirector from '../scenes/fluid/FluidsShowDirector';
import authoredShow from '../../../../public/radiance/show/fluids.show.json';

describe('FluidRuntime control ownership', () => {
  let runtime: FluidRuntime;
  beforeEach(async () => {
    vi.stubGlobal('document', { createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {} }) });
    runtime = new FluidRuntime();
    await runtime.init({ append() {} } as unknown as HTMLElement);
  });
  afterEach(() => { runtime.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('keeps scene 24 stationary with only the initial white line and no timeline or physics work', async () => {
    const doc = parseShowDoc(authoredShow);
    doc.events.push(makeEvent('strobe-lines', 0), makeEvent('emit-burst', 0));
    doc.curves.lineBreak = { keys: [{ t: 0, v: 1, shape: 'hold' }] };
    doc.curves.lineEmit = { keys: [{ t: 0, v: 0, shape: 'hold' }] };
    const savedDoc = JSON.stringify(doc);
    const updates = vi.spyOn(FluidsShowDirector.prototype, 'update');
    await runtime.enterStandby(doc);
    const updateCount = updates.mock.calls.length;
    const geometry = shared.geometry.setInstances.mock.lastCall[0];
    expect(geometry).toHaveLength(2);
    expect(geometry[0]).toMatchObject({ x: 0.5, y: 0.5, color: 0xffffff, rot: 0, h: 0.0035, shape: 0 });
    expect(geometry[1].color).toBe(0);
    // Keep the emissive face geometry unchanged while disabling its HRC
    // injection; otherwise the display field draws a large cone under it.
    expect(geometry[0]).toMatchObject({ emit: 1.15, shade: 1.1 });
    expect(shared.geometry.setGain).toHaveBeenLastCalledWith(0);
    shared.solver.step.mockClear();
    shared.solver.applyPointer.mockClear();
    shared.solver.updateInterpolation.mockClear();
    const masses = shared.solver.setMaterialMass.mock.calls.length;
    const physics = shared.solver.setParameters.mock.calls.length;
    const geometryChanges = shared.geometry.setInstances.mock.calls.length;
    runtime.setGesture({ mode: 'attract', x: 0.5, y: 0.5, vx: 0, vy: 0, strength: 1, radius: 0.3 });
    runtime.liveAction('burst', { count: 300 });
    for (let index = 0; index < 120; index += 1) {
      runtime.frame({ now: 100 + index / 60, time: 140, playing: true, dt: 1 / 60, live: { emission: 1 } });
    }
    expect(updates).toHaveBeenCalledTimes(updateCount);
    expect(shared.geometry.setInstances).toHaveBeenCalledTimes(geometryChanges);
    expect(shared.solver.step).not.toHaveBeenCalled();
    expect(shared.solver.applyPointer).not.toHaveBeenCalled();
    expect(shared.solver.updateInterpolation).not.toHaveBeenCalled();
    expect(shared.solver.setMaterialMass).toHaveBeenCalledTimes(masses);
    expect(shared.solver.setParameters).toHaveBeenCalledTimes(physics);
    expect(shared.renderer.render.mock.lastCall[1]).toMatchObject({ blackOutput: 0, backgroundBlack: 1,
      radiance: 0, radianceExposure: 0 });
    expect(runtime.telemetry()).toMatchObject({ mode: 'standby', standbyPrepared: true,
      particles: 0, solverFrame: 0, activeEvents: 0, activeGestures: 0, pps: 0 });
    expect(JSON.stringify(doc)).toBe(savedDoc);
  });

  it('starts scene 25 synchronously from prepared standby without resetting the solver or GPU caches', async () => {
    const doc = parseShowDoc(authoredShow);
    doc.events.push(makeEvent('reset-fluid', 0));
    await runtime.enterStandby(doc);
    runtime.frame({ now: 30, time: 0, dt: 1 / 60 });
    runtime.suspend(); // The controller may suspend around the scene handoff.
    const drains = shared.solver.drain.mock.calls.length;
    const resets = shared.solver.reset.mock.calls.length;
    const radianceResets = shared.renderer.resetRadiance.mock.calls.length;
    const expected = new FluidsShowDirector();
    expected.setDoc(doc);
    expected.seek(0);
    const first = expected.update({ time: 0, dt: 1 / 60, playing: true, aspect: 2688 / 1008, particleCount: 0 });
    expect(runtime.startTimeline()).toBe(true);
    expect(shared.solver.drain).toHaveBeenCalledTimes(drains);
    expect(shared.solver.reset).toHaveBeenCalledTimes(resets);
    expect(shared.renderer.resetRadiance).toHaveBeenCalledTimes(radianceResets);
    expect(runtime.telemetry()).toMatchObject({ mode: 'timeline', suspended: false, standbyPrepared: false });
    runtime.frame({ now: 31, time: 0, playing: true, dt: 1 / 60 });
    expect(shared.geometry.setGain).toHaveBeenLastCalledWith(1);
    expect(shared.renderer.render.mock.lastCall[1]).toEqual(first.render);
    expect(shared.geometry.setInstances).toHaveBeenLastCalledWith(first.geometry, 2688, 1008);
    // The time-zero event is still pending: standby did not consume it.
    expect(first.resetParticles).toEqual([0, 0, 0, 0]);
    expect(shared.solver.reset).toHaveBeenCalledTimes(resets + 1);
    expect(runtime.startTimeline()).toBe(false);
  });

  it('refreshes initial line edits during standby without starting or resetting physics', async () => {
    await runtime.enterStandby(parseShowDoc(authoredShow));
    const edited = parseShowDoc(authoredShow);
    edited.curves.lineX = { keys: [{ t: 0, v: 0.3, shape: 'hold' }] };
    edited.curves.lineY = { keys: [{ t: 0, v: 0.7, shape: 'hold' }] };
    const resets = shared.solver.reset.mock.calls.length;
    runtime.setDocument(edited);
    expect(shared.geometry.setInstances.mock.lastCall[0][0]).toMatchObject({ x: 0.3, y: 0.7, color: 0xffffff, rot: 0 });
    expect(shared.solver.reset).toHaveBeenCalledTimes(resets);
    expect(shared.solver.step).not.toHaveBeenCalled();
    expect(runtime.telemetry()).toMatchObject({ mode: 'standby', standbyPrepared: true, activeEvents: 0 });
    expect(runtime.startTimeline()).toBe(true);
    runtime.frame({ now: 1, time: 0, playing: true, dt: 1 / 60 });
    expect(shared.geometry.setInstances.mock.lastCall[0][0]).toMatchObject({ x: 0.3, y: 0.7 });
  });

  it('does not start an incomplete or canceled standby preparation', async () => {
    expect(runtime.startTimeline()).toBe(false);
    let release!: () => void;
    shared.solver.drain.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const entering = runtime.enterStandby(parseShowDoc(authoredShow));
    expect(runtime.startTimeline()).toBe(false);
    runtime.suspend();
    release();
    await entering;
    expect(runtime.startTimeline()).toBe(false);
    expect(runtime.telemetry()).toMatchObject({ suspended: true, standbyPrepared: false });
  });

  it('restarts timeline with an actually empty solver, including reentry to the same mode', async () => {
    const doc = emptyDoc();
    await runtime.enterTimeline(doc);
    shared.solver.count = 2345;
    await runtime.enterTimeline();
    expect(runtime.telemetry().particles).toBe(0);
    expect(shared.solver.reset).toHaveBeenCalledTimes(2);
    expect(shared.solver.drain).toHaveBeenCalledTimes(4);
    expect(runtime.telemetry().mode).toBe('timeline');
  });

  it('preserves the authored director outputs, geometry and solver units across the entire track', async () => {
    const doc = parseShowDoc(authoredShow);
    expect(doc.events).toHaveLength(256);
    expect(Object.values(doc.curves).reduce((count, curve) => count + curve.keys.length, 0)).toBe(400);
    const originalDirector = new FluidsShowDirector();
    originalDirector.setDoc(doc);
    originalDirector.seek(0);
    await runtime.enterTimeline(doc);
    const times = [0, 0.05, 0.08, 1, 13, 42, 71.01, 80.9, 112, 146, doc.duration];
    for (const time of times) {
      shared.solver.count = 900;
      const expected = originalDirector.update({ time, dt: 0.05, playing: true,
        aspect: 2688 / 1008, particleCount: 900 });
      shared.solver.applyPointer.mockClear();
      runtime.frame({ now: time + 100, time, dt: 0.05, playing: true });
      expect(shared.renderer.render.mock.lastCall[1]).toEqual(expected.render);
      expect(shared.geometry.setInstances).toHaveBeenLastCalledWith(expected.geometry, 2688, 1008);
      expect(shared.solver.setParameters).toHaveBeenLastCalledWith({ ...expected.physics, pointerForce: 0.5 });
      expect(shared.solver.applyPointer.mock.calls.map((call: any[]) => call[0])).toEqual(
        expected.interactions.map(interaction => ({
          ...interaction,
          x: interaction.x * 2688, y: interaction.y * 1008,
          vx: interaction.vx * 1008, vy: interaction.vy * 1008,
          radius: interaction.radius * 1008,
        })),
      );
      expect(runtime.telemetry().activeEvents).toBe(expected.status.activeEvents);
      expect(runtime.telemetry().activeGestures).toBe(expected.status.activeGestures);
    }
  });

  it('preserves particles on future live takeover while removing timeline interactions, lamps and geometry', async () => {
    const doc = emptyDoc();
    doc.events.push(makeEvent('attractor', 0));
    await runtime.enterTimeline(doc);
    runtime.frame({ now: 1, time: 0.01, dt: 1 / 60, playing: true });
    expect(shared.solver.applyPointer).toHaveBeenCalled();
    shared.solver.count = 900;
    shared.solver.applyPointer.mockClear();
    const resets = shared.solver.reset.mock.calls.length;
    await runtime.enterLive({ preserve: true });
    runtime.frame({ now: 2, time: 0.01, dt: 1 / 60, playing: true });
    expect(runtime.telemetry().particles).toBe(900);
    expect(shared.solver.reset).toHaveBeenCalledTimes(resets);
    expect(shared.solver.applyPointer).not.toHaveBeenCalled();
    expect(shared.renderer.setOverlay).toHaveBeenLastCalledWith(null);
    expect(runtime.telemetry()).toMatchObject({ mode: 'live', activeEvents: 0, activeGestures: 0 });
    expect(shared.renderer.render.mock.lastCall[1]).toMatchObject({ blackOutput: 0, reactiveSecondaryMaterial: -1 });
  });

  it('can enter the future live engine directly with its independent empty state', async () => {
    shared.solver.count = 123;
    await runtime.enterLive();
    expect(runtime.telemetry()).toMatchObject({ mode: 'live', particles: 0 });
    runtime.liveAction('burst', { count: 180, x: 0.25, y: 0.75 });
    runtime.frame({ now: 1, dt: 1 / 60 });
    expect(shared.solver.applyPointer).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'emit', emitCount: 60, x: 672, y: 756,
    }));
  });

  it('cancels a late transition result when a later scene suspends the runtime', async () => {
    let release!: () => void;
    shared.solver.drain.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const entering = runtime.enterTimeline(emptyDoc());
    runtime.suspend();
    release();
    await entering;
    expect(runtime.telemetry().suspended).toBe(true);
    expect(shared.solver.reset).not.toHaveBeenCalled();
    const calls = shared.renderer.render.mock.calls.length;
    runtime.frame({ now: 1, dt: 1 / 60, playing: true });
    expect(shared.renderer.render).toHaveBeenCalledTimes(calls);
  });

  it('keeps the original paused physics and freezes only the natural ending', async () => {
    await runtime.enterTimeline(emptyDoc());
    runtime.frame({ now: 1, dt: 1 / 60, time: 1, playing: false });
    expect(shared.solver.step).toHaveBeenCalledTimes(1);
    runtime.frame({ now: 2, dt: 1 / 60, time: 2, frozen: true });
    const rendered = shared.renderer.render.mock.calls.length;
    runtime.frame({ now: 3, dt: 1 / 60, time: 2, frozen: true });
    expect(shared.solver.step).toHaveBeenCalledTimes(1);
    expect(shared.renderer.render).toHaveBeenCalledTimes(rendered);
  });
});
