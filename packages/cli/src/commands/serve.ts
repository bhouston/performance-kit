import type { CommandModule } from 'yargs';
import { startServer } from '../server.js';
const command: CommandModule = {
  command: 'serve',
  describe: 'Serve the report and reader-only live view',
  builder: (yargs) =>
    yargs
      .option('out', { type: 'string', default: 'performance-results' })
      .option('host', { type: 'string', default: 'localhost' })
      .option('port', { type: 'number', default: 4400 }),
  handler: async (args) => {
    const server = await startServer({
      out: args.out as string,
      host: args.host as string,
      port: args.port as number,
    });
    console.log(`Performance report: ${server.url}\nLive view: ${server.url}/live`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void server.close();
      });
  },
};
export default command;
