# Performance report viewer

This React/Vite application displays processed performance results. It uses the same neutral colors, system font, sticky navigation and 1120px layout as fidelity-kit. Light and dark themes follow the operating system; Canvas timelines redraw when the system theme changes.

Build it with `pnpm --filter @performance-kit/viewer build`; the CLI copies `dist/` into generated report sites. Serve the report over HTTP.

Results use the flat layout `results/<renderer.id>/<scene.id>/`: `raw.json` stores benchmark timestamps, `metrics.json` stores precomputed display data, and `screenshot.avif` stores the capture. The CLI processes measurements before the viewer opens. Static reports include metrics and screenshots without raw files.

`index.json` contains compact references:

```json
{
  "schemaVersion": 1,
  "results": [
    {
      "renderer": { "id": "three-base", "name": "Three-Base" },
      "scene": { "id": "cornell", "name": "Cornell box" },
      "metrics": "three-base/cornell/metrics.json",
      "screenshot": "three-base/cornell/screenshot.avif"
    }
  ]
}
```

The viewer fetches only this index, the referenced metrics and screenshots, and an optional `README.md` introduction. It never requests raw results. Metrics contain bounded display series, histogram bins, phase and block durations, script attribution, clock/discrepancy summaries and the four headline statistics. The timeline stores one elapsed time in seconds per frame, aligned CPU/GPU costs in milliseconds, and selected extrema indices for plotting. Consecutive elapsed times reconstruct plotted frame intervals; setup watchdog intervals similarly reconstruct lateness. Phase and block offsets use seconds, while durations and exact statistics remain in milliseconds. The browser maps these display values to pixels without calculating statistical summaries.

Search, sorting and separate renderer/scene filters live in the top navigation. Entries have stable IDs and friendly names. The four headline metrics show their names and values. Expanding a card exposes frame/CPU/GPU timelines and precomputed detail tables. Raw data and A/B analysis remain available through the CLI.

`performance-kit dev --out results/` always watches the results folder. Its index advertises `liveReload: true`, automatically connecting the viewer to Server-Sent Events. A `resultChanged` event includes `rendererId` and `sceneId`; the viewer fetches only that pair’s `metrics.json`, updates its capture and briefly highlights the affected card. A 404 removes that pair. A `readmeChanged` event refreshes only the introduction. Initial/reconnected `indexChanged` events refresh the full lightweight snapshot to recover missed changes. Reduced-motion preferences disable highlight animation.

`performance-kit serve` and static reports never subscribe or offer a live toggle. Optional README Markdown is rendered without enabling raw HTML. Missing README files hide the introduction.
