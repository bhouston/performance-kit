# Performance report viewer

This React/Vite application powers static reports and the live reader. It uses the same neutral colors, system font, sticky navigation and 1120px layout as the fidelity-kit viewer. Light and dark themes follow the operating system; Canvas timelines redraw immediately when the system theme changes.

Build it with `pnpm --filter @performance-kit/viewer build`; the CLI copies `dist/` into the generated report site. Serve the report over HTTP so the browser can fetch its data.

`index.json` contains `{ "runs": [{ "result": <RunResult>, "file": "runsets/.../rep-1.json", "capture": "runsets/.../rep-1.avif" }] }`. Paths are relative to the report root. Capture is optional. Committed captures can use AVIF; PNG capture transport remains internal to the runner.

An optional `README.md` in the results folder supplies the report introduction, following fidelity-kit. The CLI serves and copies that file with the report. The viewer fetches it alongside the index and renders Markdown without enabling raw HTML; missing README files simply hide the introduction. There is no built-in marketing preamble.

Search, sorting and separate renderer/scene filters live in the top navigation. Every entry provides required renderer and scene references with stable IDs and friendly names. Card titles display those friendly names, while filters retain stable IDs. Cards aggregate repetitions within the same run set, stable entry and vsync mode. Typical is the median of successful repetition medians; tail and jitter show the first repetition. The four headline metrics show their names and values without secondary descriptions or repetition indicators. Expanding a card overlays available frame records and exposes CPU/GPU series, a histogram, phase durations, setup blocks, script attribution, delivery discrepancies and raw JSON links.

`performance-kit dev --out results/` always watches the results folder. Its index advertises `liveReload: true`, which automatically subscribes the viewer to `/events` using Server-Sent Events. File changes refresh the index and introduction and briefly highlight affected cards, matching fidelity-kit. Reduced-motion preferences disable the highlight animation. `performance-kit serve` and static builds never subscribe or offer a live toggle. The report only reads data. A/B comparisons remain available through the CLI.

Frame intervals use consecutive CPU starts within the measured bounds. Successful minimal frame-only records use all supplied frames; interrupted warmup is excluded. Percentiles linearly interpolate sorted observations. Jitter is IQR; MAD is the median absolute deviation. GPU nanoseconds are differenced separately and converted to milliseconds. Clock sync selects the lowest round-trip sample. Setup durations spanning clocks are hidden when sync is unavailable. Histograms and timeline colors use the shared pure schema derivation and color modules.
