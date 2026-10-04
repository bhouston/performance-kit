import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat, mkdir, readdir } from 'node:fs/promises';
import { watch, lstatSync, type FSWatcher } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';
import { scanResults, viewerDirectory } from './storage.js';
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
export async function startServer(options: {
  out: string;
  host?: string;
  port?: number;
  rendererRoot?: string;
  viewer?: string;
  watchResults?: boolean;
  live?: boolean;
}) {
  const clients = new Set<ServerResponse>();
  const liveReload = options.watchResults === true;
  const eventsEnabled = liveReload || options.live === true;
  const publish = (event: unknown) => {
    for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  let watcher: FSWatcher | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const changedPaths = new Set<string>();
  const knownDirectories = new Set<string>(['']);
  const stopWatching = () => {
    clearTimeout(debounce);
    changedPaths.clear();
    watcher?.close();
    watcher = undefined;
  };
  if (liveReload) {
    await mkdir(options.out, { recursive: true });
    const findDirectories = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        knownDirectories.add(path);
        await findDirectories(resolve(directory, entry.name), path);
      }
    };
    await findDirectories(options.out, '');
    watcher = watch(options.out, { recursive: true }, (_event, filename) => {
      const path = filename?.toString().split(sep).join('/') ?? '';
      // Atomic writers publish a final rename; temporary files never trigger report refreshes.
      if (path.split('/').some((part) => part.startsWith('.') || /(?:\.tmp|\.temp|\.swp|~)$/i.test(part))) return;
      let directory = knownDirectories.has(path);
      try {
        const info = lstatSync(resolve(options.out, path));
        if (info.isSymbolicLink()) return;
        if (info.isDirectory()) {
          // An imported run set can appear in one atomic directory rename. Existing
          // directory metadata changes also accompany ignored temporary file writes.
          if (directory) return;
          knownDirectories.add(path);
          directory = true;
        }
      } catch {
        if (directory) {
          for (const known of knownDirectories)
            if (known === path || known.startsWith(`${path}/`)) knownDirectories.delete(known);
        }
      }
      if (!directory && path && !/\.(?:json|png|avif)$/i.test(path) && path !== 'README.md') return;
      changedPaths.add(path);
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        publish({ type: 'resultsChanged', paths: [...changedPaths].toSorted() });
        changedPaths.clear();
      }, 500);
      debounce.unref();
    });
    watcher.on('error', (error) => {
      console.error('Performance results watch failed:', error.message);
      publish({ type: 'watchError', message: error.message });
      stopWatching();
    });
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (path === '/events') {
        if (!eventsEnabled) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        res.write(`data: ${JSON.stringify({ type: 'resultsChanged', paths: [] })}\n\n`);
        const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
        heartbeat.unref();
        clients.add(res);
        res.on('close', () => {
          clearInterval(heartbeat);
          clients.delete(res);
        });
        return;
      }
      if (path === '/index.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ...(await scanResults(options.out)),
            ...(liveReload || options.live === true ? { liveReload: true } : {}),
          }),
        );
        return;
      }
      if (path === '/harness') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<!doctype html><html><head><title>performance-kit harness</title></head><body style="margin:0"></body></html>',
        );
        return;
      }
      const isRaw = path.startsWith('/runsets/') || path === '/latest.json' || path === '/README.md';
      const reporter = path.startsWith('/reporter/');
      const root = resolve(
        reporter
          ? dirname(fileURLToPath(import.meta.resolve('performance-kit-reporter')))
          : (options.rendererRoot ?? (isRaw ? options.out : (options.viewer ?? (await viewerDirectory())))),
      );
      let file = resolve(
        root,
        '.' + (reporter ? path.slice('/reporter'.length) : path === '/' || path === '/live' ? '/index.html' : path),
      );
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      } catch {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end('Server error');
    }
  });
  try {
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 4400, options.host ?? 'localhost', accept);
    });
  } catch (error) {
    stopWatching();
    throw error;
  }
  server.once('close', stopWatching);
  const address = server.address();
  const host = options.host ?? 'localhost';
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://${host}:${port}`,
    server,
    publish,
    async close() {
      stopWatching();
      for (const client of clients) client.end();
      await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
    },
  };
}
