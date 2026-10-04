import { mkdir, readFile, readdir, writeFile, cp, rename, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assertRunResult, assertSuite, assertProcessedResult, processRun } from 'performance-kit-schema';
import { encodeCapture } from './capture.js';
import type { RunResult, ProcessedResult, Suite, NamedEntity } from 'performance-kit-schema';
export function safeEntryId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id === '.' || id === '..') throw new Error(`Unsafe id: ${id}`);
  return id;
}
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temp = join(resolve(file, '..'), `.${file.split('/').at(-1)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data);
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function loadSuite(file: string): Promise<Suite> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  assertSuite(value);
  for (const entry of value.entries) {
    const url = new URL(entry.url, 'http://127.0.0.1');
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error(`Entry ${entry.id}: renderer URL must use HTTP or HTTPS (relative URLs are allowed)`);
  }
  return value;
}
export interface ResultReference {
  renderer: NamedEntity;
  scene: NamedEntity;
  metrics: string;
  screenshot?: string;
}
export interface ReportIndex {
  schemaVersion: 1;
  results: ResultReference[];
}
export interface ResultRecord {
  result: ProcessedResult;
  file: string;
}
async function directories(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function loadMetrics(root: string, prefix: string): Promise<ProcessedResult | undefined> {
  let result: unknown;
  try {
    result = JSON.parse(await readFile(join(root, prefix, 'metrics.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (result === undefined) return undefined;
  assertProcessedResult(result);
  if (result.entry.renderer.id + '/' + result.entry.scene.id !== prefix)
    throw new Error(`Result metadata does not match its folder: ${prefix}`);
  return result;
}
export async function scanResults(root: string): Promise<{ runs: ResultRecord[] }> {
  const runs: ResultRecord[] = [];
  for (const renderer of await directories(root))
    for (const scene of await directories(join(root, renderer.name))) {
      const prefix = `${renderer.name}/${scene.name}`;
      const result = await loadMetrics(root, prefix);
      if (result) runs.push({ result, file: `${prefix}/metrics.json` });
    }
  return { runs };
}
async function referenceFor(root: string, result: ProcessedResult): Promise<ResultReference> {
  const prefix = `${safeEntryId(result.entry.renderer.id)}/${safeEntryId(result.entry.scene.id)}`;
  let screenshot: string | undefined;
  try {
    if (result.screenshot && (await stat(join(root, prefix, 'screenshot.avif'))).isFile())
      screenshot = `${prefix}/screenshot.avif`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    renderer: result.entry.renderer,
    scene: result.entry.scene,
    metrics: `${prefix}/metrics.json`,
    ...(screenshot ? { screenshot } : {}),
  };
}
async function saveIndex(root: string, index: ReportIndex, onWrite?: (file: string, contents: string) => void) {
  index.results = index.results.toSorted((a, b) => a.metrics.localeCompare(b.metrics));
  const contents = JSON.stringify(index);
  try {
    if ((await readFile(join(root, 'index.json'), 'utf8')) === contents) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  onWrite?.('index.json', contents);
  await atomicWrite(join(root, 'index.json'), contents);
}
export async function processResults(
  root: string,
  onWrite?: (file: string, contents: string) => void,
): Promise<ReportIndex> {
  await mkdir(root, { recursive: true });
  const index: ReportIndex = { schemaVersion: 1, results: [] };
  for (const { result } of (await scanResults(root)).runs) index.results.push(await referenceFor(root, result));
  await saveIndex(root, index, onWrite);
  return index;
}
export async function processResult(
  root: string,
  rendererId: string,
  sceneId: string,
  onWrite?: (file: string, contents: string) => void,
): Promise<void> {
  const prefix = `${safeEntryId(rendererId)}/${safeEntryId(sceneId)}`;
  const result = await loadMetrics(root, prefix);
  const reference = result ? await referenceFor(root, result) : undefined;
  const index = await readReportIndex(root);
  index.results = index.results.filter((item) => item.renderer.id !== rendererId || item.scene.id !== sceneId);
  if (reference) index.results.push(reference);
  await saveIndex(root, index, onWrite);
}
export async function readReportIndex(root: string): Promise<ReportIndex> {
  try {
    return JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as ReportIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, results: [] };
    throw error;
  }
}
export async function writeRun(root: string, result: RunResult, png?: Uint8Array): Promise<string> {
  assertRunResult(result);
  const folder = join(root, safeEntryId(result.entry.renderer.id), safeEntryId(result.entry.scene.id));
  await mkdir(folder, { recursive: true });
  if (png) {
    await atomicWrite(join(folder, 'screenshot.avif'), await encodeCapture(png));
    result.capture = {
      file: 'screenshot.avif',
      at: result.capture?.at ?? result.harness.captureSent ?? result.harness.teardown,
    };
  } else {
    await rm(join(folder, 'screenshot.avif'), { force: true });
    delete result.capture;
  }
  assertRunResult(result);
  const file = join(folder, 'metrics.json');
  const metrics = processRun(result);
  assertProcessedResult(metrics);
  await atomicWrite(file, JSON.stringify(metrics));
  await processResult(root, result.entry.renderer.id, result.entry.scene.id);
  return file;
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
  const previous = await readReportIndex(destination);
  const index = await processResults(input);
  const current = new Set(index.results.map((item) => item.metrics));
  for (const old of previous.results ?? []) {
    if (current.has(old.metrics)) continue;
    const folder = join(destination, safeEntryId(old.renderer.id), safeEntryId(old.scene.id));
    for (const name of ['metrics.json', 'screenshot.avif']) await rm(join(folder, name), { force: true });
  }
  await mkdir(destination, { recursive: true });
  await cp(await viewerDirectory(), destination, { recursive: true });
  for (const ref of index.results) {
    await mkdir(join(destination, ref.renderer.id, ref.scene.id), { recursive: true });
    await cp(join(input, ref.metrics), join(destination, ref.metrics));
    if (ref.screenshot) await cp(join(input, ref.screenshot), join(destination, ref.screenshot));
    else await rm(join(destination, ref.renderer.id, ref.scene.id, 'screenshot.avif'), { force: true });
  }
  try {
    await cp(join(input, 'README.md'), join(destination, 'README.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await rm(join(destination, 'README.md'), { force: true });
  }
  await atomicWrite(join(destination, 'index.json'), JSON.stringify(index));
}
