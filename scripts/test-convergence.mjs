// Functional browser coverage of reference loading, reporter cadence, protocol, storage and portable viewer.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const sharp = require('sharp');
const puppeteer = require('puppeteer');
const { runSuite } = await import('../packages/cli/dist/runner.js');
const { buildReport } = await import('../packages/cli/dist/storage.js');
const { startServer } = await import('../packages/cli/dist/server.js');
const temp = await mkdtemp(join(tmpdir(), 'convergence-browser-'));
let browser, server;
try {
  const app = join(temp, 'app'),
    out = join(temp, 'results'),
    site = join(temp, 'site');
  await mkdir(app);
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000000' } })
    .png()
    .toFile(join(temp, 'reference.png'));
  await writeFile(
    join(app, 'index.html'),
    `<!doctype html><canvas width="2" height="2"></canvas><script type="module">
import {createReporter} from '/reporter/index.js';
const reporter=createReporter(), canvas=document.querySelector('canvas'), context=canvas.getContext('2d');
if(reporter.params.badSize)canvas.width=3;
await reporter.convergence(canvas);
reporter.ready();
const start=performance.now();
function draw(){const token=reporter.frameBegin(); const red=Math.max(0, Math.round(220-(performance.now()-start)));
context.fillStyle='rgb('+red+',0,0)';context.fillRect(0,0,2,2);reporter.frameEnd(token);
if(reporter.running)requestAnimationFrame(draw);}
requestAnimationFrame(draw);
reporter.onCapture(()=>canvas);
</script>`,
  );
  const entries = ['quality', 'plain', 'bad'].map((id) => ({
    id,
    name: id,
    renderer: { id, name: id },
    scene: { id: 'toy', name: 'Toy' },
    url: '/index.html',
    durationMs: 500,
    params: id === 'bad' ? { badSize: true } : {},
    ...(id !== 'plain' ? { reference: { image: './reference.png', intervalMs: 50, targetPsnr: 30 } } : {}),
  }));
  const suite = join(temp, 'suite.json');
  await writeFile(suite, JSON.stringify({ schemaVersion: 1, name: 'Convergence fixture', entries }));
  const { results } = await runSuite({
    suite,
    out,
    rendererRoot: app,
    rendererPort: 0,
    width: 64,
    height: 64,
    cooldownMs: 0,
    allowSoftware: true,
    executablePath: process.env.PERFORMANCE_KIT_CHROME_PATH,
    failOnError: false,
  });
  assert(results.filter((result) => result.entry.renderer.id !== 'bad').every((result) => result.status === 'ok'));
  const failure = results.find((result) => result.entry.renderer.id === 'bad');
  assert.equal(failure.status, 'error');
  assert.match(failure.error.message, /dimensions must match/);
  assert.deepEqual(failure.reporter.frames, []);
  const quality = JSON.parse(await readFile(join(out, 'quality/toy/metrics.json'), 'utf8'));
  const plain = JSON.parse(await readFile(join(out, 'plain/toy/metrics.json'), 'utf8'));
  assert(quality.convergence.samples.length >= 4);
  assert(quality.convergence.samples.some((sample) => sample.psnr === null));
  assert(quality.convergence.timeToTarget > 0 && quality.convergence.timeToTarget < 0.5);
  assert.equal(plain.convergence, undefined);
  assert((await sharp(join(out, 'quality/toy/diff.png')).stats()).channels.every((channel) => channel.max === 0));
  await buildReport(out, site);
  server = await startServer({ out: site, port: 0 });
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.PERFORMANCE_KIT_CHROME_PATH });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1400, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    window.__qualityLabels = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__qualityLabels.push(String(text));
      return original.call(this, text, ...args);
    };
  });
  await page.goto(server.url);
  await page.waitForSelector('.convergence-badge');
  assert.equal(await page.$$eval('.convergence-badge', (nodes) => nodes.length), 1);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.card img')].every((image) => image.complete && image.naturalWidth > 0),
  );
  assert.equal(await page.$$eval('.card img[alt$=" reference"]', (nodes) => nodes.length), 1);
  assert.equal(await page.$$eval('.card img[alt$=" difference"]', (nodes) => nodes.length), 1);
  assert(await page.evaluate(() => window.__qualityLabels.includes('PSNR dB')));
  assert(!(await page.$eval('body', (node) => node.textContent.toLowerCase())).includes('overhead'));
  await page.select('[aria-label="Sort cards"]', 'timeToTarget');
  await page.waitForFunction(() => document.querySelector('.card')?.id === '7-quality-toy');
  await page.screenshot({
    path: process.env.PERFORMANCE_KIT_CONVERGENCE_SCREENSHOT ?? '/tmp/performance-kit-convergence.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Convergence browser fixture passed: cadence, exact matches, target time, optional runs, portable assets and chart.',
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(temp, { recursive: true, force: true });
}
