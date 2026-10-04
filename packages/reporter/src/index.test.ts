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
it('records warmup and measured frames, responds to clock sync and rejects wrong origins', async () => {
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
    reporter.phaseStart('load');
    reporter.phaseEnd('load');
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
  send('syncPing', { t0: 100 }, 'https://attacker.example');
  expect(messages.some((message) => message.type === 'syncPong')).toBe(false);
  send('syncPing', { t0: 100 });
  expect(messages.find((message) => message.type === 'syncPong')?.payload.t0).toBe(100);
  send('start', { entryId: 'cube', params: {}, warmupMs: 0 });
  await Promise.resolve();
  const warmup = reporter.frameBegin({ animationTime: 1 });
  reporter.frameEnd(warmup);
  send('run', { durationMs: 20 });
  const token = reporter.frameBegin({ animationTime: 2 });
  reporter.frameEnd(token);
  reporter.frameGpu(token, { gpuStart: '100', gpuEnd: '200' });
  await vi.advanceTimersByTimeAsync(21);
  const result = messages.find((message) => message.type === 'runEnd')?.payload;
  expect(result.frames).toHaveLength(2);
  expect(result.frames[1]).toMatchObject({ animationTime: 2, gpuStart: '100', gpuEnd: '200' });
  expect(result.messages.map((message: { type: string }) => message.type)).toEqual(['syncPing', 'start', 'run']);
  reporter.fail(new Error('render failed'));
  expect(messages.find((message) => message.type === 'error')?.payload.message).toBe('render failed');
  expect(reporter.frameBegin()).toBe(-1);
  expect(messages.filter((message) => message.type === 'runEnd')).toHaveLength(1);
});
