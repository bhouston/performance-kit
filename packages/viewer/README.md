# Performance report viewer

This independent React/Vite application is shared by static reports and the live reader. Build it with `pnpm --filter @performance-kit/viewer build`; the CLI copies `dist/` into the generated report site. Serve the report over HTTP, rather than opening its HTML directly, so the browser can fetch the JSON index.

`index.json` contains `{ "runs": [{ "result": <RunResult>, "file": "runsets/.../rep-1.json", "capture": "runsets/.../rep-1.png" }] }`. Paths are relative to the report root. Capture is optional. `/live` subscribes to `/events` using Server-Sent Events; named `run` / `schedule` and ordinary message events refresh the index. This page only reads data.

Cards aggregate repetitions within the same run set, stable entry and vsync mode. Typical is the median of repetition medians; tail and jitter show the first repetition. Expanding a card overlays every repetition and exposes CPU/GPU series, a histogram, phase durations, setup blocks, delivery discrepancies and raw JSON links. Comparison pairs entries with the same remaining labels and refuses mixed vsync modes.

Frame intervals use consecutive CPU starts within the measured bounds. Minimal frame-only records use all supplied frames. Percentiles linearly interpolate sorted observations. Jitter is IQR; MAD is the median absolute deviation. GPU nanoseconds are differenced separately and converted to milliseconds. Clock sync selects the lowest round-trip sample. Setup durations spanning clocks are hidden when sync is unavailable.

A/B ratios compare pooled median frame intervals. The seeded bootstrap samples entire repetitions, preserving within-run correlation. A single repetition cannot establish run-to-run uncertainty, so its verdict is conservatively “no detectable difference.” Mann–Whitney uses tie-corrected ranks and a normal approximation with continuity correction. Histograms and timeline colors use the shared pure schema derivation and color modules.
