# performance-kit-schema

TypeBox definitions, TypeScript types, and Ajv validators for suites, raw benchmark results, processed report metrics, and browser protocol messages. Published JSON Schema files live under `schemas/`.

Every suite entry and raw or processed result entry identifies its renderer and scene explicitly:

```json
{
  "renderer": { "id": "three-base", "name": "Three Base" },
  "scene": { "id": "cornell-metallic", "name": "Cornell metallic sphere" }
}
```

The required references use `NamedEntity` (`NamedEntityType`) and `NamedEntitySchema`. Stable IDs begin with an ASCII letter or digit and continue with letters, digits, periods, underscores, or hyphens. Friendly names appear in the Renderers and Scenes navigation. `SuiteEntry` aliases `Entry`.

## Raw data and processed metrics

Each renderer/scene pair has one folder:

```text
results/<renderer.id>/<scene.id>/
  screenshot.avif
  raw.json
  metrics.json
```

`RunResult` describes `raw.json`: original frame records, clock synchronization, phase marks, responsiveness records, and environment metadata. It does not contain derived statistics.

`ProcessedResult` describes `metrics.json`: exact statistics and display-ready timeline, histogram, and detail data. It contains no raw frames, message logs, harness stamps, or clock-sync samples. `screenshot` indicates whether the fixed screenshot asset exists. `validateProcessedResult` returns an Ajv boolean; `assertProcessedResult` throws a descriptive validation error.

```ts
import { processRun } from 'performance-kit-schema/process';
import { assertProcessedResult } from 'performance-kit-schema';
const metrics = processRun(rawResult);
assertProcessedResult(metrics);
```

The CLI preprocesses raw results with `processRun`; browsers read only metrics and images. Statistics and histogram counts use every measured raw observation before display reduction. Warmup frames remain excluded. Medians, percentiles, jitter, CPU/GPU summaries, setup statistics, and phase totals are exact full-data calculations.

Timeline coordinates are relative seconds, corrected to the harness start when clock sync is available. Minimal results without sync use a reporter-local origin and omit cross-clock setup estimates. Block and script durations are already computed for display.

`frameSeconds` stores one relative timestamp for every consecutive measured frame, including the final frame. CPU and GPU costs use aligned `cpuMs` and `gpuMs` arrays; unavailable values are `null`. Times round to four decimal places (0.1 ms), and costs round to two decimal places (0.01 ms). `frameIndices` selects at most 1,536 frame indices using a union of interval, CPU, and GPU extrema. The viewer draws those indices and computes each displayed interval using timestamp `i + 1` minus timestamp `i`; it never subtracts two decimated samples, which would invent gaps.

`watchdogSeconds` contains setup tick timestamps through the ready mark when available, retaining each plotted tick's actual predecessor. `watchdogIndices` selects at most 512 endpoints; `watchdogPeriodMs: 16` lets the viewer display lateness as the adjacent timestamp difference minus 16 ms. These are display transformations only; all summary statistics remain precomputed from full-precision raw data.

The timeline declares `timeUnit: "seconds"` and `valueUnit: "milliseconds"`. Phase, block, and script start/end coordinates use the same seconds precision; precomputed `durationMs` and summary statistics keep their full precision. Adjacent rounded timestamps may introduce at most 0.1 ms of display rounding error, without changing summary statistics.

`downsampleExtrema` selects each chronological bucket's minimum and maximum and both endpoints. Timestamp arrays themselves are never decimated. Histograms contain at most 40 bins; details retain at most 128 phases, 256 blocks, 256 script attributions, and 256 discrepancies. Longest blocks and scripts and largest discrepancies are retained, while full-data setup and phase summaries remain exact.
