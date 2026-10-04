import { expect, it } from 'vitest';
import { createReporter } from './index.js';
import { attachWebGPU } from './gpu.js';
it('reporter safely becomes a no-op outside harness', () => {
  const reporter = createReporter();
  expect(reporter.enabled).toBe(false);
  expect(reporter.frameBegin()).toBe(-1);
  reporter.phaseStart('load');
  reporter.phaseEnd('load');
  reporter.ready();
  reporter.frameEnd(-1);
  reporter.dispose();
});
it('WebGPU helper does not allocate queries when timestamp-query is unavailable', () => {
  const timing = attachWebGPU({
    features: new Set(),
    createQuerySet() {
      throw Error('must not allocate');
    },
    createBuffer() {
      throw Error('must not allocate');
    },
  });
  expect(timing.available).toBe(false);
  expect(timing.begin(0)).toBeUndefined();
  timing.dispose();
});

import { afterEach, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('measures first ready frames, records receipts and rejects wrong origins', async () => {
  vi.useFakeTimers();
  const messages: Record<string, any>[] = [];
  let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | undefined;
  const parent = {
    postMessage(message: Record<string, any>) {
      messages.push(message);
    },
  };
  vi.stubGlobal('window', {
    location: { search: '?performanceKitRunId=test&performanceKitOrigin=https%3A%2F%2Fharness.example' },
    parent,
    devicePixelRatio: 1,
    addEventListener(_type: string, callback: typeof listener) {
      listener = callback;
    },
    removeEventListener() {},
  });
  vi.stubGlobal('navigator', { userAgent: 'test' });
  vi.stubGlobal('PerformanceObserver', undefined);
  const reporter = createReporter();
  reporter.onStart(() => {
    const outer = reporter.phaseStart('assets');
    const inner = reporter.phaseStart('assets');
    reporter.phaseEnd(inner);
    reporter.phaseEnd(outer);
    reporter.phaseStart('assets');
    reporter.phaseEnd('assets');
    reporter.ready();
  });
  await Promise.resolve();
  let seq = 0;
  const send = (type: string, payload: unknown, origin = 'https://harness.example') =>
    listener?.({
      source: parent,
      origin,
      data: {
        protocol: 'performance-kit',
        protocolVersion: 1,
        runId: 'test',
        seq: seq++,
        sentAt: performance.timeOrigin + performance.now(),
        type,
        payload,
      },
    });
  send('start', { entryId: 'cube', params: {} }, 'https://attacker.example');
  seq = 0; // An untrusted sender has its own sequence; it cannot consume the harness sequence.
  expect(messages.some((message) => message.type === 'syncPong')).toBe(false);
  send('start', { entryId: 'cube', params: {} });
  await Promise.resolve();
  const phases = messages.filter((m) => m.type === 'phase').map((m) => m.payload);
  expect(phases.map((p) => p.id)).toEqual([0, 1, 1, 0, 2, 2]);
  expect(phases.slice(0, 2).every((p) => p.end === undefined)).toBe(true);
  expect(messages.find((m) => m.type === 'ready')?.payload.renderStart).toBeDefined();
  const first = reporter.frameBegin({ animationTime: 1 });
  reporter.frameEnd(first);
  send('run', { durationMs: 20 });
  const token = reporter.frameBegin({ animationTime: 2 });
  reporter.frameEnd(token);
  reporter.frameGpu(token, { gpuStart: '100', gpuEnd: '200' });
  await vi.advanceTimersByTimeAsync(21);
  const result = messages.find((message) => message.type === 'runEnd')?.payload;
  expect(result.frames).toHaveLength(2);
  expect(result.frames[0].cpuStart).toBeGreaterThanOrEqual(result.runStart);
  expect(result.startReceived).toBeLessThanOrEqual(result.runStart);
  expect(result.frames[1]).toMatchObject({ animationTime: 2, gpuStart: '100', gpuEnd: '200' });
  expect(result.messages.map((message: { type: string }) => message.type)).toEqual(['start', 'run']);
  seq += 1; // Simulate a dropped harness message.
  send('run', { durationMs: 20 });
  expect(messages.filter((message) => message.type === 'error').at(-1)?.payload.message).toContain(
    'dropped/reordered sequence',
  );
  reporter.fail(new Error('render failed'));
  expect(messages.filter((message) => message.type === 'error').at(-1)?.payload.message).toBe('render failed');
  expect(reporter.frameBegin()).toBe(-1);
  expect(messages.filter((message) => message.type === 'runEnd')).toHaveLength(1);
});
