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
  metrics.json
```

`RunResult` is the in-memory collection input to `processRun`, used during collection. Collection performs no clock synchronization.

`ProcessedResult` describes canonical version 2 metrics.json: exact statistics, compact timeline and detail data, and independent harness/client timing context. It stores no raw frame objects, clock sync samples, delivery discrepancies or histogram bins. `screenshot` indicates the fixed screenshot asset. `validateProcessedResult` returns an Ajv boolean; `assertProcessedResult` throws a descriptive validation error.

```ts
import { processRun } from 'performance-kit-schema/process';
import { assertProcessedResult } from 'performance-kit-schema';
const metrics = processRun(rawResult);
assertProcessedResult(metrics);
```

The CLI processes complete observations in memory and atomically writes metrics.json directly. New runs measure the first ready frames, without warmup or repetitions. Capture occurs after measurement. Only current metrics are read from disk.

All stored durations use seconds. `typicalFps` and `tailFps` are derived from exact median and p95 intervals. `measuredIntervalSeconds` retains every positive measured frame interval at full precision for comparisons and viewer histogram calculations. Its length must match `statistics.intervalCount`.

Timeline coordinates use client-relative seconds from `startReceived`, using zero when start was never received. Client init time is renderStart minus startReceived. No cross-clock differences are calculated. Phase marks require a current ID and reporter clock; network conditions are required in every result.

`timing.timeUnit` is `epochSeconds`. `timing.harness` retains independent harness stamps; `timing.reporter` retains hello, startReceived, ready, runStart and runEnd when available. `timing.messages` keeps clock-tagged send/receive stamps for diagnostics without subtracting clocks.

`frameSeconds` retains every consecutive visible frame timestamp, including the final frame. CPU and GPU costs use aligned nullable `cpuSeconds` and `gpuSeconds`. Display times round to 0.1 ms; costs round to 0.01 ms. Exact summaries and measured intervals remain full precision. `frameIndices` selects at most 1,536 extrema across the three series; adjacent timestamps reconstruct actual intervals rather than subtracting decimated samples.

`watchdogSeconds` retains init ticks through ready; `watchdogIndices` selects at most 512 endpoints, and `watchdogPeriodSeconds: 0.016` reconstructs lateness. Timeline and value units are seconds. Phase, block and script coordinates share the client origin; durationSeconds remains exact.

`downsampleExtrema` retains endpoints and chronological bucket extrema. Detail lists retain at most 128 phases, 256 longest blocks and 256 longest script attributions; phase duration totals use the full observation set. Histogram bins are computed in the viewer from exact measured intervals.
