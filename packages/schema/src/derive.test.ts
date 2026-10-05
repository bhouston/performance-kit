import { describe, it, expect } from 'vitest';
import { percentile, deriveRun, mergeBlocks, mannWhitney, compareRuns, summarizeRuns } from './derive.js';
import { frameTimeColor, responsivenessColor } from './colorScales.js';
import { processRun, type RunResult } from './index.js';
function run(step = 10): RunResult {
  return {
    schemaVersion: 1,
    runId: 'test',
    entry: {
      id: 'cube',
      name: 'Cube',
      renderer: { id: 'three-base', name: 'Three Base' },
      scene: { id: 'cube', name: 'Cube' },
      url: 'http://localhost/',
    },
    networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
    config: { durationMs: 100, vsync: 'off' },
    harness: { teardown: 1300, runSent: 1100, runEndObserved: 1208 },
    reporter: {
      hello: 1005,
      navigationStart: 1005,
      ready: 1055,
      renderStart: 1055,
      runStart: 1105,
      runEnd: 1205,
      frames: [
        { cpuStart: 1080, cpuEnd: 1085 },
        ...Array.from({ length: Math.floor(100 / step) + 1 }, (_, i) => ({
          cpuStart: 1105 + i * step,
          cpuEnd: 1107 + i * step,
          gpuStart: '1000000',
          gpuEnd: '3000000',
        })),
      ],
      watchdogTicks: [1005, 1021, 1101],
      blocks: [{ start: 1040, end: 1080, source: 'longtask' }],
    },
    status: 'ok',
  };
}
describe('read-time statistics', () => {
  it('uses linear interpolation and IQR/MAD', () => {
    expect(percentile([30, 10, 20, 40], 0.25)).toBe(17.5);
    expect(percentile([], 0.5)).toBeUndefined();
    const d = deriveRun(run());
    expect(d.median).toBe(10);
    expect(d.iqr).toBe(0);
    expect(d.mad).toBe(0);
    expect(d.gpu[0]!.value).toBe(2);
  });
  it('uses client init timing without cross-clock calculations', () => {
    const d = deriveRun(run());
    expect(d.initMs).toBe(50);
    expect(d).not.toHaveProperty('discrepancies');
    expect(d).not.toHaveProperty('offsetMs');
  });
  it('excludes warmup and clips responsiveness blocks to init', () => {
    const d = deriveRun(run());
    expect(d.intervals).toHaveLength(10);
    expect(d.watchdog[1]!.value).toBe(64);
    expect(d.initBlockedMs).toBe(18);
    expect(d.initMaxBlockMs).toBe(18);
  });
  it('merges overlapping observer/watchdog records without double-counting', () => {
    expect(
      mergeBlocks([
        { start: 0, end: 10, sources: ['longtask'] },
        { start: 5, end: 20, sources: ['watchdog'] },
      ]),
    ).toEqual([{ start: 0, end: 20, sources: ['longtask', 'watchdog'] }]);
  });
  it('handles minimal raw frame results', () => {
    const r = run();
    delete r.reporter.runStart;
    delete r.reporter.runEnd;
    expect(deriveRun(r).median).toBeDefined();
  });
  it('corrects tied ranks', () => {
    expect(mannWhitney([1, 1], [1, 1])).toEqual({ u: 2, pValue: 1 });
    expect(mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]).pValue).toBeLessThan(0.05);
  });
  it('resamples runs reproducibly and prevents cross-mode comparisons', () => {
    const a = [run(10), run(11)],
      b = [run(20), run(21)];
    const result = compareRuns(a, b, { seed: 5, iterations: 100 });
    expect(result).toEqual(compareRuns(a, b, { seed: 5, iterations: 100 }));
    expect(result.verdict).toBe('faster');
    expect(result.confidenceInterval[1]).toBeLessThan(1);
    const other = run();
    other.config.vsync = 'on';
    expect(() => compareRuns(a, [other])).toThrow('vsync');
  });
  it('flags variable repetition medians and avoids inference from a single rep', () => {
    expect(summarizeRuns([run(10), run(20)]).unstable).toBe(true);
    expect(compareRuns([run(10)], [run(20)]).verdict).toBe('no detectable difference');
  });
  it('keeps aborted warmup out of metrics and failed runs out of comparisons', () => {
    const failed = run(50);
    failed.status = 'timeout';
    delete failed.reporter.runStart;
    const partial = deriveRun(failed);
    expect(partial.intervals).toEqual([]);
    expect(partial.cpu).toEqual([]);
    expect(partial.gpu).toEqual([]);
    expect(summarizeRuns([failed, run(10)]).median).toBe(10);
    expect(compareRuns([failed, run(10), run(11)], [run(20), run(21)]).verdict).toBe('faster');
  });
  it('validates bootstrap options', () => {
    for (const iterations of [0, -1, NaN, Infinity, 1.5])
      expect(() => compareRuns([run()], [run()], { iterations })).toThrow('iterations');
    expect(() => compareRuns([run()], [run()], { seed: Infinity })).toThrow('seed');
  });
  it('shares saturated and interpolated timing scales', () => {
    expect(frameTimeColor(16.7)).toBe('rgb(34,197,94)');
    expect(frameTimeColor(100)).toBe('rgb(239,68,68)');
    expect(responsivenessColor(300)).toBe('rgb(239,68,68)');
    expect(responsivenessColor(49)).toBe('rgb(34,197,94)');
    expect(responsivenessColor(50)).toBe('rgb(250,204,21)');
    expect(responsivenessColor(100)).toBe('rgb(249,115,22)');
  });
});
it('rejects comparisons across network conditions, including differing recorded profiles', () => {
  const a = run(),
    b = run();
  a.networkProfile = { name: 'slow-4g', latencyMs: 150, downloadBytesPerSec: 200000, uploadBytesPerSec: 93750 };
  expect(() => compareRuns([a], [b])).toThrow('network profiles');
  b.networkProfile = { ...a.networkProfile };
  expect(() => compareRuns([a], [b])).not.toThrow();
  b.networkProfile.latencyMs = 200;
  expect(() => compareRuns([a], [b])).toThrow('network profiles');
});

it('compares persisted seconds with raw milliseconds using the same network profile and frame statistics', () => {
  const a = run(10),
    b = run(20);
  for (const input of [a, b]) input.networkProfile.latencyMs = 150;
  expect(compareRuns([processRun(a)], [processRun(b)])).toEqual(compareRuns([a], [b]));
  expect(compareRuns([a], [processRun(b)])).toEqual(compareRuns([a], [b]));
  expect(summarizeRuns([processRun(a), processRun(b)])).toEqual(summarizeRuns([a, b]));
});
