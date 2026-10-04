# performance-kit

[Suite format](#adopt-it-in-your-suite) · [CLI reference](#use-it-during-development) · [Reporter API](#instrument-a-renderer) · [Contributing](CONTRIBUTING.md)

[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]
[![License][license-badge]][license-url]

**Benchmark renderer performance without building a reporting site.** performance-kit measures startup, frame pacing, responsiveness, and GPU costs, then turns raw run files into a browsable website. Use it for real-time renderer suites, performance reviews, and repeatable optimization comparisons.

Your renderer owns its render loop; performance-kit handles orchestration, storage, and the viewer. Run benchmarks on a GPU machine, inspect results locally, or export a static site. It is the performance companion to [fidelity-kit](https://github.com/bhouston/fidelity-kit).

## Quick start

From a checkout of this repository, use Node 26 and the pinned pnpm version:

```sh
pnpm install
pnpm build
pnpm cli run --suite examples/demo-suite.json --renderer-root examples --out results
pnpm cli dev --out results
```

Open the URL printed by `dev` (usually <http://localhost:4400>). The [demo suite](examples/demo-suite.json) renders a WebGL cube and a variant with deliberate setup and frame stalls. The viewer shows captures, setup phases, frame timelines, and detailed timing measurements. Search entries, filter renderer configurations or scenes, and sort by FPS, tail latency, jitter, or setup time.

The runner rejects software GPUs by default. Use `--allow-software` for functional checks only; those results do not establish hardware GPU performance. Add `--headful` to run visible Chrome or `--executable-path <path>` to choose an installed Chrome.

## See it in action

[Screen-Space Fidelity](https://github.com/bhouston/three-ss-fidelity) uses performance-kit alongside fidelity-kit to benchmark Three-Base and other real-time Three variants. Its performance suite runs each workload once with vsync off, and its results are independent of fidelity image results.

## Adopt it in your suite

Create a suite file with a flat list of entries. Every entry has a stable ID, name, renderer and scene metadata, a renderer URL, and a measurement duration:

```json
{
  "schemaVersion": 1,
  "name": "My Renderer Benchmarks",
  "defaults": { "vsync": "on" },
  "entries": [
    {
      "id": "cube-my-renderer",
      "name": "Cube · My Renderer",
      "renderer": { "id": "my-renderer", "name": "My Renderer" },
      "scene": { "id": "cube", "name": "Spinning cube" },
      "url": "http://127.0.0.1:4401/cube.html",
      "durationMs": 10000,
      "params": { "scene": "cube" }
    }
  ]
}
```

Instrument the renderer with the reporter API below, then run:

```sh
pnpm cli run --suite suite.json --renderer-root renderer-pages --out results
```

`params` pass through to the renderer verbatim. Each renderer/scene pair has one result; repeated runs replace it. Measurement starts immediately from ready, with no warmup. A suite must not contain duplicate renderer/scene pairs. Entry, renderer, and scene IDs use letters, numbers, `.`, `_`, or `-`, and start with a letter or number. Names are display text and may contain spaces. Give each renderer configuration its own ID, including variants such as `three-new--ssgi-half`, so the viewer and CLI can distinguish them. Use the generated [suite JSON Schema](packages/schema/schemas/suite.schema.json) for editor completion.

Each invocation writes a flat result folder:

```text
results/
  README.md                         optional Markdown preamble above the results
  <renderer.id>/
    <scene.id>/
      metrics.json                  processed statistics and bounded display data
      screenshot.avif               optional capture
```

Captures use the same settings as ss-fidelity: AVIF quality 90, chroma subsampling `4:4:4`, and alpha removed. The browser captures lossless PNG after the measured run ends; the runner then converts it to AVIF. Frames are measured immediately from ready, including the first rendering frames, with no warmup wait. Each renderer/scene pair runs once and saves compact metrics.json directly; new runs never write raw.json. Timeouts and errors are written as results, and `run` exits nonzero when any entry fails.

### Results preamble

Place an optional `README.md` in the results root. The viewer renders it below the navigation and above the results, with Markdown headings, paragraphs, lists, emphasis, code, and links. An empty or missing README hides the introduction. The viewer has no built-in introductory text.

`dev` and `serve` expose this file, and `build` includes it in the exported site. No suite configuration change is needed to add a preamble to existing results.

## Use it during development

The CLI is available from this source checkout through `pnpm cli`:

| Command                                                             | Use                                                                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm cli run --suite suite.json --out results`                     | Execute each workload once and save metrics. Add `--renderer my-renderer` or `--scene cube` to select stable IDs. |
| `pnpm cli process --out results`                                    | Validate raw files and save processed metrics plus the lightweight result index.                                  |
| `pnpm cli dev --out results`                                        | Watch saved results and the optional README, reload connected viewers, and highlight updated entries.             |
| `pnpm cli serve --out results`                                      | Serve saved results without watching files or opening a live channel.                                             |
| `pnpm cli build --out results --site site`                          | Export the viewer, processed metrics, captures, and optional preamble for static hosting.                         |
| `pnpm cli validate --suite suite.json`                              | Validate suite configuration. Use `--results results` to validate saved runs.                                     |
| `pnpm cli compare --a renderer=new --b renderer=base --out results` | Compare matching workloads in the terminal. Select renderer or scene IDs, or pass two result directories.         |

Run `pnpm cli <command> --help` for all options. `dev` uses server-sent events to refresh the viewer when result files or the optional README change, including files written by another process. Live reload is automatic in development. `dev` starts at `--port` (default 4400) and tries successive ports if occupied; open the actual URL printed at startup. `serve` uses only the configured port (default 4400) and fails if it is occupied. `serve` and static exports load the saved report without a live channel. The CLI computes and saves `metrics.json` before notifying the viewer. The viewer fetches only processed metrics and screenshots; static exports omit raw data.

If your suite includes a built toolkit checkout at `performance-kit/`, add scripts such as:

```json
{
  "scripts": {
    "performance:run": "node performance-kit/packages/cli/dist/bin.js run --suite suite.json --out performance-results",
    "performance:process": "node performance-kit/packages/cli/dist/bin.js process --out performance-results",
    "performance:dev": "node performance-kit/packages/cli/dist/bin.js dev --out performance-results",
    "performance:serve": "node performance-kit/packages/cli/dist/bin.js serve --out performance-results",
    "performance:build": "node performance-kit/packages/cli/dist/bin.js build --out performance-results --site performance-site"
  }
}
```

Static reports work on ordinary HTTP hosting, including a subdirectory. Serve the build over HTTP locally; browsers restrict data fetching from `file://` URLs.

## Instrument a renderer

The reporter is a no-op outside an authorized harness. Register setup and capture handlers, then bracket each frame:

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

Call `reporter.environment()` with the GPU adapter actually selected by the renderer, canvas size, and API. The runner adds host information and Chrome flags. The reporter imports schema types only; browser bundles do not load TypeBox or Ajv through it.

GPU helpers and the Three adapter are available in the reporter's `gpu` and `three` subpaths. Use `const gpu = reporter.gpu.attachThree(renderer)`, then `gpu.begin(token)` and `gpu.end()` around rendering. Raw GPU timestamps attach asynchronously to frames. WebGPU samples span the first to last instrumented pass across a frame's submitted encoders, with a bounded query ring. WebGL2 exposes elapsed queries only: endpoints use a local zero origin per sample and cannot be aligned across samples or to CPU time. Disjoint queries are discarded.

## Measurement and statistics

CPU timestamps are high-resolution epoch milliseconds tagged by domain. GPU values are decimal nanoseconds on a separate clock. Client durations are calculated within the client clock. Harness send/receive timestamps and clock-tagged message receipts are retained independently in the metrics timing context, in epoch seconds. There are no synchronization pings, offset/drift estimates or delivery discrepancy tables.

Cards summarize median FPS, tail latency, jitter, and setup time. FPS is the reciprocal of the median frame interval. Durations use readable units: short costs appear in milliseconds, while longer setup and phase durations appear in seconds.

Frame pacing uses consecutive frame-start differences inside the measured window. CPU submit time and GPU cost appear separately. Percentiles use linear interpolation at `(n − 1) p`; jitter is p75 − p25, and MAD is available in run details. Statistics use every measured raw sample before display series are reduced.

Timeline axes use elapsed seconds from the client start receipt. Every visible card timeline uses the longest timeline among the current filtered cards as its shared horizontal scale. Hovering a line chart shows elapsed time and the nearest frame's frame interval. Details include viewer-calculated framerate and setup watchdog responsiveness histograms, plus a Phases table with startup phase durations and total client setup time.

Metrics store consecutive `frameSeconds`, aligned `cpuSeconds` and `gpuSeconds`, and selected extrema indices for display. Exact measured `measuredIntervalSeconds` support CLI comparisons and browser histogram calculations without relying on rounded display timestamps. All durations use seconds; FPS remains frames per second. No histogram bins are stored on disk.

The CLI computes exact summaries before writing metrics for both static and development reports. Frame-time colors transition green at 16.7 ms, yellow at 33.3 ms, and red at 50 ms; responsiveness transitions at 50, 100, and 300 ms. Run `pnpm cli process --out results` to migrate historical raw results to version 2 metrics and rebuild the index. Existing raw files are retained during migration; new metrics are canonical once migrated. Version 1 metrics without their historical raw data require a new benchmark run. Legacy suite `warmupMs` is accepted but ignored; `repetitions: 1` is accepted for compatibility, and larger values are rejected. Use `capture` to control the end-of-run screenshot; the old `captureAfterWarmup` option is accepted as a fallback.

CLI A/B comparisons match scenes when comparing renderer IDs, renderer configurations when comparing scene IDs, and stable entry IDs when comparing directories. They pool frames for Mann–Whitney U and bootstrap whole runs for the median-ratio confidence interval, preserving within-run correlation. Mixed vsync modes are rejected. Small or single-run samples retain their uncertainty rather than establishing a speedup.

## Isolation and reproducibility

The default harness runs on `http://localhost:4400`, with local renderer files served on `http://127.0.0.1:4401`. These different sites allow out-of-process iframes. The runner applies COOP/COEP headers, a fixed viewport and DPR, and Chrome flags that disable background throttling. External renderers must supply compatible isolation and resource headers. `--isolation page` opens a dedicated renderer page as a cross-check.

Vsync defaults on. The off mode disables GPU vsync and the frame-rate limit; every result records the selected mode. Scheduling supports seeded shuffle, cooldown, and optional browser recycling.

Use a dedicated GPU machine with a fixed power policy, driver, and Chrome version for performance comparisons. The normal CI validates code. The manual [GPU workflow](.github/workflows/benchmark.yml) requires a runner labeled `self-hosted` and `gpu`, and uploads metrics plus static reports after the run, including failures.

## Development and releases

- `packages/cli` provides the `performance-kit` runner, server, static builder, and file-based yargs commands.
- `packages/reporter` provides browser instrumentation and GPU adapters.
- `packages/schema` provides TypeBox schemas, Ajv validation, metric derivation, and color scales.
- `packages/viewer` provides the React/Vite report website.

See [CONTRIBUTING.md](CONTRIBUTING.md). Required checks are `pnpm build`, `pnpm tsc`, `pnpm lint`, `pnpm test --coverage`, and `pnpm audit --audit-level=high`. Dependency audit findings are reviewed in [AUDIT.md](AUDIT.md); coverage reports are uploaded with the CI artifacts.

Changesets keeps the three public packages on a shared version. Add a changeset and run `pnpm version-packages`; a maintainer runs `pnpm release` with npm credentials after review. Publishing is not automatic. Suites and protocol envelopes use version 1; persisted metrics use version 2. Unknown future versions fail validation. Historical trends and additional browsers remain future extensions.

## Author

Created by [Ben Houston](https://github.com/bhouston).

[tests-badge]: https://github.com/bhouston/performance-kit/actions/workflows/ci.yml/badge.svg
[tests-url]: https://github.com/bhouston/performance-kit/actions/workflows/ci.yml
[coverage-badge]: https://img.shields.io/badge/Coverage-V8-2b77aa
[coverage-url]: https://github.com/bhouston/performance-kit/actions/workflows/ci.yml
[license-badge]: https://img.shields.io/github/license/bhouston/performance-kit
[license-url]: LICENSE

## Network measurements

The reporter observes the iframe's Resource Timing timeline as soon as it is
created, including buffered requests and the document's navigation entry.
`ready()` sends a `download-report` for completed load requests; the end of the
measurement sends a separate, incremental `post-load` report. Requests still in
flight at ready appear in post-load when they complete. Wire and decoded bytes,
category totals, and individual resources are retained in raw and processed
results. Cross-origin resources without Timing-Allow-Origin are counted as
unknown, rather than zero-byte downloads. Worker fetches have separate timelines
and are not included; inline/blob resources do not consume network bytes.
Create the reporter early: requests lost before reporter creation cannot be
recovered from a full browser resource buffer.

Select a profile with `defaults.networkProfile` in the suite JSON:

```json
{
  "defaults": { "networkProfile": "slow-4g" },
  "networkProfiles": [
    { "name": "unthrottled", "latencyMs": 0, "downloadBytesPerSec": -1, "uploadBytesPerSec": -1 },
    { "name": "slow-4g", "latencyMs": 150, "downloadBytesPerSec": 200000, "uploadBytesPerSec": 93750 }
  ]
}
```

If `networkProfiles` is omitted, built-in `unthrottled`, `fast-4g`, `slow-4g`,
and `3g` profiles are available. The default is `unthrottled`. Custom lists must
include the selected name (or `unthrottled` when no name is selected). Each run
disables HTTP cache and bypasses service workers. CDP conditions are applied
before navigation and to new request sessions, including out-of-process iframes,
through Puppeteer’s CDP network manager before those targets resume. Conditions use uniform per-request latency and
an approximate bandwidth cap. Profiles are stored in results, shown on cards,
and comparison refuses groups with different conditions or unrecorded profiles.
Run profiles into separate output directories; a profile matrix is not yet supported.

The fifth card metric, Download, shows total known transferred bytes across load
and post-load, formatted by `humanize-units`; cards can sort by Download.
Expand a result to see its SVG bandwidth chart and request waterfall. Dotted
lead-ins indicate waiting; colored bands estimate uniform byte arrival in
10 ms bins (adaptively wider for long runs). Integrating the bands preserves
known transfer bytes, including instantaneous responses assigned to one bin.
Startup requests before the start signal use negative times on the shared
frame/network time axis. Hidden sizes are listed separately. The CDN proxy is
outside this release's scope.
