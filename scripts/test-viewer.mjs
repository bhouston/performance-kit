import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + '/packages/cli/package.json');
const { default: puppeteer } = await import(pathToFileURL(require.resolve('puppeteer')));
const { writeRun, buildReport } = await import(pathToFileURL(root + '/packages/cli/dist/storage.js'));
const { startServer } = await import(pathToFileURL(root + '/packages/cli/dist/server.js'));
const temp = await mkdtemp(join(tmpdir(), 'viewer-smoke-'));
let browser, server;
try {
  for (let i = 0; i < 8; i++) {
    const init = 100 + i * 100,
      frame = 10 + i * 5;
    await writeRun(temp, {
      schemaVersion: 1,
      runId: `run-${i}`,
      entry: {
        id: `entry-${i}`,
        name: `Entry ${i}`,
        renderer: { id: `renderer-${i}`, name: `Renderer ${i}` },
        scene: { id: 'cube', name: 'Cube' },
        url: '/cube',
      },
      networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
      config: { durationMs: 4000, vsync: 'on', phaseColors: { assets: '#8b5cf6' } },
      harness: { teardown: 5.2 },
      reporter: {
        navigationStart: 0,
        ready: init / 1000,
        renderStart: init / 1000,
        runStart: init / 1000,
        runEnd: i === 7 ? 4.6 : 5,
        frames: Array.from({ length: 80 }, (_, n) => ({
          cpuStart: (init + n * frame) / 1000,
          cpuEnd: (1 + init + n * frame) / 1000,
        })),
        phases: [
          {
            id: 0,
            phase: 'assets',
            start: { clock: 'reporter', t: 0 },
            end: { clock: 'reporter', t: init / 2000 },
          },
          {
            id: 1,
            phase: 'assets',
            start: { clock: 'reporter', t: init / 2000 },
            end: { clock: 'reporter', t: init / 1000 },
          },
        ],
        watchdogTicks: [0, 0.016, 0.05, 0.08, 0.096],
      },
      status: 'ok',
    });
  }
  await buildReport(temp, temp + '-site');
  server = await startServer({ out: temp + '-site', port: 0 });
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.PERFORMANCE_KIT_CHROME_PATH });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 0 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => {
    window.__chartLabels = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__chartLabels.push({
        text: String(text),
        chart: this.canvas.getAttribute('aria-label'),
        x: args[0],
        width: this.canvas.clientWidth,
        inkWidth: this.measureText(text).width,
        alignment: this.textAlign,
      });
      return original.call(this, text, ...args);
    };
  });
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card');
  assert.equal(await page.$$eval('.card:first-of-type .phase-legend span', (nodes) => nodes.length), 1);
  const ids = () => page.$$eval('.card', (nodes) => nodes.map((n) => n.id));
  assert.equal((await ids())[0], '10-renderer-0-cube');
  await page.select('[aria-label="Sort cards"]', 'avgFrameRate');
  await page.select('[aria-label="Sort direction"]', 'worstFirst');
  await page.waitForFunction(() => document.querySelector('.card')?.id === '10-renderer-7-cube');
  assert.match(page.url(), /sort=avgFrameRate/);
  assert.match(page.url(), /dir=worstFirst/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card');
  assert.equal((await ids())[0], '10-renderer-7-cube');
  await page.evaluate(() => window.scrollTo(0, 650));
  const scroll = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => document.querySelector('.card-link').click());
  await page.waitForSelector('.detail');
  assert.match(page.url(), /result=10-renderer-7-cube/);
  assert.equal(await page.$$('.card').then((nodes) => nodes.length), 0);
  const detailURL = page.url();
  await page.evaluate(() => {
    window.__chartLabels = [];
  });
  await page.setViewport({ width: 1390, height: 1000 });
  assert.equal(await page.$eval('.detail h2', (node) => node.textContent), 'Setup and frame timing · ms');
  assert.equal(await page.$$eval('.detail canvas.timeline', (nodes) => nodes.length), 1);
  assert.equal(await page.$$eval('.detail .detail-grid tbody tr', (nodes) => nodes.length), 2);
  assert.equal(
    await page.$eval('.detail .detail-grid tbody tr', (node) => node.textContent.replace(/\s/g, '')),
    'assets800ms',
  );
  assert.equal(
    await page.$eval('.detail .detail-grid section:first-child h3', (node) => node.textContent),
    'Rendering Histogram',
  );
  assert.equal(
    await page.$eval('.detail .detail-grid section:nth-child(2) h3', (node) => node.textContent),
    'Responsiveness Histogram',
  );
  assert.equal(
    await page.$eval('[aria-label="Breadcrumb"] [aria-current="page"]', (node) => node.textContent),
    'Renderer 7 · Cube',
  );
  await page.waitForFunction(() => window.__chartLabels.some((x) => x.text.startsWith('average ')));
  const draws = await page.evaluate(() => window.__chartLabels);
  const labels = draws.map((x) => x.text);
  assert(!draws.filter((x) => x.chart.startsWith('Init Responsiveness')).some((x) => /^(average |P95 )/.test(x.text)));
  assert(labels.some((x) => x.startsWith('P95 ')));
  assert(labels.some((x) => x.startsWith('init done ')));
  assert(labels.some((x) => x.endsWith('fps')));
  assert(labels.includes('1'));
  assert(labels.includes('2'));
  assert(labels.includes('ms'));
  assert(!labels.includes('5')); // This run ends at 4.6s despite other cards extending to 5s.
  for (const item of draws.filter(
    (label) => /^(average |P95 |init done )/.test(label.text) || (/^\d+$/.test(label.text) && label.x >= 44),
  )) {
    const right =
      item.x + (item.alignment === 'right' ? 0 : item.alignment === 'center' ? item.inkWidth / 2 : item.inkWidth);
    const left = right - item.inkWidth;
    assert(left >= 44 - 1 && right <= item.width - 16 + 1, `Label outside plot: ${item.text}`);
  }
  await page.screenshot({
    path: process.env.PERFORMANCE_KIT_SCREENSHOT_DIR
      ? join(process.env.PERFORMANCE_KIT_SCREENSHOT_DIR, 'detail.png')
      : join(temp, 'detail.png'),
    fullPage: true,
  });
  await page.click('[aria-label="Breadcrumb"] a');
  await page.waitForSelector('.card');
  await page.waitForFunction((expected) => Math.abs(window.scrollY - expected) < 3, {}, scroll);
  assert.equal((await ids())[0], '10-renderer-7-cube');
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(server.url, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await page.hover('.result-name');
  await page.click('.bookmark');
  assert.match(page.url(), /#10-renderer-7-cube$/);
  await page.waitForFunction(() => document.querySelector('.bookmark')?.textContent === 'Copied', { timeout: 5000 });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), page.url());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card');
  const top = await page.$eval('.card', (node) => node.getBoundingClientRect().top);
  assert(top >= 0 && top < 250);
  await page.goto(detailURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.detail');
  await page.select('[aria-label="Timing series"]', 'cpu');
  await page.select('[aria-label="Timing series"]', 'gpu');
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: join(temp, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.screenshot({ path: join(temp, 'dark.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: sorting/reload, card navigation, cold detail URL, back scroll, bookmark/clipboard, chart labels, CPU/GPU selector, mobile layout, dark theme, static config transport',
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(temp, { recursive: true, force: true });
  await rm(temp + '-site', { recursive: true, force: true });
}
