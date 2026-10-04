import type { ProcessedResult, RunResult } from './index.js';
import { deriveRun, percentile, type Point } from './derive.js';

export const MAX_TIMELINE_POINTS = 512;
const seconds = (milliseconds: number) => Math.round(milliseconds * 10) / 10000;
const costSeconds = (milliseconds: number) => Math.round(milliseconds * 100) / 100000;
const durationSeconds = (milliseconds: number | undefined) =>
  milliseconds === undefined ? undefined : milliseconds / 1000;
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
const select = (points: Point[], limit = MAX_TIMELINE_POINTS) =>
  downsampleExtrema(points, limit).map((point) => point.t);
/** All statistics use complete measured raw data; only display indices are reduced. */
export function processRun(run: RunResult): ProcessedResult {
  const full = deriveRun(run);
  const reporterOrigin = run.reporter.startReceived ?? 0;
  const local = (stamp: number) => seconds(stamp - reporterOrigin);
  const eligible =
    run.status !== 'ok' && run.reporter.runStart === undefined
      ? []
      : run.reporter.frames.filter(
          (frame) =>
            (run.reporter.runStart === undefined || frame.cpuStart >= run.reporter.runStart) &&
            (run.reporter.runEnd === undefined || frame.cpuStart <= run.reporter.runEnd),
        );
  const visible = run.reporter.frames.filter(
    (frame) =>
      (run.reporter.ready === undefined || frame.cpuStart >= run.reporter.ready) &&
      (run.reporter.runEnd === undefined || frame.cpuStart <= run.reporter.runEnd),
  );
  const frameSeconds = visible.map((frame) => local(frame.cpuStart));
  const cpuSeconds = visible.map((frame) =>
    frame.cpuEnd >= frame.cpuStart ? costSeconds(frame.cpuEnd - frame.cpuStart) : null,
  );
  const gpuSeconds = visible.map((frame) => {
    if (frame.gpuStart === undefined || frame.gpuEnd === undefined) return null;
    const value = Number(BigInt(frame.gpuEnd) - BigInt(frame.gpuStart)) / 1e6;
    return value >= 0 ? costSeconds(value) : null;
  });
  const intervalIndices = select(
    visible.slice(0, -1).flatMap((frame, index) => {
      const value = visible[index + 1]!.cpuStart - frame.cpuStart;
      return value > 0 ? [{ t: index, value }] : [];
    }),
  );
  const cpuIndices = select(
    visible.flatMap((frame, index) =>
      cpuSeconds[index] === null ? [] : [{ t: index, value: frame.cpuEnd - frame.cpuStart }],
    ),
  );
  const gpuIndices = select(
    visible.flatMap((frame, index) =>
      gpuSeconds[index] === null
        ? []
        : [{ t: index, value: Number(BigInt(frame.gpuEnd!) - BigInt(frame.gpuStart!)) / 1e6 }],
    ),
    510,
  );
  const frameIndices = [
    ...new Set([...intervalIndices, ...cpuIndices, ...gpuIndices, ...(visible.length ? [0, visible.length - 1] : [])]),
  ].toSorted((a, b) => a - b);
  const ticks = (run.reporter.watchdogTicks ?? []).filter(
    (tick) => run.reporter.runEnd === undefined || tick <= run.reporter.runEnd,
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
    initMaxBlockSeconds: full.initMaxBlockMs / 1000,
    initBlockedSeconds: full.initBlockedMs / 1000,
    phaseDurations: Object.create(null) as Record<string, number>,
    ...optional('averageFrameSeconds', durationSeconds(full.average)),
    ...optional('averageFps', full.average ? 1000 / full.average : undefined),
    ...optional('maxJitterSeconds', durationSeconds(full.maxJitter)),
    ...optional('worstResponsivenessSeconds', durationSeconds(full.worstResponsiveness)),
    ...optional('median', durationSeconds(full.median)),
    ...optional('p95', durationSeconds(full.p95)),
    ...optional('p99', durationSeconds(full.p99)),
    ...optional('iqr', durationSeconds(full.iqr)),
    ...optional('mad', durationSeconds(full.mad)),
    ...optional('typicalFps', full.fps),
    ...optional('tailFps', full.p95 ? 1000 / full.p95 : undefined),
    ...optional('initSeconds', durationSeconds(full.initMs)),
    ...optional('unaccountedSeconds', durationSeconds(full.unaccountedMs)),
    ...optional(
      'cpuMedian',
      durationSeconds(
        percentile(
          full.cpu.map((point) => point.value),
          0.5,
        ),
      ),
    ),
    ...optional(
      'cpuP95',
      durationSeconds(
        percentile(
          full.cpu.map((point) => point.value),
          0.95,
        ),
      ),
    ),
    ...optional(
      'gpuMedian',
      durationSeconds(
        percentile(
          full.gpu.map((point) => point.value),
          0.5,
        ),
      ),
    ),
    ...optional(
      'gpuP95',
      durationSeconds(
        percentile(
          full.gpu.map((point) => point.value),
          0.95,
        ),
      ),
    ),
  };
  for (const phase of full.phases)
    if (phase.durationMs !== undefined && phase.durationMs >= 0)
      statistics.phaseDurations[phase.phase] = (statistics.phaseDurations[phase.phase] ?? 0) + phase.durationMs;

  for (const name of Object.keys(statistics.phaseDurations)) statistics.phaseDurations[name]! /= 1000;
  const phases = full.phases.map((phase) => ({
    phase: phase.phase,
    start: local(phase.start),
    ...(phase.end === undefined ? {} : { end: local(phase.end) }),
    ...optional('durationSeconds', durationSeconds(phase.durationMs)),
  }));
  const blocks = longest(full.blocks, 256).map((block) => ({
    ...block,
    sources: [...block.sources],
    durationSeconds: (block.end - block.start) / 1000,
    start: local(block.start),
    end: local(block.end),
  }));
  const attribution = longest(
    (run.reporter.blocks ?? []).flatMap((block) => block.scripts ?? []),
    256,
  ).map((script) => ({
    ...script,
    durationSeconds: (script.end - script.start) / 1000,
    start: local(script.start),
    end: local(script.end),
  }));
  const maxTime = Math.max(
    0,
    ...[run.reporter.runEnd, run.reporter.renderStart, run.reporter.ready, visible.at(-1)?.cpuStart, ticks.at(-1)]
      .filter((value): value is number => value !== undefined)
      .map(local),
    ...phases.map((phase) => phase.end ?? phase.start),
    ...blocks.map((block) => block.end),
  );
  return {
    schemaVersion: 2,
    runId: run.runId,
    screenshot: run.capture !== undefined,
    networkProfile: structuredClone(run.networkProfile),
    ...(run.reporter.downloads
      ? {
          downloads: run.reporter.downloads.map((report) => ({
            ...structuredClone(report),
            timeOrigin: report.timeOrigin - reporterOrigin,
          })),
        }
      : {}),
    ...(run.suiteName === undefined ? {} : { suiteName: run.suiteName }),
    entry: structuredClone(run.entry),
    config: {
      durationSeconds: run.config.durationMs / 1000,
      vsync: run.config.vsync,
      ...(run.config.phaseColors === undefined ? {} : { phaseColors: { ...run.config.phaseColors } }),
    },
    ...(run.environment === undefined ? {} : { environment: structuredClone(run.environment) }),
    status: run.status,
    ...(run.error === undefined ? {} : { error: { ...run.error } }),
    statistics,
    timeline: {
      timeUnit: 'seconds',
      valueUnit: 'seconds',
      maxTime,
      ...optional('renderStart', run.reporter.renderStart === undefined ? undefined : local(run.reporter.renderStart!)),
      ...optional('ready', run.reporter.ready === undefined ? undefined : local(run.reporter.ready)),
      ...optional('runStart', run.reporter.runStart === undefined ? undefined : local(run.reporter.runStart)),
      ...optional('runEnd', run.reporter.runEnd === undefined ? undefined : local(run.reporter.runEnd)),
      frameSeconds,
      cpuSeconds,
      gpuSeconds,
      frameIndices,
      watchdogSeconds,
      watchdogIndices,
      watchdogPeriodSeconds: 0.016,
      phases,
      blocks,
    },
    measuredIntervalSeconds: full.intervals.map((point) => point.value / 1000),
    timing: {
      timeUnit: 'epochSeconds',
      harness: Object.fromEntries(
        Object.entries(run.harness).map(([key, value]) => [key, value / 1000]),
      ) as ProcessedResult['timing']['harness'],
      reporter: Object.fromEntries(
        ['hello', 'startReceived', 'ready', 'renderStart', 'runStart', 'runEnd'].flatMap((key) => {
          const value = run.reporter[key as keyof typeof run.reporter];
          return typeof value === 'number' ? [[key, value / 1000]] : [];
        }),
      ),
      messages: (run.messages ?? []).map((message) => ({
        ...message,
        sentAt: { ...message.sentAt, t: message.sentAt.t / 1000 },
        receivedAt: { ...message.receivedAt, t: message.receivedAt.t / 1000 },
      })),
    },
    attribution,
  };
}
