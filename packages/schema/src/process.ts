import type { ProcessedResult, RunResult } from './index.js';
import { deriveRun, percentile, type Point } from './derive.js';

export const MAX_TIMELINE_POINTS = 512;
const seconds = (milliseconds: number) => Math.round(milliseconds * 10) / 10000;
const milliseconds = (value: number) => Math.round(value * 100) / 100;
/** Keep both endpoints and each time-ordered bucket's extrema without altering statistics. */
export function downsampleExtrema(points: readonly Point[], limit = MAX_TIMELINE_POINTS): Point[] {
  if (!Number.isInteger(limit) || limit < 4 || limit > MAX_TIMELINE_POINTS)
    throw new Error('Point limit must be an integer from 4 to 512');
  if (points.length <= limit) return points.map((point) => ({ ...point }));
  const buckets = Math.floor((limit - 2) / 2);
  const result: Point[] = [{ ...points[0]! }];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor((bucket * (points.length - 2)) / buckets);
    const end = 1 + Math.floor(((bucket + 1) * (points.length - 2)) / buckets);
    let min = start,
      max = start;
    for (let index = start + 1; index < end; index++) {
      if (points[index]!.value < points[min]!.value) min = index;
      if (points[index]!.value > points[max]!.value) max = index;
    }
    for (const index of [...new Set([min, max])].toSorted((a, b) => a - b)) result.push({ ...points[index]! });
  }
  result.push({ ...points.at(-1)! });
  return result;
}
function optional(key: string, value: number | undefined) {
  return value === undefined ? {} : { [key]: value };
}
function longest<T extends { start: number; end: number }>(records: T[], limit: number): T[] {
  return records
    .toSorted((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, limit)
    .toSorted((a, b) => a.start - b.start);
}
const select = (points: Point[]) => downsampleExtrema(points).map((point) => point.t);
/** All statistics use complete measured raw data; only display indices are reduced. */
export function processRun(run: RunResult): ProcessedResult {
  const full = deriveRun(run);
  const reporterOrigin =
    full.offsetMs !== undefined
      ? run.harness.startSent + full.offsetMs
      : (run.reporter.hello ??
        run.reporter.phases?.find((phase) => phase.start.clock === 'reporter')?.start.t ??
        run.reporter.frames[0]?.cpuStart ??
        run.reporter.ready ??
        0);
  const local = (stamp: number) => seconds(stamp - reporterOrigin);
  const eligible =
    run.status !== 'ok' && run.reporter.runStart === undefined
      ? []
      : run.reporter.frames.filter(
          (frame) =>
            (run.reporter.runStart === undefined || frame.cpuStart >= run.reporter.runStart) &&
            (run.reporter.runEnd === undefined || frame.cpuStart <= run.reporter.runEnd),
        );
  const frameSeconds = eligible.map((frame) => local(frame.cpuStart));
  const cpuMs = eligible.map((frame) =>
    frame.cpuEnd >= frame.cpuStart ? milliseconds(frame.cpuEnd - frame.cpuStart) : null,
  );
  const gpuMs = eligible.map((frame) => {
    if (frame.gpuStart === undefined || frame.gpuEnd === undefined) return null;
    const value = Number(BigInt(frame.gpuEnd) - BigInt(frame.gpuStart)) / 1e6;
    return value >= 0 ? milliseconds(value) : null;
  });
  const intervalIndices = select(
    eligible.slice(0, -1).flatMap((frame, index) => {
      const value = eligible[index + 1]!.cpuStart - frame.cpuStart;
      return value > 0 ? [{ t: index, value }] : [];
    }),
  );
  const cpuIndices = select(
    eligible.flatMap((frame, index) =>
      cpuMs[index] === null ? [] : [{ t: index, value: frame.cpuEnd - frame.cpuStart }],
    ),
  );
  const gpuIndices = select(
    eligible.flatMap((frame, index) =>
      gpuMs[index] === null ? [] : [{ t: index, value: Number(BigInt(frame.gpuEnd!) - BigInt(frame.gpuStart!)) / 1e6 }],
    ),
  );
  const frameIndices = [...new Set([...intervalIndices, ...cpuIndices, ...gpuIndices])].toSorted((a, b) => a - b);
  const ticks = (run.reporter.watchdogTicks ?? []).filter(
    (tick) => run.reporter.ready === undefined || tick <= run.reporter.ready,
  );
  const watchdogSeconds = ticks.map(local);
  const watchdogIndices = select(
    ticks.slice(1).map((tick, index) => ({ t: index + 1, value: Math.max(0, tick - ticks[index]! - 16) })),
  );
  const statistics: ProcessedResult['statistics'] = {
    frameCount: eligible.length,
    intervalCount: full.intervals.length,
    cpuSampleCount: full.cpu.length,
    gpuSampleCount: full.gpu.length,
    setupMaxBlockMs: full.setupMaxBlockMs,
    setupBlockedMs: full.setupBlockedMs,
    phaseDurations: {},
    ...optional('median', full.median),
    ...optional('p95', full.p95),
    ...optional('p99', full.p99),
    ...optional('iqr', full.iqr),
    ...optional('mad', full.mad),
    ...optional('fps', full.fps),
    ...optional('setupMs', full.setupMs),
    ...optional('reporterSetupMs', full.reporterSetupMs),
    ...optional('hiddenStartupMs', full.hiddenStartupMs),
    ...optional('unaccountedMs', full.unaccountedMs),
    ...optional('offsetMs', full.offsetMs),
    ...optional('driftMs', full.driftMs),
    ...optional(
      'cpuMedian',
      percentile(
        full.cpu.map((point) => point.value),
        0.5,
      ),
    ),
    ...optional(
      'cpuP95',
      percentile(
        full.cpu.map((point) => point.value),
        0.95,
      ),
    ),
    ...optional(
      'gpuMedian',
      percentile(
        full.gpu.map((point) => point.value),
        0.5,
      ),
    ),
    ...optional(
      'gpuP95',
      percentile(
        full.gpu.map((point) => point.value),
        0.95,
      ),
    ),
  };
  for (const phase of full.phases)
    if (phase.durationMs !== undefined && phase.durationMs >= 0)
      statistics.phaseDurations[phase.phase] = (statistics.phaseDurations[phase.phase] ?? 0) + phase.durationMs;
  const values = full.intervals.map((point) => point.value);
  const max = values.reduce((value, item) => Math.max(value, item), 0);
  const numberBins = values.length ? Math.min(40, values.length) : 0;
  const width = numberBins ? max / numberBins : 0;
  const bins = Array.from({ length: numberBins }, (_, index) => ({
    start: milliseconds(index * width),
    end: milliseconds((index + 1) * width),
    count: 0,
  }));
  for (const value of values) bins[Math.min(numberBins - 1, Math.floor(value / width))]!.count++;
  const histogram = {
    bins,
    count: values.length,
    maxCount: bins.reduce((value, bin) => Math.max(value, bin.count), 0),
  };
  const phases = full.phases.slice(0, 128).map((phase, index) => {
    const raw = run.reporter.phases![index]!;
    return {
      phase: phase.phase,
      start: raw.start.clock === 'harness' ? seconds(raw.start.t - run.harness.startSent) : local(phase.start),
      ...(phase.end === undefined
        ? {}
        : { end: raw.end?.clock === 'harness' ? seconds(raw.end.t - run.harness.startSent) : local(phase.end) }),
      ...optional('durationMs', phase.durationMs),
    };
  });
  const blocks = longest(full.blocks, 256).map((block) => ({
    ...block,
    sources: [...block.sources],
    durationMs: block.end - block.start,
    start: local(block.start),
    end: local(block.end),
  }));
  const attribution = longest(
    (run.reporter.blocks ?? []).flatMap((block) => block.scripts ?? []),
    256,
  ).map((script) => ({
    ...script,
    durationMs: script.end - script.start,
    start: local(script.start),
    end: local(script.end),
  }));
  const maxTime = Math.max(
    0,
    seconds(run.harness.teardown - run.harness.startSent),
    ...[run.reporter.runEnd, run.reporter.ready, full.intervals.at(-1)?.t, full.cpu.at(-1)?.t, full.watchdog.at(-1)?.t]
      .filter((value): value is number => value !== undefined)
      .map(local),
  );
  const discrepancies = full.discrepancies
    .toSorted((a, b) => Math.abs(b.ms) - Math.abs(a.ms))
    .slice(0, 256)
    .map((item) => ({ ...item }));
  return {
    schemaVersion: 1,
    runId: run.runId,
    screenshot: run.capture !== undefined,
    ...(run.suiteName === undefined ? {} : { suiteName: run.suiteName }),
    entry: structuredClone(run.entry),
    config: { ...run.config },
    ...(run.environment === undefined ? {} : { environment: structuredClone(run.environment) }),
    status: run.status,
    ...(run.error === undefined ? {} : { error: { ...run.error } }),
    statistics,
    timeline: {
      timeUnit: 'seconds',
      valueUnit: 'milliseconds',
      maxTime,
      ...optional('ready', run.reporter.ready === undefined ? undefined : local(run.reporter.ready)),
      ...optional('runStart', run.reporter.runStart === undefined ? undefined : local(run.reporter.runStart)),
      ...optional('runEnd', run.reporter.runEnd === undefined ? undefined : local(run.reporter.runEnd)),
      frameSeconds,
      cpuMs,
      gpuMs,
      frameIndices,
      watchdogSeconds,
      watchdogIndices,
      watchdogPeriodMs: 16,
      phases,
      blocks,
      discrepancies,
    },
    histogram,
    attribution,
  };
}
