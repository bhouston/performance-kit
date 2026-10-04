import { it, expect } from 'vitest';
import type { RunResult } from 'performance-kit-schema';
import { compareGroups } from './comparison.js';
function run(id: string, scene: string, renderer: string, interval: number, experiment = 'baseline'): RunResult {
  return {
    schemaVersion: 1,
    runId: id,
    entry: {
      id,
      name: id,
      url: 'https://example.com',
      labels: [
        { key: 'scene', value: scene },
        { key: 'renderer', value: renderer },
        { key: 'experiment', value: experiment },
      ],
    },
    repetition: 1,
    config: { durationMs: 100, warmupMs: 0, vsync: 'on' },
    harness: { startSent: 1000, teardown: 1200 },
    reporter: {
      runStart: 1000,
      runEnd: 1200,
      frames: Array.from({ length: 5 }, (_, index) => ({
        cpuStart: 1000 + index * interval,
        cpuEnd: 1001 + index * interval,
      })),
    },
    status: 'ok',
  };
}
it('pairs directories by stable entry id without pooling scenes', () => {
  const a = [run('cube', 'cube', 'a', 10), run('sponza', 'sponza', 'a', 30)];
  const b = [run('cube', 'cube', 'b', 20), run('sponza', 'sponza', 'b', 30)];
  const comparisons = compareGroups({ runs: a, directory: true }, { runs: b, directory: true }, { iterations: 10 });
  expect(comparisons.map((c) => [c.workload, c.ratio])).toEqual([
    ['cube', 0.5],
    ['sponza', 1],
  ]);
});
it('pairs renderer labels using other workload labels', () => {
  const a = [run('a-cube', 'cube', 'a', 10), run('a-sponza', 'sponza', 'a', 30)];
  const b = [run('b-cube', 'cube', 'b', 20), run('b-sponza', 'sponza', 'b', 30)];
  const comparisons = compareGroups(
    { runs: a, directory: false, selectorKey: 'renderer' },
    { runs: b, directory: false, selectorKey: 'renderer' },
    { iterations: 10 },
  );
  expect(comparisons).toHaveLength(2);
  expect(comparisons[0].entryB).toBe('b-cube');
});
it('rejects invalid bootstrap controls and unmatched workloads', () => {
  const group = { runs: [run('cube', 'cube', 'a', 10)], directory: true };
  expect(() => compareGroups(group, group, { iterations: 0 })).toThrow('positive integer');
  expect(() => compareGroups(group, group, { seed: Infinity })).toThrow('finite');
  expect(() => compareGroups(group, { runs: [run('other', 'other', 'b', 10)], directory: true })).toThrow(
    'No matching',
  );
});

it('matches renderer comparisons by scene and experiment without pooling optimization variants', () => {
  const a = [
    run('new-baseline', 'cube', 'three-new', 10),
    run('new-ssgi-half', 'cube', 'three-new', 6, 'ssgi-half'),
    run('new-light-bake', 'cube', 'three-new', 5, 'light-bake'),
  ];
  const b = [run('current-baseline', 'cube', 'three-current', 20)];
  const comparisons = compareGroups(
    { runs: a, directory: false, selectorKey: 'renderer' },
    { runs: b, directory: false, selectorKey: 'renderer' },
    { iterations: 10 },
  );
  expect(comparisons).toHaveLength(1);
  expect(comparisons[0]).toMatchObject({ entryA: 'new-baseline', entryB: 'current-baseline', ratio: 0.5 });
});
it('matches experiment comparisons by scene and renderer', () => {
  const a = [
    run('new-optimized', 'cube', 'three-new', 5, 'optimized'),
    run('current-optimized', 'cube', 'three-current', 10, 'optimized'),
  ];
  const b = [run('new-baseline', 'cube', 'three-new', 10), run('current-baseline', 'cube', 'three-current', 20)];
  const comparisons = compareGroups(
    { runs: a, directory: false, selectorKey: 'experiment' },
    { runs: b, directory: false, selectorKey: 'experiment' },
    { iterations: 10 },
  );
  expect(comparisons.map(({ entryA, entryB }) => [entryA, entryB])).toEqual([
    ['new-optimized', 'new-baseline'],
    ['current-optimized', 'current-baseline'],
  ]);
});
it('supports different selector keys when both selected axes differ', () => {
  const comparisons = compareGroups(
    { runs: [run('new-optimized', 'cube', 'three-new', 5, 'optimized')], directory: false, selectorKey: 'experiment' },
    { runs: [run('current-baseline', 'cube', 'three-current', 20)], directory: false, selectorKey: 'renderer' },
    { iterations: 10 },
  );
  expect(comparisons).toHaveLength(1);
  expect(comparisons[0]).toMatchObject({ entryA: 'new-optimized', entryB: 'current-baseline', ratio: 0.25 });
});
