import { describe, it, expect } from 'vitest';
import { scheduleSuite, isSoftwareAdapter, chromeFlags } from './schedule.js';
import type { Suite } from 'performance-kit-schema';
const suite: Suite = {
  schemaVersion: 1,
  name: 'test',
  defaults: { repetitions: 2 },
  entries: ['a', 'b', 'c'].map((id) => ({
    id,
    name: id,
    url: 'https://example.com',
    durationMs: 100,
    labels: [{ key: 'renderer', value: id }],
  })),
};
describe('benchmark scheduling', () => {
  it('interleaves repetitions and preserves stable identifiers', () => {
    expect(scheduleSuite(suite).map((run) => `${run.entry.id}${run.repetition}`)).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'b2',
      'c2',
    ]);
  });
  it('filters labels before scheduling', () => {
    expect(scheduleSuite(suite, { filter: ['renderer=b'] }).map((run) => run.entry.id)).toEqual(['b', 'b']);
  });
  it('rejects malformed filters and repetition counts', () => {
    expect(() => scheduleSuite(suite, { filter: ['renderer'] })).toThrow('key=value');
    expect(() => scheduleSuite(suite, { repetitions: 0 })).toThrow();
  });
  it('has reproducible seeded order', () => {
    expect(scheduleSuite(suite, { seed: 17 })).toEqual(scheduleSuite(suite, { seed: 17 }));
    expect(
      scheduleSuite({ ...suite, defaults: { order: 'sequential', repetitions: 2 } }).map((run) => run.entry.id),
    ).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
  });
  it('rejects known software adapters and records vsync flags', () => {
    expect(isSoftwareAdapter({ description: 'ANGLE SwiftShader' })).toBe(true);
    expect(isSoftwareAdapter({ description: 'Apple M4' })).toBe(false);
    expect(chromeFlags('off')).toContain('--disable-frame-rate-limit');
    expect(chromeFlags('on')).not.toContain('--disable-gpu-vsync');
  });
});
