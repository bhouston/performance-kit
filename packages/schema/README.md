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

`ProcessedResult` describes schema v3 metrics.json with exact statistics and a compact
timeline. CPU, phase, resource and reporter lifecycle times are seconds from a single
reporter origin, stored directly without rounding or epoch conversion. Harness times
use an independent local origin. No clock synchronization or offset estimates exist.

`frameTimes` contains every visible frame start; nullable `cpuDurations` and
`gpuDurations` align with it. `frameIndices` retains up to 1,536 extrema for display.
`measuredIntervals` contains every positive measured interval for comparisons and
histograms. Watchdog ticks and blocks describe initialization only.

The chart uses `runEnd` as its exact maximum. Uncovered initialization time is
inferred as `unknown` phases. Phase identities preserve duplicate and overlapping
names. Block lists retain at most 256 longest intervals; summaries use all data.

One `runEnd` envelope contains all measurements, phases, downloads and environment.
The only other reporter envelope is a screenshot response after completion. The
harness can request a screenshot or abort. Failed runs have no measurement report.
