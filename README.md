# performance-kit

Raw, filesystem-first performance benchmarks for real-time renderers. Companion to [fidelity-kit](https://github.com/bhouston/fidelity-kit): measure startup, frame pacing, responsiveness and GPU costs, then inspect a portable report.

## Workspace

- `packages/cli` → `performance-kit`: Puppeteer runner, static report builder, report/live server and file-based yargs commands.
- `packages/reporter` → `performance-kit-reporter`: browser instrumentation with type-only schema imports and no runtime schema loading. No-op outside an authorized harness.
- `packages/schema` → `performance-kit-schema`: TypeBox schemas, Ajv validation, pure metric derivation and shared color scales.
- `packages/viewer`: independent React/Vite report UI with timeline cards, run details and comparisons.

Use Node 26 and the pinned pnpm version. Start with `pnpm install && pnpm build`.

```sh
# Try the actual WebGL demo: smooth cube versus deliberate setup/frame stalls.
pnpm cli run --suite examples/demo-suite.json --renderer-root examples --out results
pnpm cli serve --out results
pnpm cli build --out results --site site
pnpm cli validate --suite examples/demo-suite.json
pnpm cli validate --results results
pnpm cli compare --a results-a --b results-b
```

The runner rejects software GPUs by default. `--allow-software` is for functional smoke checks; software results cannot establish GPU performance. `--headful` runs visible Chrome, `--live` exposes a separate `/live` reader, and `--filter renderer=value` selects labels. Run `pnpm cli <command> --help` for complete options.

## Instrument a renderer

```ts
import { createReporter } from 'performance-kit-reporter';
const reporter = createReporter();
reporter.onStart(async ({ params }) => {
  reporter.phaseStart('load');
  await loadAssets(params);
  reporter.phaseEnd('load');
  reporter.phaseStart('compile');
  await compilePipelines();
  reporter.phaseEnd('compile');
  reporter.ready();
  requestAnimationFrame(render);
});
reporter.onCapture(async () => {
  await renderAndFinish();
  return canvas;
});
function render() {
  const token = reporter.frameBegin({ animationTime: sceneTime });
  renderer.render(scene, camera);
  reporter.frameEnd(token);
  requestAnimationFrame(render);
}
```

The reporter depends on `performance-kit-schema` so its published TypeScript declarations resolve for consumers. Its source imports schema types with `import type`, which is erased in JavaScript; browser bundles never load TypeBox or Ajv through the reporter.

The renderer owns its loop; the reporter bounds measurement with its own clock. Warmup records stay on disk but are excluded from run statistics. Capture happens after warmup and before the measured window. Call `reporter.environment()` with the adapter actually selected by the renderer, canvas size and API. The runner supplements browser information with host and Chrome flags. GPU helpers and the Three adapter live in the reporter's `gpu` and `three` subpaths. Use `const gpu = reporter.gpu.attachThree(renderer)`, then `gpu.begin(token)` / `gpu.end()` around rendering; raw timestamps attach asynchronously to the frame. WebGPU samples span the first to last instrumented pass across a frame's submitted encoders (up to 64 passes per encoder, bounded query ring). WebGL2 exposes elapsed queries only: its endpoints use a local zero origin per sample and must never be aligned across samples or to CPU time. Disjoint queries are discarded.

## Suite and raw artifacts

A suite is a flat list of stable IDs, names, URLs, labels, run duration and optional params. Repetitions default to three, warmup to two seconds, and order to interleaved. `params` pass through verbatim. Use the generated `packages/schema/schemas/suite.schema.json` for editor completion. See [the demo suite](examples/demo-suite.json).

Each invocation creates `runsets/<timestamp>_<id>/manifest.json`, a suite/schedule snapshot, and `runs/<entry-id>/rep-<n>.json` with optional adjacent AVIF captures. Captures use the same settings as ss-fidelity: quality 90, chroma subsampling `4:4:4`, and alpha removed. Browser capture transport remains lossless PNG before the measured window; the runner converts it to AVIF after measurement finishes. `latest.json` points to the newest run set. Writers append; they never store medians, percentages or durations. Report builds create an `index.json` for loading raw results efficiently and preserve raw JSON links. Static reports work on ordinary HTTP hosting, including a subdirectory. Serve the build over HTTP locally; browsers restrict fetching from `file://` URLs.

## Measurement and statistics

CPU timestamps are high-resolution epoch milliseconds tagged by domain; GPU values are decimal nanoseconds on a separate clock. Clock offset is derived using the minimum-round-trip sync sample. Never subtract clocks without this correction. Frame pacing uses consecutive frame-start differences inside the measured window; CPU submit and GPU cost appear separately. Percentiles use linear interpolation at `(n − 1) p`. Jitter is p75 − p25; MAD is also available.

Reports derive setup latency, phase durations, watchdog lateness, merged blocked intervals, message-delivery latency and harness/reporter discrepancies from raw timestamps. Repetition summaries use the median of run medians and flag spread above 5%. A/B comparison pools frames for Mann–Whitney U, while the ratio confidence interval bootstraps whole runs to preserve within-run correlation. Mixed vsync modes are rejected. Small or single-run samples should be interpreted with the displayed uncertainty and sample counts.

The frame-time scale transitions green (16.7 ms) → yellow (33.3 ms) → red (50 ms). Responsiveness transitions at 50, 100 and 300 ms. Both static/live timelines share the exact derivation and color modules. The harness remains idle during measurement; live charts run in a separate page.

## Isolation and reproducibility

The default harness is `http://localhost:4400`, with local renderer files served at `http://127.0.0.1:4401`. These different sites allow out-of-process iframes. COOP/COEP headers and a fixed viewport/DPR are applied; browser flags disable background throttling. External renderers must supply compatible isolation/resource headers. `--isolation page` opens a dedicated renderer page as a cross-check. Vsync defaults on; off disables GPU vsync and the frame-rate limit, and is recorded in each result.

Use a dedicated physical GPU machine, fixed power policy, driver and bundled Chrome version for performance comparisons. The normal CI validates code; the manual [GPU workflow](.github/workflows/benchmark.yml) requires a runner labeled `self-hosted` and `gpu` and uploads raw results plus static reports even after failures. Timeouts and errors are written as results; run exits nonzero when any entry fails.

## Development and releases

See [CONTRIBUTING.md](CONTRIBUTING.md). Required checks: `pnpm build`, `pnpm tsc`, `pnpm lint`, `pnpm test --coverage`, and `pnpm audit --audit-level=high`. Changesets keeps the three public packages on a shared version. Add a changeset, run `pnpm version-packages`, then a maintainer runs `pnpm release` with npm credentials after review. Nothing publishes automatically.

The v1 format is the first supported schema/protocol version. Unknown future versions fail validation rather than silently being reinterpreted. Historical trend UI and additional browsers remain future extensions; existing run sets retain enough stable IDs and raw data for those readers.
