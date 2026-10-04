import { describe, expect, it } from 'vitest';
import { assertSuite, validateRunResult, validateMessageToReporter, validateMessageToHarness } from './index.js';
describe('schema boundaries', () => {
  it('accepts raw minimal results and rejects derived metrics', () => {
    const result = {
      schemaVersion: 1,
      runId: 'test',
      entry: { id: 'cube', name: 'Cube', labels: [], url: '/cube' },
      config: { durationMs: 100, warmupMs: 0, vsync: 'on' },
      harness: { startSent: 1000, teardown: 1200 },
      reporter: { frames: [{ cpuStart: 1050, cpuEnd: 1051 }] },
      status: 'ok',
    };
    expect(validateRunResult(result)).toBe(true);
    expect(
      validateRunResult({
        ...result,
        reporter: {
          ...result.reporter,
          blocks: [
            {
              start: 1040,
              end: 1100,
              source: 'loaf',
              scripts: [{ start: 1041, end: 1099, sourceURL: 'renderer.js', invoker: 'requestAnimationFrame' }],
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      validateRunResult({
        ...result,
        reporter: {
          ...result.reporter,
          blocks: [{ start: 1040, end: 1100, source: 'loaf', scripts: [{ start: 1041, end: 1099, duration: 58 }] }],
        },
      }),
    ).toBe(false);
    expect(validateRunResult({ ...result, median: 16 })).toBe(false);
    expect(
      validateRunResult({
        ...result,
        reporter: { frames: [{ cpuStart: 1, cpuEnd: 2, gpuStart: '1.1' }] },
      }),
    ).toBe(false);
  });
  it('rejects duplicate and unsafe filesystem entry IDs', () => {
    const entry = { id: 'cube', name: 'Cube', url: '/cube', durationMs: 100 };
    expect(() => assertSuite({ schemaVersion: 1, name: 'test', entries: [entry, entry] })).toThrow('duplicate');
    expect(() => assertSuite({ schemaVersion: 1, name: 'test', entries: [{ ...entry, id: '../escape' }] })).toThrow();
  });
  it('validates directions and binary capture payloads', () => {
    const message = {
      protocol: 'performance-kit',
      protocolVersion: 1,
      runId: 'test',
      seq: 0,
      sentAt: 1,
      type: 'run',
      payload: { durationMs: 100 },
    };
    expect(validateMessageToReporter(message)).toBe(true);
    expect(validateMessageToHarness(message)).toBe(false);
    expect(validateMessageToHarness({ ...message, type: 'capture', payload: { at: 1, bytes: {} } })).toBe(false);
    expect(
      validateMessageToHarness({
        ...message,
        type: 'capture',
        payload: { at: 1, bytes: new ArrayBuffer(8) },
      }),
    ).toBe(true);
  });
});
