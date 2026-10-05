import { expect, it } from 'vitest';
import { uncoveredInitialization } from './initialization.js';
import { processRun, assertProcessedResult, type RunResult } from './index.js';

it('infers leading, internal and trailing gaps while respecting overlapping and unfinished phases', () => {
  expect(
    uncoveredInitialization(
      [
        { start: 20, end: 40 },
        { start: 30, end: 50 },
        { start: 80, end: 90 },
      ],
      0,
      100,
    ),
  ).toEqual([
    { start: 0, end: 20 },
    { start: 50, end: 80 },
    { start: 90, end: 100 },
  ]);
  expect(uncoveredInitialization([{ start: -10, end: 10 }, { start: 20 }], 0, 100)).toEqual([{ start: 10, end: 20 }]);
  expect(uncoveredInitialization([], 0, 100)).toEqual([{ start: 0, end: 100 }]);
  expect(uncoveredInitialization([{ start: 5, end: 4 }], 0, 10)).toEqual([{ start: 0, end: 10 }]);
});
const run: RunResult = {
  schemaVersion: 1,
  runId: 'navigation',
  entry: {
    id: 'test',
    name: 'Test',
    renderer: { id: 'test', name: 'Test' },
    scene: { id: 'test', name: 'Test' },
    url: '/test',
  },
  networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  config: { durationMs: 100, vsync: 'on' },
  harness: { iframeCreated: 990, teardown: 7500 },
  status: 'ok',
  reporter: {
    navigationStart: 1000,
    renderStart: 7300,
    ready: 7300,
    runStart: 7300,
    runEnd: 7400,
    frames: [7300, 7320, 7340].map((cpuStart) => ({ cpuStart, cpuEnd: cpuStart + 1 })),
    phases: [
      { id: 0, phase: 'load', start: { clock: 'reporter', t: 1000 }, end: { clock: 'reporter', t: 7100 } },
      { id: 1, phase: 'compile', start: { clock: 'reporter', t: 7200 }, end: { clock: 'reporter', t: 7250 } },
    ],
  },
};
it('includes page and script startup in initialization, retaining exact frame statistics', () => {
  const result = processRun(run);
  assertProcessedResult(result);
  expect(result.timeline.phases).toEqual([
    { phase: 'load', start: 0, duration: 6.1 },
    { phase: 'unknown', start: 6.1, duration: 0.1 },
    { phase: 'compile', start: 6.2, duration: 0.05 },
    { phase: 'unknown', start: 6.25, duration: 0.05 },
  ]);
  expect(result.statistics.initDuration).toBe(6.3);
  expect(result.statistics.phaseDurations.unknown).toBe(0.15);
  expect(result.measuredIntervals).toEqual([0.02, 0.02]);
  expect(result.timing.reporter.navigationStart).toBe(1);
  expect(result.timing.harness).not.toHaveProperty('startSent');
});
