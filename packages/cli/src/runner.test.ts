import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const launch = vi.hoisted(() =>
  vi.fn(async () => ({
    userAgent: async () => 'pinned-test-chrome',
    close: async () => {},
    newPage: async () => ({
      goto: async () => {},
      close: async () => {},
      setViewport: async () => {},
      exposeFunction: async () => {},
      evaluate: async (fn: Function, input?: unknown) => {
        if (input)
          return {
            harness: { iframeCreated: 1000, startSent: 1000, runSent: 1010, runEndObserved: 1110, teardown: 1111 },
            reporter: { frames: [], runStart: 1010, runEnd: 1110 },
            messages: [],
            clockSync: { samples: [] },
            environment: {},
            status: 'ok',
          };
        if (fn.toString().includes('requestAdapter'))
          return {
            available: true,
            adapter: { description: 'Real GPU' },
            gpuTimestampsAvailable: true,
            crossOriginIsolated: true,
          };
        return true;
      },
    }),
  })),
);
vi.mock('puppeteer', () => ({ default: { launch } }));
import { runSuite, deadline } from './runner.js';
describe('runner lifecycle', () => {
  it('writes the manifest once after browser probing and survives process recycling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'performance-runner-'));
    try {
      const suite = join(root, 'suite.json');
      await writeFile(
        suite,
        JSON.stringify({
          schemaVersion: 1,
          name: 'runner',
          defaults: { repetitions: 2, captureAfterWarmup: false, warmupMs: 0 },
          entries: [{ id: 'cube', name: 'Cube', url: 'http://127.0.0.1/cube', durationMs: 100 }],
        }),
      );
      const result = await runSuite({ suite, out: join(root, 'results'), port: 0, cooldownMs: 0, recycle: 1 });
      expect(result.results).toHaveLength(2);
      expect(launch).toHaveBeenCalledTimes(2);
      const manifest = JSON.parse(await readFile(join(result.runset, 'manifest.json'), 'utf8'));
      expect(manifest.environment.userAgent).toBe('pinned-test-chrome');
      expect(manifest.environment.gpuTimestampsAvailable).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('bounds a wedged renderer independently of the browser clock', async () => {
    await expect(deadline(new Promise(() => {}), 2, 'run')).rejects.toThrow('Timeout during run');
    expect(await deadline(Promise.resolve(7), 100, 'run')).toBe(7);
  });
});
