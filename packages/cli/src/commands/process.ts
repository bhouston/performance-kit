import type { CommandModule } from 'yargs';
import { processResults } from '../storage.js';
const command: CommandModule = {
  command: 'process',
  describe: 'Derive compact metrics and the viewer index from raw results',
  builder: (yargs) => yargs.option('out', { type: 'string', default: 'performance-results' }),
  handler: async (args) => {
    const index = await processResults(args.out as string);
    console.log(`Processed ${index.results.length} results`);
  },
};
export default command;
