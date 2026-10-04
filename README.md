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

Open the URL printed by `dev` (usually <http://localhost:4400>). The [demo suite](examples/demo-suite.json) renders a WebGL cube and a variant with deliberate setup and frame stalls. The viewer shows captures, setup phases, frame timelines, and repetition details. Search entries, filter renderer configurations or scenes, and sort by frame time, tail latency, jitter, or setup time.

The runner rejects software GPUs by default. Use `--allow-software` for functional checks only; those results do not establish hardware GPU performance. Add `--headful` to run visible Chrome or `--executable-path <path>` to choose an installed Chrome.

## See it in action

[Screen-Space Fidelity](https://github.com/bhouston/three-ss-fidelity) uses performance-kit alongside fidelity-kit to benchmark Three-Base and other real-time Three variants. Its performance suite uses one repetition with vsync off, and its run sets are independent of fidelity image results.

## Adopt it in your suite

Create a suite file with a flat list of entries. Every entry has a stable ID, name, renderer and scene metadata, a renderer URL, and a measurement duration:

```json
{
  "schemaVersion": 1,
  "name": "My Renderer Benchmarks",
  "defaults": { "warmupMs": 2000, "repetitions": 3, "vsync": "on" },
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

`params` pass through to the renderer verbatim. Repetitions default to three, warmup to two seconds, and scheduling to interleaved order. Entry, renderer, and scene IDs use letters, numbers, `.`, `_`, or `-`, and start with a letter or number. Names are display text and may contain spaces. Give each renderer configuration its own ID, including variants such as `three-new--ssgi-half`, so the viewer and CLI can distinguish them. Use the generated [suite JSON Schema](packages/schema/schemas/suite.schema.json) for editor completion.

Each invocation appends a self-contained run set:

```text
results/
  README.md                         optional Markdown preamble above the results
  latest.json                       pointer to the newest run set
  runsets/
    <timestamp>_<id>/
      manifest.json                 suite, schedule, seed, commit, and environment
      runs/
        cube-my-renderer/
          rep-1.json                raw timestamps and run status
          rep-1.avif                optional capture
          rep-2.json
          rep-2.avif
```

Captures use the same settings as ss-fidelity: AVIF quality 90, chroma subsampling `4:4:4`, and alpha removed. The browser captures lossless PNG after warmup and before the measured window; the runner converts it to AVIF after measurement finishes. Warmup frames stay on disk but are excluded from measured statistics. Timeouts and errors are written as results, and `run` exits nonzero when any entry fails.

### Results preamble

Place an optional `README.md` in the results root. The viewer renders it below the navigation and above the results, with Markdown headings, paragraphs, lists, emphasis, code, and links. An empty or missing README hides the introduction. The viewer has no built-in introductory text.

`dev` and `serve` expose this file, and `build` includes it in the exported site. No suite configuration change is needed to add a preamble to existing results.

## Use it during development

The CLI is available from this source checkout through `pnpm cli`:

| Command                                                             | Use                                                                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm cli run --suite suite.json --out results`                     | Execute the suite and append a raw run set. Add `--renderer my-renderer` or `--scene cube` to select stable IDs. |
| `pnpm cli dev --out results`                                        | Watch saved results and the optional README, reload connected viewers, and highlight updated entries.            |
| `pnpm cli serve --out results`                                      | Serve saved results without watching files or opening a live channel.                                            |
| `pnpm cli build --out results --site site`                          | Export the viewer, raw results, captures, and optional preamble for static hosting.                              |
| `pnpm cli validate --suite suite.json`                              | Validate suite configuration. Use `--results results` to validate saved runs.                                    |
| `pnpm cli compare --a renderer=new --b renderer=base --out results` | Compare matching workloads in the terminal. Select renderer or scene IDs, or pass two run-set directories.       |

Run `pnpm cli <command> --help` for all options. `dev` uses server-sent events to refresh the viewer when result files or the optional README change, including files written by another process. Live reload is automatic in development. `serve` and static exports load the saved report without a live channel. The report derives metrics from raw data instead of storing statistics in result files.

If your suite includes a built toolkit checkout at `performance-kit/`, add scripts such as:

```json
{
  "scripts": {
    "performance:run": "node performance-kit/packages/cli/dist/bin.js run --suite suite.json --out performance-results",
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

CPU timestamps are high-resolution epoch milliseconds tagged by domain. GPU values are decimal nanoseconds on a separate clock. Clock offset uses the minimum-round-trip sync sample; timestamps from different clocks are corrected before comparison.

Frame pacing uses consecutive frame-start differences inside the measured window. CPU submit time and GPU cost appear separately. Percentiles use linear interpolation at `(n − 1) p`; jitter is p75 − p25, and MAD is available in run details. Repetition summaries use the median of per-run medians and flag spread above 5%.

The report derives setup latency, phase durations, watchdog lateness, merged blocked intervals, message-delivery latency, and harness/reporter discrepancies from raw timestamps. Frame-time colors transition green at 16.7 ms, yellow at 33.3 ms, and red at 50 ms; responsiveness transitions at 50, 100, and 300 ms. Static and development timelines share the derivation and color modules.

CLI A/B comparisons match scenes when comparing renderer IDs, renderer configurations when comparing scene IDs, and stable entry IDs when comparing directories. They pool frames for Mann–Whitney U and bootstrap whole runs for the median-ratio confidence interval, preserving within-run correlation. Mixed vsync modes are rejected. Small or single-run samples retain their uncertainty rather than establishing a speedup.

## Isolation and reproducibility

The default harness runs on `http://localhost:4400`, with local renderer files served on `http://127.0.0.1:4401`. These different sites allow out-of-process iframes. The runner applies COOP/COEP headers, a fixed viewport and DPR, and Chrome flags that disable background throttling. External renderers must supply compatible isolation and resource headers. `--isolation page` opens a dedicated renderer page as a cross-check.

Vsync defaults on. The off mode disables GPU vsync and the frame-rate limit; every result records the selected mode. Scheduling supports interleaved repetitions, seeded shuffle, cooldown, and optional browser recycling.

Use a dedicated GPU machine with a fixed power policy, driver, and Chrome version for performance comparisons. The normal CI validates code. The manual [GPU workflow](.github/workflows/benchmark.yml) requires a runner labeled `self-hosted` and `gpu`, and uploads raw results plus static reports after the run, including failures.

## Development and releases

- `packages/cli` provides the `performance-kit` runner, server, static builder, and file-based yargs commands.
- `packages/reporter` provides browser instrumentation and GPU adapters.
- `packages/schema` provides TypeBox schemas, Ajv validation, metric derivation, and color scales.
- `packages/viewer` provides the React/Vite report website.

See [CONTRIBUTING.md](CONTRIBUTING.md). Required checks are `pnpm build`, `pnpm tsc`, `pnpm lint`, `pnpm test --coverage`, and `pnpm audit --audit-level=high`. Dependency audit findings are reviewed in [AUDIT.md](AUDIT.md); coverage reports are uploaded with the CI artifacts.

Changesets keeps the three public packages on a shared version. Add a changeset and run `pnpm version-packages`; a maintainer runs `pnpm release` with npm credentials after review. Publishing is not automatic. The v1 format is the first supported schema/protocol version; unknown future versions fail validation. Historical trends and additional browsers remain future extensions.

## Author

Created by [Ben Houston](https://github.com/bhouston).

[tests-badge]: https://github.com/bhouston/performance-kit/actions/workflows/ci.yml/badge.svg
[tests-url]: https://github.com/bhouston/performance-kit/actions/workflows/ci.yml
[coverage-badge]: https://img.shields.io/badge/Coverage-V8-2b77aa
[coverage-url]: https://github.com/bhouston/performance-kit/actions/workflows/ci.yml
[license-badge]: https://img.shields.io/github/license/bhouston/performance-kit
[license-url]: LICENSE
