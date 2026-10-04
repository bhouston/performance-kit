import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { deriveRun, summarizeRuns, compareRuns, type Point } from 'performance-kit-schema/derive';
import { frameTimeColor, responsivenessColor } from 'performance-kit-schema/colorScales';
import type { RunResult } from 'performance-kit-schema';
import './style.css';
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
      ctx.font = '10px system-ui';
      ctx.strokeStyle = '#343d4e';
      ctx.fillStyle = '#8f9baf';
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
              { load: '#5a44904d', process: '#367b9c4d', compile: '#bf7d384d' } as Record<string, string>
            )[p.phase]!;
            ctx.fillRect(
              x(p.start - origin),
              10,
              Math.max(1, x((p.end ?? r.reporter.ready ?? p.start) - origin) - x(p.start - origin)),
              height - 38,
            );
            ctx.fillStyle = '#a9b6ca';
            ctx.fillText(p.phase, x(p.start - origin) + 3, 20);
          }
          if (r.reporter.ready !== undefined) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#a2a5ff';
            ctx.beginPath();
            ctx.moveTo(x(r.reporter.ready - origin), 8);
            ctx.lineTo(x(r.reporter.ready - origin), height - 28);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#a2a5ff';
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
              ctx.strokeStyle = '#7a8da680';
              ctx.beginPath();
              const runStart = r.reporter.runStart ?? origin;
              ctx.moveTo(x(runStart - origin), y(v));
              ctx.lineTo(width - 14, y(v));
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = '#a8b1c1';
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
    return () => observer.disconnect();
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
        <h3>Repetition overlays</h3>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="intervals">Frame intervals</option>
          <option value="cpu">CPU submit</option>
          <option value="gpu">GPU cost</option>
        </select>
      </div>
      <Timeline runs={items.map((i) => i.result)} kind={kind} />
      <div className="detail-grid">
        <section>
          <h3>Frame distribution · first repetition</h3>
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
                  <td>{b.sources.join(', ')}</td>
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
        {run.environment?.host?.os ?? 'OS unspecified'} · vsync {run.config.vsync} ·{' '}
        {run.environment?.crossOriginIsolated ? 'isolated clocks' : 'clock isolation unavailable'}
      </p>
    </div>
  );
}
function Card({ items }: { items: RecordItem[] }) {
  const [open, setOpen] = useState(false),
    r = items[0]!.result,
    d = deriveRun(r),
    summary = summarizeRuns(items.map((i) => i.result));
  return (
    <article className="card">
      <div className="card-main">
        <div className="capture">
          {items[0]!.capture ? (
            <img src={items[0]!.capture} alt={`${r.entry.name} render capture`} loading="lazy" />
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
                {r.entry.name} <span>{open ? '−' : '+'}</span>
              </button>
              <div className="labels">
                {r.entry.labels.map((l) => (
                  <span key={l.key + l.value}>
                    {l.key}
                    <b>{l.value}</b>
                  </span>
                ))}
                <span>{items.length} reps</span>
                <span>{r.config.vsync === 'on' ? 'vsync on' : 'uncapped'}</span>
                {summary.unstable && <span className="warning">unstable</span>}
                {r.status !== 'ok' && <span className="warning">{r.status}</span>}
              </div>
            </div>
            <div className="stats">
              <div>
                <small>Typical</small>
                <strong>{number(summary.median)}</strong>
                <em>{summary.median ? `${Math.round(1000 / summary.median)} fps` : 'no frames'}</em>
                {summary.repetitions > 1 && (
                  <span
                    className="rep-range"
                    title={`Repetition medians: ${number(summary.min)} – ${number(summary.max)}`}
                    aria-label={`Repetition medians ${number(summary.min)} to ${number(summary.max)}`}
                  >
                    <i
                      style={{
                        left: `${summary.max === summary.min ? 50 : ((summary.median! - summary.min!) / (summary.max! - summary.min!)) * 100}%`,
                      }}
                    />
                  </span>
                )}
              </div>
              <div title={`p99 ${number(d.p99)}`}>
                <small>Tail · p95</small>
                <strong>{number(d.p95)}</strong>
                <em>first repetition</em>
              </div>
              <div>
                <small>Jitter · IQR</small>
                <strong>{number(d.iqr)}</strong>
                <em>middle 50%</em>
              </div>
              <div title={`Max setup block ${number(d.setupMaxBlockMs)}`}>
                <small>Setup</small>
                <strong>{number(d.setupMs === undefined ? undefined : d.setupMs / 1000, 's')}</strong>
                <em>time to ready</em>
              </div>
            </div>
          </div>
          <Timeline runs={[r]} />
        </div>
      </div>
      {r.error && <p className="error">{r.error.message}</p>}
      {open && <Detail items={items} />}
    </article>
  );
}
function Comparison({ items }: { items: RecordItem[] }) {
  const keys = [...new Set(items.flatMap((i) => i.result.entry.labels.map((l) => l.key)))];
  const [key, setKey] = useState(keys.includes('renderer') ? 'renderer' : (keys[0] ?? '')),
    [a, setA] = useState(''),
    [b, setB] = useState('');
  const values = [
    ...new Set(items.flatMap((i) => i.result.entry.labels.filter((l) => l.key === key).map((l) => l.value))),
  ];
  let rows: React.ReactNode[] = [];
  if (a && b && a !== b) {
    const groups = new Map<string, { a: RunResult[]; b: RunResult[] }>();
    for (const i of items) {
      const value = i.result.entry.labels.find((l) => l.key === key)?.value;
      if (value !== a && value !== b) continue;
      const identity = i.result.entry.labels
        .filter((l) => l.key !== key)
        .map((l) => `${l.key}:${l.value}`)
        .toSorted()
        .join(' · ');
      const group = groups.get(identity) ?? { a: [], b: [] };
      group[value === a ? 'a' : 'b'].push(i.result);
      groups.set(identity, group);
    }
    rows = [...groups]
      .filter(([, g]) => g.a.length && g.b.length)
      .map(([name, g]) => {
        try {
          const c = compareRuns(g.a, g.b);
          return (
            <tr key={name}>
              <td>{name || 'all entries'}</td>
              <td>{number(c.medianA)}</td>
              <td>{number(c.medianB)}</td>
              <td>
                {c.ratio.toFixed(3)}× [{c.confidenceInterval.map((v) => v.toFixed(3)).join(', ')}]
              </td>
              <td>
                {a} {c.verdict}
              </td>
              <td>{c.pValue.toFixed(4)}</td>
            </tr>
          );
        } catch (e) {
          return (
            <tr key={name}>
              <td>{name}</td>
              <td colSpan={5}>{String(e)}</td>
            </tr>
          );
        }
      });
  }
  return (
    <section className="compare">
      <h2>Compare renderers</h2>
      <div className="controls">
        <select
          aria-label="Comparison label"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setA('');
            setB('');
          }}
        >
          {keys.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select aria-label="Group A" value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">Choose A</option>
          {values.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <span>versus</span>
        <select aria-label="Group B" value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">Choose B</option>
          {values.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      {rows.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Held labels</th>
                <th>A median</th>
                <th>B median</th>
                <th>A/B · bootstrap 95% CI</th>
                <th>Verdict</th>
                <th>Mann–Whitney p</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          Choose two label values. Comparisons pair matching remaining labels and resample repetitions.
        </p>
      )}
    </section>
  );
}
function App() {
  const [items, setItems] = useState<RecordItem[]>([]),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('name'),
    [label, setLabel] = useState(''),
    [mode, setMode] = useState('all'),
    [live, setLive] = useState(location.pathname.endsWith('/live')),
    [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('./index.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load results (${response.status})`);
        const data = (await response.json()) as { runs: RecordItem[] };
        if (active) {
          setItems(data.runs ?? []);
          setError('');
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    void refresh();
    let events: EventSource | undefined;
    if (live) {
      events = new EventSource('./events');
      events.addEventListener('open', () => setConnected(true));
      events.addEventListener('error', () => setConnected(false));
      events.addEventListener('message', () => void refresh());
      events.addEventListener('run', () => void refresh());
      events.addEventListener('schedule', () => void refresh());
    }
    return () => {
      active = false;
      events?.close();
    };
  }, [live]);
  const labels = [...new Set(items.flatMap((i) => i.result.entry.labels.map((l) => `${l.key}=${l.value}`)))].toSorted();
  const groups = new Map<string, RecordItem[]>();
  for (const i of items) {
    const r = i.result;
    if (query && !`${r.entry.name} ${r.entry.id}`.toLowerCase().includes(query.toLowerCase())) continue;
    if (label && !r.entry.labels.some((l) => `${l.key}=${l.value}` === label)) continue;
    if (mode !== 'all' && r.config.vsync !== mode) continue;
    const key = `${r.suiteName ?? ''}/${r.entry.id}/${r.config.vsync}/${i.file.split('/runs/')[0]}`;
    const group = groups.get(key) ?? [];
    group.push(i);
    groups.set(key, group);
  }
  const cards = [...groups.values()].toSorted((a, b) =>
    sort === 'name'
      ? a[0]!.result.entry.name.localeCompare(b[0]!.result.entry.name)
      : (deriveRun(a[0]!.result)[sort as 'median' | 'p95' | 'iqr' | 'setupMs'] ?? Infinity) -
        (deriveRun(b[0]!.result)[sort as 'median' | 'p95' | 'iqr' | 'setupMs'] ?? Infinity),
  );
  return (
    <>
      <header>
        <a className="brand" href="./">
          <span>▥</span> performance-kit
        </a>
        <div className="header-status">
          <span className={connected ? 'dot connected' : 'dot'} />
          {live ? (connected ? 'live stream' : 'reconnecting') : 'static report'}
          <button onClick={() => setLive(!live)}>{live ? 'Pause live' : 'Connect live'}</button>
        </div>
      </header>
      <main>
        <div className="intro">
          <div className="eyebrow">RENDER PERFORMANCE / RAW DATA, SHARED CLOCKS</div>
          <h1>Every frame tells a story.</h1>
          <p>Inspect throughput, startup and stability across your renderer suite.</p>
        </div>
        <div className="controls filters">
          <input
            aria-label="Search entries"
            placeholder="Find a scene or renderer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Filter label" value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="">All labels</option>
            {labels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select aria-label="Vsync mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">All measurement modes</option>
            <option value="on">Vsync on</option>
            <option value="off">Uncapped throughput</option>
          </select>
          <select aria-label="Sort cards" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">Sort by name</option>
            <option value="median">Typical frame time</option>
            <option value="p95">Tail frame time</option>
            <option value="iqr">Jitter</option>
            <option value="setupMs">Setup time</option>
          </select>
        </div>
        <div className="list-heading">
          <h2>
            {cards.length} entries <small> / {items.length} raw runs</small>
          </h2>
          <div className="legend">
            <span className="green">●</span> ≤16.7ms <span className="yellow">●</span> 33.3ms{' '}
            <span className="red">●</span> ≥50ms
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {cards.map((g, i) => (
          <Card key={g[0]!.file || i} items={g} />
        ))}
        {!cards.length && !error && <div className="empty">Results will appear here when a benchmark completes.</div>}
        {items.length > 0 && <Comparison items={items} />}
        <footer>performance-kit · metrics derived from raw timestamps · CPU / GPU clocks remain separate</footer>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
