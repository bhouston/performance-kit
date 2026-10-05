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
  networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  config: { durationMs: 100, vsync: 'off' },
  harness: { teardown: 1200 },
  reporter: { frames: [] },
  status: 'timeout',
};
it('writes only flat AVIF/metrics files atomically and overwrites a workload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-flat-'));
  try {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const file = await writeRun(root, structuredClone(result), png);
    expect(file).toBe(join(root, 'test/cube/metrics.json'));
    await expect(readFile(join(root, 'test/cube/raw.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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
it('rejects old metrics instead of migrating raw files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-format-'));
  try {
    const file = await writeRun(root, structuredClone(result));
    await writeFile(file, JSON.stringify({ schemaVersion: 1 }));
    await writeFile(join(root, 'test/cube/raw.json'), JSON.stringify(result));
    await expect(processResults(root)).rejects.toThrow('Invalid processed result');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ schemaVersion: 1 });
    await rm(file);
    expect((await scanResults(root)).runs).toEqual([]);
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
    await rm(join(root, 'test/cube/metrics.json'));
    await buildReport(root, site);
    await expect(readFile(join(site, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(site, 'test/cube/metrics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(site, { recursive: true, force: true });
  }
});

it('treats metrics as canonical even when stale raw files remain, and rejects future versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-canonical-'));
  try {
    const file = await writeRun(root, structuredClone(result));
    await writeFile(join(root, 'test/cube/raw.json'), JSON.stringify({ ...result, runId: 'stale' }));
    await processResults(root);
    expect((await scanResults(root)).runs[0]?.result.runId).toBe('test');
    const metrics = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...metrics, schemaVersion: metrics.schemaVersion + 1 }));
    await expect(processResults(root)).rejects.toThrow('Invalid processed result');
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(metrics.schemaVersion + 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps convergence references and diffs portable and removes them when overwritten without a reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'convergence-assets-'));
  try {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
      .png()
      .toBuffer();
    const run = structuredClone(result);
    run.status = 'ok';
    run.reporter.runStart = 0.1;
    run.reporter.runEnd = 1;
    run.reporter.convergence = {
      width: 2,
      height: 2,
      interval: 0.25,
      targetPsnr: 30,
      samples: [{ at: 0.2, frame: 1, mse: 0, psnr: null }],
    };
    await writeRun(root, run, png, png);
    const metrics = JSON.parse(await readFile(join(root, 'test/cube/metrics.json'), 'utf8'));
    expect(metrics.convergence.timeToTarget).toBe(0.1);
    expect(metrics.convergence.reference).toBe('reference.png');
    expect((await readReportIndex(root)).results[0]).toMatchObject({
      reference: 'test/cube/reference.png',
      diff: 'test/cube/diff.png',
    });
    expect((await sharp(join(root, 'test/cube/diff.png')).stats()).channels.every((c) => c.max === 0)).toBe(true);
    await buildReport(root, root + '-site');
    expect(await readFile(join(root + '-site', 'test/cube/reference.png'))).toEqual(png);
    expect((await sharp(join(root + '-site', 'test/cube/diff.png')).metadata()).width).toBe(2);
    await writeRun(root, structuredClone(result));
    await buildReport(root, root + '-site');
    for (const name of ['reference.png', 'diff.png']) {
      await expect(readFile(join(root, 'test/cube', name))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root + '-site', 'test/cube', name))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(root + '-site', { recursive: true, force: true });
  }
});
