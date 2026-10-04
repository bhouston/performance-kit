import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.js';
it('serves isolation headers, index and live reader assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-server-'));
  const results = await mkdtemp(join(tmpdir(), 'performance-data-'));
  await writeFile(join(results, 'README.md'), '# Suite introduction');
  await writeFile(join(root, 'index.html'), '<html>viewer</html>');
  const server = await startServer({ out: results, viewer: root, port: 0 });
  try {
    const response = await fetch(server.url + '/live');
    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(await (await fetch(server.url + '/index.json')).json()).toEqual({
      runs: [],
      manifests: [],
    });
    const introduction = await fetch(server.url + '/README.md');
    expect(introduction.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await introduction.text()).toBe('# Suite introduction');
    await rm(join(results, 'README.md'));
    expect((await fetch(server.url + '/README.md')).status).toBe(404);
    expect((await fetch(server.url + '/missing')).status).toBe(404);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    await rm(results, { recursive: true, force: true });
  }
});

import { mkdir, rename } from 'node:fs/promises';
import { vi } from 'vitest';
async function subscribe(url: string) {
  const controller = new AbortController();
  const response = await fetch(`${url}/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  const events: { type: string; paths?: string[] }[] = [];
  let ended = false;
  const task = (async () => {
    let text = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = text.indexOf('\n\n')) !== -1) {
          const frame = text.slice(0, boundary);
          text = text.slice(boundary + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      ended = true;
    }
  })();
  return {
    events,
    task,
    get ended() {
      return ended;
    },
    close() {
      controller.abort();
      return task;
    },
  };
}
it('static serve disables watch metadata and SSE even after result edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-static-'));
  const server = await startServer({ out: root, viewer: root, port: 0 });
  try {
    expect((await fetch(`${server.url}/events`)).status).toBe(404);
    expect(await (await fetch(`${server.url}/index.json`)).json()).not.toHaveProperty('liveReload');
    await writeFile(join(root, 'README.md'), '# Changed');
    expect(await (await fetch(`${server.url}/index.json`)).json()).not.toHaveProperty('liveReload');
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('dev coalesces atomic writes, handles added/removed results and README, and closes pending watches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-watch-'));
  const directory = join(root, 'runsets', 'set', 'runs', 'cube');
  await mkdir(directory, { recursive: true });
  const server = await startServer({ out: root, viewer: root, port: 0, watchResults: true });
  const stream = await subscribe(server.url);
  try {
    expect(await (await fetch(`${server.url}/index.json`)).json()).toMatchObject({ liveReload: true });
    await vi.waitFor(() => expect(stream.events).toEqual([{ type: 'resultsChanged', paths: [] }]));
    const result = {
      schemaVersion: 1,
      runId: 'test',
      entry: {
        id: 'cube',
        name: 'Cube',
        renderer: { id: 'test', name: 'Test Renderer' },
        scene: { id: 'cube', name: 'Spinning cube' },
        url: '/cube',
      },
      config: { durationMs: 100, warmupMs: 0, vsync: 'on' },
      harness: { startSent: 1, teardown: 2 },
      reporter: { frames: [] },
      status: 'ok',
    };
    const temp = join(directory, '.rep-1.json.tmp');
    await writeFile(temp, JSON.stringify(result));
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(stream.events).toHaveLength(1); // Temporary writes (and parent metadata) stay silent.
    await rename(temp, join(directory, 'rep-1.json'));
    await writeFile(join(root, 'README.md'), '# One');
    await writeFile(join(root, 'README.md'), '# Two');
    await vi.waitFor(() => expect(stream.events).toHaveLength(2), { timeout: 2500 });
    expect(stream.events[1]).toEqual({
      type: 'resultsChanged',
      paths: ['README.md', 'runsets/set/runs/cube/rep-1.json'],
    });
    expect((await (await fetch(`${server.url}/index.json`)).json()).runs).toHaveLength(1);
    await rm(join(directory, 'rep-1.json'));
    await rm(join(root, 'README.md'));
    await vi.waitFor(() => expect(stream.events).toHaveLength(3), { timeout: 2500 });
    expect(stream.events[2]?.paths).toEqual(['README.md', 'runsets/set/runs/cube/rep-1.json']);
    expect((await (await fetch(`${server.url}/index.json`)).json()).runs).toHaveLength(0);
    const imported = await mkdtemp(join(tmpdir(), 'performance-import-'));
    await mkdir(join(imported, 'runs', 'cube'), { recursive: true });
    await writeFile(join(imported, 'runs', 'cube', 'rep-1.json'), JSON.stringify(result));
    await rename(imported, join(root, 'runsets', 'imported'));
    await vi.waitFor(() => expect(stream.events).toHaveLength(4), { timeout: 2500 });
    expect(stream.events[3]?.paths).toContain('runsets/imported');
    expect((await (await fetch(`${server.url}/index.json`)).json()).runs).toHaveLength(1);
    await rm(join(root, 'runsets', 'imported'), { recursive: true });
    await vi.waitFor(() => expect(stream.events).toHaveLength(5), { timeout: 2500 });
    expect(stream.events[4]?.paths).toContain('runsets/imported');
    expect((await (await fetch(`${server.url}/index.json`)).json()).runs).toHaveLength(0);
    // Pending debounced changes must disappear when the server is shut down.
    await writeFile(join(root, 'README.md'), '# Pending');
    await server.close();
    await stream.task;
    expect(stream.ended).toBe(true);
    expect(stream.events).toHaveLength(5);
    await writeFile(join(root, 'README.md'), '# After close');
  } finally {
    await stream.close();
    if (server.server.listening) await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('benchmark live events remain available without enabling filesystem watching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-live-'));
  const server = await startServer({ out: root, viewer: root, port: 0, live: true });
  const stream = await subscribe(server.url);
  try {
    await vi.waitFor(() => expect(stream.events).toHaveLength(1));
    server.publish({ type: 'run', file: 'runsets/new/runs/cube/rep-1.json' });
    await vi.waitFor(() => expect(stream.events.at(-1)?.type).toBe('run'));
    expect(await (await fetch(`${server.url}/index.json`)).json()).toMatchObject({ liveReload: true });
  } finally {
    await stream.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
