import type { ProcessedResult, PhaseColorConfig } from 'performance-kit-schema';

export type SortKey = 'setupTime' | 'avgFrameRate' | 'maxJitter' | 'worstResponsiveness';
export type SortDirection = 'bestFirst' | 'worstFirst';
export type MetricGrade = 'good' | 'warn' | 'bad' | 'none';
export const gradeColors: Record<MetricGrade, string> = {
  good: 'rgb(34,197,94)',
  warn: 'rgb(249,115,22)',
  bad: 'rgb(239,68,68)',
  none: 'var(--muted-foreground)',
};
// Values are milliseconds except FPS. A higher FPS is better; other metrics are lower-is-better.
export const metricTable = {
  setupTime: { label: 'Setup time', sign: 1, good: 250, warn: 500 },
  avgFrameRate: { label: 'Average frame rate', sign: -1, good: -60, warn: -30 },
  maxJitter: { label: 'Max jitter', sign: 1, good: 5, warn: 15 },
  worstResponsiveness: { label: 'Worst responsiveness', sign: 1, good: 50, warn: 300 },
} as const;
export function gradeMetric(key: SortKey, value: number | undefined): MetricGrade {
  if (value === undefined || !Number.isFinite(value)) return 'none';
  const rule = metricTable[key],
    score = value * rule.sign;
  if (key === 'avgFrameRate') return score <= rule.good ? 'good' : score <= rule.warn ? 'warn' : 'bad';
  return score < rule.good ? 'good' : score < rule.warn ? 'warn' : 'bad';
}
const ms = (v: number | undefined) => (v === undefined ? undefined : v * 1000);
const missing = (v: number | undefined) => v === undefined || !Number.isFinite(v);
export function cardMetrics(result: ProcessedResult): Record<SortKey, number | undefined> {
  const s = result.statistics,
    values = result.measuredIntervalSeconds ?? [];
  const mean = s.averageFrameSeconds ?? (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined);
  const ticks = result.timeline.watchdogSeconds;
  const delays = ticks.slice(1).map((t, i) => Math.max(0, t - ticks[i]! - result.timeline.watchdogPeriodSeconds));
  const jitter =
    s.maxJitterSeconds ??
    (mean === undefined ? undefined : values.reduce((max, v) => Math.max(max, Math.abs(v - mean)), 0));
  const worst =
    s.worstResponsivenessSeconds ?? (delays.length ? delays.reduce((max, v) => Math.max(max, v), 0) : undefined);
  return {
    setupTime: ms(s.setupSeconds),
    avgFrameRate: s.averageFps ?? (mean ? 1 / mean : undefined),
    maxJitter: ms(jitter),
    worstResponsiveness: ms(worst),
  };
}
export function compareMetrics(a: ProcessedResult, b: ProcessedResult, key: SortKey, direction: SortDirection): number {
  const left = cardMetrics(a)[key],
    right = cardMetrics(b)[key];
  if (missing(left) || missing(right)) return Number(missing(left)) - Number(missing(right));
  return (left! - right!) * metricTable[key].sign * (direction === 'bestFirst' ? 1 : -1);
}
export function phaseColor(name: string, colors?: PhaseColorConfig): string {
  if (colors && Object.hasOwn(colors, name)) return colors[name]!;
  let hash = 2166136261;
  for (const character of name) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  // Reserve red/orange/green for metric grades; phase hues stay in the cyan/blue/violet range.
  return `hsl(${190 + ((hash >>> 0) % 111)} 65% 58%)`;
}
/** Four equal divisions using the requested ladder, extended for large stalls. */
export function chartScale(max: number) {
  let factor = 1;
  while (max > 400 * factor) factor *= 10;
  const step = [5, 10, 25, 50, 100].map((v) => v * factor).find((v) => 4 * v >= max) ?? 100 * factor;
  return { max: 4 * step, ticks: [0, 1, 2, 3, 4].map((v) => v * step) };
}
// Length prefixes keep renderer/scene pairs unique even when IDs contain separators.
export function resultId(result: ProcessedResult): string {
  return `${result.entry.renderer.id.length}-${result.entry.renderer.id}-${result.entry.scene.id}`;
}
export function readRoute(url: URL) {
  const sort = url.searchParams.get('sort');
  return {
    sort: sort && Object.hasOwn(metricTable, sort) ? (sort as SortKey) : ('setupTime' as SortKey),
    direction: url.searchParams.get('dir') === 'worstFirst' ? ('worstFirst' as const) : ('bestFirst' as const),
    result: url.searchParams.get('result'),
    query: url.searchParams.get('q') ?? '',
    renderer: url.searchParams.get('renderer') ?? '',
    scene: url.searchParams.get('scene') ?? '',
  };
}
