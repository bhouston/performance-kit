import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { createRoot } from 'react-dom/client';
import { frameTimeColor, responsivenessColor } from 'performance-kit-schema/colorScales';
import type { NamedEntity, ProcessedResult } from 'performance-kit-schema';
import './style.css';
type Point = [seconds: number, milliseconds: number];
type ResultReference = { renderer: NamedEntity; scene: NamedEntity; metrics: string; screenshot?: string };
type RecordItem = ResultReference & { result: ProcessedResult };
const entryTitle = (result: ProcessedResult) => `${result.entry.renderer.name} · ${result.entry.scene.name}`;
const duration = (seconds: number | undefined) => {
  if (seconds === undefined) return '—';
  const milliseconds = Math.abs(seconds) < 1;
  const value = milliseconds ? seconds * 1000 : seconds;
  return `${Number(value.toPrecision(3))}${milliseconds ? 'ms' : 's'}`;
};
const fps = (value: number | undefined) => (value === undefined ? '—' : `${Number(value.toPrecision(3))}fps`);
function Timeline({ result, kind = 'intervals' }: { result: ProcessedResult; kind?: 'intervals' | 'cpu' | 'gpu' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const draw = () => {
      const width = canvas.clientWidth,
        height = canvas.clientHeight,
        dpr = devicePixelRatio;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      const { timeline, statistics } = result;
      const maxTime = Math.max(1, timeline.maxTime);
      // Exact summaries are processed offline. Adjacent elapsed times reconstruct only plotted intervals.
      const points: Point[] = timeline.frameIndices.flatMap((i) => {
        const time = timeline.frameSeconds[i]!;
        const value =
          kind === 'intervals'
            ? timeline.frameSeconds[i + 1] === undefined
              ? i === 0
                ? undefined
                : (time - timeline.frameSeconds[i - 1]!) * 1000
              : (timeline.frameSeconds[i + 1]! - time) * 1000
            : kind === 'cpu'
              ? timeline.cpuSeconds[i] === null
                ? null
                : timeline.cpuSeconds[i]! * 1000
              : timeline.gpuSeconds[i] === null
                ? null
                : timeline.gpuSeconds[i]! * 1000;
        return value === undefined || value === null || (kind === 'intervals' && value <= 0)
          ? []
          : [[time, value] as Point];
      });
      const watchdog: Point[] = timeline.watchdogIndices.flatMap((i) =>
        i === 0
          ? []
          : [
              [
                timeline.watchdogSeconds[i]!,
                Math.max(
                  0,
                  (timeline.watchdogSeconds[i]! - timeline.watchdogSeconds[i - 1]! - timeline.watchdogPeriodSeconds) *
                    1000,
                ),
              ] as Point,
            ],
      );
      const ceiling = Math.max(100, (statistics.p99 ?? statistics.p95 ?? 0) * 1200);
      const clipped = points.some((point) => point[1] > ceiling);
      const x = (t: number) => 36 + (t / maxTime) * (width - 50),
        y = (v: number) => height - 28 - (Math.min(v, ceiling) / ceiling) * (height - 42);
      const style = getComputedStyle(canvas),
        color = (name: string) => style.getPropertyValue(name).trim();
      ctx.font = '10px system-ui';
      ctx.strokeStyle = color('--chart-grid');
      ctx.fillStyle = color('--muted-foreground');
      let previousTick = Infinity;
      for (const v of [0, 16.7, 33.3, 50, ceiling]) {
        if (previousTick - y(v) < 12) continue;
        previousTick = y(v);
        ctx.beginPath();
        ctx.moveTo(36, y(v));
        ctx.lineTo(width - 14, y(v));
        ctx.stroke();
        ctx.fillText(`${v === ceiling && clipped ? '≥' : ''}${Math.round(v)}`, 3, y(v) + 3);
      }
      ctx.fillText('ms', 3, height - 8);
      ctx.fillText(statistics.offsetSeconds === undefined ? '0s · reporter-relative' : '0s', 36, height - 8);
      ctx.fillText(`${maxTime.toFixed(1)}s`, width - 43, height - 8);
      for (const phase of timeline.phases) {
        ctx.fillStyle = color(`--chart-${phase.phase}`);
        ctx.fillRect(
          x(phase.start),
          10,
          Math.max(1, x(phase.end ?? timeline.ready ?? phase.start) - x(phase.start)),
          height - 38,
        );
        ctx.fillStyle = color('--muted-foreground');
        ctx.fillText(phase.phase, x(phase.start) + 3, 20);
      }
      if (timeline.ready !== undefined) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = color('--chart-ready');
        ctx.beginPath();
        ctx.moveTo(x(timeline.ready), 8);
        ctx.lineTo(x(timeline.ready), height - 28);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color('--chart-ready');
        ctx.fillText('ready', x(timeline.ready) + 4, 34);
      }
      if (timeline.runStart !== undefined) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = color('--chart-reference');
        ctx.beginPath();
        ctx.moveTo(x(timeline.runStart), 8);
        ctx.lineTo(x(timeline.runStart), height - 28);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color('--muted-foreground');
        ctx.fillText('measured', x(timeline.runStart) + 4, 46);
      }
      if (statistics.median !== undefined && kind === 'intervals') {
        const reference: [number, string][] =
          Math.abs(y(statistics.median * 1000) - y(statistics.p95! * 1000)) < 12
            ? [[statistics.median * 1000, 'median / p95']]
            : [
                [statistics.median * 1000, 'median'],
                [statistics.p95! * 1000, 'p95'],
              ];
        for (const [value, label] of reference) {
          ctx.setLineDash([4, 5]);
          ctx.strokeStyle = color('--chart-reference');
          ctx.beginPath();
          ctx.moveTo(x(timeline.runStart ?? timeline.frameSeconds[0] ?? 0), y(value));
          ctx.lineTo(width - 14, y(value));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color('--muted-foreground');
          ctx.textAlign = 'right';
          ctx.fillText(label, width - 16, y(value) - 3);
          ctx.textAlign = 'left';
        }
      }
      const series = (samples: Point[], scale: (v: number) => string, setup = false) => {
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1]!,
            b = samples[i]!;
          const ax = x(a[0]),
            bx = x(b[0]),
            ay = setup ? height - 28 - (Math.min(a[1], 300) / 300) * (height - 42) : y(a[1]),
            by = setup ? height - 28 - (Math.min(b[1], 300) / 300) * (height - 42) : y(b[1]);
          const gradient = ctx.createLinearGradient(ax, ay, bx, by);
          gradient.addColorStop(0, scale(a[1]));
          gradient.addColorStop(1, scale(b[1]));
          ctx.strokeStyle = gradient;
          ctx.lineWidth = setup ? 1 : 1.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      };
      series(points, frameTimeColor);
      series(watchdog, responsivenessColor, true);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const theme = matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', draw);
    return () => {
      observer.disconnect();
      theme.removeEventListener('change', draw);
    };
  }, [result, kind]);
  return (
    <canvas
      ref={ref}
      className="timeline"
      aria-label={`${kind} timeline with setup phases, ready marker and frame timings`}
    />
  );
}
function Histogram({ result }: { result: ProcessedResult }) {
  const { histogram } = result;
  return (
    <div>
      <div className="histogram">
        {histogram.bins.map((bin, i) => (
          <div
            key={i}
            title={`${duration(bin.start)}–${duration(bin.end)}: ${bin.count} frames`}
            style={{
              height: `${Math.max(2, (bin.count / Math.max(1, histogram.maxCount)) * 100)}%`,
              background: frameTimeColor(bin.start * 1000),
            }}
          />
        ))}
      </div>
      <div className="axis">
        0ms{' '}
        <span>
          {duration(histogram.bins.at(-1)?.end)} · {histogram.count} intervals
        </span>
      </div>
    </div>
  );
}
function Detail({ result }: { result: ProcessedResult }) {
  const { statistics, timeline } = result;
  const [kind, setKind] = useState<'intervals' | 'cpu' | 'gpu'>('intervals');
  return (
    <div className="detail">
      <div className="detail-heading">
        <h3>Frame timings</h3>
        <select aria-label="Timing series" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="intervals">Frame intervals</option>
          <option value="cpu">CPU submit</option>
          <option value="gpu">GPU cost</option>
        </select>
      </div>
      <Timeline result={result} kind={kind} />
      <div className="detail-grid">
        <section>
          <h3>Frame distribution</h3>
          <Histogram result={result} />
          <p>
            p99 {duration(statistics.p99)} · MAD {duration(statistics.mad)}
          </p>
          <p>
            CPU median {duration(statistics.cpuMedian)} · p95 {duration(statistics.cpuP95)}
          </p>
          <p>
            GPU median {duration(statistics.gpuMedian)} · p95 {duration(statistics.gpuP95)}
          </p>
        </section>
        <section>
          <h3>Clock & startup</h3>
          <p>
            Clock offset {duration(statistics.offsetSeconds)} · drift {duration(statistics.driftSeconds)} · hidden
            startup {duration(statistics.hiddenStartupSeconds)}
          </p>
          <p>
            Unaccounted setup {duration(statistics.unaccountedSeconds)} · blocked{' '}
            {duration(statistics.setupBlockedSeconds)}
          </p>
          <table>
            <tbody>
              {timeline.discrepancies.map((v, i) => (
                <tr key={i}>
                  <td>{v.name}</td>
                  <td className={v.flagged ? 'warning' : ''}>{duration(v.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Phases</h3>
          <table>
            <tbody>
              {timeline.phases.map((p, i) => (
                <tr key={i}>
                  <td>{p.phase}</td>
                  <td>{duration(p.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Main-thread blocks</h3>
          <table>
            <tbody>
              {timeline.blocks.map((b, i) => (
                <tr key={i}>
                  <td>
                    {b.sources.join(', ')}
                    {result.attribution
                      .filter((script) => script.start < b.end && script.end > b.start)
                      .map((script, index) => (
                        <div className="script-attribution" key={index}>
                          <strong>{script.sourceFunctionName || script.invoker || 'anonymous script'}</strong> ·{' '}
                          {duration(script.durationSeconds)}
                          <span>
                            {script.sourceURL || 'source unavailable'}
                            {script.sourceCharPosition === undefined ? '' : ` @${script.sourceCharPosition}`}
                          </span>
                          {script.invoker && (
                            <span>
                              {script.invokerType ? `${script.invokerType}: ` : ''}
                              {script.invoker}
                            </span>
                          )}
                        </div>
                      ))}
                  </td>
                  <td>{duration(b.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <p className="muted">
        {result.environment?.gpuAdapter?.description ?? 'GPU unspecified'} ·{' '}
        {result.environment?.host?.os ?? 'OS unspecified'} ·{' '}
        {result.environment?.crossOriginIsolated ? 'isolated clocks' : 'clock isolation unavailable'}
      </p>
    </div>
  );
}
function Card({
  item,
  revision = 0,
  captureEpoch = 0,
}: {
  item: RecordItem;
  revision?: number;
  captureEpoch?: number;
}) {
  const imageRevision = Math.max(revision, captureEpoch);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!revision || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const node = ref.current!;
    node.classList.remove('reloaded');
    const frame = requestAnimationFrame(() => node.classList.add('reloaded'));
    return () => cancelAnimationFrame(frame);
  }, [revision]);
  const [open, setOpen] = useState(false),
    r = item.result,
    d = r.statistics;
  return (
    <article className="card" ref={ref}>
      <div className="card-main">
        <div className="capture">
          {item.screenshot ? (
            <img
              src={
                imageRevision
                  ? `${item.screenshot}${item.screenshot.includes('?') ? '&' : '?'}updated=${imageRevision}`
                  : item.screenshot
              }
              alt={`${entryTitle(r)} render capture`}
              loading="lazy"
            />
          ) : (
            <div className="capture-placeholder">
              ◇<small>capture unavailable</small>
            </div>
          )}
        </div>
        <div className="card-body">
          <div className="card-heading">
            <div>
              <button className="entry-title" onClick={() => setOpen(!open)} aria-expanded={open}>
                {entryTitle(r)} <span>{open ? '−' : '+'}</span>
              </button>
            </div>
            <div className="stats">
              <div>
                <small>Typical</small>
                <strong>{fps(d.typicalFps)}</strong>
              </div>
              <div title={`p99 ${duration(d.p99)}`}>
                <small>Tail · p95</small>
                <strong>{fps(d.tailFps)}</strong>
              </div>
              <div>
                <small>Jitter · IQR</small>
                <strong>{duration(d.iqr)}</strong>
              </div>
              <div title={`Max setup block ${duration(d.setupMaxBlockSeconds)}`}>
                <small>Setup</small>
                <strong>{duration(d.setupSeconds)}</strong>
              </div>
            </div>
          </div>
          <Timeline result={r} />
        </div>
      </div>
      {(r.error || r.status !== 'ok') && <p className="error">{r.error?.message ?? r.status}</p>}
      {open && <Detail result={r} />}
    </article>
  );
}
function App() {
  const [items, setItems] = useState<RecordItem[]>([]),
    [error, setError] = useState(''),
    [preamble, setPreamble] = useState(''),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('name'),
    [renderer, setRenderer] = useState(''),
    [scene, setScene] = useState(''),
    [live, setLive] = useState(false),
    [revisions, setRevisions] = useState<Record<string, number>>({}),
    [captureEpoch, setCaptureEpoch] = useState(0);
  useEffect(() => {
    let active = true;
    let snapshotRequest = 0;
    let seenSnapshotEvent = false;
    const pairRequests = new Map<string, number>();
    const pairApplied = new Map<string, number>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const retry = (operation: () => void) => {
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        if (active) operation();
      }, 500);
      retryTimers.add(timer);
    };
    const readIntroduction = async () => {
      try {
        const response = await fetch('./README.md', { cache: 'no-store' });
        const text = response.ok ? await response.text() : '';
        if (active) setPreamble(text);
      } catch {
        /* The introduction is optional. */
      }
    };
    const refresh = async (flash = false, attempt = 0) => {
      const request = ++snapshotRequest;
      const startedPairs = new Map(pairRequests);
      const newer = (key: string) => (pairApplied.get(key) ?? 0) > (startedPairs.get(key) ?? 0);
      try {
        const response = await fetch('./index.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load results (${response.status})`);
        const index = (await response.json()) as { schemaVersion: 1; results: ResultReference[]; liveReload?: boolean };
        const loaded = await Promise.all(
          (index.results ?? []).map(async (item) => {
            const metrics = await fetch(item.metrics, { cache: 'no-store' });
            if (!metrics.ok) throw new Error(`Unable to load metrics (${metrics.status})`);
            return { ...item, result: (await metrics.json()) as ProcessedResult };
          }),
        );
        if (active && request === snapshotRequest) {
          setItems((previous) => {
            const current = new Map(previous.map((item) => [item.metrics, item]));
            const loadedKeys = new Set(loaded.map((item) => item.metrics));
            const merged = loaded.flatMap((item) =>
              newer(item.metrics) ? (current.has(item.metrics) ? [current.get(item.metrics)!] : []) : [item],
            );
            return [...merged, ...previous.filter((item) => !loadedKeys.has(item.metrics) && newer(item.metrics))];
          });
          setLive(index.liveReload === true);
          if (flash)
            setRevisions((previous) => ({
              ...previous,
              ...Object.fromEntries(loaded.map((item) => [item.metrics, performance.now()])),
            }));
          setError('');
        }
      } catch (failure) {
        if (active && request === snapshotRequest) {
          if (attempt < 2)
            retry(() => {
              if (snapshotRequest === request) void refresh(flash, attempt + 1);
            });
          else setError(String(failure));
        }
      }
    };
    const updatePair = async (rendererId: string, sceneId: string, attempt = 0, version?: number) => {
      const directory = `${encodeURIComponent(rendererId)}/${encodeURIComponent(sceneId)}`;
      const metrics = `${directory}/metrics.json`;
      const request = version ?? (pairRequests.get(metrics) ?? 0) + 1;
      pairRequests.set(metrics, request);
      try {
        const response = await fetch(metrics, { cache: 'no-store' });
        if (!active || pairRequests.get(metrics) !== request) return;
        if (response.status === 404) {
          pairApplied.set(metrics, request);
          setItems((previous) => previous.filter((item) => item.metrics !== metrics));
          setError('');
          return;
        }
        if (!response.ok) throw new Error(`Unable to load metrics (${response.status})`);
        const result = (await response.json()) as ProcessedResult;
        if (!active || pairRequests.get(metrics) !== request) return;
        const item: RecordItem = {
          renderer: result.entry.renderer,
          scene: result.entry.scene,
          metrics,
          result,
          ...(result.screenshot ? { screenshot: `${directory}/screenshot.avif` } : {}),
        };
        pairApplied.set(metrics, request);
        setItems((previous) => {
          const other = previous.filter((existing) => existing.metrics !== metrics);
          return [...other, item];
        });
        setRevisions((previous) => ({ ...previous, [metrics]: performance.now() }));
        setError('');
      } catch (failure) {
        if (active && pairRequests.get(metrics) === request) {
          if (attempt < 2)
            retry(() => {
              if (pairRequests.get(metrics) === request) void updatePair(rendererId, sceneId, attempt + 1, request);
            });
          else setError(String(failure));
        }
      }
    };
    void refresh();
    void readIntroduction();
    let events: EventSource | undefined;
    if (live) {
      events = new EventSource('./events');
      events.addEventListener('open', () => setCaptureEpoch(performance.now()));
      const receive = (message: MessageEvent<string>) => {
        try {
          const event = JSON.parse(message.data) as { type?: string; rendererId?: string; sceneId?: string };
          if (
            event.type === 'resultChanged' &&
            typeof event.rendererId === 'string' &&
            typeof event.sceneId === 'string'
          )
            void updatePair(event.rendererId, event.sceneId);
          else if (event.type === 'readmeChanged') void readIntroduction();
          else if (event.type === 'indexChanged') {
            void refresh(seenSnapshotEvent);
            void readIntroduction();
            seenSnapshotEvent = true;
          }
        } catch {
          /* Ignore non-data SSE notifications. */
        }
      };
      events.addEventListener('message', receive);
      events.addEventListener('resultChanged', receive);
      events.addEventListener('readmeChanged', receive);
      events.addEventListener('indexChanged', receive);
    }
    return () => {
      active = false;
      retryTimers.forEach((timer) => clearTimeout(timer));
      events?.close();
    };
  }, [live]);
  const renderers = [
    ...new Map(items.map((item) => [item.result.entry.renderer.id, item.result.entry.renderer])).values(),
  ].toSorted((a, b) => a.name.localeCompare(b.name));
  const scenes = [
    ...new Map(items.map((item) => [item.result.entry.scene.id, item.result.entry.scene])).values(),
  ].toSorted((a, b) => a.name.localeCompare(b.name));
  const cards = items
    .filter((item) => {
      const result = item.result;
      if (
        query &&
        !`${entryTitle(result)} ${result.entry.renderer.id} ${result.entry.scene.id}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
        return false;
      return (!renderer || result.entry.renderer.id === renderer) && (!scene || result.entry.scene.id === scene);
    })
    .toSorted((a, b) =>
      sort === 'name'
        ? entryTitle(a.result).localeCompare(entryTitle(b.result))
        : (a.result.statistics[sort as 'median' | 'p95' | 'iqr' | 'setupSeconds'] ?? Infinity) -
          (b.result.statistics[sort as 'median' | 'p95' | 'iqr' | 'setupSeconds'] ?? Infinity),
    );
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <a className="brand" href="./">
            Performance results
          </a>
          <nav className="header-controls" aria-label="Report controls">
            <input
              aria-label="Search entries"
              placeholder="Entry Filter"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select aria-label="Sort cards" title="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Name</option>
              <option value="median">Typical FPS</option>
              <option value="p95">Tail FPS</option>
              <option value="iqr">Jitter</option>
              <option value="setupSeconds">Setup time</option>
            </select>
            <select
              aria-label="Renderers"
              title="Renderers"
              value={renderer}
              onChange={(e) => setRenderer(e.target.value)}
            >
              <option value="">All renderers</option>
              {renderers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select aria-label="Scenes" title="Scenes" value={scene} onChange={(e) => setScene(e.target.value)}>
              <option value="">All scenes</option>
              {scenes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="result-count">
              {cards.length}/{items.length}
            </span>
            <a
              className="repository-link"
              aria-label="performance-kit repository"
              href="https://github.com/bhouston/performance-kit"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 19c-4.3 1.3-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.4 6.2-1.5 6.2-7a5.5 5.5 0 0 0-1.5-3.8 5.1 5.1 0 0 0-.1-3.8S17.5.4 15 2.3a13.4 13.4 0 0 0-6 0C6.5.4 5.3.8 5.3.8a5.1 5.1 0 0 0-.1 3.8A5.5 5.5 0 0 0 3.7 8c0 5.5 3.2 6.6 6.2 7a3.4 3.4 0 0 0-.9 2.7V22" />
              </svg>
            </a>
          </nav>
        </div>
      </header>
      <main>
        {preamble && (
          <div className="preamble">
            <ReactMarkdown>{preamble}</ReactMarkdown>
          </div>
        )}
        <div className="list-heading">
          <div className="legend">
            <span className="green">●</span> 60fps <span className="orange">●</span> 30fps{' '}
            <span className="red">●</span> 20fps
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {cards.map((item) => (
          <Card key={item.metrics} item={item} captureEpoch={captureEpoch} revision={revisions[item.metrics] ?? 0} />
        ))}
        {!cards.length && !error && <div className="empty">Results will appear here when a benchmark completes.</div>}
      </main>
      <footer>
        Website powered by{' '}
        <a href="https://github.com/bhouston/performance-kit" rel="noopener noreferrer" target="_blank">
          performance-kit
        </a>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
