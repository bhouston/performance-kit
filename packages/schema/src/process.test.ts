import { describe, expect, it } from 'vitest';
import { deriveRun } from './derive.js';
import { downsampleExtrema, processRun } from './process.js';
import { assertProcessedResult, validateProcessedResult, type RunResult } from './index.js';
function raw(count = 5000): RunResult {
  let time = 1010;
  const frames = Array.from({ length: count }, (_, index) => {
    // Isolated spikes must survive display sampling while exact stats remain unchanged.
    time += index === 2377 ? 200 : index % 101 === 0 ? 3 : 10;
    return { cpuStart: time, cpuEnd: time + (index === 2700 ? 35 : 2), gpuStart: '1000000', gpuEnd: '4000000' };
  });
  return {
    schemaVersion: 1,
    runId: 'processed-fixture',
    entry: {
      id: 'cube',
      name: 'Cube',
      renderer: { id: 'three-base', name: 'Three Base' },
      scene: { id: 'cube', name: 'Reference cube' },
      url: '/cube',
    },
    config: { durationMs: 60000, warmupMs: 0, vsync: 'on' },
    harness: { startSent: 1000, teardown: time + 20 },
    clockSync: { samples: [{ t0: 1000, t1: 1005, t2: 1006, t3: 1001 }] },
    reporter: {
      hello: 1000,
      ready: 1005,
      runStart: 1010,
      runEnd: time + 1,
      frames,
      phases: [{ phase: 'load', start: { clock: 'reporter', t: 1005 }, end: { clock: 'reporter', t: 1009 } }],
      watchdogTicks: Array.from({ length: count }, (_, index) => 1005 + index * 16),
    },
    status: 'ok',
  };
}
describe('offline raw preprocessing', () => {
  it('computes exact complete-data statistics before display reduction', () => {
    const input = raw();
    const original = structuredClone(input);
    const derived = deriveRun(input);
    const metrics = processRun(input);
    expect(input).toEqual(original);
    for (const key of [
      'median',
      'p95',
      'p99',
      'iqr',
      'mad',
      'fps',
      'setupMs',
      'setupMaxBlockMs',
      'setupBlockedMs',
    ] as const)
      expect(metrics.statistics[key]).toBe(derived[key]);
    expect(metrics.statistics.intervalCount).toBe(4999);
    expect(metrics.statistics.frameCount).toBe(5000);
    expect(metrics.statistics.phaseDurations).toEqual({ load: 4 });
    expect(metrics.statistics.cpuMedian).toBe(2);
    expect(metrics.statistics.gpuMedian).toBe(3);
    expect(metrics.timeline.frameSeconds).toHaveLength(5000);
    expect(metrics.timeline.cpuMs).toHaveLength(5000);
    expect(metrics.timeline.gpuMs).toHaveLength(5000);
    expect(metrics.timeline.frameIndices.length).toBeLessThanOrEqual(1536);
    expect(metrics.timeline.watchdogIndices.length).toBeLessThanOrEqual(512);
    expect(
      Math.max(
        ...metrics.timeline.frameIndices.flatMap((index) =>
          index + 1 < 5000
            ? [(metrics.timeline.frameSeconds[index + 1]! - metrics.timeline.frameSeconds[index]!) * 1000]
            : [],
        ),
      ),
    ).toBeCloseTo(200);
    expect(Math.max(...metrics.timeline.cpuMs.filter((value): value is number => value !== null))).toBe(35);
    expect(metrics.histogram.count).toBe(4999);
    expect(metrics.histogram.bins.reduce((count, bin) => count + bin.count, 0)).toBe(4999);
    expect(metrics.histogram.bins.length).toBeLessThanOrEqual(40);
    assertProcessedResult(metrics);
    expect(JSON.stringify(metrics).length).toBeLessThan(JSON.stringify(input).length);
  });
  it('keeps consecutive timestamps intact so rendering sampled indices never creates artificial frame gaps', () => {
    const input = raw();
    const metrics = processRun(input);
    const indices = metrics.timeline.frameIndices;
    const position = indices.findIndex((index, offset) => offset > 0 && index > indices[offset - 1]! + 1);
    expect(position).toBeGreaterThan(0);
    const index = indices[position - 1]!;
    const actualInterval = input.reporter.frames[index + 1]!.cpuStart - input.reporter.frames[index]!.cpuStart;
    const displayInterval = (metrics.timeline.frameSeconds[index + 1]! - metrics.timeline.frameSeconds[index]!) * 1000;
    expect(displayInterval).toBeCloseTo(actualInterval, 1);
    expect(metrics.timeline.frameSeconds.at(-1)).toBe(
      Math.round((input.reporter.frames.at(-1)!.cpuStart - 1005) * 10) / 10000,
    );
    expect(metrics.statistics.intervalCount).toBe(4999);
  });
  it('aligns nullable CPU/GPU costs and validates selected sample references', () => {
    const input = raw(3);
    input.reporter.frames[1]!.cpuEnd = input.reporter.frames[1]!.cpuStart - 1;
    delete input.reporter.frames[1]!.gpuStart;
    delete input.reporter.frames[1]!.gpuEnd;
    const metrics = processRun(input);
    expect(metrics.timeline.cpuMs).toEqual([2, null, 2]);
    expect(metrics.timeline.gpuMs).toEqual([3, null, 3]);
    expect(validateProcessedResult(metrics)).toBe(true);
    expect(validateProcessedResult({ ...metrics, timeline: { ...metrics.timeline, cpuMs: [2, 2] } })).toBe(false);
    expect(validateProcessedResult({ ...metrics, timeline: { ...metrics.timeline, frameIndices: [0, 3] } })).toBe(
      false,
    );
    expect(validateProcessedResult({ ...metrics, timeline: { ...metrics.timeline, frameIndices: [2, 0] } })).toBe(
      false,
    );
    expect(validateProcessedResult({ ...metrics, timeline: { ...metrics.timeline, watchdogIndices: [0] } })).toBe(
      false,
    );
  });
  it('prepares aligned relative coordinates rather than browser clock calculations', () => {
    const input = raw(2);
    const metrics = processRun(input);
    expect(metrics.screenshot).toBe(false);
    input.capture = { file: 'screenshot.avif', at: 1050 };
    expect(processRun(input).screenshot).toBe(true);
    expect(metrics.statistics.offsetMs).toBe(5);
    expect(metrics.timeline.runStart).toBe(0.005);
    expect(metrics.timeline.ready).toBe(0);
    expect(metrics.timeline.frameSeconds[0]).toBe((input.reporter.frames[0]!.cpuStart - 1005) / 1000);
    expect(metrics.timeline.phases[0]).toEqual({ phase: 'load', start: 0, end: 0.004, durationMs: 4 });
    input.reporter.phases![0] = {
      phase: 'load',
      start: { clock: 'harness', t: 1000 },
      end: { clock: 'harness', t: 1004 },
    };
    expect(processRun(input).timeline.phases[0]).toEqual({ phase: 'load', start: 0, end: 0.004, durationMs: 4 });
  });
  it('uses shared rounded timestamps and seconds while retaining exact statistics and negative phase coordinates', () => {
    const input = raw(3);
    input.reporter.frames = [1015.123456, 1031.790123, 1048.45678].map((cpuStart) => ({
      cpuStart,
      cpuEnd: cpuStart + 2.34567,
    }));
    input.reporter.runEnd = 1100;
    input.reporter.phases = [
      { phase: 'load', start: { clock: 'reporter', t: 1004.84321 }, end: { clock: 'reporter', t: 1006.5555 } },
    ];
    const metrics = processRun(input);
    expect(metrics.timeline.timeUnit).toBe('seconds');
    expect(metrics.timeline.valueUnit).toBe('milliseconds');
    expect(metrics.timeline.frameSeconds.slice(0, 2)).toEqual([0.0101, 0.0268]);
    expect(metrics.timeline.cpuMs[0]).toBe(2.35);
    expect((metrics.timeline.frameSeconds[1]! - metrics.timeline.frameSeconds[0]!) * 1000).toBeCloseTo(16.7);
    expect(metrics.timeline.phases[0]?.start).toBe(-0.0002);
    expect(metrics.timeline.phases[0]?.end).toBe(0.0016);
    expect(metrics.timeline.phases[0]?.durationMs).toBe(1006.5555 - 1004.84321);
    expect(metrics.statistics.median).toBe(deriveRun(input).median);
    expect(metrics.statistics.median).not.toBe(16.67);
    expect(metrics.histogram.count).toBe(2);
    expect(
      validateProcessedResult({
        ...metrics,
        timeline: { ...metrics.timeline, frameSeconds: [[0.0101, 16.67]] },
      }),
    ).toBe(false);
  });
  it('limits watchdog display to setup without changing full responsiveness statistics', () => {
    const input = raw();
    input.reporter.ready = 1055;
    const metrics = processRun(input);
    expect(metrics.timeline.watchdogSeconds).toHaveLength(4);
    expect(metrics.timeline.watchdogSeconds.every((point) => point <= metrics.timeline.ready!)).toBe(true);
    expect(metrics.statistics.setupBlockedMs).toBe(deriveRun(input).setupBlockedMs);
    delete input.reporter.ready;
    expect(processRun(input).timeline.watchdogIndices.length).toBeLessThanOrEqual(512);
    expect(processRun(input).timeline.watchdogIndices.length).toBeGreaterThan(3);
  });
  it('uses an internal reporter origin for minimal results without sync', () => {
    const input = raw(2);
    delete input.clockSync;
    delete input.reporter.hello;
    delete input.reporter.ready;
    delete input.reporter.phases;
    const metrics = processRun(input);
    expect(metrics.timeline.frameSeconds[0]).toBe(0);
    expect(metrics.statistics.offsetMs).toBeUndefined();
    expect(metrics.statistics.setupMs).toBeUndefined();
  });
  it('keeps timeouts with no measured window empty and viewable', () => {
    const input = raw();
    input.status = 'timeout';
    delete input.reporter.runStart;
    const metrics = processRun(input);
    expect(metrics.timeline.frameSeconds).toEqual([]);
    expect(metrics.histogram).toEqual({ bins: [], count: 0, maxCount: 0 });
    expect(metrics.statistics.median).toBeUndefined();
    expect(validateProcessedResult(metrics)).toBe(true);
  });
  it('bounds detail payloads and preserves full-data phase totals', () => {
    const input = raw(2);
    input.reporter.phases = Array.from({ length: 300 }, (_, index) => ({
      phase: 'load',
      start: { clock: 'reporter', t: 1005 + index * 10 },
      end: { clock: 'reporter', t: 1010 + index * 10 },
    }));
    input.reporter.blocks = Array.from({ length: 600 }, (_, index) => ({
      start: 1005 + index * 100,
      end: 1010 + index * 100,
      source: 'loaf',
      scripts: [{ start: 1005 + index * 100, end: 1010 + index * 100, sourceURL: 'renderer.js' }],
    }));
    input.messages = Array.from({ length: 600 }, (_, index) => ({
      type: 'syncPing',
      direction: 'toReporter',
      sentAt: { clock: 'harness', t: 1000 },
      receivedAt: { clock: 'reporter', t: 1005 + index },
    }));
    const metrics = processRun(input);
    expect(metrics.timeline.phases).toHaveLength(128);
    expect(metrics.timeline.blocks).toHaveLength(256);
    expect(metrics.timeline.blocks[0]?.durationMs).toBe(5);
    expect(metrics.attribution[0]?.durationMs).toBe(5);
    expect(metrics.timeline.discrepancies).toHaveLength(256);
    expect(metrics.attribution).toHaveLength(256);
    expect(metrics.statistics.phaseDurations.load).toBe(1500);
    expect(validateProcessedResult(metrics)).toBe(true);
  });
  it('rejects raw payload leakage and oversized display series at the schema boundary', () => {
    const metrics = processRun(raw(2));
    for (const extra of [
      { reporter: { frames: [] } },
      { frames: [] },
      { clockSync: { samples: [] } },
      { harness: {} },
      { messages: [] },
    ])
      expect(validateProcessedResult({ ...metrics, ...extra })).toBe(false);
    expect(
      validateProcessedResult({
        ...metrics,
        timeline: { ...metrics.timeline, frameIndices: Array.from({ length: 1537 }, (_, index) => index) },
      }),
    ).toBe(false);
  });
});
describe('extrema-preserving sampling', () => {
  it('keeps both endpoints, chronological extrema, and a strict point bound', () => {
    const points = Array.from({ length: 10000 }, (_, index) => ({
      t: index,
      value: index === 4999 ? 999 : index === 5000 ? -999 : index % 10,
    }));
    const sampled = downsampleExtrema(points, 100);
    expect(sampled.length).toBeLessThanOrEqual(100);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    expect(sampled).toContainEqual(points[4999]);
    expect(sampled).toContainEqual(points[5000]);
    expect(sampled.every((point, index) => index === 0 || point.t > sampled[index - 1]!.t)).toBe(true);
  });
  it('copies small series and validates bounds', () => {
    const points = [{ t: 0, value: 2 }];
    expect(downsampleExtrema(points)).toEqual(points);
    expect(downsampleExtrema(points)[0]).not.toBe(points[0]);
    for (const limit of [0, 3, 1001, NaN, 4.5]) expect(() => downsampleExtrema(points, limit)).toThrow('Point limit');
  });
});
