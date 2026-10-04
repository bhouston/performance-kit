import { mkdir, readFile, readdir, writeFile, cp, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRunResult, assertSuite, assertManifest } from 'performance-kit-schema';
import type { RunResult, Suite } from 'performance-kit-schema';
export function safeEntryId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id === '.' || id === '..') throw new Error(`Unsafe entry id: ${id}`);
  return id;
}
export async function loadSuite(file: string): Promise<Suite> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  assertSuite(value);
  for (const entry of value.entries) {
    const url = new URL(entry.url, 'http://127.0.0.1');
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error(`Entry ${entry.id}: renderer URL must use HTTP or HTTPS (relative URLs are allowed)`);
  }
  return value as Suite;
}
export async function writeRun(root: string, result: RunResult, png?: Uint8Array): Promise<string> {
  const folder = join(root, 'runs', safeEntryId(result.entry.id));
  await mkdir(folder, { recursive: true });
  const file = join(folder, `rep-${result.repetition}.json`);
  assertRunResult(result);
  if (png) {
    await writeFile(join(folder, `rep-${result.repetition}.png`), png, { flag: 'wx' });
    result.capture = {
      file: `rep-${result.repetition}.png`,
      at: result.capture?.at ?? result.harness.captureSent ?? result.harness.teardown,
    };
  }
  assertRunResult(result);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return file;
}
export interface ReportIndex {
  runs: { result: RunResult; file: string; capture?: string }[];
  manifests: unknown[];
}
export async function scanResults(root: string): Promise<ReportIndex> {
  const index: ReportIndex = { runs: [], manifests: [] };
  async function walk(directory: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = join(directory, entry.name),
        url = [relative, entry.name].filter(Boolean).join('/');
      if (entry.isDirectory()) await walk(file, url);
      else if (entry.name === 'manifest.json') {
        const manifest: unknown = JSON.parse(await readFile(file, 'utf8'));
        assertManifest(manifest);
        index.manifests.push(manifest);
      } else if (entry.name.endsWith('.json') && /^rep-\d+\.json$/.test(entry.name)) {
        const result = JSON.parse(await readFile(file, 'utf8')) as RunResult;
        assertRunResult(result);
        index.runs.push({
          result,
          file: url,
          ...(result.capture ? { capture: [relative, result.capture.file].join('/') } : {}),
        });
      }
    }
  }
  await walk(resolve(root), '');
  return index;
}
export async function updateLatest(root: string, runset: string): Promise<void> {
  const temp = join(root, `latest-${process.pid}.tmp`);
  await writeFile(temp, `${JSON.stringify({ runset: `runsets/${runset}` }, null, 2)}\n`);
  await rename(temp, join(root, 'latest.json'));
}
export async function viewerDirectory(): Promise<string> {
  const packaged = fileURLToPath(new URL('../viewer', import.meta.url));
  try {
    if ((await stat(join(packaged, 'index.html'))).isFile()) return packaged;
  } catch {}
  const workspace = fileURLToPath(new URL('../../viewer/dist', import.meta.url));
  try {
    await stat(join(workspace, 'index.html'));
    return workspace;
  } catch {
    throw new Error('Viewer is not built. Run pnpm build first.');
  }
}
export async function buildReport(out: string, site: string): Promise<void> {
  const input = resolve(out),
    destination = resolve(site);
  if (input === destination || destination.startsWith(input + '/') || input.startsWith(destination + '/'))
    throw new Error('Site and result folders must be separate');
  await mkdir(destination, { recursive: true });
  await cp(await viewerDirectory(), destination, { recursive: true });
  const runsets = join(input, 'runsets');
  try {
    await cp(runsets, join(destination, 'runsets'), { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(join(destination, 'index.json'), JSON.stringify(await scanResults(input)));
}
