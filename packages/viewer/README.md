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

The viewer fetches the index, referenced metrics and screenshots, and an optional `README.md`. Metrics contain exact summary statistics, consecutive elapsed frame timestamps, aligned CPU/GPU costs, selected extrema indices, startup phases and blocks. All time measurements in schema v3 use seconds, including resource timings and network latency. Phases and blocks store `start` plus `duration`; the viewer computes their end. Unused message logs and script attribution are omitted. Regenerate older reports; there is no legacy reader. The framerate histogram is calculated from exact measured intervals; the responsiveness histogram uses consecutive init watchdog ticks minus its 16 ms period. Bins are never persisted.

Search, sorting and renderer/scene filters live in the top navigation. Every visible card timeline share the duration of the longest currently filtered timeline. Hover over a line chart to see the elapsed time and nearest frame's frame interval. The Init phases table shows each startup phase's total duration and total client init time. Clock synchronization and discrepancy tables are removed. Typical and Tail use the precomputed exact median/p95 FPS. CLI comparisons read metrics directly.

`performance-kit dev --out results/` always watches the results folder. Its index advertises `liveReload: true`, automatically connecting the viewer to Server-Sent Events. A `resultChanged` event includes `rendererId` and `sceneId`; the viewer fetches only that pair’s `metrics.json`, updates its capture and briefly highlights the affected card. A 404 removes that pair. A `readmeChanged` event refreshes only the introduction. Initial/reconnected `indexChanged` events refresh the full lightweight snapshot to recover missed changes. Reduced-motion preferences disable highlight animation.

`performance-kit serve` and static reports never subscribe or offer a live toggle. Optional README Markdown is rendered without enabling raw HTML. Missing README files hide the introduction.

Results are cards with four headline metrics. Use **Sort cards** and **Sort direction**
for best-first or worst-first ordering. Sorting, search and renderer/scene filters
are kept in the URL. Click a card to open `?result=<id>`; the **Performance results** breadcrumb (or browser
Back) returns to the list and restores its position. Hover/focus the name to copy
its bookmark link. Touch devices always show the bookmark control.

Init time is elapsed reporter time from navigation
until explicit render start. Overlapping
phases are not added together. Average FPS is the reciprocal of the arithmetic
mean of measured frame intervals. Max jitter is the maximum absolute deviation
from that mean. Worst responsiveness is maximum watchdog lateness across the run.
Missing measurements display a dash, have no grade, and sort last in either direction.

The grading table lives in `src/report.ts`: init is good below 250ms and warning
below 500ms; jitter is good below 5ms and warning below 15ms; FPS is good at 60 or
above and warning at 30 or above; responsiveness is good below 50ms and warning
below 300ms (the existing chart keeps its finer delay color bands).

The suite JSON accepts `phaseColors`, e.g. `{"assets": "#8b5cf6"}`. Overrides
travel with each result through processing and static report builds. Otherwise
phase names use a deterministic cyan/blue/violet hue (190–300°), reserving warm
and green colors for metric grades, with fixed 65% saturation and 58% lightness.
Duplicate phases share their color but remain separate rows in reported order.

Detail charts plot milliseconds; the frame chart also labels average FPS. Blue
average and red P95 lines show exact measured frame statistics, and the blue
init-done marker shows elapsed init time. Four equal Y divisions cover the
observed maximum using 5/10/25/50/100ms steps, extended to 250/500/1000ms and
larger as needed. X gridlines mark whole seconds. Responsiveness uses its own
scale rather than the previous hidden 300ms range.

After `pnpm build`, run `pnpm test:viewer` for the headless browser regression
checks (sorting/reload, navigation/back scroll, direct details, bookmarks and
clipboard, chart labels, mobile layout and dark theme). Set
`PERFORMANCE_KIT_CHROME_PATH` to use an existing Chrome executable.

Cards and details combine setup phases, watchdog lateness, and frame timing in one timeline. A solid phase band makes short setup phases visible above the shaded intervals. Details retain CPU/GPU selection, average/P95 reference lines, rendering and responsiveness histograms, bandwidth, and measured phase totals. Timing and bandwidth axes start at zero elapsed seconds from the first recorded activity; the reporter records navigation directly as the time origin. Any uncovered initialization time is inferred as translucent gray `unknown` blocks and included in phase totals.

The default sort is Average frame rate, Best first: highest average FPS (lowest average frame time). Explicit URL sort and direction selections take precedence.
