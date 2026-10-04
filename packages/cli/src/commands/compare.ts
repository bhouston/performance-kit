import { stat } from 'node:fs/promises';
import type { CommandModule } from 'yargs';
import { compareRuns } from 'performance-kit-schema';
import type { RunResult } from 'performance-kit-schema';
import { scanResults } from '../storage.js';
async function select(value: string, root: string): Promise<RunResult[]> {
  try {
    if ((await stat(value)).isDirectory()) return (await scanResults(value)).runs.map((run) => run.result);
  } catch {}
  const split = value.indexOf('=');
  if (split < 1) throw new Error(`Comparison selector must be a directory or key=value: ${value}`);
  return (await scanResults(root)).runs
    .map((run) => run.result)
    .filter((run) =>
      run.entry.labels.some((label) => label.key === value.slice(0, split) && label.value === value.slice(split + 1)),
    );
}
const command: CommandModule = {
  command: 'compare',
  describe: 'Compare runs using run-level bootstrap confidence intervals',
  builder: (yargs) =>
    yargs
      .option('a', { type: 'string', demandOption: true })
      .option('b', { type: 'string', demandOption: true })
      .option('out', { type: 'string', default: 'performance-results' })
      .option('seed', { type: 'number', default: 1 })
      .option('iterations', { type: 'number', default: 2000 })
      .option('json', { type: 'boolean', default: false })
      .option('regression-threshold', {
        type: 'number',
        describe: 'Fail when A/B ratio confidently exceeds 1 + threshold (fraction)',
      }),
  handler: async (args) => {
    const [a, b] = await Promise.all([
      select(args.a as string, args.out as string),
      select(args.b as string, args.out as string),
    ]);
    if (!a.length || !b.length) throw new Error('Both comparison groups must contain results');
    const comparison = compareRuns(a, b, {
      seed: args.seed as number,
      iterations: args.iterations as number,
    });
    console.log(
      args.json
        ? JSON.stringify(comparison, null, 2)
        : `A ${comparison.medianA.toFixed(3)} ms; B ${comparison.medianB.toFixed(3)} ms\nA/B ${comparison.ratio.toFixed(3)} (95% CI ${comparison.confidenceInterval.map((v) => v.toFixed(3)).join('–')}); ${comparison.verdict}\nMann-Whitney U=${comparison.u.toFixed(1)}, p=${comparison.pValue.toPrecision(3)}`,
    );
    if (typeof args.regressionThreshold === 'number' && comparison.confidenceInterval[0] > 1 + args.regressionThreshold)
      process.exitCode = 1;
  },
};
export default command;
