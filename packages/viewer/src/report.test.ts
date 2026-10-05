import { expect, it } from 'vitest';
import { processRun, type RunResult } from 'performance-kit-schema';
import {
  gradeMetric,
  cardMetrics,
  compareMetrics,
  chartScale,
  phaseColor,
  readRoute,
  resultId,
  metricTable,
} from './report.js';
const run: RunResult = {
  schemaVersion: 1,
  runId: 'test',
  entry: { id: 'entry', name: 'Entry', renderer: { id: 'a', name: 'A' }, scene: { id: 'b', name: 'B' }, url: '/test' },
  networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  config: { durationMs: 1000, vsync: 'on' },
  harness: { teardown: 1000 },
  status: 'ok',
  reporter: {
    navigationStart: 0,
    ready: 100,
    renderStart: 100,
    runStart: 100,
    runEnd: 1000,
    frames: [100, 110, 140].map((cpuStart) => ({ cpuStart, cpuEnd: cpuStart + 1 })),
    watchdogTicks: [0, 16, 96],
  },
};
it('uses means rather than medians, max absolute jitter and worst delay', () => {
  expect(cardMetrics(processRun(run))).toEqual({
    initTime: 100,
    avgFrameRate: 50,
    maxJitter: 10,
    worstResponsiveness: 64,
    download: undefined,
  });
  const empty = processRun({ ...run, reporter: { frames: [] } });
  expect(cardMetrics(empty)).toEqual({
    initTime: undefined,
    avgFrameRate: undefined,
    maxJitter: undefined,
    worstResponsiveness: undefined,
    download: undefined,
  });
});
it('sorts each metric in both directions and leaves missing observations last', () => {
  const a = processRun(run),
    b = structuredClone(a),
    empty = processRun({ ...run, reporter: { frames: [] } });
  b.statistics.initSeconds = 0.2;
  b.statistics.averageFps = 25;
  b.statistics.maxJitterSeconds = 0.02;
  b.statistics.worstResponsivenessSeconds = 0.2;
  for (const key of Object.keys(metricTable).filter((key) => key !== 'download') as (keyof typeof metricTable)[]) {
    expect(compareMetrics(a, b, key, 'bestFirst')).toBeLessThan(0);
    expect(compareMetrics(a, b, key, 'worstFirst')).toBeGreaterThan(0);
    expect(compareMetrics(a, empty, key, 'worstFirst')).toBeLessThan(0);
    expect(compareMetrics(empty, empty, key, 'bestFirst')).toBe(0);
  }
});
it('grades exact init and jitter boundaries and established FPS/responsiveness categories', () => {
  expect([249, 250, 499, 500].map((v) => gradeMetric('initTime', v))).toEqual(['good', 'warn', 'warn', 'bad']);
  expect([4.9, 5, 14.9, 15].map((v) => gradeMetric('maxJitter', v))).toEqual(['good', 'warn', 'warn', 'bad']);
  expect([60, 30, 20].map((v) => gradeMetric('avgFrameRate', v))).toEqual(['good', 'warn', 'bad']);
  expect([49, 50, 299, 300].map((v) => gradeMetric('worstResponsiveness', v))).toEqual(['good', 'warn', 'warn', 'bad']);
  expect(gradeMetric('initTime', undefined)).toBe('none');
  expect(gradeMetric('maxJitter', NaN)).toBe('none');
});
it('uses configured colors and deterministic legible fallback including prototype names', () => {
  expect(phaseColor('assets', { assets: 'rebeccapurple' })).toBe('rebeccapurple');
  expect(phaseColor('assets')).toBe(phaseColor('assets'));
  expect(phaseColor('__proto__')).toMatch(/^hsl\(\d+ 65% 58%\)$/);
});
it('covers observed values with exactly four nice divisions, including large stalls', () => {
  expect(chartScale(16.7)).toEqual({ max: 20, ticks: [0, 5, 10, 15, 20] });
  expect(chartScale(55).max).toBe(100);
  for (const max of [0, 33, 400, 401, 900, 4001, 1e6]) {
    const scale = chartScale(max);
    expect(scale.max).toBeGreaterThanOrEqual(max);
    expect(scale.ticks).toHaveLength(5);
  }
});
it('roundtrips shareable sort, detail and filter URLs and defaults invalid options', () => {
  expect(
    readRoute(new URL('https://example.test/?result=x&sort=avgFrameRate&dir=worstFirst&q=cube&renderer=a&scene=b')),
  ).toEqual({ result: 'x', sort: 'avgFrameRate', direction: 'worstFirst', query: 'cube', renderer: 'a', scene: 'b' });
  expect(readRoute(new URL('https://example.test/?sort=__proto__&dir=no')).sort).toBe('avgFrameRate');
  expect(readRoute(new URL('https://example.test/'))).toMatchObject({ sort: 'avgFrameRate', direction: 'bestFirst' });
  const a = processRun(run),
    b = structuredClone(a);
  b.entry.renderer.id = 'a-b';
  b.entry.scene.id = 'c';
  a.entry.scene.id = 'b-c';
  expect(resultId(a)).not.toBe(resultId(b));
});
it('sorts Download in both directions by total transferred bytes and retains missing values last', () => {
  const a = processRun(run),
    b = processRun(run),
    missing = processRun(run);
  const report = {
    phase: 'load' as const,
    timeOrigin: 0,
    totalTransferBytes: 100,
    totalDecodedBytes: 200,
    unknownSizeCount: 0,
    byCategory: { script: 100, wasm: 0, model: 0, texture: 0, document: 0, other: 0 },
    resources: [],
  };
  a.downloads = [report, { ...report, phase: 'post-load', totalTransferBytes: 50 }];
  b.downloads = [{ ...report, totalTransferBytes: 200 }];
  expect(cardMetrics(a).download).toBe(150);
  expect(compareMetrics(a, b, 'download', 'bestFirst')).toBeLessThan(0);
  expect(compareMetrics(a, b, 'download', 'worstFirst')).toBeGreaterThan(0);
  expect(compareMetrics(missing, a, 'download', 'bestFirst')).toBeGreaterThan(0);
  expect(compareMetrics(missing, a, 'download', 'worstFirst')).toBeGreaterThan(0);
  expect(readRoute(new URL('https://test/?sort=download')).sort).toBe('download');
});
