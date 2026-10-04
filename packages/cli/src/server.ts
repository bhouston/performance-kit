import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';
import { scanResults, viewerDirectory } from './storage.js';
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
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
}) {
  const clients = new Set<ServerResponse>();
  const server = createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (path === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (path === '/index.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(await scanResults(options.out)));
        return;
      }
      if (path === '/harness') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<!doctype html><html><head><title>performance-kit harness</title></head><body style="margin:0"></body></html>',
        );
        return;
      }
      const isRaw = path.startsWith('/runsets/') || path === '/latest.json';
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
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4400, options.host ?? 'localhost', accept);
  });
  const address = server.address();
  const host = options.host ?? 'localhost';
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://${host}:${port}`,
    server,
    publish(event: unknown) {
      for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    async close() {
      for (const client of clients) client.end();
      await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
    },
  };
}
