import { describe, it, expect } from 'vitest';
import { percentile, clockOffset, deriveRun, mergeBlocks, mannWhitney, compareRuns, summarizeRuns } from './derive.js';
import { frameTimeColor, responsivenessColor } from './colorScales.js';
import type { RunResult } from './index.js';
function run(step = 10): RunResult {
  return {
    schemaVersion: 1,
    runId: 'test',
    entry: { id: 'cube', name: 'Cube', labels: [], url: 'http://localhost/' },
    config: { durationMs: 100, warmupMs: 20, vsync: 'off' },
    harness: { startSent: 1000, teardown: 1300, runSent: 1100, runEndObserved: 1208 },
    clockSync: { samples: [{ t0: 1000, t1: 1007, t2: 1008, t3: 1005 }] },
    reporter: {
      hello: 1005,
      ready: 1055,
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
  it('selects minimum round trip and corrects clocks', () => {
    expect(
      clockOffset([
        { t0: 0, t1: 20, t2: 21, t3: 31 },
        { t0: 100, t1: 107, t2: 108, t3: 105 },
      ]),
    ).toBe(5);
    const d = deriveRun(run());
    expect(d.setupMs).toBe(50);
    expect(d.reporterSetupMs).toBe(50);
    expect(d.discrepancies[0]!.ms).toBe(0);
  });
  it('excludes warmup and clips responsiveness blocks to setup', () => {
    const d = deriveRun(run());
    expect(d.intervals).toHaveLength(10);
    expect(d.watchdog[1]!.value).toBe(64);
    expect(d.setupBlockedMs).toBe(18);
    expect(d.setupMaxBlockMs).toBe(18);
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
  it('shares saturated and interpolated timing scales', () => {
    expect(frameTimeColor(16.7)).toBe('rgb(34,197,94)');
    expect(frameTimeColor(100)).toBe('rgb(239,68,68)');
    expect(responsivenessColor(300)).toBe('rgb(239,68,68)');
  });
});
