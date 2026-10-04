import { it, expect } from 'vitest';
import sharp from 'sharp';
import { RESULT_AVIF } from './capture.js';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeRun,
  scanResults,
  safeEntryId,
  buildReport,
  processResults,
  processResult,
  readReportIndex,
} from './storage.js';
import type { RunResult } from 'performance-kit-schema';
const result: RunResult = {
  schemaVersion: 1,
  runId: 'test',
  entry: {
    id: 'cube',
    name: 'Cube',
    renderer: { id: 'test', name: 'Test Renderer' },
    scene: { id: 'cube', name: 'Spinning cube' },
    url: '/cube',
  },
  repetition: 1,
  config: { durationMs: 100, warmupMs: 0, vsync: 'off' },
  harness: { startSent: 1000, teardown: 1200 },
  reporter: { frames: [] },
  status: 'timeout',
};
it('writes flat AVIF/raw/processed files atomically and overwrites a workload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-flat-'));
  try {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const file = await writeRun(root, structuredClone(result), png);
    expect(file).toBe(join(root, 'test/cube/raw.json'));
    expect((await sharp(join(root, 'test/cube/screenshot.avif')).metadata()).hasAlpha).toBe(false);
    expect(RESULT_AVIF).toEqual({ quality: 90, chromaSubsampling: '4:4:4' });
    const index = await readReportIndex(root);
    expect(index).toEqual({
      schemaVersion: 1,
      results: [
        {
          renderer: result.entry.renderer,
          scene: result.entry.scene,
          metrics: 'test/cube/metrics.json',
          screenshot: 'test/cube/screenshot.avif',
        },
      ],
    });
    expect(JSON.stringify(index)).not.toContain('reporter');
    const processed = JSON.parse(await readFile(join(root, 'test/cube/metrics.json'), 'utf8'));
    expect(processed.status).toBe('timeout');
    expect(processed.screenshot).toBe(true);
    expect(processed).not.toHaveProperty('reporter');
    const before = (await stat(join(root, 'test/cube/metrics.json'))).mtimeMs;
    await processResults(root);
    expect((await stat(join(root, 'test/cube/metrics.json'))).mtimeMs).toBe(before);
    await writeRun(root, { ...structuredClone(result), runId: 'replacement' });
    expect(JSON.parse(await readFile(file, 'utf8')).runId).toBe('replacement');
    expect((await scanResults(root)).runs).toHaveLength(1);
    await expect(readFile(join(root, 'test/cube/screenshot.avif'))).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(file);
    await processResult(root, 'test', 'cube');
    expect((await readReportIndex(root)).results).toEqual([]);
    await expect(readFile(join(root, 'test/cube/metrics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('reprocesses legacy display metrics into numeric seconds arrays without changing raw data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-migrate-'));
  try {
    const measured: RunResult = {
      ...structuredClone(result),
      status: 'ok',
      reporter: {
        ready: 1010,
        runStart: 1030,
        runEnd: 1100,
        frames: [
          { cpuStart: 1010, cpuEnd: 1012 },
          { cpuStart: 1030, cpuEnd: 1033 },
          { cpuStart: 1047, cpuEnd: 1051 },
          { cpuStart: 1064, cpuEnd: 1068 },
        ],
      },
    };
    const rawFile = await writeRun(root, measured);
    const rawBefore = await readFile(rawFile, 'utf8');
    const metricsFile = join(root, 'test/cube/metrics.json');
    await writeFile(
      metricsFile,
      JSON.stringify({
        schemaVersion: 1,
        timeline: { intervals: [{ t: 791.2299, value: 137.1 }] },
      }),
    );
    await processResults(root);
    const metrics = JSON.parse(await readFile(metricsFile, 'utf8'));
    expect(metrics.timeline.timeUnit).toBe('seconds');
    expect(metrics.timeline.valueUnit).toBe('seconds');
    expect(metrics.timeline.frameSeconds.length).toBeGreaterThan(1);
    expect(metrics.timeline.frameSeconds.every((value: unknown) => typeof value === 'number')).toBe(true);
    expect(metrics.timeline).not.toHaveProperty('intervals');
    expect(metrics.timeline).not.toHaveProperty('cpu');
    expect(metrics.timeline).not.toHaveProperty('gpu');
    expect(metrics.timeline).not.toHaveProperty('watchdog');
    expect(metrics.statistics.intervalCount).toBe(2);
    expect(await readFile(rawFile, 'utf8')).toBe(rawBefore);
    const before = (await stat(metricsFile)).mtimeMs;
    await processResults(root);
    expect((await stat(metricsFile)).mtimeMs).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('rejects traversal IDs', () => {
  for (const id of ['../escape', 'a/b', '..', '/tmp/x']) expect(() => safeEntryId(id)).toThrow();
});
it('exports processed files and README without raw data and removes stale owned results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-readme-')),
    site = await mkdtemp(join(tmpdir(), 'performance-site-'));
  try {
    await writeRun(root, structuredClone(result));
    await writeFile(join(root, 'README.md'), '# My benchmark\n\nSuite description.');
    await buildReport(root, site);
    expect(await readFile(join(site, 'README.md'), 'utf8')).toBe('# My benchmark\n\nSuite description.');
    expect(JSON.parse(await readFile(join(site, 'test/cube/metrics.json'), 'utf8')).entry.renderer.id).toBe('test');
    await expect(readFile(join(site, 'test/cube/raw.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(join(root, 'README.md'));
    await rm(join(root, 'test/cube/raw.json'));
    await buildReport(root, site);
    await expect(readFile(join(site, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(site, 'test/cube/metrics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(site, { recursive: true, force: true });
  }
});
