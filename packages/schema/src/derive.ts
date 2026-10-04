import type { RunResult, ClockSyncSample } from './index.js';

/** Linear interpolation between adjacent sorted observations, with endpoints clamped. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].toSorted((a, b) => a - b);
  const index = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const low = Math.floor(index);
  return sorted[low]! + (sorted[Math.ceil(index)]! - sorted[low]!) * (index - low);
}
export function clockOffset(samples: readonly ClockSyncSample[] = []): number | undefined {
  const valid = samples.filter((s) => [s.t0, s.t1, s.t2, s.t3].every(Number.isFinite) && s.t3 - s.t0 >= s.t2 - s.t1);
  const best = valid.reduce<ClockSyncSample | undefined>(
    (a, b) => (!a || b.t3 - b.t0 - b.t2 + b.t1 < a.t3 - a.t0 - a.t2 + a.t1 ? b : a),
    undefined,
  );
  return best ? (best.t1 - best.t0 + (best.t2 - best.t3)) / 2 : undefined;
}
export interface Point {
  t: number;
  value: number;
}
export interface Block {
  start: number;
  end: number;
  sources: string[];
}
export interface Discrepancy {
  name: string;
  ms: number;
  flagged: boolean;
}
export function mergeBlocks(blocks: readonly Block[]): Block[] {
  const merged: Block[] = [];
  for (const b of [...blocks].toSorted((left, right) => left.start - right.start)) {
    if (b.end <= b.start) continue;
    const last = merged.at(-1);
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
      last.sources = [...new Set([...last.sources, ...b.sources])];
    } else merged.push({ ...b, sources: [...b.sources] });
  }
  return merged;
}
export function deriveRun(run: RunResult) {
  const offsetMs = clockOffset(run.clockSync?.samples);
  const start = run.reporter.runStart;
  const end = run.reporter.runEnd;
  // Explicit measured bounds exclude warmup; minimal frame-only results use all supplied frames.
  const frames = run.reporter.frames.filter(
    (f) => (start === undefined || f.cpuStart >= start) && (end === undefined || f.cpuStart <= end),
  );
  const intervals: Point[] = frames.slice(0, -1).flatMap((f, i) => {
    const value = frames[i + 1]!.cpuStart - f.cpuStart;
    return value > 0 ? [{ t: f.cpuStart, value }] : [];
  });
  const cpu = frames.map((f) => ({ t: f.cpuStart, value: f.cpuEnd - f.cpuStart })).filter((p) => p.value >= 0);
  const gpu = frames.flatMap((f) => {
    if (f.gpuStart === undefined || f.gpuEnd === undefined) return [];
    const value = Number(BigInt(f.gpuEnd) - BigInt(f.gpuStart)) / 1e6;
    return value >= 0 ? [{ t: f.cpuStart, value }] : [];
  });
  const values = intervals.map((p) => p.value);
  const median = percentile(values, 0.5),
    p95 = percentile(values, 0.95),
    p99 = percentile(values, 0.99);
  const iqr = values.length ? percentile(values, 0.75)! - percentile(values, 0.25)! : undefined;
  const mad =
    median === undefined
      ? undefined
      : percentile(
          values.map((v) => Math.abs(v - median)),
          0.5,
        );
  const watchdog = (run.reporter.watchdogTicks ?? [])
    .slice(1)
    .map((t, i) => ({ t, value: Math.max(0, t - run.reporter.watchdogTicks![i]! - 16) }));
  const blocks = mergeBlocks([
    ...(run.reporter.blocks ?? []).map((b) => ({
      start: b.start,
      end: b.end,
      sources: [b.source],
    })),
    ...watchdog.filter((p) => p.value >= 50).map((p) => ({ start: p.t - p.value, end: p.t, sources: ['watchdog'] })),
  ]);
  const ready = run.reporter.ready;
  const setupMs = ready !== undefined && offsetMs !== undefined ? ready - offsetMs - run.harness.startSent : undefined;
  const reporterSetupMs =
    ready !== undefined && run.reporter.hello !== undefined ? ready - run.reporter.hello : undefined;
  const setupStart = offsetMs !== undefined ? run.harness.startSent + offsetMs : run.reporter.hello;
  const setupBlocks =
    setupStart === undefined || ready === undefined
      ? []
      : blocks.flatMap((b) => {
          const clipped = {
            ...b,
            start: Math.max(b.start, setupStart),
            end: Math.min(b.end, ready),
          };
          return clipped.end > clipped.start ? [clipped] : [];
        });
  const phases = (run.reporter.phases ?? []).map((p) => ({
    phase: p.phase,
    start: p.start.t,
    end: p.end?.t,
    durationMs: p.end && p.start.clock === p.end.clock ? p.end.t - p.start.t : undefined,
  }));
  const completed = phases.filter((p) => p.end !== undefined);
  const phaseUnion = mergeBlocks(completed.map((p) => ({ start: p.start, end: p.end!, sources: [p.phase] })));
  const accounted =
    setupStart === undefined || ready === undefined
      ? 0
      : phaseUnion.reduce((sum, p) => sum + Math.max(0, Math.min(p.end, ready) - Math.max(p.start, setupStart)), 0);
  const discrepancies: Discrepancy[] = [];
  const add = (name: string, ms: number) => discrepancies.push({ name, ms, flagged: ms > 50 });
  if (offsetMs !== undefined) {
    if (start !== undefined && run.harness.runSent !== undefined)
      add('Run delivery', start - offsetMs - run.harness.runSent);
    if (end !== undefined && run.harness.runEndObserved !== undefined)
      add('Run completion delivery', run.harness.runEndObserved - (end - offsetMs));
    for (const m of run.messages ?? []) {
      const sent = m.sentAt.t - (m.sentAt.clock === 'reporter' ? offsetMs : 0);
      const received = m.receivedAt.t - (m.receivedAt.clock === 'reporter' ? offsetMs : 0);
      add(m.type, received - sent);
    }
  }
  return {
    intervals,
    cpu,
    gpu,
    median,
    p95,
    p99,
    iqr,
    mad,
    fps: median ? 1000 / median : undefined,
    offsetMs,
    setupMs,
    reporterSetupMs,
    hiddenStartupMs: setupMs !== undefined && reporterSetupMs !== undefined ? setupMs - reporterSetupMs : undefined,
    unaccountedMs: setupMs === undefined ? undefined : Math.max(0, setupMs - accounted),
    phases,
    blocks,
    watchdog,
    setupMaxBlockMs: Math.max(0, ...setupBlocks.map((b) => b.end - b.start)),
    setupBlockedMs: setupBlocks.reduce((n, b) => n + b.end - b.start, 0),
    discrepancies,
  };
}
export function summarizeRuns(runs: readonly RunResult[]) {
  const medians = runs.map((r) => deriveRun(r).median).filter((v): v is number => v !== undefined);
  const median = percentile(medians, 0.5),
    min = medians.length ? Math.min(...medians) : undefined,
    max = medians.length ? Math.max(...medians) : undefined;
  return {
    median,
    min,
    max,
    unstable: median !== undefined && median > 0 && (max! - min!) / median > 0.05,
    repetitions: medians.length,
  };
}
/** Normal approximation with tie correction and continuity correction. */
export function mannWhitney(a: readonly number[], b: readonly number[]) {
  if (!a.length || !b.length) return { u: 0, pValue: 1 };
  const joined = [...a.map((v) => ({ v, a: true })), ...b.map((v) => ({ v, a: false }))].toSorted((x, y) => x.v - y.v);
  let rankA = 0,
    ties = 0;
  for (let i = 0; i < joined.length;) {
    let j = i + 1;
    while (j < joined.length && joined[j]!.v === joined[i]!.v) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (joined[k]!.a) rankA += rank;
    ties += (j - i) ** 3 - (j - i);
    i = j;
  }
  const u = rankA - (a.length * (a.length + 1)) / 2,
    n = joined.length;
  const variance = ((a.length * b.length) / 12) * (n + 1 - ties / (n * (n - 1)));
  if (variance === 0) return { u, pValue: 1 };
  const z = Math.max(0, Math.abs(u - (a.length * b.length) / 2) - 0.5) / Math.sqrt(variance);
  const t = 1 / (1 + 0.2316419 * z),
    density = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const tail =
    density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return { u, pValue: Math.min(1, 2 * tail) };
}
export function compareRuns(
  a: readonly RunResult[],
  b: readonly RunResult[],
  options: { seed?: number; iterations?: number } = {},
) {
  if (!a.length || !b.length) throw new Error('Comparison requires runs in both groups');
  if (new Set([...a, ...b].map((r) => r.config.vsync)).size !== 1)
    throw new Error('Cannot compare different vsync modes');
  const av = a.map((r) => deriveRun(r).intervals.map((p) => p.value)).filter((v) => v.length),
    bv = b.map((r) => deriveRun(r).intervals.map((p) => p.value)).filter((v) => v.length);
  if (!av.length || !bv.length) throw new Error('Comparison requires measured frames');
  const medianA = percentile(av.flat(), 0.5)!,
    medianB = percentile(bv.flat(), 0.5)!;
  let state = options.seed ?? 42;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const sample = (groups: number[][]) =>
    Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]!).flat();
  const ratios = Array.from(
    { length: options.iterations ?? 2000 },
    () => percentile(sample(av), 0.5)! / percentile(sample(bv), 0.5)!,
  );
  const confidenceInterval: [number, number] = [percentile(ratios, 0.025)!, percentile(ratios, 0.975)!];
  // Single repetitions cannot estimate run-to-run uncertainty: do not claim significance.
  const verdict =
    av.length < 2 || bv.length < 2
      ? 'no detectable difference'
      : confidenceInterval[1] < 1
        ? 'faster'
        : confidenceInterval[0] > 1
          ? 'slower'
          : 'no detectable difference';
  return {
    medianA,
    medianB,
    ratio: medianA / medianB,
    confidenceInterval,
    verdict,
    ...mannWhitney(av.flat(), bv.flat()),
  };
}
