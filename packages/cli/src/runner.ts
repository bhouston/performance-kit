import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer, { type Browser } from 'puppeteer';
import { ulid } from 'ulid';
import { assertMessageToHarness, assertManifest } from 'performance-kit-schema';
import type { RunResult, Environment } from 'performance-kit-schema';
import { harnessRun } from './harness.js';
import { chromeFlags, isSoftwareAdapter, scheduleSuite } from './schedule.js';
import { loadSuite, safeEntryId, updateLatest, writeRun } from './storage.js';
import { startServer } from './server.js';
export interface RunOptions {
  suite: string;
  out: string;
  renderer?: string[];
  scene?: string[];
  headful?: boolean;
  live?: boolean;
  host?: string;
  port?: number;
  rendererRoot?: string;
  rendererPort?: number;
  seed?: number;
  repetitions?: number;
  cooldownMs?: number;
  recycle?: number;
  width?: number;
  height?: number;
  isolation?: 'iframe' | 'page';
  allowSoftware?: boolean;
  executablePath?: string;
  failOnError?: boolean;
}
export async function deadline<T>(promise: Promise<T>, timeoutMs: number, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout during ${phase}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function runSuite(options: RunOptions): Promise<{ runset: string; results: RunResult[] }> {
  for (const [name, value] of [
    ['width', options.width],
    ['height', options.height],
    ['recycle', options.recycle],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1))
      throw new Error(`${name} must be a positive integer`);
  }
  if (options.cooldownMs !== undefined && (!Number.isFinite(options.cooldownMs) || options.cooldownMs < 0))
    throw new Error('cooldown-ms must be nonnegative');
  const suite = await loadSuite(options.suite);
  const schedule = scheduleSuite(suite, options);
  if (!schedule.length) throw new Error('No suite entries match the filters');
  for (const { entry } of schedule) safeEntryId(entry.id);
  const out = resolve(options.out);
  const runSetId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${ulid()}`;
  const runset = join(out, 'runsets', runSetId);
  await mkdir(runset, { recursive: true });
  const flags = chromeFlags(suite.defaults?.vsync ?? 'on');
  const host = { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown' };
  let gitCommit: string | undefined;
  try {
    gitCommit = (await promisify(execFile)('git-dedup', ['rev-parse', 'HEAD'])).stdout.trim();
  } catch {}
  const manifest = {
    schemaVersion: 1,
    runSetId,
    createdAt: new Date().toISOString(),
    suite,
    schedule: schedule.map(({ entry, repetition }) => ({ entryId: entry.id, repetition })),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    gitCommit,
    environment: {
      userAgent: 'pending browser launch',
      gpuTimestampsAvailable: false,
      crossOriginIsolated: false,
      devicePixelRatio: 1,
      host,
      chromeFlags: flags,
    } as Environment,
  };
  const server = await startServer({ out, host: options.host, port: options.port, live: options.live });
  let rendererServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let browser: Browser | undefined;
  const results: RunResult[] = [];
  try {
    if (options.rendererRoot)
      rendererServer = await startServer({
        out,
        host: '127.0.0.1',
        port: options.rendererPort ?? 4401,
        rendererRoot: options.rendererRoot,
      });
    console.log(`Report: ${server.url}${options.live ? '/live' : ''}\nRun set: ${runset}`);
    const launch = async () => {
      browser = await puppeteer.launch({
        headless: !options.headful,
        args: flags,
        executablePath: options.executablePath,
      });
      const probe = await browser.newPage();
      await probe.goto(server.url + '/harness');
      const gpu = await probe.evaluate(async () => {
        const nav = navigator as Navigator & {
          gpu?: {
            requestAdapter: () => Promise<{ info?: unknown; features?: Set<string> } | null>;
          };
        };
        const adapter = await nav.gpu?.requestAdapter();
        const info = adapter?.info as { vendor?: string; architecture?: string; description?: string } | undefined;
        const gl = document.createElement('canvas').getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          adapter: { vendor: info?.vendor, architecture: info?.architecture, description: info?.description },
          gpuTimestampsAvailable: adapter?.features?.has('timestamp-query') ?? false,
          crossOriginIsolated: globalThis.crossOriginIsolated,
          renderer: debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
          available: !!adapter || !!gl,
          api: adapter ? ('webgpu' as const) : ('webgl2' as const),
        };
      });
      await probe.close();
      manifest.environment = {
        ...manifest.environment,
        userAgent: await browser.userAgent(),
        gpuTimestampsAvailable: gpu.gpuTimestampsAvailable,
        crossOriginIsolated: gpu.crossOriginIsolated,
        gpuAdapter: gpu.adapter,
        api: gpu.api,
      };
      if (!gpu.available) throw new Error('No GPU API available in Chrome');
      if (isSoftwareAdapter(gpu) && !options.allowSoftware)
        throw new Error(
          `Software GPU rejected: ${JSON.stringify(gpu)}. Pass --allow-software only for functional testing.`,
        );
    };
    await launch();
    assertManifest(manifest);
    await writeFile(join(runset, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    for (let i = 0; i < schedule.length; i++) {
      if (i > 0 && options.recycle && i % options.recycle === 0) {
        await browser?.close();
        await launch();
      }
      const { entry, repetition } = schedule[i];
      const runId = ulid();
      const page = await browser!.newPage();
      await page.setViewport({
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        deviceScaleFactor: 1,
      });
      await page.exposeFunction('validateEnvelope', (message: unknown, bytes?: number[]) => {
        if (bytes) (message as { payload: { bytes: ArrayBuffer } }).payload.bytes = Uint8Array.from(bytes).buffer;
        assertMessageToHarness(message);
      });
      const url = new URL(entry.url, rendererServer?.url ?? server.url);
      url.searchParams.set('performanceKitRunId', runId);
      url.searchParams.set('performanceKitOrigin', new URL(server.url).origin);
      const input = {
        runId,
        url: url.href,
        entryId: entry.id,
        params: entry.params ?? {},
        warmupMs: entry.warmupMs ?? suite.defaults?.warmupMs ?? 2000,
        durationMs: entry.durationMs,
        setupTimeoutMs: suite.defaults?.setupTimeoutMs ?? 60000,
        capture: suite.defaults?.captureAfterWarmup ?? true,
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        isolation: options.isolation ?? 'iframe',
      };
      console.log(`[${i + 1}/${schedule.length}] ${entry.id} repetition ${repetition}`);
      server.publish({ type: 'start', entryId: entry.id, repetition });
      let payload: Awaited<ReturnType<typeof harnessRun>>;
      try {
        if (options.isolation === 'page') {
          await page.evaluateOnNewDocument(
            (source, runInput) => {
              (window as unknown as { __performanceKitResult: Promise<unknown> }).__performanceKitResult = new Function(
                `return (${source})`,
              )()(runInput);
            },
            harnessRun.toString(),
            input,
          );
          await page.goto(url.href, {
            waitUntil: 'domcontentloaded',
            timeout: input.setupTimeoutMs,
          });
          payload = await deadline(
            page.evaluate(
              async () =>
                await (
                  window as unknown as {
                    __performanceKitResult: Promise<Awaited<ReturnType<typeof harnessRun>>>;
                  }
                ).__performanceKitResult,
            ),
            input.setupTimeoutMs * 3 + input.durationMs + input.warmupMs + 10000,
            'renderer page run',
          );
        } else {
          await page.goto(server.url + '/harness');
          payload = await deadline(
            page.evaluate(harnessRun, input),
            input.setupTimeoutMs * 3 + input.durationMs + input.warmupMs + 10000,
            'iframe run',
          );
        }
      } catch (error) {
        const timestamp = Date.now();
        payload = {
          harness: { iframeCreated: timestamp, startSent: timestamp, teardown: timestamp },
          reporter: { frames: [] },
          messages: [],
          clockSync: { samples: [] },
          environment: {},
          status: /timeout/i.test((error as Error).message) ? 'timeout' : 'error',
          error: { message: (error as Error).message },
          capture: undefined,
        };
      }
      const capture = payload.capture;
      const environment = {
        ...manifest.environment,
        userAgent: manifest.environment.userAgent,
        gpuTimestampsAvailable: manifest.environment.gpuTimestampsAvailable,
        crossOriginIsolated: await deadline(
          page.evaluate(() => crossOriginIsolated),
          2000,
          'isolation probe',
        ).catch(() => false),
        devicePixelRatio: 1,
        chromeFlags: flags,
        host,
        gitCommit,
        ...(payload.environment as Partial<Environment>),
      };
      if (isSoftwareAdapter(environment.gpuAdapter) && !options.allowSoftware) {
        payload.status = 'error';
        payload.error = {
          message: `Renderer selected a software GPU: ${JSON.stringify(environment.gpuAdapter)}. Pass --allow-software only for functional testing.`,
        };
      }
      const result = {
        schemaVersion: 1,
        runId,
        suiteName: suite.name,
        entry: { id: entry.id, name: entry.name, renderer: entry.renderer, scene: entry.scene, url: entry.url },
        repetition,
        config: {
          durationMs: entry.durationMs,
          warmupMs: input.warmupMs,
          vsync: suite.defaults?.vsync ?? 'on',
        },
        environment,
        harness: payload.harness,
        clockSync: payload.clockSync,
        messages: payload.messages,
        reporter: payload.reporter,
        status: payload.status,
        ...(payload.error ? { error: payload.error } : {}),
        ...(capture ? { capture: { file: `rep-${repetition}.avif`, at: capture.at } } : {}),
      } as RunResult;
      await page.close();
      const file = await writeRun(runset, result, capture ? Uint8Array.from(capture.bytes) : undefined);
      results.push(result);
      server.publish({ type: 'run', result, file });
      if (i + 1 < schedule.length) await new Promise((done) => setTimeout(done, options.cooldownMs ?? 2000));
    }
    await updateLatest(out, runSetId);
  } finally {
    await browser?.close();
    await rendererServer?.close();
    await server.close();
  }
  if (options.failOnError !== false && results.some((result) => result.status !== 'ok')) process.exitCode = 1;
  return { runset, results };
}
