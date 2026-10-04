import { stat } from 'node:fs/promises';
import { compareRuns, type RunResult } from 'performance-kit-schema';
import { scanResults } from './storage.js';
export interface ComparisonGroup {
  runs: RunResult[];
  selectorKey?: string;
  directory: boolean;
}
export async function selectComparisonGroup(value: string, root: string): Promise<ComparisonGroup> {
  try {
    if ((await stat(value)).isDirectory())
      return { runs: (await scanResults(value)).runs.map((run) => run.result), directory: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const split = value.indexOf('=');
  if (split < 1) throw new Error(`Comparison selector must be a directory or key=value: ${value}`);
  const selectorKey = value.slice(0, split);
  return {
    directory: false,
    selectorKey,
    runs: (await scanResults(root)).runs
      .map((run) => run.result)
      .filter((run) =>
        run.entry.labels.some((label) => label.key === selectorKey && label.value === value.slice(split + 1)),
      ),
  };
}
export function compareGroups(
  a: ComparisonGroup,
  b: ComparisonGroup,
  options: { seed?: number; iterations?: number } = {},
) {
  if (!a.runs.length || !b.runs.length) throw new Error('Both comparison groups must contain results');
  if (options.iterations !== undefined && (!Number.isInteger(options.iterations) || options.iterations < 1))
    throw new Error('iterations must be a positive integer');
  if (options.seed !== undefined && !Number.isFinite(options.seed)) throw new Error('seed must be finite');
  const excluded = new Set(['renderer', 'experiment', a.selectorKey, b.selectorKey]);
  const keysA = new Set(a.runs.flatMap((run) => run.entry.labels.map((label) => label.key)));
  const commonKeys = [...new Set(b.runs.flatMap((run) => run.entry.labels.map((label) => label.key)))]
    .filter((key) => keysA.has(key) && !excluded.has(key))
    .toSorted();
  const directoryPair = a.directory && b.directory;
  const keyFor = (run: RunResult) =>
    directoryPair
      ? run.entry.id
      : JSON.stringify(
          commonKeys.map((key) => [key, run.entry.labels.find((label) => label.key === key)?.value ?? '']),
        );
  const collect = (group: ComparisonGroup) => {
    const grouped = new Map<string, RunResult[]>();
    for (const run of group.runs) {
      const key = keyFor(run);
      grouped.set(key, [...(grouped.get(key) ?? []), run]);
    }
    if (!directoryPair)
      for (const [key, runs] of grouped)
        if (new Set(runs.map((run) => run.entry.id)).size > 1)
          throw new Error(
            `Ambiguous workload ${key}: add labels to distinguish entries or compare run-set directories`,
          );
    return grouped;
  };
  const left = collect(a),
    right = collect(b);
  const comparisons = [];
  for (const [workload, runsA] of left) {
    const runsB = right.get(workload);
    if (!runsB) continue;
    comparisons.push({
      workload: directoryPair
        ? workload
        : commonKeys
            .map((key) => `${key}=${runsA[0].entry.labels.find((label) => label.key === key)?.value ?? ''}`)
            .join(', ') || `${runsA[0].entry.id} / ${runsB[0].entry.id}`,
      entryA: runsA[0].entry.id,
      entryB: runsB[0].entry.id,
      ...compareRuns(runsA, runsB, options),
    });
  }
  if (!comparisons.length) throw new Error('No matching workload entries between comparison groups');
  return comparisons;
}
