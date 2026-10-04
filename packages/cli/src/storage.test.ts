import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { RESULT_AVIF } from './capture.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRun, scanResults, safeEntryId, updateLatest } from './storage.js';
import type { RunResult } from 'performance-kit-schema';
const result: RunResult = {
  schemaVersion: 1,
  runId: 'test',
  entry: { id: 'cube', name: 'Cube', labels: [], url: 'http://127.0.0.1/cube' },
  repetition: 1,
  config: { durationMs: 100, warmupMs: 0, vsync: 'on' },
  harness: { startSent: 1000, teardown: 1200 },
  reporter: { frames: [] },
  status: 'timeout',
};
describe('raw append-only storage', () => {
  it('persists partial runs, capture files, and relative index URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'performance-kit-'));
    try {
      const runset = join(root, 'runsets', 'test');
      const png = await sharp({
        create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
      })
        .png()
        .toBuffer();
      const file = await writeRun(runset, structuredClone(result), png);
      const image = await sharp(join(runset, 'runs/cube/rep-1.avif')).metadata();
      expect(image).toMatchObject({
        format: 'heif',
        mediaType: 'image/avif',
        compression: 'av1',
        width: 2,
        height: 2,
        hasAlpha: false,
      });
      expect(RESULT_AVIF).toEqual({ quality: 90, chromaSubsampling: '4:4:4' });
      expect(JSON.parse(await readFile(file, 'utf8')).status).toBe('timeout');
      const index = await scanResults(root);
      expect(index.runs[0].file).toBe('runsets/test/runs/cube/rep-1.json');
      expect(index.runs[0].capture).toBe('runsets/test/runs/cube/rep-1.avif');
      await expect(writeRun(runset, structuredClone(result))).rejects.toThrow();
      await updateLatest(root, 'test');
      expect(JSON.parse(await readFile(join(root, 'latest.json'), 'utf8')).runset).toBe('runsets/test');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects traversal entry ids', () => {
    for (const id of ['../escape', 'a/b', '..', '/tmp/x']) expect(() => safeEntryId(id)).toThrow();
  });
});
