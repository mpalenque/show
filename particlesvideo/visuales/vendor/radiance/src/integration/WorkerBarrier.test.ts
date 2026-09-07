import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class WorkerDouble {
  static instance: WorkerDouble;
  messages: any[] = [];
  onmessage: (event: { data: any }) => void = () => {};
  constructor() { WorkerDouble.instance = this; }
  postMessage(message: any) { this.messages.push(message); }
  terminate() {}
  emit(message: any) { this.onmessage({ data: message }); }
}

describe('native fluid worker command boundary', () => {
  let client: any;
  beforeEach(async () => {
    vi.stubGlobal('document', { baseURI: 'https://show.example/performance/index.html' });
    vi.stubGlobal('Worker', WorkerDouble);
    const { default: Client } = await import('../scenes/fluid/KotFluidWorkerClient.js');
    client = new Client({ initialParticlesByMaterial: [0, 0, 0, 0] });
  });
  afterEach(() => { client.dispose(); vi.unstubAllGlobals(); });

  it('clears queued timeline input and resolves only after the in-flight frame and barrier', async () => {
    client.step(3);
    client.step(3);
    client.applyPointer({ mode: 'attract', x: 5, y: 8 });
    let complete = false;
    const drained = client.drain().then(() => { complete = true; });
    expect(client._stepQueued).toBe(false);
    expect(client._pendingInteractions).toEqual([]);
    await Promise.resolve();
    expect(complete).toBe(false);
    const worker = WorkerDouble.instance;
    worker.emit({ type: 'snapshot', kind: 'frame', count: 0, frame: 1, buffer: new ArrayBuffer(0) });
    expect(worker.messages.filter(message => message.type === 'step')).toHaveLength(1);
    expect(client._stepInFlight).toBe(false);
    expect(complete).toBe(false);
    const barrier = worker.messages.find(message => message.type === 'barrier');
    worker.emit({ type: 'barrier', id: barrier.id });
    await drained;
    expect(complete).toBe(true);
  });

  it('rejects a pending transition when disposed instead of leaving a hanging scene load', async () => {
    const draining = client.drain();
    client.dispose();
    await expect(draining).rejects.toThrow('disposed');
    expect(client._barriers.size).toBe(0);
  });
});
