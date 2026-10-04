import { describe, expect, it } from 'vitest';
import { deriveRun } from './derive.js';
import { downsampleExtrema, processRun } from './process.js';
import { assertProcessedResult, validateProcessedResult, type RunResult } from './index.js';
const keys = (value: unknown): string[] =>
  value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)]) : [];

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
    for (const [output, source] of [
      ['median', 'median'],
      ['p95', 'p95'],
      ['p99', 'p99'],
      ['iqr', 'iqr'],
      ['mad', 'mad'],
      ['setupSeconds', 'setupMs'],
      ['setupMaxBlockSeconds', 'setupMaxBlockMs'],
      ['setupBlockedSeconds', 'setupBlockedMs'],
    ] as const)
      expect(metrics.statistics[output]).toBe(derived[source] === undefined ? undefined : derived[source]! / 1000);
    expect(metrics.statistics.typicalFps).toBe(derived.fps);
    expect(metrics.statistics.tailFps).toBe(1000 / derived.p95!);
    expect(metrics.statistics.intervalCount).toBe(4999);
    expect(metrics.statistics.frameCount).toBe(5000);
    expect(metrics.statistics.phaseDurations).toEqual({ load: 0.004 });
    expect(metrics.statistics.cpuMedian).toBe(0.002);
    expect(metrics.statistics.gpuMedian).toBe(0.003);
    expect(metrics.timeline.frameSeconds).toHaveLength(5000);
    expect(metrics.timeline.cpuSeconds).toHaveLength(5000);
    expect(metrics.timeline.gpuSeconds).toHaveLength(5000);
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
    expect(Math.max(...metrics.timeline.cpuSeconds.filter((value): value is number => value !== null))).toBe(0.035);
    expect(metrics.measuredIntervalSeconds).toHaveLength(4999);
    expect(metrics).not.toHaveProperty('histogram');
    assertProcessedResult(metrics);
    expect(JSON.stringify(metrics).length).toBeLessThan(JSON.stringify(input).length);
  });
  it('shows warmup and capture frames after ready while statistics remain measured-window only', () => {
    const input = raw(6);
    input.reporter.ready = 1010;
    input.reporter.runStart = 1030;
    input.reporter.frames.unshift({ cpuStart: 1000, cpuEnd: 1001 });
    input.capture = { file: 'screenshot.avif', at: 1023 };
    const metrics = processRun(input);
    expect(metrics.timeline.frameSeconds).toHaveLength(6);
    expect(metrics.timeline.frameSeconds[0]).toBe(0.013);
    expect(metrics.timeline.ready).toBe(0.01);
    expect(metrics.timeline.runStart).toBe(0.03);
    expect(metrics.statistics.frameCount).toBe(4);
    expect(metrics.statistics.intervalCount).toBe(3);
    expect(metrics.statistics.median).toBe(0.01);
    expect(metrics.statistics.typicalFps).toBe(100);
    expect(metrics.statistics.tailFps).toBe(100);
    expect(metrics.timeline.frameIndices.at(-1)).toBe(5);
    expect(validateProcessedResult(metrics)).toBe(true);
    input.reporter.runEnd = 1053;
    const clipped = processRun(input);
    expect(clipped.timeline.frameSeconds).toHaveLength(5);
    expect(clipped.timeline.frameSeconds.at(-1)).toBe(0.053);
    expect(clipped.timeline.frameIndices.at(-1)).toBe(4);
  });
  it('stores durations in seconds and independent clock-stamped message receipts', () => {
    const input = raw(3);
    input.messages = [
      {
        type: 'start',
        direction: 'toReporter',
        sentAt: { clock: 'harness', t: 1000 },
        receivedAt: { clock: 'reporter', t: 1025 },
      },
    ];
    const metrics = processRun(input);
    expect(metrics.config).toEqual({ durationSeconds: 60, vsync: 'on' });
    expect(metrics.timeline.watchdogPeriodSeconds).toBe(0.016);
    expect(metrics.timeline.cpuSeconds[0]).toBe(0.002);
    expect(metrics.timeline.gpuSeconds[0]).toBe(0.003);
    expect(metrics.measuredIntervalSeconds).toEqual([0.01, 0.01]);
    expect(metrics.timing.messages[0]).toEqual({
      type: 'start',
      direction: 'toReporter',
      sentAt: { clock: 'harness', t: 1 },
      receivedAt: { clock: 'reporter', t: 1.025 },
    });
    expect(metrics.timeline).not.toHaveProperty('discrepancies');
    expect(keys(metrics).some((key) => key.endsWith('Ms'))).toBe(false);
    expect(keys(metrics).includes('value')).toBe(false);
    expect(metrics.timing.timeUnit).toBe('epochSeconds');
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
      Math.round((input.reporter.frames.at(-1)!.cpuStart - 1000) * 10) / 10000,
    );
    expect(metrics.statistics.intervalCount).toBe(4999);
  });
  it('aligns nullable CPU/GPU costs and validates selected sample references', () => {
    const input = raw(3);
    input.reporter.frames[1]!.cpuEnd = input.reporter.frames[1]!.cpuStart - 1;
    delete input.reporter.frames[1]!.gpuStart;
    delete input.reporter.frames[1]!.gpuEnd;
    const metrics = processRun(input);
    expect(metrics.timeline.cpuSeconds).toEqual([0.002, null, 0.002]);
    expect(metrics.timeline.gpuSeconds).toEqual([0.003, null, 0.003]);
    expect(validateProcessedResult(metrics)).toBe(true);
    expect(validateProcessedResult({ ...metrics, timeline: { ...metrics.timeline, cpuSeconds: [2, 2] } })).toBe(false);
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
    expect(metrics.statistics).not.toHaveProperty('offsetSeconds');
    expect(metrics.timeline.runStart).toBe(0.01);
    expect(metrics.timeline.ready).toBe(0.005);
    expect(metrics.timeline.frameSeconds[0]).toBe((input.reporter.frames[0]!.cpuStart - 1000) / 1000);
    expect(metrics.timeline.phases[0]).toEqual({ phase: 'load', start: 0.005, end: 0.009, durationSeconds: 0.004 });
    input.reporter.phases![0] = {
      phase: 'load',
      start: { clock: 'harness', t: 1000 },
      end: { clock: 'harness', t: 1004 },
    };
    expect(processRun(input).timeline.phases).toEqual([]);
  });
  it('uses shared rounded timestamps and seconds while retaining exact statistics and negative phase coordinates', () => {
    const input = raw(3);
    input.reporter.startReceived = 1005;
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
    expect(metrics.timeline.valueUnit).toBe('seconds');
    expect(metrics.timeline.frameSeconds.slice(0, 2)).toEqual([0.0101, 0.0268]);
    expect(metrics.timeline.cpuSeconds[0]).toBe(0.00235);
    expect((metrics.timeline.frameSeconds[1]! - metrics.timeline.frameSeconds[0]!) * 1000).toBeCloseTo(16.7);
    expect(metrics.timeline.phases[0]?.start).toBe(-0.0002);
    expect(metrics.timeline.phases[0]?.end).toBe(0.0016);
    expect(metrics.timeline.phases[0]?.durationSeconds).toBe((1006.5555 - 1004.84321) / 1000);
    expect(metrics.statistics.median).toBe(deriveRun(input).median! / 1000);
    expect(metrics.statistics.median).not.toBe(0.01667);
    expect(metrics.measuredIntervalSeconds).toHaveLength(2);
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
    expect(metrics.statistics.setupBlockedSeconds).toBe(deriveRun(input).setupBlockedMs / 1000);
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
    expect(metrics.statistics).not.toHaveProperty('offsetSeconds');
    expect(metrics.statistics.setupSeconds).toBeUndefined();
  });
  it('keeps timeout statistics empty while showing available warmup frames', () => {
    const input = raw();
    input.status = 'timeout';
    delete input.reporter.runStart;
    const metrics = processRun(input);
    expect(metrics.timeline.frameSeconds).toHaveLength(5000);
    expect(metrics.statistics.frameCount).toBe(0);
    expect(metrics.measuredIntervalSeconds).toEqual([]);
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
      type: 'start',
      direction: 'toReporter',
      sentAt: { clock: 'harness', t: 1000 },
      receivedAt: { clock: 'reporter', t: 1005 + index },
    }));
    const metrics = processRun(input);
    expect(metrics.timeline.phases).toHaveLength(128);
    expect(metrics.timeline.blocks).toHaveLength(256);
    expect(metrics.timeline.blocks[0]?.durationSeconds).toBe(0.005);
    expect(metrics.attribution[0]?.durationSeconds).toBe(0.005);
    expect(metrics.timing.messages).toHaveLength(600);
    expect(metrics.attribution).toHaveLength(256);
    expect(metrics.statistics.phaseDurations.load).toBe(1.5);
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
