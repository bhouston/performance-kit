import { it, expect, vi } from 'vitest';
import { harnessRun } from './harness.js';
it('preserves inbound arrival order despite reversed validator delays and transferred capture bytes', async () => {
  let sequence = 0,
    activeValidators = 0,
    maxActiveValidators = 0;
  const validationOrder: number[] = [];
  const validationStarts: number[] = [];
  const source: { [key: string]: unknown } = {};
  const emit = (type: string, payload: Record<string, unknown>) => {
    (source.__performanceKitSend as (message: unknown) => void)({
      protocol: 'performance-kit',
      protocolVersion: 1,
      runId: 'test',
      seq: sequence++,
      type,
      sentAt: performance.timeOrigin + performance.now(),
      payload,
    });
  };
  source.addEventListener = () => {};
  source.removeEventListener = () => {};
  source.validateEnvelope = async (
    message: { seq: number; type: string; payload: Record<string, unknown> },
    bytes?: number[],
  ) => {
    validationStarts.push(performance.timeOrigin + performance.now());
    activeValidators++;
    maxActiveValidators = Math.max(maxActiveValidators, activeValidators);
    // An immediately following message would finish first without the queue.
    await new Promise((done) => setTimeout(done, message.seq % 2 === 0 ? 15 : 0));
    validationOrder.push(message.seq);
    activeValidators--;
    if (message.type === 'capture') expect(bytes).toEqual([137, 80, 78, 71]);
  };
  source.__performanceKitReceive = (message: { type: string; payload: Record<string, unknown> }) => {
    const at = performance.timeOrigin + performance.now();
    if (message.type === 'start') {
      emit('phase', { id: 0, phase: 'assets', start: { clock: 'reporter', t: at } });
      emit('phase', { id: 1, phase: 'assets', start: { clock: 'reporter', t: at } });
      emit('phase', {
        id: 1,
        phase: 'assets',
        start: { clock: 'reporter', t: at },
        end: { clock: 'reporter', t: at + 2 },
      });
      emit('phase', {
        id: 0,
        phase: 'assets',
        start: { clock: 'reporter', t: at },
        end: { clock: 'reporter', t: at + 3 },
      });
      emit('ready', { at, renderStart: at });
    }
    if (message.type === 'capture') emit('capture', { at, bytes: Uint8Array.of(137, 80, 78, 71).buffer });
    if (message.type === 'run') {
      emit('environment', { devicePixelRatio: 1 });
      emit('runEnd', {
        runStart: at,
        runEnd: at + 10,
        frames: [{ cpuStart: at, cpuEnd: at + 1 }],
        blocks: [],
        watchdogTicks: [],
      });
    }
  };
  vi.stubGlobal('window', source);
  vi.stubGlobal('document', { createElement: () => ({ style: {}, remove: () => {} }) });
  vi.stubGlobal(
    'MessageEvent',
    // oxlint-disable-next-line typescript/no-extraneous-class -- Constructible MessageEvent substitute.
    class {
      constructor(_type: string, properties: Record<string, unknown>) {
        Object.assign(this, properties);
      }
    },
  );
  try {
    const promise = harnessRun({
      runId: 'test',
      url: 'http://127.0.0.1/demo',
      entryId: 'demo',
      params: {},
      durationMs: 10,
      initTimeoutMs: 2000,
      capture: true,
      width: 640,
      height: 480,
      isolation: 'page',
    });
    emit('hello', { reporterVersion: 'test', capabilities: { gpuTimestamps: false, longTasks: false, loaf: false } });
    emit('environment', { userAgent: 'test' });
    const result = await promise;
    expect(result.status).toBe('ok');
    expect(maxActiveValidators).toBe(1);
    expect(validationOrder).toEqual(Array.from({ length: sequence }, (_, index) => index));
    expect(result.capture?.bytes).toEqual([137, 80, 78, 71]);
    expect(result).not.toHaveProperty('clockSync');
    expect(result.harness.captureSent).toBeGreaterThanOrEqual(result.harness.runEndObserved!);
    expect(result.reporter.frames).toHaveLength(1);
    expect(result.reporter.phases).toHaveLength(2);
    expect(result.reporter.phases?.map((p) => p.id)).toEqual([0, 1]);
    expect(result.reporter.phases?.every((p) => p.end !== undefined)).toBe(true);
    expect(result.reporter.renderStart).toBe(result.reporter.ready);
    const receipts = result.messages.filter(
      (message) => (message as { direction: string }).direction === 'toHarness',
    ) as { receivedAt: { t: number } }[];
    // Reception is stamped immediately, before the first slow validation.
    expect(receipts[1].receivedAt.t).toBeLessThanOrEqual(validationStarts[0]);
  } finally {
    vi.unstubAllGlobals();
  }
});
