import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { createRoot } from 'react-dom/client';
import { deriveRun, summarizeRuns, type Point } from 'performance-kit-schema/derive';
import { frameTimeColor, responsivenessColor } from 'performance-kit-schema/colorScales';
import type { RunResult } from 'performance-kit-schema';
import './style.css';
const entryTitle = (run: RunResult) => `${run.entry.renderer.name} · ${run.entry.scene.name}`;
type RecordItem = { result: RunResult; file: string; capture?: string };
const number = (n: number | undefined, unit = 'ms') =>
  n === undefined ? '—' : `${n.toFixed(unit === 's' ? 2 : 1)}${unit}`;
function Timeline({ runs, kind = 'intervals' }: { runs: RunResult[]; kind?: 'intervals' | 'cpu' | 'gpu' }) {
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
      const all = runs.map((r) => ({ r, d: deriveRun(r) }));
      const origins = all.map(({ r, d }) =>
        d.offsetMs === undefined
          ? (r.reporter.hello ??
            r.reporter.phases?.[0]?.start.t ??
            r.reporter.frames[0]?.cpuStart ??
            r.reporter.ready ??
            r.reporter.runStart ??
            r.harness.startSent)
          : r.harness.startSent + d.offsetMs,
      );
      const maxTime = Math.max(
        1,
        ...all.map(
          ({ r }, i) => (r.reporter.runEnd ?? r.reporter.frames.at(-1)?.cpuStart ?? origins[i]!) - origins[i]!,
        ),
      );
      const ceiling = all.reduce((maximum, { d }) => d[kind].reduce((n, p) => Math.max(n, p.value), maximum), 50);
      const x = (t: number) => 36 + (t / maxTime) * (width - 50),
        y = (v: number) => height - 28 - (v / ceiling) * (height - 42);
      const style = getComputedStyle(canvas);
      const themeColor = (name: string) => style.getPropertyValue(name).trim();
      ctx.font = '10px system-ui';
      ctx.strokeStyle = themeColor('--chart-grid');
      ctx.fillStyle = themeColor('--muted-foreground');
      for (const v of [0, 16.7, 33.3, 50]) {
        ctx.beginPath();
        ctx.moveTo(36, y(v));
        ctx.lineTo(width - 14, y(v));
        ctx.stroke();
        ctx.fillText(`${Math.round(v)}`, 3, y(v) + 3);
      }
      ctx.fillText('ms', 3, height - 8);
      ctx.fillText(all[0]?.d.offsetMs === undefined ? '0s · reporter-relative' : '0s', 36, height - 8);
      ctx.fillText(`${(maxTime / 1000).toFixed(1)}s`, width - 43, height - 8);
      all.forEach(({ r, d }, rep) => {
        const origin = origins[rep]!;
        if (rep === 0) {
          for (const p of d.phases) {
            ctx.fillStyle = (
              {
                load: themeColor('--chart-load'),
                process: themeColor('--chart-process'),
                compile: themeColor('--chart-compile'),
              } as Record<string, string>
            )[p.phase]!;
            ctx.fillRect(
              x(p.start - origin),
              10,
              Math.max(1, x((p.end ?? r.reporter.ready ?? p.start) - origin) - x(p.start - origin)),
              height - 38,
            );
            ctx.fillStyle = themeColor('--muted-foreground');
            ctx.fillText(p.phase, x(p.start - origin) + 3, 20);
          }
          if (r.reporter.ready !== undefined) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = themeColor('--chart-ready');
            ctx.beginPath();
            ctx.moveTo(x(r.reporter.ready - origin), 8);
            ctx.lineTo(x(r.reporter.ready - origin), height - 28);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = themeColor('--chart-ready');
            ctx.fillText('ready', x(r.reporter.ready - origin) + 4, 34);
          }
          if (d.median !== undefined && kind === 'intervals') {
            const reference: [number, string][] =
              Math.abs(y(d.median) - y(d.p95!)) < 12
                ? [[d.median, 'median / p95']]
                : [
                    [d.median, 'median'],
                    [d.p95!, 'p95'],
                  ];
            for (const [v, label] of reference) {
              ctx.setLineDash([4, 5]);
              ctx.strokeStyle = themeColor('--chart-reference');
              ctx.beginPath();
              const runStart = r.reporter.runStart ?? d.intervals[0]?.t ?? origin;
              ctx.moveTo(x(runStart - origin), y(v));
              ctx.lineTo(width - 14, y(v));
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = themeColor('--muted-foreground');
              ctx.textAlign = 'right';
              ctx.fillText(label, width - 16, y(v) - 3);
              ctx.textAlign = 'left';
            }
          }
        }
        const series = (points: Point[], color: (v: number) => string, setup = false) => {
          ctx.globalAlpha = rep ? 0.5 : 1;
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1]!,
              b = points[i]!;
            const ax = x(a.t - origin),
              bx = x(b.t - origin),
              ay = setup ? height - 28 - (Math.min(a.value, 300) / 300) * (height - 42) : y(a.value),
              by = setup ? height - 28 - (Math.min(b.value, 300) / 300) * (height - 42) : y(b.value);
            const gradient = ctx.createLinearGradient(ax, ay, bx, by);
            gradient.addColorStop(0, color(a.value));
            gradient.addColorStop(1, color(b.value));
            ctx.strokeStyle = gradient;
            ctx.lineWidth = setup ? 1 : 1.5;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        };
        series(d[kind], frameTimeColor);
        if (rep === 0)
          series(
            d.watchdog.filter((p) => r.reporter.ready !== undefined && p.t <= r.reporter.ready),
            responsivenessColor,
            true,
          );
      });
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
  }, [runs, kind]);
  return (
    <canvas
      ref={ref}
      className="timeline"
      aria-label={`${kind} timeline with setup phases, ready marker and frame timings`}
    />
  );
}
function Histogram({ run }: { run: RunResult }) {
  const values = deriveRun(run).intervals.map((p) => p.value);
  const bins = Array<number>(24).fill(0);
  const max = values.reduce((n, v) => Math.max(n, v), 50);
  values.forEach((v) => bins[Math.min(23, Math.floor((v / max) * 24))]++);
  const peak = Math.max(1, ...bins);
  return (
    <div>
      <div className="histogram">
        {bins.map((v, i) => (
          <div
            key={i}
            title={`${((i * max) / 24).toFixed(1)}ms: ${v} frames`}
            style={{
              height: `${Math.max(2, (v / peak) * 100)}%`,
              background: frameTimeColor((i * max) / 24),
            }}
          />
        ))}
      </div>
      <div className="axis">
        0ms{' '}
        <span>
          {max.toFixed(1)}ms · {values.length} intervals
        </span>
      </div>
    </div>
  );
}
function Detail({ items }: { items: RecordItem[] }) {
  const run = items[0]!.result,
    d = deriveRun(run);
  const [kind, setKind] = useState<'intervals' | 'cpu' | 'gpu'>('intervals');
  return (
    <div className="detail">
      <div className="detail-heading">
        <h3>Frame timings</h3>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="intervals">Frame intervals</option>
          <option value="cpu">CPU submit</option>
          <option value="gpu">GPU cost</option>
        </select>
      </div>
      <Timeline runs={items.map((i) => i.result)} kind={kind} />
      <div className="detail-grid">
        <section>
          <h3>Frame distribution</h3>
          <Histogram run={run} />
          <p>
            p99 {number(d.p99)} · MAD {number(d.mad)}
          </p>
        </section>
        <section>
          <h3>Clock & startup</h3>
          <p>
            Clock offset {number(d.offsetMs)} · drift {number(d.driftMs)} · hidden startup {number(d.hiddenStartupMs)}
          </p>
          <p>
            Unaccounted setup {number(d.unaccountedMs)} · blocked {number(d.setupBlockedMs)}
          </p>
          <table>
            <tbody>
              {d.discrepancies.map((v, i) => (
                <tr key={i}>
                  <td>{v.name}</td>
                  <td className={v.flagged ? 'warning' : ''}>{number(v.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Phases</h3>
          <table>
            <tbody>
              {d.phases.map((p, i) => (
                <tr key={i}>
                  <td>{p.phase}</td>
                  <td>{number(p.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Main-thread blocks</h3>
          <table>
            <tbody>
              {d.blocks.map((b, i) => (
                <tr key={i}>
                  <td>
                    {b.sources.join(', ')}
                    {(run.reporter.blocks ?? [])
                      .filter((raw) => raw.start < b.end && raw.end > b.start)
                      .flatMap((raw) => raw.scripts ?? [])
                      .map((script, index) => (
                        <div className="script-attribution" key={index}>
                          <strong>{script.sourceFunctionName || script.invoker || 'anonymous script'}</strong> ·{' '}
                          {number(script.end - script.start)}
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
                  <td>{number(b.end - b.start)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <div className="raw-links">
        {items.map((i) => (
          <a key={i.file} href={i.file} target="_blank" rel="noreferrer">
            Raw JSON · rep {i.result.repetition ?? 1} ↗
          </a>
        ))}
      </div>
      <p className="muted">
        {run.environment?.gpuAdapter?.description ?? 'GPU unspecified'} ·{' '}
        {run.environment?.host?.os ?? 'OS unspecified'} ·{' '}
        {run.environment?.crossOriginIsolated ? 'isolated clocks' : 'clock isolation unavailable'}
      </p>
    </div>
  );
}
function Card({
  items,
  revision = 0,
  captureEpoch = 0,
}: {
  items: RecordItem[];
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
    r = items[0]!.result,
    d = deriveRun(r),
    summary = summarizeRuns(items.map((i) => i.result));
  return (
    <article className="card" ref={ref}>
      <div className="card-main">
        <div className="capture">
          {items[0]!.capture ? (
            <img
              src={
                imageRevision
                  ? `${items[0]!.capture}${items[0]!.capture.includes('?') ? '&' : '?'}updated=${imageRevision}`
                  : items[0]!.capture
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
                <strong>{number(summary.median)}</strong>
              </div>
              <div title={`p99 ${number(d.p99)}`}>
                <small>Tail · p95</small>
                <strong>{number(d.p95)}</strong>
              </div>
              <div>
                <small>Jitter · IQR</small>
                <strong>{number(d.iqr)}</strong>
              </div>
              <div title={`Max setup block ${number(d.setupMaxBlockMs)}`}>
                <small>Setup</small>
                <strong>{number(d.setupMs === undefined ? undefined : d.setupMs / 1000, 's')}</strong>
              </div>
            </div>
          </div>
          <Timeline runs={[r]} />
        </div>
      </div>
      {(r.error || r.status !== 'ok') && <p className="error">{r.error?.message ?? r.status}</p>}
      {open && <Detail items={items} />}
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
    let latestRequest = 0;
    let everOpened = false;
    const pendingPaths = new Set<string>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const refresh = async (changedPaths: string[] = [], attempt = 0) => {
      changedPaths.forEach((path) => pendingPaths.add(path));
      const request = ++latestRequest;
      try {
        const [response, introduction] = await Promise.all([
          fetch('./index.json', { cache: 'no-store' }),
          fetch('./README.md', { cache: 'no-store' })
            .then((introResponse) => (introResponse.ok ? introResponse.text() : ''))
            .catch(() => ''),
        ]);
        if (!response.ok) throw new Error(`Unable to load results (${response.status})`);
        const data = (await response.json()) as { runs: RecordItem[]; liveReload?: boolean };
        if (active && request === latestRequest) {
          setItems(data.runs ?? []);
          setLive(data.liveReload === true);
          if (pendingPaths.size) {
            const changed = [...pendingPaths].map((path) => path.replace(/^\.\//, ''));
            const affected = (data.runs ?? []).filter((item) =>
              changed.some((path) =>
                [item.file, item.capture].some(
                  (file) =>
                    file &&
                    (path === '' ||
                      path === file ||
                      path.endsWith('/' + file) ||
                      file.startsWith(path.replace(/\/+$/, '') + '/')),
                ),
              ),
            );
            setRevisions((previous) => ({
              ...previous,
              ...Object.fromEntries(affected.map((item) => [item.file, performance.now()])),
            }));
          }
          pendingPaths.clear();
          setPreamble(introduction);
          setError('');
        }
      } catch (e) {
        if (active && request === latestRequest) {
          if (attempt < 2) {
            const timer = setTimeout(() => {
              retryTimers.delete(timer);
              if (active && request === latestRequest) void refresh([], attempt + 1);
            }, 500);
            retryTimers.add(timer);
          } else setError(String(e));
        }
      }
    };
    void refresh();
    let events: EventSource | undefined;
    if (live) {
      events = new EventSource('./events');
      events.addEventListener('open', () => {
        setCaptureEpoch(performance.now());
        void refresh(everOpened ? [''] : []);
        everOpened = true;
      });
      const receive = (message: MessageEvent<string>) => {
        let paths: string[] = [];
        try {
          const event = JSON.parse(message.data) as { paths?: unknown; path?: string; file?: string };
          paths = Array.isArray(event.paths)
            ? event.paths.filter((path): path is string => typeof path === 'string')
            : typeof event.file === 'string'
              ? [event.file]
              : typeof event.path === 'string'
                ? [event.path]
                : [];
        } catch {
          /* Events without data still request a fresh index. */
        }
        void refresh(paths);
      };
      events.addEventListener('message', receive);
      events.addEventListener('run', receive);
      events.addEventListener('schedule', receive);
      events.addEventListener('resultsChanged', receive);
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
  const groups = new Map<string, RecordItem[]>();
  for (const i of items) {
    const r = i.result;
    if (
      query &&
      !`${entryTitle(r)} ${r.entry.id} ${r.entry.renderer.id} ${r.entry.scene.id}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      continue;
    if (renderer && r.entry.renderer.id !== renderer) continue;
    if (scene && r.entry.scene.id !== scene) continue;
    const key = `${r.suiteName ?? ''}/${r.entry.id}/${r.config.vsync}/${i.file.split('/runs/')[0]}`;
    const group = groups.get(key) ?? [];
    group.push(i);
    groups.set(key, group);
  }
  const cards = [...groups.values()].toSorted((a, b) =>
    sort === 'name'
      ? entryTitle(a[0]!.result).localeCompare(entryTitle(b[0]!.result))
      : sort === 'median'
        ? (summarizeRuns(a.map((item) => item.result)).median ?? Infinity) -
          (summarizeRuns(b.map((item) => item.result)).median ?? Infinity)
        : (deriveRun(a[0]!.result)[sort as 'p95' | 'iqr' | 'setupMs'] ?? Infinity) -
          (deriveRun(b[0]!.result)[sort as 'p95' | 'iqr' | 'setupMs'] ?? Infinity),
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
              <option value="median">Typical frame time</option>
              <option value="p95">Tail frame time</option>
              <option value="iqr">Jitter</option>
              <option value="setupMs">Setup time</option>
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
            <span className="result-count" title={`${items.length} raw runs`}>
              {cards.length}/
              {
                new Set(
                  items.map(
                    (i) =>
                      `${i.result.suiteName ?? ''}/${i.result.entry.id}/${i.result.config.vsync}/${i.file.split('/runs/')[0]}`,
                  ),
                ).size
              }
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
        {cards.map((g, i) => (
          <Card
            key={g[0]!.file || i}
            items={g}
            captureEpoch={captureEpoch}
            revision={Math.max(0, ...g.map((item) => revisions[item.file] ?? 0))}
          />
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
