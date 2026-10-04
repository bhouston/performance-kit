import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.js';
it('serves isolation headers, index and live reader assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-server-'));
  await writeFile(join(root, 'index.html'), '<html>viewer</html>');
  const server = await startServer({ out: root, viewer: root, port: 0 });
  try {
    const response = await fetch(server.url + '/live');
    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(await (await fetch(server.url + '/index.json')).json()).toEqual({
      runs: [],
      manifests: [],
    });
    expect((await fetch(server.url + '/missing')).status).toBe(404);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
