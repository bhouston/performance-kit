# Performance report viewer

This React/Vite application displays processed performance results. It uses the same neutral colors, system font, sticky navigation and 1120px layout as fidelity-kit. Light and dark themes follow the operating system; Canvas timelines redraw when the system theme changes.

Build it with `pnpm --filter @performance-kit/viewer build`; the CLI copies `dist/` into generated report sites. Serve the report over HTTP.

Results use the flat layout `results/<renderer.id>/<scene.id>/`: `metrics.json` is saved directly after measurement, and `screenshot.avif` stores the end-of-run capture. Both development and static reports use the same metrics-only layout.

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

The viewer fetches the index, referenced metrics and screenshots, and an optional `README.md`. Metrics contain exact summary statistics, consecutive elapsed frame timestamps, aligned CPU/GPU costs, selected extrema indices, startup phases, blocks and script attribution. All durations use seconds. The framerate histogram is calculated from exact measured intervals; the responsiveness histogram uses consecutive setup watchdog ticks minus its 16 ms period. Bins are never persisted.

Search, sorting and renderer/scene filters live in the top navigation. Every visible card timeline share the duration of the longest currently filtered timeline. Hover over a line chart to see the elapsed time and nearest frame's frame interval. The Phases table shows each startup phase's total duration and total client setup time. Clock synchronization and discrepancy tables are removed. Typical and Tail use the precomputed exact median/p95 FPS. CLI comparisons read metrics directly.

`performance-kit dev --out results/` always watches the results folder. Its index advertises `liveReload: true`, automatically connecting the viewer to Server-Sent Events. A `resultChanged` event includes `rendererId` and `sceneId`; the viewer fetches only that pair’s `metrics.json`, updates its capture and briefly highlights the affected card. A 404 removes that pair. A `readmeChanged` event refreshes only the introduction. Initial/reconnected `indexChanged` events refresh the full lightweight snapshot to recover missed changes. Reduced-motion preferences disable highlight animation.

`performance-kit serve` and static reports never subscribe or offer a live toggle. Optional README Markdown is rendered without enabling raw HTML. Missing README files hide the introduction.
